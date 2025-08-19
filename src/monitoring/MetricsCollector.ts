/**
 * MetricsCollector - Comprehensive metrics and telemetry for MVMemory
 * Tracks performance, usage patterns, and optimization effectiveness
 */

export interface SearchMetrics {
  totalSearches: number;
  avgSearchTime: number;
  avgResultCount: number;
  cacheHitRate: number;
  popularQueries: Array<{ query: string; count: number; avgTime: number }>;
}

export interface IndexingMetrics {
  totalFilesIndexed: number;
  totalChunksCreated: number;
  avgIndexingTime: number;
  indexingErrors: number;
  languageBreakdown: Record<string, number>;
  fileSizeBreakdown: Record<string, number>;
}

export interface OptimizationMetrics {
  totalTokensSaved: number;
  avgCompressionRatio: number;
  optimizedRequests: number;
  tokenSavingsPercentage: number;
}

export interface SystemMetrics {
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage: number;
  diskUsage: { used: number; total: number };
  errorRate: number;
}

export interface MetricsReport {
  search: SearchMetrics;
  indexing: IndexingMetrics;
  optimization: OptimizationMetrics;
  system: SystemMetrics;
  timestamp: number;
  period: { start: number; end: number };
}

export class MetricsCollector {
  private startTime: number = Date.now();
  
  // Search metrics
  private searchCount = 0;
  private totalSearchTime = 0;
  private totalResultCount = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private queryHistory: Array<{
    query: string;
    duration: number;
    resultCount: number;
    timestamp: number;
  }> = [];
  
  // Indexing metrics
  private indexedFiles = 0;
  private createdChunks = 0;
  private totalIndexingTime = 0;
  private indexingErrors = 0;
  private languageStats: Record<string, number> = {};
  private fileSizeStats: Record<string, number> = {
    'small (<1KB)': 0,
    'medium (1-10KB)': 0,
    'large (10-100KB)': 0,
    'xlarge (>100KB)': 0
  };
  
  // Optimization metrics
  private totalTokensSaved = 0;
  private totalOriginalTokens = 0;
  private optimizedRequestCount = 0;
  
  // System metrics
  private errorCount = 0;
  private totalRequests = 0;
  
  constructor() {
    // Start CPU monitoring
    this.startCpuMonitoring();
  }
  
  /**
   * Track a search operation
   */
  trackSearch(duration: number, resultCount: number, query?: string): void {
    this.searchCount++;
    this.totalSearchTime += duration;
    this.totalResultCount += resultCount;
    this.totalRequests++;
    
    if (query) {
      this.queryHistory.push({
        query,
        duration,
        resultCount,
        timestamp: Date.now()
      });
      
      // Keep only recent queries (last 1000)
      if (this.queryHistory.length > 1000) {
        this.queryHistory = this.queryHistory.slice(-1000);
      }
    }
  }
  
  /**
   * Track cache hit
   */
  trackCacheHit(): void {
    this.cacheHits++;
  }
  
  /**
   * Track cache miss
   */
  trackCacheMiss(): void {
    this.cacheMisses++;
  }
  
  /**
   * Track file indexing
   */
  trackFileIndexed(
    language: string,
    fileSize: number,
    chunkCount: number,
    duration: number
  ): void {
    this.indexedFiles++;
    this.createdChunks += chunkCount;
    this.totalIndexingTime += duration;
    
    // Track language stats
    this.languageStats[language] = (this.languageStats[language] || 0) + 1;
    
    // Track file size stats
    const sizeCategory = this.getFileSizeCategory(fileSize);
    this.fileSizeStats[sizeCategory]++;
  }
  
  /**
   * Track indexing error
   */
  trackIndexingError(): void {
    this.indexingErrors++;
    this.errorCount++;
  }
  
  /**
   * Track token optimization
   */
  trackTokenOptimization(originalTokens: number, optimizedTokens: number): void {
    this.totalOriginalTokens += originalTokens;
    this.totalTokensSaved += (originalTokens - optimizedTokens);
    this.optimizedRequestCount++;
  }
  
  /**
   * Track general error
   */
  trackError(): void {
    this.errorCount++;
  }
  
