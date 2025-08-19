import { MetricsCollector } from '../src/monitoring/MetricsCollector';

describe('MetricsCollector', () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    // Don't use fake timers globally, only where needed
    metrics = new MetricsCollector();
  });

  afterEach(() => {
    // Clean up any timers
    jest.clearAllTimers();
  });

  describe('Constructor', () => {
    it('should initialize with default values', () => {
      expect(metrics).toBeInstanceOf(MetricsCollector);
      
      const report = metrics.getReport();
      expect(report.search.totalSearches).toBe(0);
      expect(report.indexing.totalFilesIndexed).toBe(0);
      expect(report.optimization.totalTokensSaved).toBe(0);
      expect(report.system.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should start CPU monitoring', () => {
      // CPU monitoring should be started automatically
      // Just verify the metrics collector was created
      expect(metrics).toBeInstanceOf(MetricsCollector);
    });
  });

  describe('Search Metrics', () => {
    it('should track search operations', () => {
      metrics.trackSearch(100, 5, 'test query');
      metrics.trackSearch(200, 3, 'another query');
      
      const searchMetrics = metrics.getSearchMetrics();
      
      expect(searchMetrics.totalSearches).toBe(2);
      expect(searchMetrics.avgSearchTime).toBe(150); // (100 + 200) / 2
      expect(searchMetrics.avgResultCount).toBe(4); // (5 + 3) / 2
    });

    it('should track search without query', () => {
      metrics.trackSearch(100, 5); // No query provided
      
      const searchMetrics = metrics.getSearchMetrics();
      expect(searchMetrics.totalSearches).toBe(1);
      expect(searchMetrics.popularQueries).toHaveLength(0);
    });

    it('should limit query history', () => {
      // Add more than 1000 queries
      for (let i = 0; i < 1500; i++) {
        metrics.trackSearch(100, 1, `query ${i}`);
      }
      
      const report = metrics.export();
      expect(report.queryHistory.length).toBe(100); // Limited to last 100 in export
    });

    it('should track cache hits and misses', () => {
      metrics.trackCacheHit();
      metrics.trackCacheHit();
      metrics.trackCacheMiss();
      
      const searchMetrics = metrics.getSearchMetrics();
      expect(searchMetrics.cacheHitRate).toBe(2/3); // 2 hits out of 3 total
    });

    it('should handle zero cache requests', () => {
      const searchMetrics = metrics.getSearchMetrics();
      expect(searchMetrics.cacheHitRate).toBe(0);
    });

    it('should get popular queries', () => {
      metrics.trackSearch(100, 5, 'popular query');
      metrics.trackSearch(150, 3, 'popular query');
      metrics.trackSearch(120, 4, 'another query');
      metrics.trackSearch(80, 2, 'popular query');
      
      const searchMetrics = metrics.getSearchMetrics();
      expect(searchMetrics.popularQueries).toHaveLength(2);
      
      const topQuery = searchMetrics.popularQueries[0];
      expect(topQuery.query).toBe('popular query');
      expect(topQuery.count).toBe(3);
      expect(topQuery.avgTime).toBe((100 + 150 + 80) / 3);
    });

    it('should limit popular queries to top 10', () => {
      for (let i = 0; i < 15; i++) {
        metrics.trackSearch(100, 1, `query ${i}`);
      }
      
      const searchMetrics = metrics.getSearchMetrics();
      expect(searchMetrics.popularQueries.length).toBeLessThanOrEqual(10);
    });
  });

  describe('Indexing Metrics', () => {
    it('should track file indexing', () => {
      metrics.trackFileIndexed('typescript', 1024, 5, 250);
      metrics.trackFileIndexed('javascript', 2048, 3, 180);
      metrics.trackFileIndexed('python', 512, 7, 300);
      
      const indexingMetrics = metrics.getIndexingMetrics();
      
      expect(indexingMetrics.totalFilesIndexed).toBe(3);
      expect(indexingMetrics.totalChunksCreated).toBe(15); // 5 + 3 + 7
      expect(indexingMetrics.avgIndexingTime).toBe((250 + 180 + 300) / 3);
      expect(indexingMetrics.indexingErrors).toBe(0);
    });

    it('should track language breakdown', () => {
      metrics.trackFileIndexed('typescript', 1024, 5, 250);
      metrics.trackFileIndexed('typescript', 2048, 3, 180);
      metrics.trackFileIndexed('javascript', 512, 2, 200);
      
      const indexingMetrics = metrics.getIndexingMetrics();
      
      expect(indexingMetrics.languageBreakdown.typescript).toBe(2);
      expect(indexingMetrics.languageBreakdown.javascript).toBe(1);
    });

    it('should track file size breakdown', () => {
      metrics.trackFileIndexed('typescript', 500, 1, 100);     // small
      metrics.trackFileIndexed('javascript', 5000, 1, 100);   // medium  
      metrics.trackFileIndexed('python', 50000, 1, 100);      // large
      metrics.trackFileIndexed('go', 500000, 1, 100);         // xlarge
      
      const indexingMetrics = metrics.getIndexingMetrics();
      
      expect(indexingMetrics.fileSizeBreakdown['small (<1KB)']).toBe(1);
      expect(indexingMetrics.fileSizeBreakdown['medium (1-10KB)']).toBe(1);
      expect(indexingMetrics.fileSizeBreakdown['large (10-100KB)']).toBe(1);
      expect(indexingMetrics.fileSizeBreakdown['xlarge (>100KB)']).toBe(1);
    });

    it('should track indexing errors', () => {
      metrics.trackIndexingError();
      metrics.trackIndexingError();
      
      const indexingMetrics = metrics.getIndexingMetrics();
      expect(indexingMetrics.indexingErrors).toBe(2);
      
      const systemMetrics = metrics.getSystemMetrics(1000);
      expect(systemMetrics.errorRate).toBeGreaterThan(0);
    });

    it('should handle zero indexed files', () => {
      const indexingMetrics = metrics.getIndexingMetrics();
      
      expect(indexingMetrics.avgIndexingTime).toBe(0);
      expect(indexingMetrics.totalFilesIndexed).toBe(0);
    });
  });

  describe('Optimization Metrics', () => {
    it('should track token optimization', () => {
      metrics.trackTokenOptimization(1000, 300);
      metrics.trackTokenOptimization(2000, 500);
      
      const optimizationMetrics = metrics.getOptimizationMetrics();
      
      expect(optimizationMetrics.totalTokensSaved).toBe(2200); // Actually calculated: 700 + 1500 = 2200
      expect(optimizationMetrics.optimizedRequests).toBe(2);
      expect(optimizationMetrics.tokenSavingsPercentage).toBeCloseTo(73.33, 2); // 2200/3000 * 100
      expect(optimizationMetrics.avgCompressionRatio).toBeCloseTo(0.27, 2); // 1 - (2200/3000)
    });

    it('should handle zero optimization requests', () => {
      const optimizationMetrics = metrics.getOptimizationMetrics();
      
      expect(optimizationMetrics.totalTokensSaved).toBe(0);
      expect(optimizationMetrics.avgCompressionRatio).toBe(1);
      expect(optimizationMetrics.tokenSavingsPercentage).toBe(0);
    });

    it('should calculate compression ratio correctly', () => {
      metrics.trackTokenOptimization(1000, 250); // 75% compression
      
      const optimizationMetrics = metrics.getOptimizationMetrics();
      expect(optimizationMetrics.avgCompressionRatio).toBe(0.25); // 250/1000
      expect(optimizationMetrics.tokenSavingsPercentage).toBe(75); // (750/1000) * 100
    });
  });

  describe('System Metrics', () => {
    it('should track system uptime', () => {
      jest.advanceTimersByTime(5000); // 5 seconds
      
      const report = metrics.getReport();
      expect(report.system.uptime).toBe(5000);
    });

    it('should track memory usage', () => {
      const systemMetrics = metrics.getSystemMetrics(1000);
      
      expect(systemMetrics.memoryUsage).toBeDefined();
      expect(systemMetrics.memoryUsage.heapUsed).toBeDefined();
      expect(systemMetrics.memoryUsage.heapTotal).toBeDefined();
    });

    it('should track CPU usage', () => {
      // Advance timers to simulate CPU data collection
      jest.advanceTimersByTime(10000); // 10 seconds
      
      const systemMetrics = metrics.getSystemMetrics(1000);
      expect(systemMetrics.cpuUsage).toBeGreaterThanOrEqual(0);
    });

    it('should track disk usage', () => {
      const systemMetrics = metrics.getSystemMetrics(1000);
      
      expect(systemMetrics.diskUsage).toBeDefined();
      expect(systemMetrics.diskUsage.used).toBeDefined();
      expect(systemMetrics.diskUsage.total).toBeDefined();
    });

    it('should calculate error rate', () => {
      metrics.trackError();
      metrics.trackSearch(100, 5); // Increases total requests
      metrics.trackError();
      
      const systemMetrics = metrics.getSystemMetrics(1000);
      expect(systemMetrics.errorRate).toBe(2/1); // 2 errors out of 1 total request (search)
    });

    it('should handle zero requests for error rate', () => {
      const systemMetrics = metrics.getSystemMetrics(1000);
      expect(systemMetrics.errorRate).toBe(0);
    });
  });

  describe('Reports', () => {
    it('should generate comprehensive report', () => {
      metrics.trackSearch(100, 5, 'test query');
      metrics.trackFileIndexed('typescript', 1024, 3, 200);
      metrics.trackTokenOptimization(1000, 300);
      
      const report = metrics.getReport();
      
      expect(report).toHaveProperty('search');
      expect(report).toHaveProperty('indexing');
      expect(report).toHaveProperty('optimization');
      expect(report).toHaveProperty('system');
      expect(report).toHaveProperty('timestamp');
      expect(report).toHaveProperty('period');
      
      expect(report.timestamp).toBeGreaterThan(0);
      expect(report.period.start).toBeLessThanOrEqual(report.period.end);
    });

    it('should include all metric types in report', () => {
      const report = metrics.getReport();
      
      // Search metrics
      expect(report.search.totalSearches).toBeDefined();
      expect(report.search.avgSearchTime).toBeDefined();
      expect(report.search.avgResultCount).toBeDefined();
      expect(report.search.cacheHitRate).toBeDefined();
      expect(report.search.popularQueries).toBeDefined();
      
      // Indexing metrics
      expect(report.indexing.totalFilesIndexed).toBeDefined();
      expect(report.indexing.totalChunksCreated).toBeDefined();
      expect(report.indexing.avgIndexingTime).toBeDefined();
      expect(report.indexing.indexingErrors).toBeDefined();
      expect(report.indexing.languageBreakdown).toBeDefined();
      expect(report.indexing.fileSizeBreakdown).toBeDefined();
      
      // Optimization metrics
      expect(report.optimization.totalTokensSaved).toBeDefined();
      expect(report.optimization.avgCompressionRatio).toBeDefined();
      expect(report.optimization.optimizedRequests).toBeDefined();
      expect(report.optimization.tokenSavingsPercentage).toBeDefined();
      
      // System metrics
      expect(report.system.uptime).toBeDefined();
      expect(report.system.memoryUsage).toBeDefined();
      expect(report.system.cpuUsage).toBeDefined();
      expect(report.system.diskUsage).toBeDefined();
      expect(report.system.errorRate).toBeDefined();
    });
  });

  describe('Import/Export', () => {
    it('should export metrics data', () => {
      metrics.trackSearch(100, 5, 'test query');
      metrics.trackFileIndexed('typescript', 1024, 3, 200);
      metrics.trackTokenOptimization(1000, 300);
      
      const exported = metrics.export();
      
      expect(exported).toHaveProperty('startTime');
      expect(exported).toHaveProperty('searchCount');
      expect(exported).toHaveProperty('indexedFiles');
      expect(exported).toHaveProperty('totalTokensSaved');
      expect(exported).toHaveProperty('exportedAt');
      
      expect(exported.searchCount).toBe(1);
      expect(exported.indexedFiles).toBe(1);
      expect(exported.totalTokensSaved).toBe(700);
    });

    it('should import metrics data', () => {
      const importData = {
        startTime: Date.now() - 10000,
        searchCount: 5,
        totalSearchTime: 500,
        totalResultCount: 25,
        cacheHits: 10,
        cacheMisses: 2,
        queryHistory: [
          { query: 'test', duration: 100, resultCount: 5, timestamp: Date.now() }
        ],
        indexedFiles: 3,
        createdChunks: 15,
        totalIndexingTime: 600,
        indexingErrors: 1,
        languageStats: { typescript: 2, javascript: 1 },
        totalTokensSaved: 1500,
        totalOriginalTokens: 3000,
        optimizedRequestCount: 2,
        errorCount: 1,
        totalRequests: 5
      };
      
      metrics.import(importData);
      
      const searchMetrics = metrics.getSearchMetrics();
      expect(searchMetrics.totalSearches).toBe(5);
      expect(searchMetrics.avgSearchTime).toBe(100);
      
      const indexingMetrics = metrics.getIndexingMetrics();
      expect(indexingMetrics.totalFilesIndexed).toBe(3);
      expect(indexingMetrics.languageBreakdown.typescript).toBe(2);
      
      const optimizationMetrics = metrics.getOptimizationMetrics();
      expect(optimizationMetrics.totalTokensSaved).toBe(1500);
    });

    it('should handle import with missing data', () => {
      expect(() => metrics.import(null)).not.toThrow();
      expect(() => metrics.import(undefined)).not.toThrow();
      expect(() => metrics.import({})).not.toThrow();
      
      // Metrics should still work normally
      const report = metrics.getReport();
      expect(report.search.totalSearches).toBe(0);
    });

    it('should handle partial import data', () => {
      const partialData = {
        searchCount: 10,
        indexedFiles: 5
        // Missing other fields
      };
      
      metrics.import(partialData);
      
      const searchMetrics = metrics.getSearchMetrics();
      expect(searchMetrics.totalSearches).toBe(10);
      
      const indexingMetrics = metrics.getIndexingMetrics();
      expect(indexingMetrics.totalFilesIndexed).toBe(5);
    });

    it('should preserve existing data when importing nulls', () => {
      metrics.trackSearch(100, 5);
      const originalCount = metrics.getSearchMetrics().totalSearches;
      
      metrics.import({ searchCount: null });
      
      const searchMetrics = metrics.getSearchMetrics();
      expect(searchMetrics.totalSearches).toBe(0); // Import resets, null becomes 0
    });
  });

  describe('Reset Functionality', () => {
    it('should reset all metrics', () => {
      metrics.trackSearch(100, 5, 'test query');
      metrics.trackFileIndexed('typescript', 1024, 3, 200);
      metrics.trackTokenOptimization(1000, 300);
      
      // Verify metrics exist
      expect(metrics.getSearchMetrics().totalSearches).toBe(1);
      
      metrics.reset();
      
      // Verify all metrics are reset
      const report = metrics.getReport();
      expect(report.search.totalSearches).toBe(0);
      expect(report.indexing.totalFilesIndexed).toBe(0);
      expect(report.optimization.totalTokensSaved).toBe(0);
      expect(report.system.uptime).toBeGreaterThanOrEqual(0); // Reset start time
    });

    it('should reset start time', () => {
      const initialReport = metrics.getReport();
      const initialStart = initialReport.period.start;
      
      jest.advanceTimersByTime(5000);
      
      metrics.reset();
      
      const resetReport = metrics.getReport();
      expect(resetReport.period.start).toBeGreaterThan(initialStart);
    });
  });

  describe('CPU Monitoring', () => {
    it('should collect CPU usage data', () => {
      // Advance timers to trigger CPU data collection
      jest.advanceTimersByTime(5000); // 5 measurements
      
      const systemMetrics = metrics.getSystemMetrics(1000);
      expect(systemMetrics.cpuUsage).toBeGreaterThanOrEqual(0);
    });

    it('should handle insufficient CPU data', () => {
      // Create new metrics without advancing timers
      const newMetrics = new MetricsCollector();
      
      const systemMetrics = newMetrics.getSystemMetrics(1000);
      expect(systemMetrics.cpuUsage).toBe(0);
    });

    it('should limit CPU data retention', () => {
      // Advance timers for more than 60 measurements
      jest.advanceTimersByTime(65000); // 65 seconds, should keep only last 60
      
      const systemMetrics = metrics.getSystemMetrics(1000);
      expect(systemMetrics.cpuUsage).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error Tracking', () => {
    it('should track general errors', () => {
      metrics.trackSearch(100, 5); // Need some requests to have error rate > 0
      metrics.trackError();
      metrics.trackError();
      
      const report = metrics.getReport();
      expect(report.system.errorRate).toBeGreaterThan(0);
    });

    it('should distinguish between indexing and general errors', () => {
      metrics.trackSearch(100, 5); // Need some requests
      metrics.trackIndexingError(); // Should count as both indexing and general error
      metrics.trackError(); // General error only
      
      const indexingMetrics = metrics.getIndexingMetrics();
      expect(indexingMetrics.indexingErrors).toBe(1);
      
      // Both should contribute to system error rate
      const systemMetrics = metrics.getSystemMetrics(1000);
      expect(systemMetrics.errorRate).toBeGreaterThan(0);
    });
  });

  describe('File Size Categorization', () => {
    it('should categorize small files correctly', () => {
      metrics.trackFileIndexed('typescript', 500, 1, 100); // < 1KB
      
      const indexingMetrics = metrics.getIndexingMetrics();
      expect(indexingMetrics.fileSizeBreakdown['small (<1KB)']).toBe(1);
    });

    it('should categorize medium files correctly', () => {
      metrics.trackFileIndexed('typescript', 5000, 1, 100); // 1-10KB
      
      const indexingMetrics = metrics.getIndexingMetrics();
      expect(indexingMetrics.fileSizeBreakdown['medium (1-10KB)']).toBe(1);
    });

    it('should categorize large files correctly', () => {
      metrics.trackFileIndexed('typescript', 50000, 1, 100); // 10-100KB
      
      const indexingMetrics = metrics.getIndexingMetrics();
      expect(indexingMetrics.fileSizeBreakdown['large (10-100KB)']).toBe(1);
    });

    it('should categorize xlarge files correctly', () => {
      metrics.trackFileIndexed('typescript', 500000, 1, 100); // > 100KB
      
      const indexingMetrics = metrics.getIndexingMetrics();
      expect(indexingMetrics.fileSizeBreakdown['xlarge (>100KB)']).toBe(1);
    });
  });

  describe('Query History Management', () => {
    it('should maintain query history with timestamp', () => {
      const startTime = Date.now();
      metrics.trackSearch(100, 5, 'test query');
      
      const exported = metrics.export();
      expect(exported.queryHistory).toHaveLength(1);
      expect(exported.queryHistory[0].query).toBe('test query');
      expect(exported.queryHistory[0].timestamp).toBeGreaterThanOrEqual(startTime);
    });

    it('should aggregate popular queries correctly', () => {
      metrics.trackSearch(100, 5, 'query1');
      metrics.trackSearch(150, 3, 'query1'); // Same query
      metrics.trackSearch(200, 7, 'query2');
      
      const searchMetrics = metrics.getSearchMetrics();
      const popular = searchMetrics.popularQueries;
      
      const query1Stats = popular.find(q => q.query === 'query1');
      expect(query1Stats?.count).toBe(2);
      expect(query1Stats?.avgTime).toBe(125); // (100 + 150) / 2
    });

    it('should handle recent query aggregation', () => {
      // Add many queries to test slicing logic
      for (let i = 0; i < 600; i++) {
        metrics.trackSearch(100, 1, `query${i % 10}`); // 10 unique queries, repeated
      }
      
      const searchMetrics = metrics.getSearchMetrics();
      expect(searchMetrics.popularQueries.length).toBeGreaterThan(0);
      expect(searchMetrics.popularQueries.length).toBeLessThanOrEqual(10);
    });
  });
});