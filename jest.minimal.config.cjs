module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  
  testMatch: [
    '**/tests/simple.test.ts',
    '**/tests/token-optimizer.test.ts',
    '**/tests/metrics-collector.test.ts'
  ],
  
  transform: {
    '^.+\\.ts$': 'ts-jest'
  },
  
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/core/VectorStore.ts',
    '!src/mcp/MCPServer.ts'
  ],
  
  coverageReporters: ['text', 'text-summary']
};