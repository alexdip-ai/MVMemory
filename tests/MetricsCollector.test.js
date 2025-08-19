import { MetricsCollector } from '../src/monitoring/MetricsCollector.js';
describe('MetricsCollector', () => {
    let collector;
    beforeEach(() => {
        collector = new MetricsCollector();
    });
    afterEach(() => {
        collector.reset();
    });
    describe('Search Metrics Tracking', () => {
        it('should track basic search operations', () => {
            collector.trackSearch(100, 5, 'test query');
            collector.trackSearch(200, 3, 'another query');
            const metrics = collector.getSearchMetrics();
            expect(metrics.totalSearches).toBe(2);
            expect(metrics.avgSearchTime).toBe(150); // (100 + 200) / 2
            expect(metrics.avgResultCount).toBe(4); // (5 + 3) / 2
        });
        it('should track search operations without query', () => {
            collector.trackSearch(50, 10);
            const metrics = collector.getSearchMetrics();
            expect(metrics.totalSearches).toBe(1);
            expect(metrics.avgSearchTime).toBe(50);
            expect(metrics.avgResultCount).toBe(10);
        });
        it('should handle zero search duration', () => {
            collector.trackSearch(0, 5, 'instant query');
            const metrics = collector.getSearchMetrics();
            expect(metrics.totalSearches).toBe(1);
            expect(metrics.avgSearchTime).toBe(0);
        });
        it('should handle zero result count', () => {
            collector.trackSearch(100, 0, 'no results');
            const metrics = collector.getSearchMetrics();
            expect(metrics.totalSearches).toBe(1);
            expect(metrics.avgResultCount).toBe(0);
        });
        it('should track cache hits and misses', () => {
            collector.trackCacheHit();
            collector.trackCacheHit();
            collector.trackCacheMiss();
            const metrics = collector.getSearchMetrics();
            expect(metrics.cacheHitRate).toBe(2 / 3); // 2 hits out of 3 total
        });
        it('should handle cache metrics with no cache requests', () => {
            const metrics = collector.getSearchMetrics();
            expect(metrics.cacheHitRate).toBe(0);
        });
        it('should track popular queries', () => {
            // Add some queries multiple times
            collector.trackSearch(100, 5, 'popular query');
            collector.trackSearch(110, 4, 'popular query');
            collector.trackSearch(90, 6, 'popular query');
            collector.trackSearch(200, 3, 'less popular');
            collector.trackSearch(150, 2, 'least popular');
            const metrics = collector.getSearchMetrics();
            expect(metrics.popularQueries).toHaveLength(3);
            expect(metrics.popularQueries[0].query).toBe('popular query');
            expect(metrics.popularQueries[0].count).toBe(3);
            expect(metrics.popularQueries[0].avgTime).toBe(100); // (100 + 110 + 90) / 3
        });
        it('should limit query history to prevent memory leaks', () => {
            // Add more than 1000 queries
            for (let i = 0; i < 1200; i++) {
                collector.trackSearch(100, 5, `query ${i}`);
            }
            const metrics = collector.getSearchMetrics();
            // Should still work and not crash
            expect(metrics.totalSearches).toBe(1200);
            expect(metrics.popularQueries.length).toBeLessThanOrEqual(10);
        });
    });
    describe('Cache Metrics', () => {
        it('should track cache hit rate correctly', () => {
            // Create a pattern: hit, hit, miss, hit, miss
            collector.trackCacheHit();
            collector.trackCacheHit();
            collector.trackCacheMiss();
            collector.trackCacheHit();
            collector.trackCacheMiss();
            const metrics = collector.getSearchMetrics();
            expect(metrics.cacheHitRate).toBe(0.6); // 3 hits out of 5 total
        });
        it('should handle only cache hits', () => {
            collector.trackCacheHit();
            collector.trackCacheHit();
            collector.trackCacheHit();
            const metrics = collector.getSearchMetrics();
            expect(metrics.cacheHitRate).toBe(1.0);
        });
        it('should handle only cache misses', () => {
            collector.trackCacheMiss();
            collector.trackCacheMiss();
            collector.trackCacheMiss();
            const metrics = collector.getSearchMetrics();
            expect(metrics.cacheHitRate).toBe(0.0);
        });
    });
    describe('Indexing Metrics Tracking', () => {
        it('should track file indexing operations', () => {
            collector.trackFileIndexed('typescript', 1024, 5, 150);
            collector.trackFileIndexed('javascript', 2048, 8, 200);
            collector.trackFileIndexed('python', 512, 3, 100);
            const metrics = collector.getIndexingMetrics();
            expect(metrics.totalFilesIndexed).toBe(3);
            expect(metrics.totalChunksCreated).toBe(16); // 5 + 8 + 3
            expect(metrics.avgIndexingTime).toBe(150); // (150 + 200 + 100) / 3
            expect(metrics.indexingErrors).toBe(0);
        });
        it('should track language breakdown', () => {
            collector.trackFileIndexed('typescript', 1024, 5, 150);
            collector.trackFileIndexed('typescript', 2048, 8, 200);
            collector.trackFileIndexed('javascript', 512, 3, 100);
            collector.trackFileIndexed('python', 256, 2, 80);
            const metrics = collector.getIndexingMetrics();
            expect(metrics.languageBreakdown.typescript).toBe(2);
            expect(metrics.languageBreakdown.javascript).toBe(1);
            expect(metrics.languageBreakdown.python).toBe(1);
        });
        it('should track file size breakdown', () => {
            collector.trackFileIndexed('js', 500, 2, 50); // small
            collector.trackFileIndexed('js', 5000, 10, 100); // medium
            collector.trackFileIndexed('js', 50000, 50, 200); // large
            collector.trackFileIndexed('js', 200000, 100, 300); // xlarge
            const metrics = collector.getIndexingMetrics();
            expect(metrics.fileSizeBreakdown['small (<1KB)']).toBe(1);
            expect(metrics.fileSizeBreakdown['medium (1-10KB)']).toBe(1);
            expect(metrics.fileSizeBreakdown['large (10-100KB)']).toBe(1);
            expect(metrics.fileSizeBreakdown['xlarge (>100KB)']).toBe(1);
        });
        it('should track indexing errors', () => {
            collector.trackFileIndexed('typescript', 1024, 5, 150);
            collector.trackIndexingError();
            collector.trackIndexingError();
            const metrics = collector.getIndexingMetrics();
            expect(metrics.indexingErrors).toBe(2);
            expect(metrics.totalFilesIndexed).toBe(1);
        });
        it('should handle zero indexing time', () => {
            collector.trackFileIndexed('javascript', 1024, 5, 0);
            const metrics = collector.getIndexingMetrics();
            expect(metrics.avgIndexingTime).toBe(0);
        });
        it('should handle zero chunk count', () => {
            collector.trackFileIndexed('typescript', 1024, 0, 150);
            const metrics = collector.getIndexingMetrics();
            expect(metrics.totalChunksCreated).toBe(0);
        });
    });
    describe('Token Optimization Metrics', () => {
        it('should track token optimization operations', () => {
            collector.trackTokenOptimization(1000, 300); // 70% savings
            collector.trackTokenOptimization(500, 200); // 60% savings
            const metrics = collector.getOptimizationMetrics();
            expect(metrics.totalTokensSaved).toBe(1000); // (1000-300) + (500-200)
            expect(metrics.optimizedRequests).toBe(2);
            expect(metrics.tokenSavingsPercentage).toBeCloseTo(66.67, 1); // 1000/1500 * 100
        });
        it('should calculate compression ratio correctly', () => {
            collector.trackTokenOptimization(1000, 300); // 70% compression
            collector.trackTokenOptimization(500, 400); // 20% compression
            const metrics = collector.getOptimizationMetrics();
            // Average compression ratio should be 1 - (savings/total)
            // Savings: 700 + 100 = 800, Total: 1500
            expect(metrics.avgCompressionRatio).toBeCloseTo(0.467, 2); // 1 - (800/1500)
        });
        it('should handle zero token optimization', () => {
            const metrics = collector.getOptimizationMetrics();
            expect(metrics.totalTokensSaved).toBe(0);
            expect(metrics.avgCompressionRatio).toBe(1);
            expect(metrics.optimizedRequests).toBe(0);
            expect(metrics.tokenSavingsPercentage).toBe(0);
        });
        it('should handle cases where optimized tokens equal original', () => {
            collector.trackTokenOptimization(1000, 1000); // No compression
            const metrics = collector.getOptimizationMetrics();
            expect(metrics.totalTokensSaved).toBe(0);
            expect(metrics.tokenSavingsPercentage).toBe(0);
        });
        it('should handle large token counts', () => {
            collector.trackTokenOptimization(1000000, 100000); // 90% savings
            const metrics = collector.getOptimizationMetrics();
            expect(metrics.totalTokensSaved).toBe(900000);
            expect(metrics.tokenSavingsPercentage).toBe(90);
        });
    });
    describe('System Metrics', () => {
        it('should track error rates', () => {
            // Simulate some requests with errors
            collector.trackSearch(100, 5);
            collector.trackError();
            collector.trackSearch(200, 3);
            collector.trackError();
            collector.trackSearch(150, 4);
            const report = collector.getReport();
            expect(report.system.errorRate).toBeCloseTo(0.4); // 2 errors out of 5 total requests
        });
        it('should track system uptime', () => {
            const startTime = Date.now();
            const report = collector.getReport();
            expect(report.system.uptime).toBeGreaterThan(0);
            expect(report.system.uptime).toBeLessThan(1000); // Should be less than 1 second for this test
        });
        it('should include memory usage in system metrics', () => {
            const report = collector.getReport();
            expect(report.system.memoryUsage).toBeDefined();
            expect(report.system.memoryUsage.heapUsed).toBeGreaterThan(0);
            expect(report.system.memoryUsage.heapTotal).toBeGreaterThan(0);
        });
        it('should handle zero error rate', () => {
            collector.trackSearch(100, 5);
            collector.trackSearch(200, 3);
            const report = collector.getReport();
            expect(report.system.errorRate).toBe(0);
        });
    });
    describe('Comprehensive Reporting', () => {
        it('should generate complete metrics report', () => {
            // Add some data to all metric types
            collector.trackSearch(100, 5, 'test query');
            collector.trackCacheHit();
            collector.trackFileIndexed('typescript', 2048, 10, 150);
            collector.trackTokenOptimization(1000, 300);
            collector.trackError();
            const report = collector.getReport();
            expect(report.search).toBeDefined();
            expect(report.indexing).toBeDefined();
            expect(report.optimization).toBeDefined();
            expect(report.system).toBeDefined();
            expect(report.timestamp).toBeGreaterThan(0);
            expect(report.period.start).toBeGreaterThan(0);
            expect(report.period.end).toBeGreaterThan(report.period.start);
        });
        it('should maintain consistent timestamps', () => {
            const report1 = collector.getReport();
            // Small delay
            await new Promise(resolve => setTimeout(resolve, 10));
            const report2 = collector.getReport();
            expect(report2.timestamp).toBeGreaterThan(report1.timestamp);
            expect(report1.period.start).toBe(report2.period.start); // Same collector instance
        });
    });
    describe('Data Export and Import', () => {
        it('should export metrics data', () => {
            collector.trackSearch(100, 5, 'test query');
            collector.trackFileIndexed('typescript', 1024, 5, 150);
            collector.trackTokenOptimization(1000, 300);
            const exported = collector.export();
            expect(exported.searchCount).toBe(1);
            expect(exported.indexedFiles).toBe(1);
            expect(exported.optimizedRequestCount).toBe(1);
            expect(exported.exportedAt).toBeGreaterThan(0);
        });
        it('should import metrics data', () => {
            const importData = {
                searchCount: 5,
                totalSearchTime: 500,
                totalResultCount: 25,
                cacheHits: 3,
                cacheMisses: 2,
                indexedFiles: 10,
                createdChunks: 50,
                totalIndexingTime: 1000,
                languageStats: { typescript: 5, javascript: 3, python: 2 },
                totalTokensSaved: 5000,
                totalOriginalTokens: 10000,
                optimizedRequestCount: 8
            };
            collector.import(importData);
            const metrics = collector.getSearchMetrics();
            expect(metrics.totalSearches).toBe(5);
            expect(metrics.avgSearchTime).toBe(100);
            expect(metrics.cacheHitRate).toBe(0.6);
            const indexingMetrics = collector.getIndexingMetrics();
            expect(indexingMetrics.totalFilesIndexed).toBe(10);
            expect(indexingMetrics.languageBreakdown.typescript).toBe(5);
            const optimizationMetrics = collector.getOptimizationMetrics();
            expect(optimizationMetrics.totalTokensSaved).toBe(5000);
        });
        it('should handle import with missing data', () => {
            const incompleteData = {
                searchCount: 3,
                // Missing other fields
            };
            expect(() => collector.import(incompleteData)).not.toThrow();
            const metrics = collector.getSearchMetrics();
            expect(metrics.totalSearches).toBe(3);
        });
        it('should handle import with null data', () => {
            expect(() => collector.import(null)).not.toThrow();
            expect(() => collector.import(undefined)).not.toThrow();
        });
        it('should preserve query history during export/import', () => {
            collector.trackSearch(100, 5, 'query1');
            collector.trackSearch(200, 3, 'query2');
            const exported = collector.export();
            const newCollector = new MetricsCollector();
            newCollector.import(exported);
            const metrics = newCollector.getSearchMetrics();
            expect(metrics.totalSearches).toBe(2);
        });
    });
    describe('Reset Functionality', () => {
        it('should reset all metrics to initial state', () => {
            // Add substantial data
            collector.trackSearch(100, 5, 'test query');
            collector.trackCacheHit();
            collector.trackFileIndexed('typescript', 1024, 5, 150);
            collector.trackTokenOptimization(1000, 300);
            collector.trackError();
            collector.reset();
            const report = collector.getReport();
            expect(report.search.totalSearches).toBe(0);
            expect(report.indexing.totalFilesIndexed).toBe(0);
            expect(report.optimization.optimizedRequests).toBe(0);
            expect(report.system.errorRate).toBe(0);
        });
        it('should reset timestamps', () => {
            const oldReport = collector.getReport();
            const oldStartTime = oldReport.period.start;
            // Small delay
            await new Promise(resolve => setTimeout(resolve, 10));
            collector.reset();
            const newReport = collector.getReport();
            expect(newReport.period.start).toBeGreaterThan(oldStartTime);
        });
    });
    describe('Edge Cases and Error Handling', () => {
        it('should handle negative durations gracefully', () => {
            collector.trackSearch(-100, 5, 'negative duration');
            const metrics = collector.getSearchMetrics();
            expect(metrics.totalSearches).toBe(1);
            expect(metrics.avgSearchTime).toBe(-100); // Should preserve the data as-is
        });
        it('should handle extremely large values', () => {
            collector.trackSearch(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'large values');
            collector.trackTokenOptimization(Number.MAX_SAFE_INTEGER, 0);
            const searchMetrics = collector.getSearchMetrics();
            const optimizationMetrics = collector.getOptimizationMetrics();
            expect(searchMetrics.totalSearches).toBe(1);
            expect(optimizationMetrics.tokenSavingsPercentage).toBe(100);
        });
        it('should handle very small values', () => {
            collector.trackSearch(0.001, 0, 'tiny values');
            collector.trackFileIndexed('js', 1, 0, 0.1);
            const searchMetrics = collector.getSearchMetrics();
            const indexingMetrics = collector.getIndexingMetrics();
            expect(searchMetrics.avgSearchTime).toBe(0.001);
            expect(indexingMetrics.avgIndexingTime).toBe(0.1);
        });
        it('should handle empty strings and special characters in queries', () => {
            const queries = ['', ' ', '\n', '\t', '🎉', '测试', null, undefined];
            queries.forEach((query, index) => {
                expect(() => collector.trackSearch(100, 1, query)).not.toThrow();
            });
            const metrics = collector.getSearchMetrics();
            expect(metrics.totalSearches).toBe(queries.length);
        });
        it('should handle extremely long file paths and language names', () => {
            const longLanguage = 'a'.repeat(1000);
            const largeFileSize = 1024 * 1024 * 1024; // 1GB
            expect(() => {
                collector.trackFileIndexed(longLanguage, largeFileSize, 1000, 5000);
            }).not.toThrow();
            const metrics = collector.getIndexingMetrics();
            expect(metrics.languageBreakdown[longLanguage]).toBe(1);
        });
        it('should handle rapid concurrent operations', () => {
            const operations = 1000;
            const promises = [];
            for (let i = 0; i < operations; i++) {
                promises.push(new Promise(resolve => {
                    collector.trackSearch(Math.random() * 100, Math.floor(Math.random() * 10), `query${i}`);
                    collector.trackCacheHit();
                    resolve();
                }));
            }
            expect(() => Promise.all(promises)).not.toThrow();
        });
    });
    describe('Performance Considerations', () => {
        it('should handle large numbers of operations efficiently', () => {
            const start = Date.now();
            for (let i = 0; i < 10000; i++) {
                collector.trackSearch(100 + i, 5, `query${i % 100}`);
                if (i % 2 === 0)
                    collector.trackCacheHit();
                else
                    collector.trackCacheMiss();
            }
            const duration = Date.now() - start;
            // Should complete within reasonable time (generous limit)
            expect(duration).toBeLessThan(5000);
            const metrics = collector.getSearchMetrics();
            expect(metrics.totalSearches).toBe(10000);
        });
        it('should maintain bounded memory usage with many queries', () => {
            // Add many unique queries to test memory bounds
            for (let i = 0; i < 2000; i++) {
                collector.trackSearch(100, 5, `unique_query_${i}`);
            }
            const exported = collector.export();
            // Query history should be limited to prevent memory issues
            expect(exported.queryHistory.length).toBeLessThanOrEqual(100);
        });
    });
    describe('Statistics Calculation Edge Cases', () => {
        it('should handle division by zero in averages', () => {
            // Test with no data
            const emptyMetrics = collector.getSearchMetrics();
            expect(emptyMetrics.avgSearchTime).toBe(0);
            expect(emptyMetrics.avgResultCount).toBe(0);
            expect(emptyMetrics.cacheHitRate).toBe(0);
        });
        it('should calculate popular queries correctly with edge cases', () => {
            // Add queries with same frequency
            collector.trackSearch(100, 5, 'query1');
            collector.trackSearch(200, 3, 'query1');
            collector.trackSearch(150, 4, 'query2');
            collector.trackSearch(250, 2, 'query2');
            const metrics = collector.getSearchMetrics();
            expect(metrics.popularQueries).toHaveLength(2);
            expect(metrics.popularQueries[0].count).toBe(2);
            expect(metrics.popularQueries[1].count).toBe(2);
        });
        it('should handle floating point precision in calculations', () => {
            collector.trackSearch(1 / 3, 1, 'precision test');
            collector.trackSearch(2 / 3, 2, 'precision test');
            const metrics = collector.getSearchMetrics();
            expect(metrics.avgSearchTime).toBeCloseTo(0.5, 10);
            expect(metrics.avgResultCount).toBeCloseTo(1.5, 10);
        });
    });
});
//# sourceMappingURL=MetricsCollector.test.js.map