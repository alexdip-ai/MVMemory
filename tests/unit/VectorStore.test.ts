import { VectorStore, CodeChunk, SearchResult } from '../../src/core/VectorStore.js';
import { createMockChunk, delay } from '../setup.js';
import fs from 'fs-extra';
import path from 'path';
import { jest } from '@jest/globals';

// Mock dependencies
jest.mock('fs-extra');
jest.mock('child_process');
jest.mock('winston');

const mockFs = fs as jest.Mocked<typeof fs>;

describe('VectorStore', () => {
  let vectorStore: VectorStore;
  let tempDbPath: string;

  beforeEach(() => {
    tempDbPath = path.join(__dirname, 'test-db.json');
    
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock fs operations
    mockFs.readFile.mockResolvedValue('{"embeddings": [], "file_index": []}');
    mockFs.writeFile.mockResolvedValue();
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.access.mockRejectedValue(new Error('File not found'));
    
    vectorStore = new VectorStore(tempDbPath);
  });

  afterEach(async () => {
    if (vectorStore) {
      await vectorStore.close();
    }
    jest.clearAllMocks();
  });

  describe('Constructor and Initialization', () => {
    it('should initialize with default database path', () => {
      const vs = new VectorStore();
      expect(vs).toBeInstanceOf(VectorStore);
    });

    it('should initialize with custom database path', () => {
      const customPath = '/custom/path/db.json';
      const vs = new VectorStore(customPath);
      expect(vs).toBeInstanceOf(VectorStore);
    });

    it('should create new database when file does not exist', async () => {
      mockFs.readFile.mockRejectedValueOnce(new Error('ENOENT'));
      
      const vs = new VectorStore(tempDbPath);
      await delay(100); // Allow initialization to complete
      
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        tempDbPath,
        expect.stringContaining('embeddings')
      );
    });

    it('should load existing database when file exists', async () => {
      const existingData = {
        embeddings: [
          {
            id: 'test-1',
            file_path: '/test/file.ts',
            chunk_type: 'function',
            name: 'testFunc',
            content: 'function test() {}',
            start_line: 1,
            end_line: 1,
            language: 'typescript',
            imports: '[]',
            exports: '[]',
            metadata: '{}',
            created_at: '2024-01-01T00:00:00.000Z',
            updated_at: '2024-01-01T00:00:00.000Z'
          }
        ],
        file_index: []
      };
      
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(existingData));
      
      const vs = new VectorStore(tempDbPath);
      await delay(100);
      
      expect(mockFs.readFile).toHaveBeenCalledWith(tempDbPath, 'utf-8');
    });

    it('should handle invalid JSON in database file', async () => {
      mockFs.readFile.mockResolvedValueOnce('invalid json');
      
      const vs = new VectorStore(tempDbPath);
      await delay(100);
      
      // Should create new database when JSON is invalid
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        tempDbPath,
        expect.stringContaining('embeddings')
      );
    });
  });

  describe('addChunk', () => {
    it('should add a chunk without Python engine', async () => {
      const chunk: CodeChunk = createMockChunk({
        id: 'test-chunk-1',
        name: 'testFunction',
        content: 'function test() { return true; }'
      });

      await vectorStore.addChunk(chunk);

      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it('should replace existing chunk with same id', async () => {
      const chunk1: CodeChunk = createMockChunk({
        id: 'same-id',
        name: 'original',
        content: 'original content'
      });
      
      const chunk2: CodeChunk = createMockChunk({
        id: 'same-id',
        name: 'updated',
        content: 'updated content'
      });

      await vectorStore.addChunk(chunk1);
      await vectorStore.addChunk(chunk2);

      expect(mockFs.writeFile).toHaveBeenCalledTimes(2);
    });

    it('should generate id when not provided', async () => {
      const chunk: CodeChunk = createMockChunk();
      delete chunk.id;

      await vectorStore.addChunk(chunk);

      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it('should handle Python engine integration', async () => {
      // Mock Python engine ready state
      (vectorStore as any).pythonReady = true;
      (vectorStore as any).sendToPython = jest.fn().mockResolvedValue({
        vectorIds: [123]
      });

      const chunk: CodeChunk = createMockChunk();
      await vectorStore.addChunk(chunk);

      expect((vectorStore as any).sendToPython).toHaveBeenCalledWith('add', {
        texts: [chunk.content],
        metadata: [{
          id: chunk.id,
          filePath: chunk.filePath,
          name: chunk.name,
          type: chunk.type
        }]
      });
    });

    it('should handle Python engine errors gracefully', async () => {
      (vectorStore as any).pythonReady = true;
      (vectorStore as any).sendToPython = jest.fn().mockRejectedValue(new Error('Python error'));

      const chunk: CodeChunk = createMockChunk();
      
      // Should not throw, should fallback gracefully
      await expect(vectorStore.addChunk(chunk)).resolves.not.toThrow();
    });
  });

  describe('removeFile', () => {
    beforeEach(async () => {
      // Add some test chunks
      const chunks = [
        createMockChunk({ id: 'file1-chunk1', filePath: '/test/file1.ts' }),
        createMockChunk({ id: 'file1-chunk2', filePath: '/test/file1.ts' }),
        createMockChunk({ id: 'file2-chunk1', filePath: '/test/file2.ts' })
      ];
      
      for (const chunk of chunks) {
        await vectorStore.addChunk(chunk);
      }
    });

    it('should remove all chunks for a file', async () => {
      await vectorStore.removeFile('/test/file1.ts');
      
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it('should remove from Python engine when available', async () => {
      (vectorStore as any).pythonReady = true;
      (vectorStore as any).sendToPython = jest.fn().mockResolvedValue({});

      await vectorStore.removeFile('/test/file1.ts');

      expect((vectorStore as any).sendToPython).toHaveBeenCalledWith('remove', {
        vectorIds: expect.any(Array)
      });
    });

    it('should handle Python engine errors during removal', async () => {
      (vectorStore as any).pythonReady = true;
      (vectorStore as any).sendToPython = jest.fn().mockRejectedValue(new Error('Python error'));

      await expect(vectorStore.removeFile('/test/file1.ts')).resolves.not.toThrow();
    });

    it('should handle removing non-existent file', async () => {
      await expect(vectorStore.removeFile('/nonexistent/file.ts')).resolves.not.toThrow();
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      // Add test data
      const chunks = [
        createMockChunk({
          id: 'search1',
          name: 'calculateTotal',
          content: 'function calculateTotal(items) { return items.reduce((sum, item) => sum + item.price, 0); }',
          language: 'javascript'
        }),
        createMockChunk({
          id: 'search2',
          name: 'UserService',
          content: 'class UserService { async findUser(id) { return this.repository.findById(id); } }',
          language: 'typescript'
        }),
        createMockChunk({
          id: 'search3',
          name: 'processData',
          content: 'def process_data(data): return [item for item in data if item.is_valid()]',
          language: 'python'
        })
      ];
      
      for (const chunk of chunks) {
        await vectorStore.addChunk(chunk);
      }
    });

    it('should perform text search when Python engine unavailable', async () => {
      const results = await vectorStore.search('calculate', 10);
      
      expect(results).toBeInstanceOf(Array);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('distance');
      expect(results[0]).toHaveProperty('relevance');
    });

    it('should filter by file types', async () => {
      const results = await vectorStore.search('function', 10, ['typescript']);
      
      results.forEach(result => {
        expect(result.language).toBe('typescript');
      });
    });

    it('should respect limit parameter', async () => {
      const results = await vectorStore.search('function', 1);
      
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('should handle empty search results', async () => {
      const results = await vectorStore.search('nonexistent-search-term', 10);
      
      expect(results).toEqual([]);
    });

    it('should use Python engine when available', async () => {
      (vectorStore as any).pythonReady = true;
      (vectorStore as any).sendToPython = jest.fn().mockResolvedValue([
        {
          metadata: { id: 'search1' },
          distance: 0.2,
          relevance: 0.8
        }
      ]);

      const results = await vectorStore.search('calculate', 10);

      expect((vectorStore as any).sendToPython).toHaveBeenCalledWith('search', {
        query: 'calculate',
        k: 20 // limit * 2
      });
      expect(results.length).toBeGreaterThan(0);
    });

    it('should fallback to text search when Python engine fails', async () => {
      (vectorStore as any).pythonReady = true;
      (vectorStore as any).sendToPython = jest.fn().mockRejectedValue(new Error('Search failed'));

      const results = await vectorStore.search('calculate', 10);
      
      expect(results).toBeInstanceOf(Array);
    });

    it('should search case-insensitive', async () => {
      const resultsLower = await vectorStore.search('calculate');
      const resultsUpper = await vectorStore.search('CALCULATE');
      
      expect(resultsLower.length).toEqual(resultsUpper.length);
    });

    it('should search in both content and name', async () => {
      const contentResults = await vectorStore.search('reduce');
      const nameResults = await vectorStore.search('UserService');
      
      expect(contentResults.length).toBeGreaterThan(0);
      expect(nameResults.length).toBeGreaterThan(0);
    });
  });

  describe('searchByCode', () => {
    it('should delegate to search method', async () => {
      const searchSpy = jest.spyOn(vectorStore, 'search');
      
      await vectorStore.searchByCode('function test() {}', 5);
      
      expect(searchSpy).toHaveBeenCalledWith('function test() {}', 5);
    });
  });

  describe('getContext', () => {
    beforeEach(async () => {
      // Add test data with imports
      const chunks = [
        createMockChunk({
          id: 'context1',
          name: 'mainFunction',
          content: 'import { helper } from "./helper"; function main() { return helper.process(); }',
          imports: ['helper']
        }),
        createMockChunk({
          id: 'context2',
          name: 'helper',
          content: 'export function process() { return "processed"; }'
        })
      ];
      
      for (const chunk of chunks) {
        await vectorStore.addChunk(chunk);
      }
    });

    it('should return context for existing target', async () => {
      const context = await vectorStore.getContext('mainFunction', 2);
      
      expect(context).toBeInstanceOf(Array);
      expect(context.length).toBeGreaterThan(0);
      expect(context[0].name).toBe('mainFunction');
    });

    it('should return empty array for non-existent target', async () => {
      const context = await vectorStore.getContext('nonexistent', 2);
      
      expect(context).toEqual([]);
    });

    it('should include related imports when depth > 0', async () => {
      const context = await vectorStore.getContext('mainFunction', 2);
      
      expect(context.length).toBeGreaterThan(1);
    });

    it('should limit context when depth is 0', async () => {
      const context = await vectorStore.getContext('mainFunction', 0);
      
      expect(context.length).toBe(1);
    });
  });

  describe('getStats', () => {
    beforeEach(async () => {
      // Add test data
      const chunks = [
        createMockChunk({ language: 'typescript' }),
        createMockChunk({ language: 'javascript' }),
        createMockChunk({ language: 'typescript' })
      ];
      
      for (const chunk of chunks) {
        await vectorStore.addChunk(chunk);
      }
    });

    it('should return comprehensive statistics', async () => {
      const stats = await vectorStore.getStats();
      
      expect(stats).toHaveProperty('totalChunks');
      expect(stats).toHaveProperty('totalFiles');
      expect(stats).toHaveProperty('languages');
      expect(stats).toHaveProperty('pythonEngineReady');
      
      expect(stats.totalChunks).toBe(3);
      expect(stats.languages).toBeInstanceOf(Array);
      expect(stats.languages.length).toBeGreaterThan(0);
    });

    it('should group by language correctly', async () => {
      const stats = await vectorStore.getStats();
      
      const tsLang = stats.languages.find((l: any) => l.language === 'typescript');
      const jsLang = stats.languages.find((l: any) => l.language === 'javascript');
      
      expect(tsLang?.count).toBe(2);
      expect(jsLang?.count).toBe(1);
    });
  });

  describe('healthCheck', () => {
    it('should return Python engine status', () => {
      const health = vectorStore.healthCheck();
      
      expect(typeof health).toBe('boolean');
      expect(health).toBe(false); // Python engine not ready in tests
    });

    it('should return true when Python engine is ready', () => {
      (vectorStore as any).pythonReady = true;
      
      const health = vectorStore.healthCheck();
      
      expect(health).toBe(true);
    });
  });

  describe('close', () => {
    it('should save database and cleanup', async () => {
      await vectorStore.close();
      
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it('should kill Python process if running', async () => {
      const mockProcess = {
        kill: jest.fn(),
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn()
      };
      
      (vectorStore as any).pythonProcess = mockProcess;
      
      await vectorStore.close();
      
      expect(mockProcess.kill).toHaveBeenCalled();
    });
  });

  describe('Database Operations', () => {
    it('should handle database save errors', async () => {
      mockFs.writeFile.mockRejectedValueOnce(new Error('Write failed'));
      
      const chunk = createMockChunk();
      
      await expect(vectorStore.addChunk(chunk)).rejects.toThrow('Write failed');
    });

    it('should create directory structure if missing', async () => {
      mockFs.mkdir.mockResolvedValueOnce(undefined);
      
      const chunk = createMockChunk();
      await vectorStore.addChunk(chunk);
      
      expect(mockFs.mkdir).toHaveBeenCalled();
    });
  });

  describe('Python Engine Integration', () => {
    it('should start Python engine on initialization', () => {
      // Python engine should attempt to start (but fail in test environment)
      expect(mockFs.access).toHaveBeenCalled();
    });

    it('should handle Python engine timeout', async () => {
      (vectorStore as any).pythonReady = true;
      (vectorStore as any).requestQueue = new Map();
      
      const sendPromise = (vectorStore as any).sendToPython('test', {});
      
      // Simulate timeout
      jest.advanceTimersByTime(30000);
      
      await expect(sendPromise).rejects.toThrow('Python engine timeout');
    });

    it('should handle malformed Python responses', () => {
      const mockCallback = jest.fn();
      (vectorStore as any).requestQueue.set('test-id', mockCallback);
      
      // Simulate receiving malformed data
      const mockStdout = {
        on: jest.fn((event, callback) => {
          if (event === 'data') {
            callback('invalid json\n');
          }
        })
      };
      
      (vectorStore as any).pythonProcess = { stdout: mockStdout };
      
      // Should not crash on malformed data
      expect(() => {
        mockStdout.on.mock.calls[0][1]('invalid json\n');
      }).not.toThrow();
    });

    it('should restart Python engine on exit', () => {
      const restartSpy = jest.spyOn(vectorStore as any, 'startPythonEngine');
      
      // Simulate process exit
      const mockProcess = {
        on: jest.fn((event, callback) => {
          if (event === 'exit') {
            callback(1);
          }
        }),
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() }
      };
      
      (vectorStore as any).pythonProcess = mockProcess;
      
      // Trigger exit event
      mockProcess.on.mock.calls.find(([event]) => event === 'exit')?.[1](1);
      
      // Should schedule restart
      expect(setTimeout).toHaveBeenCalled();
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty database gracefully', async () => {
      mockFs.readFile.mockResolvedValueOnce('{"embeddings": [], "file_index": []}');
      
      const vs = new VectorStore(tempDbPath);
      await delay(100);
      
      const stats = await vs.getStats();
      expect(stats.totalChunks).toBe(0);
      expect(stats.totalFiles).toBe(0);
    });

    it('should handle corrupted database structure', async () => {
      mockFs.readFile.mockResolvedValueOnce('{"invalid": "structure"}');
      
      const vs = new VectorStore(tempDbPath);
      await delay(100);
      
      // Should create proper structure
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        tempDbPath,
        expect.stringContaining('"embeddings":[]')
      );
    });

    it('should handle very large search results', async () => {
      // Add many chunks
      for (let i = 0; i < 100; i++) {
        await vectorStore.addChunk(createMockChunk({
          id: `chunk-${i}`,
          name: `function${i}`,
          content: `function test${i}() { return ${i}; }`
        }));
      }
      
      const results = await vectorStore.search('function', 50);
      expect(results.length).toBeLessThanOrEqual(50);
    });

    it('should handle special characters in search', async () => {
      await vectorStore.addChunk(createMockChunk({
        content: 'function test() { return "hello@#$%^&*()"; }'
      }));
      
      const results = await vectorStore.search('@#$%^&*()');
      expect(results).toBeInstanceOf(Array);
    });

    it('should handle unicode content', async () => {
      await vectorStore.addChunk(createMockChunk({
        content: 'function test() { return "こんにちは世界"; }'
      }));
      
      const results = await vectorStore.search('こんにちは');
      expect(results).toBeInstanceOf(Array);
    });
  });
});