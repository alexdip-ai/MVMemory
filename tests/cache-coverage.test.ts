import { CacheManager } from '../src/optimization/CacheManager';

describe('CacheManager Coverage Tests', () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager(3, 0.001); // Small cache
  });

  it('should handle TTL expiration in get method', () => {
    jest.useFakeTimers();
    
    cache.set('key1', 'value1', 1000);
    expect(cache.get('key1')).toBe('value1');
    
    jest.advanceTimersByTime(1500);
    expect(cache.get('key1')).toBeNull(); // This should trigger TTL check and delete
    
    jest.useRealTimers();
  });

  it('should handle TTL expiration in has method', () => {
    jest.useFakeTimers();
    
    cache.set('key1', 'value1', 1000);
    expect(cache.has('key1')).toBe(true);
    
    jest.advanceTimersByTime(1500);
    expect(cache.has('key1')).toBe(false); // This should trigger TTL check and delete
    
    jest.useRealTimers();
  });

  it('should handle memory-based eviction', () => {
    const largeValue = 'x'.repeat(10000);
    
    cache.set('key1', largeValue);
    cache.set('key2', largeValue); // Should trigger memory eviction
    
    expect(cache.get('key1')).toBeNull(); // Should be evicted due to memory
    expect(cache.get('key2')).toBe(largeValue);
  });

  it('should handle size-based eviction', () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.set('key3', 'value3');
    cache.set('key4', 'value4'); // Should evict key1
    
    expect(cache.get('key1')).toBeNull();
    expect(cache.get('key4')).toBe('value4');
  });

  it('should handle empty eviction scenario', () => {
    const emptyCache = new CacheManager(0, 1);
    emptyCache.set('key1', 'value1');
    expect(emptyCache.get('key1')).toBeNull();
  });

  it('should handle import with expired entries', () => {
    const data = {
      entries: [
        {
          key: 'expired',
          value: 'value1',
          createdAt: Date.now() - 10000,
          expiresAt: Date.now() - 1000,
          size: 100
        },
        {
          key: 'valid',
          value: 'value2',
          createdAt: Date.now(),
          size: 100
        }
      ]
    };
    
    cache.import(data);
    expect(cache.get('expired')).toBeNull();
    expect(cache.get('valid')).toBe('value2');
  });

  it('should handle import with missing data', () => {
    cache.import(null as any);
    cache.import(undefined as any);
    cache.import({} as any);
    cache.import({ entries: null } as any);
    
    // Should not throw and cache should be empty
    expect(cache.getStats().entries).toBe(0);
  });

  it('should handle serialization errors in calculateSize', () => {
    const circular: any = {};
    circular.self = circular;
    
    cache.set('circular', circular);
    expect(cache.get('circular')).toBe(circular);
    
    const stats = cache.getStats();
    expect(stats.totalSizeMB).toBeGreaterThan(0); // Should use fallback size
  });
});