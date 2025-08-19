/**
 * CacheManager - High-performance LRU cache with TTL support
 * Optimized for semantic search results and token-optimized responses
 */

export interface CacheEntry {
  value: any;
  hits: number;
  createdAt: number;
  expiresAt?: number;
  size: number;
}

export interface CacheStats {
  entries: number;
  totalHits: number;
  totalMisses: number;
  hitRate: number;
  totalSizeMB: number;
  avgHits: number;
  evictions: number;
}

export class CacheManager {
  private cache: Map<string, CacheEntry> = new Map();
  private accessOrder: string[] = [];
  private maxSize: number;
  private maxMemoryMB: number;
  private currentSizeBytes: number = 0;
  
  // Statistics
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    totalOperations: 0
  };
  
  constructor(
    maxSize: number = 1000,
    maxMemoryMB: number = 100
  ) {
    this.maxSize = maxSize;
    this.maxMemoryMB = maxMemoryMB;
    
    // Periodic cleanup of expired entries
    setInterval(() => this.cleanupExpired(), 60000); // Every minute
  }
  
  /**
   * Get value from cache
   */
  get(key: string): any | null {
    this.stats.totalOperations++;
    
    const entry = this.cache.get(key);
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    
    // Check if expired
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.delete(key);
      this.stats.misses++;
      return null;
    }
    
    // Update access order (move to end)
    this.updateAccessOrder(key);
    
    // Update statistics
    entry.hits++;
    this.stats.hits++;
    
    return entry.value;
  }
  
  /**
   * Set value in cache with optional TTL
   */
  set(key: string, value: any, ttlMs?: number): void {
    const size = this.calculateSize(value);
    const now = Date.now();
    
    // Check if we need to evict to make space
    this.ensureCapacity(size);
    
    // Remove existing entry if present
    if (this.cache.has(key)) {
      this.delete(key);
    }
    
    // Create new entry
    const entry: CacheEntry = {
      value,
      hits: 0,
      createdAt: now,
      expiresAt: ttlMs ? now + ttlMs : undefined,
      size
    };
    
    this.cache.set(key, entry);
    this.currentSizeBytes += size;
    this.updateAccessOrder(key);
  }
  
  /**
   * Delete entry from cache
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }
    
    this.cache.delete(key);
    this.currentSizeBytes -= entry.size;
    this.removeFromAccessOrder(key);
    
    return true;
  }
  
  /**
   * Check if key exists in cache
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }
    
    // Check if expired
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.delete(key);
      return false;
    }
    
    return true;
  }
  
  /**
   * Clear all cache entries
   */
  clear(): number {
    const count = this.cache.size;
    this.cache.clear();
    this.accessOrder = [];
    this.currentSizeBytes = 0;
    return count;
  }
  
  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    let totalHits = 0;
    
    for (const entry of this.cache.values()) {
      totalHits += entry.hits;
    }
    
    const totalRequests = this.stats.hits + this.stats.misses;
    
    return {
      entries: this.cache.size,
      totalHits: this.stats.hits,
      totalMisses: this.stats.misses,
      hitRate: totalRequests > 0 ? this.stats.hits / totalRequests : 0,
      totalSizeMB: this.currentSizeBytes / 1024 / 1024,
      avgHits: this.cache.size > 0 ? totalHits / this.cache.size : 0,
      evictions: this.stats.evictions
    };
  }
  
  /**
   * Get cache keys sorted by access frequency
   */
  getHotKeys(limit: number = 10): Array<{ key: string; hits: number }> {
    const entries = Array.from(this.cache.entries())
      .map(([key, entry]) => ({ key, hits: entry.hits }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, limit);
    
    return entries;
  }
  
  /**
   * Get cache entries that will expire soon
   */
  getExpiringSoon(windowMs: number = 5 * 60 * 1000): string[] {
    const now = Date.now();
    const threshold = now + windowMs;
    
    const expiring: string[] = [];
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt && entry.expiresAt <= threshold) {
        expiring.push(key);
      }
    }
    
    return expiring;
  }
  
  /**
   * Preload cache with commonly accessed items
   */
  preload(items: Array<{ key: string; value: any; ttlMs?: number }>): void {
    for (const item of items) {
      this.set(item.key, item.value, item.ttlMs);
    }
  }
  
  /**
   * Export cache state for persistence
   */
  export(): any {
    const exported = {
      entries: [] as any[],
      stats: this.stats,
      exportedAt: Date.now()
    };
    
    for (const [key, entry] of this.cache.entries()) {
      exported.entries.push({
        key,
        value: entry.value,
        hits: entry.hits,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
        size: entry.size
      });
    }
    
    return exported;
  }
  
  /**
   * Import cache state from persistence
   */
  import(data: any): void {
    if (!data || !data.entries) {
      return;
    }
    
    this.clear();
    
    const now = Date.now();
    
    for (const item of data.entries) {
      // Skip expired entries
      if (item.expiresAt && now > item.expiresAt) {
        continue;
      }
      
      const entry: CacheEntry = {
        value: item.value,
        hits: item.hits || 0,
        createdAt: item.createdAt || now,
        expiresAt: item.expiresAt,
        size: item.size || this.calculateSize(item.value)
      };
      
      this.cache.set(item.key, entry);
      this.currentSizeBytes += entry.size;
      this.accessOrder.push(item.key);
    }
    
    // Restore stats if available
    if (data.stats) {
      this.stats = { ...this.stats, ...data.stats };
    }
  }
  
  // Private methods
  
  private updateAccessOrder(key: string): void {
    // Remove from current position
    this.removeFromAccessOrder(key);
    // Add to end (most recently used)
    this.accessOrder.push(key);
  }
  
  private removeFromAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
  }
  
  private ensureCapacity(newEntrySize: number): void {
    // Check size limit
    while (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }
    
    // Check memory limit
    const maxSizeBytes = this.maxMemoryMB * 1024 * 1024;
    while (this.currentSizeBytes + newEntrySize > maxSizeBytes) {
      this.evictLRU();
    }
  }
  
  private evictLRU(): void {
    if (this.accessOrder.length === 0) {
      return;
    }
    
    // Remove least recently used (first in access order)
    const lruKey = this.accessOrder[0];
    this.delete(lruKey);
    this.stats.evictions++;
  }
  
  private cleanupExpired(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt && now > entry.expiresAt) {
        expiredKeys.push(key);
      }
    }
    
    for (const key of expiredKeys) {
      this.delete(key);
    }
  }
  
  private calculateSize(value: any): number {
    try {
      // Rough estimation of object size in bytes
      const str = JSON.stringify(value);
      return str.length * 2; // Rough estimate for UTF-16 encoding
    } catch {
      // Fallback for non-serializable objects
      return 1024; // 1KB default
    }
  }
}