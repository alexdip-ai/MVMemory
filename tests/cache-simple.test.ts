import { CacheManager } from '../src/optimization/CacheManager';

// Clear all timers after each test to prevent hanging
afterEach(() => {
  jest.clearAllTimers();
});

describe('CacheManager Simple Tests', () => {
  it('should create cache and basic operations', () => {
    const cache = new CacheManager(5, 1);
    
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
    expect(cache.has('key1')).toBe(true);
    
    expect(cache.delete('key1')).toBe(true);
    expect(cache.get('key1')).toBeNull();
    expect(cache.has('key1')).toBe(false);
    
    cache.clear();
  });

  it('should handle TTL', () => {
    jest.useFakeTimers();
    const cache = new CacheManager(5, 1);
    
    cache.set('key1', 'value1', 1000);
    expect(cache.get('key1')).toBe('value1');
    
    jest.advanceTimersByTime(1500);
    expect(cache.get('key1')).toBeNull();
    
    cache.clear();
    jest.useRealTimers();
  });

  it('should handle eviction', () => {
    const cache = new CacheManager(2, 1); // Small cache
    
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.set('key3', 'value3'); // Should evict key1
    
    expect(cache.get('key1')).toBeNull();
    expect(cache.get('key3')).toBe('value3');
    
    cache.clear();
  });

  it('should handle memory eviction', () => {
    const cache = new CacheManager(10, 0.001); // Very small memory
    const largeValue = 'x'.repeat(10000);
    
    cache.set('key1', largeValue);
    cache.set('key2', largeValue); // Should trigger memory eviction
    
    const stats = cache.getStats();
    expect(stats.evictions).toBeGreaterThan(0);
    
    cache.clear();
  });

  it('should handle stats', () => {
    const cache = new CacheManager(5, 1);
    
    cache.set('key1', 'value1');
    cache.get('key1'); // hit
    cache.get('nonexistent'); // miss
    
    const stats = cache.getStats();
    expect(stats.entries).toBe(1);
    expect(stats.totalHits).toBe(1);
    expect(stats.totalMisses).toBe(1);
    expect(stats.hitRate).toBe(0.5);
    
    cache.clear();
  });

  it('should handle import/export', () => {
    const cache = new CacheManager(5, 1);
    
    cache.set('key1', 'value1');
    const exported = cache.export();
    
    expect(exported.entries).toHaveLength(1);
    expect(exported.entries[0].key).toBe('key1');
    
    const newCache = new CacheManager(5, 1);
    newCache.import(exported);
    expect(newCache.get('key1')).toBe('value1');
    
    cache.clear();
    newCache.clear();
  });

  it('should handle hot keys', () => {
    const cache = new CacheManager(5, 1);
    
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    
    cache.get('key1');
    cache.get('key1'); // key1 has 2 hits
    cache.get('key2'); // key2 has 1 hit
    
    const hotKeys = cache.getHotKeys(2);
    expect(hotKeys).toHaveLength(2);
    expect(hotKeys[0].key).toBe('key1');
    expect(hotKeys[0].hits).toBe(2);
    
    cache.clear();
  });

  it('should handle error cases', () => {
    const cache = new CacheManager(5, 1);
    
    // Circular reference
    const circular: any = {};
    circular.self = circular;
    
    cache.set('circular', circular);
    expect(cache.get('circular')).toBe(circular);
    
    // Import null data
    cache.import(null as any);
    cache.import(undefined as any);
    
    cache.clear();
  });
});