  /**
   * Get comprehensive metrics report
   */
  getReport(): MetricsReport {
    const now = Date.now();
    const uptime = now - this.startTime;
    
    return {
      search: this.getSearchMetrics(),
      indexing: this.getIndexingMetrics(),
      optimization: this.getOptimizationMetrics(),
      system: this.getSystemMetrics(uptime),
      timestamp: now,
      period: {
        start: this.startTime,
        end: now
      }
    };
  }
  
  /**
   * Get search-specific metrics
   */
  getSearchMetrics(): SearchMetrics {
    const totalCacheRequests = this.cacheHits + this.cacheMisses;
    
    return {
      totalSearches: this.searchCount,
      avgSearchTime: this.searchCount > 0 ? this.totalSearchTime / this.searchCount : 0,
      avgResultCount: this.searchCount > 0 ? this.totalResultCount / this.searchCount : 0,
      cacheHitRate: totalCacheRequests > 0 ? this.cacheHits / totalCacheRequests : 0,
      popularQueries: this.getPopularQueries()
    };
  }
  
  /**
   * Get indexing-specific metrics
   */
  getIndexingMetrics(): IndexingMetrics {
    return {
      totalFilesIndexed: this.indexedFiles,
      totalChunksCreated: this.createdChunks,
      avgIndexingTime: this.indexedFiles > 0 ? this.totalIndexingTime / this.indexedFiles : 0,
      indexingErrors: this.indexingErrors,
      languageBreakdown: { ...this.languageStats },
      fileSizeBreakdown: { ...this.fileSizeStats }
    };
  }
  
  /**
   * Get optimization-specific metrics
   */
  getOptimizationMetrics(): OptimizationMetrics {
    const tokenSavingsPercentage = this.totalOriginalTokens > 0 
      ? (this.totalTokensSaved / this.totalOriginalTokens) * 100 
      : 0;
    
    const avgCompressionRatio = this.optimizedRequestCount > 0 && this.totalOriginalTokens > 0
      ? 1 - (this.totalTokensSaved / this.totalOriginalTokens)
      : 1;
    
    return {
      totalTokensSaved: this.totalTokensSaved,
      avgCompressionRatio,
      optimizedRequests: this.optimizedRequestCount,
      tokenSavingsPercentage
    };
  }
  
  /**
   * Get system-specific metrics
   */
  getSystemMetrics(uptime: number): SystemMetrics {
    return {
      uptime,
      memoryUsage: process.memoryUsage(),
      cpuUsage: this.getCurrentCpuUsage(),
      diskUsage: this.getDiskUsage(),
      errorRate: this.totalRequests > 0 ? this.errorCount / this.totalRequests : 0
    };
  }
  
  /**
   * Export metrics for persistence
   */
  export(): any {
    return {
      startTime: this.startTime,
      searchCount: this.searchCount,
      totalSearchTime: this.totalSearchTime,
      totalResultCount: this.totalResultCount,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      queryHistory: this.queryHistory.slice(-100), // Keep last 100 queries
      indexedFiles: this.indexedFiles,
      createdChunks: this.createdChunks,
      totalIndexingTime: this.totalIndexingTime,
      indexingErrors: this.indexingErrors,
      languageStats: this.languageStats,
      fileSizeStats: this.fileSizeStats,
      totalTokensSaved: this.totalTokensSaved,
      totalOriginalTokens: this.totalOriginalTokens,
      optimizedRequestCount: this.optimizedRequestCount,
      errorCount: this.errorCount,
      totalRequests: this.totalRequests,
      exportedAt: Date.now()
    };
  }
  
