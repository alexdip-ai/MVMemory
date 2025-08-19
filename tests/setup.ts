// Test setup file for Jest
import { jest } from '@jest/globals';

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.MVMEMORY_LOG_LEVEL = 'error';
process.env.MVMEMORY_DB = ':memory:';
process.env.MVMEMORY_CACHE_SIZE = '100';

// Mock winston
jest.mock('winston', () => {
  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };
  
  return {
    default: {
      createLogger: jest.fn(() => mockLogger),
      format: {
        combine: jest.fn(() => ({})),
        timestamp: jest.fn(() => ({})),
        colorize: jest.fn(() => ({})),
        printf: jest.fn(() => ({})),
        json: jest.fn(() => ({})),
        simple: jest.fn(() => ({}))
      },
      transports: {
        Console: jest.fn(() => ({})),
        File: jest.fn(() => ({}))
      }
    }
  };
});

// Increase timeout for CI environments
if (process.env.CI) {
  jest.setTimeout(60000);
}

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});

// Global test utilities
export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const mockFileSystem = {
  '/test/file1.ts': 'export function test() { return "test"; }',
  '/test/file2.py': 'def test():\n    return "test"',
  '/test/file3.js': 'function test() { return "test"; }',
};

export const createMockChunk = (overrides: any = {}) => ({
  id: 'test-id',
  type: 'function' as const,
  name: 'testFunction',
  content: 'function test() { return true; }',
  filePath: '/test/file.ts',
  startLine: 1,
  endLine: 3,
  language: 'typescript',
  imports: [],
  exports: [],
  metadata: {},
  ...overrides
});