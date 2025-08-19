#!/usr/bin/env node

/**
 * MVMemory System Validation Script
 * Tests core functionality to ensure CI/CD compatibility across Node.js versions
 */

import { VectorStore } from '../dist/core/VectorStore.js';
import { CodeParser } from '../dist/indexer/CodeParser.js';
import { MCPVectorServer } from '../dist/mcp/MCPServer.js';
import { TokenOptimizer } from '../dist/optimization/TokenOptimizer.js';
import { MetricsCollector } from '../dist/monitoring/MetricsCollector.js';
import { CacheManager } from '../dist/optimization/CacheManager.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test configuration
const TEST_DB_PATH = path.join(__dirname, '..', 'temp-validation.json');

let testsPassed = 0;
let testsTotal = 0;

function test(name, fn) {
  testsTotal++;
  return fn().then(() => {
    console.log(`✅ ${name}`);
    testsPassed++;
  }).catch(error => {
    console.error(`❌ ${name}: ${error.message}`);
  });
}

async function cleanup() {
  try {
    await fs.unlink(TEST_DB_PATH);
  } catch (error) {
    // Ignore if file doesn't exist
  }
}

async function validateSystem() {
  console.log('🚀 MVMemory System Validation');
  console.log(`📋 Node.js version: ${process.version}`);
  console.log('');

  await cleanup();

  // Test 1: VectorStore Core Functionality
  await test('VectorStore initialization and basic operations', async () => {
    const vectorStore = new VectorStore(TEST_DB_PATH);
    
    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 500));

    // Add test chunk
    const testChunk = {
      type: 'function',
      name: 'validateFunction',
      content: 'function validateFunction() { return "validation successful"; }',
      filePath: '/test/validate.js',
      startLine: 1,
      endLine: 1,
      language: 'javascript',
      imports: [],
      exports: ['validateFunction']
    };

    await vectorStore.addChunk(testChunk);

    // Test search
    const results = await vectorStore.search('validateFunction', 5);
    if (results.length === 0) throw new Error('Search returned no results');

    // Test stats
    const stats = await vectorStore.getStats();
    if (stats.totalChunks === 0) throw new Error('Stats show no chunks');

    await vectorStore.close();
  });

  // Test 2: CodeParser
  await test('CodeParser functionality', async () => {
    const parser = new CodeParser();
    
    const jsCode = `
      function testFunction() {
        return "hello world";
      }
      
      class TestClass {
        constructor() {
          this.value = 42;
        }
      }
    `;

    const chunks = await parser.parseFile('/test/sample.js', jsCode);
    if (chunks.length === 0) throw new Error('Parser returned no chunks');
  });

  // Test 3: MCPVectorServer
  await test('MCPVectorServer initialization', async () => {
    const server = new MCPVectorServer({
      dbPath: TEST_DB_PATH,
      cacheDir: path.join(__dirname, '..', 'temp-cache'),
      autoIndex: false,
      watchFiles: false
    });

    // Just test that it initializes without error
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  // Test 4: TokenOptimizer
  await test('TokenOptimizer functionality', async () => {
    const optimizer = new TokenOptimizer();
    
    const testResults = [
      {
        id: '1',
        type: 'function',
        name: 'test1',
        content: 'function test1() { return 1; }',
        filePath: '/test1.js',
        startLine: 1,
        endLine: 1,
        language: 'javascript',
        imports: [],
        exports: [],
        distance: 0.1,
        relevance: 0.9
      }
    ];

    const optimized = optimizer.optimizeSearchResults(testResults, 'test query', 1000);
    if (!optimized || optimized.chunksIncluded === 0) throw new Error('Optimizer returned empty results');
  });

  // Test 5: MetricsCollector
  await test('MetricsCollector functionality', async () => {
    const collector = new MetricsCollector();
    
    collector.trackSearch(50, 5, 'test query');
    collector.trackCacheHit();

    const report = collector.getReport();
    if (report.search.totalSearches === 0) throw new Error('Metrics not tracking searches');
  });

  // Test 6: CacheManager
  await test('CacheManager functionality', async () => {
    const cache = new CacheManager();
    
    cache.set('test-key', 'test-value');
    const value = cache.get('test-key');
    if (value !== 'test-value') throw new Error('Cache not storing/retrieving values');

    cache.delete('test-key');
    const deletedValue = cache.get('test-key');
    if (deletedValue !== null) throw new Error('Cache not properly deleting values');
  });

  await cleanup();

  console.log('');
  console.log(`📊 Validation Results: ${testsPassed}/${testsTotal} tests passed`);
  
  if (testsPassed === testsTotal) {
    console.log('🎉 All validations passed! System is ready for production.');
    return true;
  } else {
    console.log(`❌ ${testsTotal - testsPassed} validations failed.`);
    return false;
  }
}

// Run validation
validateSystem().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('💥 Validation script failed:', error);
  process.exit(1);
});