  /**
   * Import metrics from persistence
   */
  import(data: any): void {
    if (!data) return;
    
    this.startTime = data.startTime || this.startTime;
    this.searchCount = data.searchCount || 0;
    this.totalSearchTime = data.totalSearchTime || 0;
    this.totalResultCount = data.totalResultCount || 0;
    this.cacheHits = data.cacheHits || 0;
    this.cacheMisses = data.cacheMisses || 0;
    this.queryHistory = data.queryHistory || [];
    this.indexedFiles = data.indexedFiles || 0;
    this.createdChunks = data.createdChunks || 0;
    this.totalIndexingTime = data.totalIndexingTime || 0;
    this.indexingErrors = data.indexingErrors || 0;
    this.languageStats = data.languageStats || {};
    this.fileSizeStats = data.fileSizeStats || {
      'small (<1KB)': 0,
      'medium (1-10KB)': 0,
      'large (10-100KB)': 0,
      'xlarge (>100KB)': 0
    };
    this.totalTokensSaved = data.totalTokensSaved || 0;
    this.totalOriginalTokens = data.totalOriginalTokens || 0;
    this.optimizedRequestCount = data.optimizedRequestCount || 0;
    this.errorCount = data.errorCount || 0;
    this.totalRequests = data.totalRequests || 0;
  }
  
  /**
   * Reset all metrics
   */
  reset(): void {
    this.startTime = Date.now();
    this.searchCount = 0;
    this.totalSearchTime = 0;
    this.totalResultCount = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.queryHistory = [];
    this.indexedFiles = 0;
    this.createdChunks = 0;
    this.totalIndexingTime = 0;
    this.indexingErrors = 0;
    this.languageStats = {};
    this.fileSizeStats = {
      'small (<1KB)': 0,
      'medium (1-10KB)': 0,
      'large (10-100KB)': 0,
      'xlarge (>100KB)': 0
    };
    this.totalTokensSaved = 0;
    this.totalOriginalTokens = 0;
    this.optimizedRequestCount = 0;
    this.errorCount = 0;
    this.totalRequests = 0;
  }
  
  // Private methods
  
  private getPopularQueries(): Array<{ query: string; count: number; avgTime: number }> {
    const queryMap = new Map<string, { count: number; totalTime: number }>();
    
    // Aggregate queries from recent history
    const recentHistory = this.queryHistory.slice(-500); // Last 500 queries
    
    for (const entry of recentHistory) {
      const existing = queryMap.get(entry.query);
      if (existing) {
        existing.count++;
        existing.totalTime += entry.duration;
      } else {
        queryMap.set(entry.query, {
          count: 1,
          totalTime: entry.duration
        });
      }
    }
    
    // Convert to array and sort by frequency
    const popularQueries = Array.from(queryMap.entries())
      .map(([query, stats]) => ({
        query,
        count: stats.count,
        avgTime: stats.totalTime / stats.count
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10); // Top 10
    
    return popularQueries;
  }
  
  private getFileSizeCategory(sizeBytes: number): string {
    if (sizeBytes < 1024) {
      return 'small (<1KB)';
    } else if (sizeBytes < 10 * 1024) {
      return 'medium (1-10KB)';
    } else if (sizeBytes < 100 * 1024) {
      return 'large (10-100KB)';
    } else {
      return 'xlarge (>100KB)';
    }
  }
  
  private cpuUsageData: number[] = [];
  
  private startCpuMonitoring(): void {
    // Simple CPU usage tracking
    setInterval(() => {
      const usage = process.cpuUsage();
      const totalUsage = (usage.user + usage.system) / 1000000; // Convert to seconds
      this.cpuUsageData.push(totalUsage);
      
      // Keep only recent data (last 60 measurements)
      if (this.cpuUsageData.length > 60) {
        this.cpuUsageData = this.cpuUsageData.slice(-60);
      }
    }, 1000);
  }
  
  private getCurrentCpuUsage(): number {
    if (this.cpuUsageData.length < 2) return 0;
    
    // Calculate average CPU usage over recent period
    const recent = this.cpuUsageData.slice(-10); // Last 10 seconds
    return recent.reduce((a, b) => a + b, 0) / recent.length;
  }
  
  private getDiskUsage(): { used: number; total: number } {
    try {
      const fs = require('fs');
      const stats = fs.statSync(process.cwd());
      
      // This is a simplified disk usage - in production you'd want to use
      // a proper disk usage library or system command
      return {
        used: 0, // Would calculate actual disk usage
        total: 0  // Would get total disk space
      };
    } catch {
      return { used: 0, total: 0 };
    }
  }
}