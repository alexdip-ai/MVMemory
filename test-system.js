#!/usr/bin/env node

// Simple test script to verify MVMemory components
const path = require('path');
const { spawn } = require('child_process');

console.log('🧪 Testing MVMemory System Components\n');

// Test 1: Check if Python vector engine can start
console.log('1. Testing Python Vector Engine...');
const pythonTest = spawn('python', [
  '-c',
  `
import sys
try:
    import faiss
    import sentence_transformers
    import numpy
    print("✅ Python dependencies OK")
    sys.exit(0)
except ImportError as e:
    print(f"❌ Missing dependency: {e}")
    sys.exit(1)
`
]);

pythonTest.stdout.on('data', (data) => {
  console.log(data.toString());
});

pythonTest.stderr.on('data', (data) => {
  console.error(data.toString());
});

pythonTest.on('close', (code) => {
  if (code === 0) {
    console.log('   Python engine test passed!\n');
    
    // Test 2: Check if TypeScript build exists
    console.log('2. Checking TypeScript build...');
    try {
      const fs = require('fs');
      const mcpServerPath = path.join(__dirname, 'dist', 'mcp', 'MCPServer.js');
      
      if (fs.existsSync(mcpServerPath)) {
        console.log('   ✅ MCP Server build found\n');
        
        // Test 3: Try to import core modules
        console.log('3. Testing core modules...');
        try {
          const { VectorStore } = require('./dist/core/VectorStore.js');
          console.log('   ✅ VectorStore module OK');
          
          const { CacheManager } = require('./dist/optimization/CacheManager.js');
          console.log('   ✅ CacheManager module OK');
          
          const { TokenOptimizer } = require('./dist/optimization/TokenOptimizer.js');
          console.log('   ✅ TokenOptimizer module OK');
          
          const { MetricsCollector } = require('./dist/monitoring/MetricsCollector.js');
          console.log('   ✅ MetricsCollector module OK\n');
          
          console.log('🎉 All system tests passed! MVMemory is ready to use.');
          console.log('\nNext steps:');
          console.log('1. Run "npm start" to start the MCP server');
          console.log('2. Configure Claude Code CLI with the settings shown above');
          console.log('3. Restart Claude Code CLI to activate MVMemory');
          
        } catch (e) {
          console.error('   ❌ Failed to load modules:', e.message);
          console.log('\nPlease run "npm run build" first');
        }
      } else {
        console.log('   ❌ Build not found. Please run "npm run build" first');
      }
    } catch (e) {
      console.error('   ❌ Error checking build:', e.message);
    }
  } else {
    console.log('   ❌ Python test failed. Please install Python dependencies:');
    console.log('      pip install -r requirements.txt');
  }
});