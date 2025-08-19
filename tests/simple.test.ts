import { CacheManager } from '../src/optimization/CacheManager';

describe('Simple CacheManager Test', () => {
  it('should create a cache manager', () => {
    const cache = new CacheManager();
    expect(cache).toBeInstanceOf(CacheManager);
  });

  it('should set and get values', () => {
    const cache = new CacheManager();
    cache.set('test', 'value');
    expect(cache.get('test')).toBe('value');
  });

  it('should handle non-existent keys', () => {
    const cache = new CacheManager();
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('should delete values', () => {
    const cache = new CacheManager();
    cache.set('test', 'value');
    expect(cache.delete('test')).toBe(true);
    expect(cache.get('test')).toBeNull();
  });

  it('should clear all values', () => {
    const cache = new CacheManager();
    cache.set('test1', 'value1');
    cache.set('test2', 'value2');
    const cleared = cache.clear();
    expect(cleared).toBe(2);
    expect(cache.get('test1')).toBeNull();
    expect(cache.get('test2')).toBeNull();
  });
});