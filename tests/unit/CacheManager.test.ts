import { CacheManager, CacheEntry, CacheStats } from '../../src/optimization/CacheManager.js';

describe('CacheManager', () => {
  let cache: CacheManager;
  
  beforeEach(() => {
    cache = new CacheManager(5, 1); // 5 entries, 1MB max
  });
  
  afterEach(() => {
    cache.clear();
  });
  
  describe('Basic Operations', () => {
    it('should store and retrieve values', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });
    
    it('should return null for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeNull();
    });
    
    it('should check key existence', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('key2')).toBe(false);
    });
    
    it('should delete entries', () => {
      cache.set('key1', 'value1');
      expect(cache.delete('key1')).toBe(true);
      expect(cache.get('key1')).toBeNull();
      expect(cache.delete('key1')).toBe(false);
    });
    
    it('should clear all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      const cleared = cache.clear();
      
      expect(cleared).toBe(2);
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBeNull();
    });

    it('should handle undefined and null values', () => {
      cache.set('undefined', undefined);
      cache.set('null', null);
      cache.set('zero', 0);
      cache.set('false', false);
      cache.set('empty', '');

      expect(cache.get('undefined')).toBeUndefined();
      expect(cache.get('null')).toBeNull();
      expect(cache.get('zero')).toBe(0);
      expect(cache.get('false')).toBe(false);
      expect(cache.get('empty')).toBe('');
    });

    it('should handle complex object values', () => {
      const complexObject = {
        array: [1, 2, 3],
        nested: {
          property: 'value',
          number: 42
        },
        date: new Date('2024-01-01'),
        func: () => 'test'
      };

      cache.set('complex', complexObject);
      const retrieved = cache.get('complex');

      expect(retrieved.array).toEqual([1, 2, 3]);
      expect(retrieved.nested.property).toBe('value');
      expect(retrieved.date).toEqual(new Date('2024-01-01'));
      expect(typeof retrieved.func).toBe('function');
    });

    it('should handle very long keys', () => {
      const longKey = 'a'.repeat(1000);
      cache.set(longKey, 'value');
      expect(cache.get(longKey)).toBe('value');
      expect(cache.has(longKey)).toBe(true);
    });

    it('should handle special characters in keys', () => {
      const specialKeys = [
        'key with spaces',
        'key:with:colons',
        'key/with/slashes',
        'key-with-dashes',
        'key.with.dots',
        'key@with@symbols',
        'key#with#hash',
        'key$with$dollar',
        'key%with%percent',
        'émojis🎉',
        '中文键'
      ];

      specialKeys.forEach(key => {
        cache.set(key, `value-${key}`);
        expect(cache.get(key)).toBe(`value-${key}`);
      });
    });
  });
  
  describe('LRU Eviction', () => {
    it('should evict least recently used items when full', () => {
      // Fill cache to capacity
      for (let i = 1; i <= 5; i++) {
        cache.set(`key${i}`, `value${i}`);
      }
      
      // Add one more item, should evict key1
      cache.set('key6', 'value6');
      
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key6')).toBe('value6');
    });
    
    it('should update access order on get', () => {
      // Fill cache
      for (let i = 1; i <= 5; i++) {
        cache.set(`key${i}`, `value${i}`);
      }
      
      // Access key1 to make it most recently used
      cache.get('key1');
      
      // Add new item, should evict key2 (now least recently used)
      cache.set('key6', 'value6');
      
      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBeNull();
    });
  });
  
  describe('TTL (Time To Live)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    
    afterEach(() => {
      jest.useRealTimers();
    });
    
    it('should expire entries after TTL', () => {
      cache.set('key1', 'value1', 1000); // 1 second TTL
      
      expect(cache.get('key1')).toBe('value1');
      
      // Advance time by 1.5 seconds
      jest.advanceTimersByTime(1500);
      
      expect(cache.get('key1')).toBeNull();
    });
    
    it('should not expire entries without TTL', () => {
      cache.set('key1', 'value1'); // No TTL
      
      // Advance time significantly
      jest.advanceTimersByTime(10000);
      
      expect(cache.get('key1')).toBe('value1');
    });
    
    it('should return false for has() on expired entries', () => {
      cache.set('key1', 'value1', 1000);
      
      expect(cache.has('key1')).toBe(true);
      
      jest.advanceTimersByTime(1500);
      
      expect(cache.has('key1')).toBe(false);
    });
  });
  
  describe('Statistics', () => {
    it('should track basic stats', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      
      cache.get('key1');
      cache.get('key1');
      cache.get('key2');
      cache.get('nonexistent');
      
      const stats = cache.getStats();
      
      expect(stats.entries).toBe(2);
      expect(stats.totalHits).toBe(3);
      expect(stats.totalMisses).toBe(1);
      expect(stats.hitRate).toBe(0.75);
    });
    
    it('should track evictions', () => {
      // Fill cache beyond capacity
      for (let i = 1; i <= 7; i++) {
        cache.set(`key${i}`, `value${i}`);
      }
      
      const stats = cache.getStats();
      expect(stats.evictions).toBe(2); // 2 items evicted
    });
  });
  
  describe('Memory Management', () => {
    it('should track memory usage', () => {
      const largeValue = 'x'.repeat(1000);
      cache.set('large', largeValue);
      
      const stats = cache.getStats();
      expect(stats.totalSizeMB).toBeGreaterThan(0);
    });
    
    it('should evict based on memory limit', () => {
      const smallCache = new CacheManager(100, 0.001); // Very small memory limit
      
      const largeValue = 'x'.repeat(1000);
      smallCache.set('key1', largeValue);
      smallCache.set('key2', largeValue);
      
      // Should evict key1 due to memory pressure
      expect(smallCache.get('key1')).toBeNull();
      expect(smallCache.get('key2')).toBe(largeValue);
    });
  });
  
  describe('Hot Keys', () => {
    it('should return most frequently accessed keys', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      
      // Access keys different numbers of times
      cache.get('key1');
      cache.get('key1');
      cache.get('key1'); // 3 hits
      
      cache.get('key2');
      cache.get('key2'); // 2 hits
      
      cache.get('key3'); // 1 hit
      
      const hotKeys = cache.getHotKeys(2);
      
      expect(hotKeys).toHaveLength(2);
      expect(hotKeys[0].key).toBe('key1');
      expect(hotKeys[0].hits).toBe(3);
      expect(hotKeys[1].key).toBe('key2');
      expect(hotKeys[1].hits).toBe(2);
    });
  });
  
  describe('Expiring Soon', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    
    afterEach(() => {
      jest.useRealTimers();
    });
    
    it('should identify entries expiring soon', () => {
      cache.set('key1', 'value1', 1000); // 1 second
      cache.set('key2', 'value2', 10000); // 10 seconds
      cache.set('key3', 'value3'); // No expiry
      
      jest.advanceTimersByTime(500); // 0.5 seconds passed
      
      const expiringSoon = cache.getExpiringSoon(1000); // Within 1 second
      
      expect(expiringSoon).toContain('key1');
      expect(expiringSoon).not.toContain('key2');
      expect(expiringSoon).not.toContain('key3');
    });
  });
  
  describe('Import/Export', () => {
    it('should export cache state', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2', 5000);
      
      cache.get('key1'); // Create some hits
      
      const exported = cache.export();
      
      expect(exported.entries).toHaveLength(2);
      expect(exported.entries[0].key).toBe('key1');
      expect(exported.entries[0].value).toBe('value1');
      expect(exported.exportedAt).toBeGreaterThan(0);
    });
    
    it('should import cache state', () => {
      const data = {
        entries: [
          {
            key: 'key1',
            value: 'value1',
            hits: 5,
            createdAt: Date.now(),
            size: 100
          },
          {
            key: 'key2',
            value: 'value2',
            hits: 2,
            createdAt: Date.now(),
            expiresAt: Date.now() + 5000,
            size: 100
          }
        ],
        stats: {
          hits: 10,
          misses: 3
        }
      };
      
      cache.import(data);
      
      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBe('value2');
      
      const stats = cache.getStats();
      expect(stats.entries).toBe(2);
    });
    
    it('should skip expired entries during import', () => {
      const data = {
        entries: [
          {
            key: 'valid',
            value: 'value1',
            createdAt: Date.now(),
            size: 100
          },
          {
            key: 'expired',
            value: 'value2',
            createdAt: Date.now() - 10000,
            expiresAt: Date.now() - 5000, // Already expired
            size: 100
          }
        ]
      };
      
      cache.import(data);
      
      expect(cache.get('valid')).toBe('value1');
      expect(cache.get('expired')).toBeNull();
    });
  });
  
  describe('Preloading', () => {
    it('should preload multiple items', () => {
      const items = [
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: 'value2', ttlMs: 5000 },
        { key: 'key3', value: 'value3' }
      ];
      
      cache.preload(items);
      
      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBe('value2');
      expect(cache.get('key3')).toBe('value3');
    });

    it('should handle empty preload list', () => {
      expect(() => cache.preload([])).not.toThrow();
    });

    it('should respect cache limits during preload', () => {
      const items = Array.from({ length: 10 }, (_, i) => ({
        key: `key${i}`,
        value: `value${i}`
      }));

      cache.preload(items);

      // Should only have 5 items due to size limit
      const stats = cache.getStats();
      expect(stats.entries).toBe(5);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle rapid set/get operations', () => {
      const operations = 1000;
      
      for (let i = 0; i < operations; i++) {
        cache.set(`key${i}`, `value${i}`);
        expect(cache.get(`key${i}`)).toBe(`value${i}`);
      }
    });

    it('should handle concurrent operations gracefully', () => {
      const promises = [];
      
      for (let i = 0; i < 100; i++) {
        promises.push(
          new Promise<void>(resolve => {
            cache.set(`key${i}`, `value${i}`);
            cache.get(`key${i}`);
            resolve();
          })
        );
      }

      expect(() => Promise.all(promises)).not.toThrow();
    });

    it('should handle circular references in values', () => {
      const circular: any = { name: 'test' };
      circular.self = circular;

      expect(() => cache.set('circular', circular)).not.toThrow();
      const retrieved = cache.get('circular');
      expect(retrieved.name).toBe('test');
    });

    it('should handle very large values', () => {
      const largeValue = {
        data: 'x'.repeat(100000),
        numbers: Array.from({ length: 10000 }, (_, i) => i)
      };

      cache.set('large', largeValue);
      const retrieved = cache.get('large');
      
      expect(retrieved.data.length).toBe(100000);
      expect(retrieved.numbers.length).toBe(10000);
    });

    it('should handle extreme memory pressure', () => {
      const tinyCache = new CacheManager(100, 0.0001); // Extremely small memory limit
      
      // Should handle gracefully without crashing
      expect(() => {
        for (let i = 0; i < 100; i++) {
          tinyCache.set(`key${i}`, 'x'.repeat(1000));
        }
      }).not.toThrow();
    });

    it('should handle zero or negative cache sizes', () => {
      expect(() => new CacheManager(0, 1)).not.toThrow();
      expect(() => new CacheManager(-1, 1)).not.toThrow();
      expect(() => new CacheManager(5, 0)).not.toThrow();
      expect(() => new CacheManager(5, -1)).not.toThrow();
    });
  });

  describe('Performance and Stress Testing', () => {
    it('should maintain performance with many entries', () => {
      const start = Date.now();
      const entries = 1000;
      
      for (let i = 0; i < entries; i++) {
        cache.set(`perf${i}`, `value${i}`);
      }
      
      const setTime = Date.now() - start;
      
      const getStart = Date.now();
      for (let i = 0; i < entries; i++) {
        cache.get(`perf${i}`);
      }
      const getTime = Date.now() - getStart;
      
      // Performance should be reasonable (these are generous limits)
      expect(setTime).toBeLessThan(1000); // 1 second for 1000 sets
      expect(getTime).toBeLessThan(500);  // 0.5 second for 1000 gets
    });

    it('should handle frequent evictions efficiently', () => {
      const start = Date.now();
      
      // Force many evictions
      for (let i = 0; i < 1000; i++) {
        cache.set(`evict${i}`, `value${i}`);
      }
      
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(2000); // Should handle evictions efficiently
    });
  });

  describe('Memory Usage Tracking', () => {
    it('should accurately track memory usage', () => {
      const initialStats = cache.getStats();
      expect(initialStats.totalSizeMB).toBe(0);

      cache.set('test', 'value');
      const afterSet = cache.getStats();
      expect(afterSet.totalSizeMB).toBeGreaterThan(0);

      cache.delete('test');
      const afterDelete = cache.getStats();
      expect(afterDelete.totalSizeMB).toBe(0);
    });

    it('should handle memory calculation errors gracefully', () => {
      // Objects that can't be JSON.stringified
      const problematicValue = {};
      Object.defineProperty(problematicValue, 'toJSON', {
        value: () => { throw new Error('Cannot serialize'); }
      });

      expect(() => cache.set('problematic', problematicValue)).not.toThrow();
      expect(cache.get('problematic')).toBe(problematicValue);
    });
  });

  describe('Statistics Edge Cases', () => {
    it('should handle division by zero in statistics', () => {
      const emptyStats = cache.getStats();
      
      expect(emptyStats.hitRate).toBe(0);
      expect(emptyStats.avgHits).toBe(0);
      expect(emptyStats.entries).toBe(0);
      expect(emptyStats.totalHits).toBe(0);
      expect(emptyStats.totalMisses).toBe(0);
    });

    it('should track hit rates accurately over time', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      // Create specific hit/miss pattern
      cache.get('key1'); // hit
      cache.get('key1'); // hit
      cache.get('key2'); // hit
      cache.get('nonexistent'); // miss
      cache.get('nonexistent2'); // miss

      const stats = cache.getStats();
      expect(stats.totalHits).toBe(3);
      expect(stats.totalMisses).toBe(2);
      expect(stats.hitRate).toBe(0.6); // 3/5
    });
  });

  describe('Cleanup and Maintenance', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should clean up expired entries periodically', () => {
      cache.set('shortTtl', 'value', 1000);
      cache.set('longTtl', 'value', 10000);
      cache.set('noTtl', 'value');

      expect(cache.get('shortTtl')).toBe('value');
      expect(cache.get('longTtl')).toBe('value');
      expect(cache.get('noTtl')).toBe('value');

      // Advance past first TTL but before cleanup interval
      jest.advanceTimersByTime(1500);
      
      // Trigger cleanup by advancing to cleanup interval (60 seconds)
      jest.advanceTimersByTime(60000);

      expect(cache.get('shortTtl')).toBeNull();
      expect(cache.get('longTtl')).toBe('value');
      expect(cache.get('noTtl')).toBe('value');
    });
  });

  describe('Import/Export Edge Cases', () => {
    it('should handle malformed import data', () => {
      expect(() => cache.import(null)).not.toThrow();
      expect(() => cache.import(undefined)).not.toThrow();
      expect(() => cache.import({})).not.toThrow();
      expect(() => cache.import({ entries: null })).not.toThrow();
      expect(() => cache.import({ entries: 'invalid' })).not.toThrow();
    });

    it('should handle import data with missing properties', () => {
      const incompleteData = {
        entries: [
          { key: 'test1', value: 'value1' }, // Missing other properties
          { key: 'test2' }, // Missing value
          { value: 'value3' }, // Missing key
        ]
      };

      expect(() => cache.import(incompleteData)).not.toThrow();
      expect(cache.get('test1')).toBe('value1');
    });

    it('should export and import large datasets', () => {
      // Fill cache with substantial data
      for (let i = 0; i < 100; i++) {
        cache.set(`key${i}`, { data: 'x'.repeat(100), index: i });
      }

      const exported = cache.export();
      const newCache = new CacheManager(1000, 10);
      
      expect(() => newCache.import(exported)).not.toThrow();
      
      // Verify some entries (cache might have evicted some due to size limits)
      const stats = newCache.getStats();
      expect(stats.entries).toBeGreaterThan(0);
    });
  });

  describe('Constructor Edge Cases', () => {
    it('should handle extreme constructor parameters', () => {
      expect(() => new CacheManager(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).not.toThrow();
      expect(() => new CacheManager(0.5, 0.5)).not.toThrow();
      expect(() => new CacheManager(Number.MIN_VALUE, Number.MIN_VALUE)).not.toThrow();
    });

    it('should use default values when parameters are not provided', () => {
      const defaultCache = new CacheManager();
      
      // Should work with defaults
      defaultCache.set('test', 'value');
      expect(defaultCache.get('test')).toBe('value');
      
      const stats = defaultCache.getStats();
      expect(stats).toBeDefined();
    });
  });
});