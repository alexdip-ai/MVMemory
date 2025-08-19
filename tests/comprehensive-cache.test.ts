import { CacheManager } from '../src/optimization/CacheManager';

describe('Comprehensive CacheManager Tests', () => {
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

    it('should handle has() method', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('should delete entries', () => {
      cache.set('key1', 'value1');
      expect(cache.delete('key1')).toBe(true);
      expect(cache.delete('nonexistent')).toBe(false);
    });

    it('should clear all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      const cleared = cache.clear();
      expect(cleared).toBe(2);
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
      cache.set('key1', 'value1', 1000);
      expect(cache.get('key1')).toBe('value1');
      
      jest.advanceTimersByTime(1500);
      expect(cache.get('key1')).toBeNull();
    });

    it('should handle has() with expired entries', () => {
      cache.set('key1', 'value1', 1000);
      expect(cache.has('key1')).toBe(true);
      
      jest.advanceTimersByTime(1500);
      expect(cache.has('key1')).toBe(false);
    });
  });

  describe('LRU Eviction', () => {
    it('should evict least recently used items', () => {
      // Fill cache to capacity
      for (let i = 1; i <= 5; i++) {
        cache.set(`key${i}`, `value${i}`);
      }
      
      // Add one more, should evict key1
      cache.set('key6', 'value6');
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key6')).toBe('value6');
    });

    it('should update access order on get', () => {
      for (let i = 1; i <= 5; i++) {
        cache.set(`key${i}`, `value${i}`);
      }
      
      // Access key1 to make it most recently used
      cache.get('key1');
      
      // Add new item, should evict key2
      cache.set('key6', 'value6');
      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBeNull();
    });
  });

  describe('Memory Management', () => {
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

  describe('Statistics', () => {
    it('should track comprehensive stats', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      
      cache.get('key1'); // hit
      cache.get('key1'); // hit
      cache.get('key2'); // hit
      cache.get('nonexistent'); // miss
      
      const stats = cache.getStats();
      expect(stats.entries).toBe(2);
      expect(stats.totalHits).toBe(3);
      expect(stats.totalMisses).toBe(1);
      expect(stats.hitRate).toBe(0.75);
      expect(stats.totalSizeMB).toBeGreaterThan(0);
      expect(stats.avgHits).toBeGreaterThan(0);
      expect(stats.evictions).toBe(0);
    });

    it('should track evictions', () => {
      // Fill cache beyond capacity to trigger evictions
      for (let i = 1; i <= 7; i++) {
        cache.set(`key${i}`, `value${i}`);
      }
      
      const stats = cache.getStats();
      expect(stats.evictions).toBe(2);
    });
  });

  describe('Hot Keys Analysis', () => {
    it('should return most frequently accessed keys', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      
      // Create hit patterns
      for (let i = 0; i < 5; i++) cache.get('key1'); // 5 hits
      for (let i = 0; i < 3; i++) cache.get('key2'); // 3 hits
      cache.get('key3'); // 1 hit
      
      const hotKeys = cache.getHotKeys(2);
      expect(hotKeys).toHaveLength(2);
      expect(hotKeys[0].key).toBe('key1');
      expect(hotKeys[0].hits).toBe(5);
      expect(hotKeys[1].key).toBe('key2');
      expect(hotKeys[1].hits).toBe(3);
    });

    it('should handle empty cache for hot keys', () => {
      const hotKeys = cache.getHotKeys(5);
      expect(hotKeys).toHaveLength(0);
    });
  });

  describe('Expiring Soon Analysis', () => {
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

    it('should handle empty cache for expiring soon', () => {
      const expiringSoon = cache.getExpiringSoon(1000);
      expect(expiringSoon).toHaveLength(0);
    });
  });

  describe('Preloading', () => {
    it('should preload multiple items', () => {
      const items = [
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: 'value2', ttlMs: 5000 },
        { key: 'key3', value: { data: 'complex' } }
      ];
      
      cache.preload(items);
      
      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBe('value2');
      expect(cache.get('key3')).toEqual({ data: 'complex' });
    });

    it('should handle empty preload list', () => {
      expect(() => cache.preload([])).not.toThrow();
    });
  });

  describe('Import/Export', () => {
    it('should export cache state', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2', 5000);
      
      cache.get('key1'); // Create hits
      
      const exported = cache.export();
      expect(exported.entries).toHaveLength(2);
      expect(exported.stats).toBeDefined();
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
          }
        ],
        stats: {
          hits: 10,
          misses: 3
        }
      };
      
      cache.import(data);
      expect(cache.get('key1')).toBe('value1');
    });

    it('should handle malformed import data', () => {
      expect(() => cache.import(null as any)).not.toThrow();
      expect(() => cache.import(undefined as any)).not.toThrow();
      expect(() => cache.import({})).not.toThrow();
      expect(() => cache.import({ entries: null })).not.toThrow();
    });

    it('should skip expired entries during import', () => {
      const data = {
        entries: [
          {
            key: 'expired',
            value: 'value',
            createdAt: Date.now() - 10000,
            expiresAt: Date.now() - 5000, // Already expired
            size: 100
          }
        ]
      };
      
      cache.import(data);
      expect(cache.get('expired')).toBeNull();
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

      // Advance past first TTL
      jest.advanceTimersByTime(1500);
      
      // Trigger cleanup by advancing to cleanup interval (60 seconds)
      jest.advanceTimersByTime(60000);

      expect(cache.get('shortTtl')).toBeNull();
      expect(cache.get('longTtl')).toBe('value');
      expect(cache.get('noTtl')).toBe('value');
    });
  });

  describe('Edge Cases', () => {
    it('should handle circular references in values', () => {
      const circular: any = { name: 'test' };
      circular.self = circular;

      expect(() => cache.set('circular', circular)).not.toThrow();
      const retrieved = cache.get('circular');
      expect(retrieved.name).toBe('test');
    });

    it('should handle zero or negative constructor parameters', () => {
      expect(() => new CacheManager(0, 1)).not.toThrow();
      expect(() => new CacheManager(-1, 1)).not.toThrow();
      expect(() => new CacheManager(5, 0)).not.toThrow();
      expect(() => new CacheManager(5, -1)).not.toThrow();
    });

    it('should handle default constructor parameters', () => {
      const defaultCache = new CacheManager();
      defaultCache.set('test', 'value');
      expect(defaultCache.get('test')).toBe('value');
    });

    it('should handle very large values', () => {
      const largeValue = {
        data: 'x'.repeat(10000),
        numbers: Array.from({ length: 1000 }, (_, i) => i)
      };

      cache.set('large', largeValue);
      const retrieved = cache.get('large');
      
      expect(retrieved.data.length).toBe(10000);
      expect(retrieved.numbers.length).toBe(1000);
    });

    it('should handle undefined and null values correctly', () => {
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

    it('should handle memory calculation errors gracefully', () => {
      // Object that can't be JSON.stringified
      const problematic = {};
      Object.defineProperty(problematic, 'toJSON', {
        value: () => { throw new Error('Cannot serialize'); }
      });

      expect(() => cache.set('problematic', problematic)).not.toThrow();
      expect(cache.get('problematic')).toBe(problematic);
    });

    it('should handle setting same key multiple times', () => {
      cache.set('key1', 'value1');
      cache.set('key1', 'value2');
      cache.set('key1', 'value3');
      
      expect(cache.get('key1')).toBe('value3');
      expect(cache.getStats().entries).toBe(1);
    });

    it('should handle access order updates correctly', () => {
      // Test private updateAccessOrder method indirectly
      for (let i = 1; i <= 3; i++) {
        cache.set(`key${i}`, `value${i}`);
      }
      
      // Access key1 multiple times
      cache.get('key1');
      cache.get('key1');
      
      // Add new items to fill cache
      cache.set('key4', 'value4');
      cache.set('key5', 'value5');
      
      // Add one more to trigger eviction
      cache.set('key6', 'value6');
      
      // key1 should still exist due to recent access
      expect(cache.get('key1')).toBe('value1');
    });
  });

  describe('Performance and Stress Testing', () => {
    it('should handle many operations efficiently', () => {
      const operations = 1000;
      
      for (let i = 0; i < operations; i++) {
        cache.set(`perf${i % 100}`, `value${i}`); // Reuse keys to test updates
        cache.get(`perf${i % 100}`);
      }
      
      const stats = cache.getStats();
      expect(stats.totalHits).toBeGreaterThan(0);
      expect(stats.totalMisses).toBeGreaterThan(0);
    });

    it('should handle rapid evictions', () => {
      // Force many evictions by exceeding cache size
      for (let i = 0; i < 100; i++) {
        cache.set(`evict${i}`, `value${i}`);
      }
      
      const stats = cache.getStats();
      expect(stats.evictions).toBeGreaterThan(90); // Most should be evicted
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

    it('should calculate memory usage accurately', () => {
      const initialStats = cache.getStats();
      expect(initialStats.totalSizeMB).toBe(0);

      cache.set('test', 'value');
      const afterSet = cache.getStats();
      expect(afterSet.totalSizeMB).toBeGreaterThan(0);

      cache.delete('test');
      const afterDelete = cache.getStats();
      expect(afterDelete.totalSizeMB).toBe(0);
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle mixed TTL and non-TTL entries', () => {
      jest.useFakeTimers();
      
      cache.set('permanent', 'value');
      cache.set('temporary', 'value', 1000);
      
      jest.advanceTimersByTime(1500);
      
      expect(cache.get('permanent')).toBe('value');
      expect(cache.get('temporary')).toBeNull();
      
      jest.useRealTimers();
    });

    it('should handle cache operations during eviction', () => {
      // Fill cache
      for (let i = 1; i <= 5; i++) {
        cache.set(`key${i}`, `value${i}`);
      }
      
      // Force eviction while accessing existing keys
      cache.get('key3'); // Update access order
      cache.set('key6', 'value6'); // Should evict key1
      
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key3')).toBe('value3');
      expect(cache.get('key6')).toBe('value6');
    });

    it('should maintain consistency during rapid operations', () => {
      const key = 'rapidOps';
      
      for (let i = 0; i < 100; i++) {
        cache.set(key, `value${i}`);
        expect(cache.get(key)).toBe(`value${i}`);
        expect(cache.has(key)).toBe(true);
      }
      
      cache.delete(key);
      expect(cache.get(key)).toBeNull();
      expect(cache.has(key)).toBe(false);
    });
  });
});