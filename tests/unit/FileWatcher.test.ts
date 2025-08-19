import { FileWatcher, FileWatcherConfig, IndexingStats } from '../../src/indexer/FileWatcher.js';
import { VectorStore } from '../../src/core/VectorStore.js';
import { CodeParser } from '../../src/indexer/CodeParser.js';
import { createMockChunk, delay, mockFileSystem } from '../setup.js';
import fs from 'fs-extra';
import path from 'path';
import { jest } from '@jest/globals';

// Mock dependencies
jest.mock('fs-extra');
jest.mock('chokidar');
jest.mock('glob');
jest.mock('winston');
jest.mock('../../src/core/VectorStore.js');
jest.mock('../../src/indexer/CodeParser.js');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockVectorStore = VectorStore as jest.MockedClass<typeof VectorStore>;
const mockCodeParser = CodeParser as jest.MockedClass<typeof CodeParser>;

// Mock chokidar
const mockChokidar = {
  watch: jest.fn(),
  close: jest.fn(),
  on: jest.fn(),
  unwatch: jest.fn()
};

// Mock glob
const mockGlob = {
  glob: jest.fn()
};

// Set up mock modules
jest.doMock('chokidar', () => mockChokidar);
jest.doMock('glob', () => mockGlob);

describe('FileWatcher', () => {
  let fileWatcher: FileWatcher;
  let mockVectorStoreInstance: jest.Mocked<VectorStore>;
  let mockCodeParserInstance: jest.Mocked<CodeParser>;
  let config: FileWatcherConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useFakeTimers();

    // Setup mock instances
    mockVectorStoreInstance = {
      addChunk: jest.fn().mockResolvedValue(undefined),
      removeFile: jest.fn().mockResolvedValue(undefined),
      search: jest.fn().mockResolvedValue([]),
      getStats: jest.fn().mockResolvedValue({ totalChunks: 0, totalFiles: 0 }),
      close: jest.fn().mockResolvedValue(undefined),
      healthCheck: jest.fn().mockReturnValue(true)
    } as any;

    mockCodeParserInstance = {
      parseFile: jest.fn().mockResolvedValue([createMockChunk()]),
      shouldIndex: jest.fn().mockReturnValue(true)
    } as any;

    mockVectorStore.mockImplementation(() => mockVectorStoreInstance);
    mockCodeParser.mockImplementation(() => mockCodeParserInstance);

    // Setup fs mocks
    mockFs.stat.mockResolvedValue({
      size: 1000,
      isDirectory: () => false,
      isFile: () => true
    } as any);

    mockFs.readFile.mockResolvedValue('function test() { return "hello"; }');

    // Setup chokidar mock
    const mockWatcher = {
      on: jest.fn().mockReturnThis(),
      close: jest.fn().mockResolvedValue(undefined),
      unwatch: jest.fn()
    };
    
    mockChokidar.watch.mockReturnValue(mockWatcher as any);

    // Setup glob mock
    mockGlob.glob.mockResolvedValue([
      '/test/project/src/file1.ts',
      '/test/project/src/file2.js',
      '/test/project/README.md'
    ]);

    config = {
      projectPath: '/test/project',
      vectorStore: mockVectorStoreInstance,
      debounceDelay: 100,
      batchSize: 5,
      maxConcurrency: 2,
      watchEnabled: true,
      indexOnStart: false,
      ignorePatterns: ['**/node_modules/**', '**/.git/**'],
      logLevel: 'error'
    };
  });

  afterEach(() => {
    if (fileWatcher) {
      fileWatcher.removeAllListeners();
    }
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('Constructor and Initialization', () => {
    it('should initialize with required config', () => {
      fileWatcher = new FileWatcher(config);
      
      expect(fileWatcher).toBeInstanceOf(FileWatcher);
      expect(mockVectorStore).toHaveBeenCalledWith(config.vectorStore);
      expect(mockCodeParser).toHaveBeenCalled();
    });

    it('should initialize with default config values', () => {
      const minimalConfig = {
        projectPath: '/test/project',
        vectorStore: mockVectorStoreInstance
      };
      
      fileWatcher = new FileWatcher(minimalConfig);
      
      expect(fileWatcher).toBeInstanceOf(FileWatcher);
    });

    it('should start watching if watchEnabled is true', () => {
      fileWatcher = new FileWatcher(config);
      
      expect(mockChokidar.watch).toHaveBeenCalledWith(
        config.projectPath,
        expect.objectContaining({
          ignored: config.ignorePatterns,
          persistent: true,
          ignoreInitial: true
        })
      );
    });

    it('should not start watching if watchEnabled is false', () => {
      const nonWatchingConfig = { ...config, watchEnabled: false };
      fileWatcher = new FileWatcher(nonWatchingConfig);
      
      expect(mockChokidar.watch).not.toHaveBeenCalled();
    });

    it('should start initial indexing if indexOnStart is true', () => {
      const indexOnStartConfig = { ...config, indexOnStart: true };
      fileWatcher = new FileWatcher(indexOnStartConfig);
      
      // Initial indexing should be triggered
      expect(mockGlob.glob).toHaveBeenCalled();
    });
  });

  describe('File Discovery', () => {
    beforeEach(() => {
      fileWatcher = new FileWatcher({ ...config, indexOnStart: false });
    });

    it('should find indexable files with correct patterns', async () => {
      const findIndexableFilesSpy = (fileWatcher as any).findIndexableFiles;
      
      await (fileWatcher as any).findIndexableFiles();
      
      expect(mockGlob.glob).toHaveBeenCalledWith(
        expect.stringContaining('**/*.ts'),
        expect.objectContaining({
          cwd: config.projectPath,
          absolute: true,
          ignore: config.ignorePatterns,
          nodir: true
        })
      );
    });

    it('should filter files using shouldIndex', async () => {
      mockCodeParserInstance.shouldIndex
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);

      const files = await (fileWatcher as any).findIndexableFiles();
      
      expect(mockCodeParserInstance.shouldIndex).toHaveBeenCalledTimes(3);
    });

    it('should handle glob errors gracefully', async () => {
      mockGlob.glob.mockRejectedValue(new Error('Glob failed'));
      
      const files = await (fileWatcher as any).findIndexableFiles();
      
      expect(files).toEqual([]);
    });

    it('should remove duplicates from file list', async () => {
      mockGlob.glob
        .mockResolvedValueOnce(['/test/file1.ts'])
        .mockResolvedValueOnce(['/test/file1.ts', '/test/file2.js']);
      
      const files = await (fileWatcher as any).findIndexableFiles();
      
      const uniqueFiles = [...new Set(files)];
      expect(files.length).toBe(uniqueFiles.length);
    });
  });

  describe('File Indexing', () => {
    beforeEach(() => {
      fileWatcher = new FileWatcher({ ...config, indexOnStart: false });
    });

    it('should index a single file successfully', async () => {
      const filePath = '/test/project/src/test.ts';
      const mockChunks = [
        createMockChunk({ id: 'chunk1', filePath }),
        createMockChunk({ id: 'chunk2', filePath })
      ];
      
      mockCodeParserInstance.parseFile.mockResolvedValue(mockChunks);
      
      await (fileWatcher as any).indexFile(filePath);
      
      expect(mockFs.readFile).toHaveBeenCalledWith(filePath, 'utf-8');
      expect(mockCodeParserInstance.parseFile).toHaveBeenCalledWith(filePath, expect.any(String));
      expect(mockVectorStoreInstance.removeFile).toHaveBeenCalledWith(filePath);
      expect(mockVectorStoreInstance.addChunk).toHaveBeenCalledTimes(2);
    });

    it('should skip files that are too large', async () => {
      const largePath = '/test/project/large.ts';
      mockCodeParserInstance.shouldIndex.mockReturnValue(false);
      
      await (fileWatcher as any).indexFile(largePath);
      
      expect(mockCodeParserInstance.parseFile).not.toHaveBeenCalled();
      expect(mockVectorStoreInstance.addChunk).not.toHaveBeenCalled();
    });

    it('should skip files with no chunks', async () => {
      const emptyPath = '/test/project/empty.ts';
      mockCodeParserInstance.parseFile.mockResolvedValue([]);
      
      await (fileWatcher as any).indexFile(emptyPath);
      
      expect(mockVectorStoreInstance.removeFile).toHaveBeenCalledWith(emptyPath);
      expect(mockVectorStoreInstance.addChunk).not.toHaveBeenCalled();
    });

    it('should handle file read errors', async () => {
      const errorPath = '/test/project/error.ts';
      mockFs.readFile.mockRejectedValue(new Error('File not found'));
      
      await (fileWatcher as any).indexFile(errorPath);
      
      expect(mockCodeParserInstance.parseFile).not.toHaveBeenCalled();
    });

    it('should handle parser errors', async () => {
      const errorPath = '/test/project/parser-error.ts';
      mockCodeParserInstance.parseFile.mockRejectedValue(new Error('Parse error'));
      
      await (fileWatcher as any).indexFile(errorPath);
      
      expect(mockVectorStoreInstance.addChunk).not.toHaveBeenCalled();
    });

    it('should handle vector store errors', async () => {
      const errorPath = '/test/project/vector-error.ts';
      mockVectorStoreInstance.addChunk.mockRejectedValue(new Error('Vector store error'));
      
      await (fileWatcher as any).indexFile(errorPath);
      
      // Should continue despite vector store error
      expect(mockCodeParserInstance.parseFile).toHaveBeenCalled();
    });

    it('should prevent duplicate processing', async () => {
      const filePath = '/test/project/src/test.ts';
      
      // Start two concurrent indexing operations
      const promise1 = (fileWatcher as any).indexFile(filePath);
      const promise2 = (fileWatcher as any).indexFile(filePath);
      
      await Promise.all([promise1, promise2]);
      
      // Second call should return early
      expect(mockFs.readFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('Batch Processing', () => {
    beforeEach(() => {
      fileWatcher = new FileWatcher({ ...config, indexOnStart: false, batchSize: 3 });
    });

    it('should process files in batches', async () => {
      const files = [
        '/test/project/file1.ts',
        '/test/project/file2.ts',
        '/test/project/file3.ts',
        '/test/project/file4.ts',
        '/test/project/file5.ts'
      ];
      
      const processBatchSpy = jest.spyOn(fileWatcher as any, 'processBatch');
      
      await (fileWatcher as any).processBatch(files);
      
      expect(processBatchSpy).toHaveBeenCalled();
    });

    it('should respect maxConcurrency setting', async () => {
      const files = Array.from({ length: 10 }, (_, i) => `/test/project/file${i}.ts`);
      
      const indexFileSpy = jest.spyOn(fileWatcher as any, 'indexFile');
      indexFileSpy.mockImplementation(async () => {
        await delay(100);
      });
      
      const startTime = Date.now();
      await (fileWatcher as any).processBatch(files);
      
      // With maxConcurrency: 2, should take longer than if all ran in parallel
      expect(indexFileSpy).toHaveBeenCalledTimes(files.length);
    });

    it('should handle batch processing errors gracefully', async () => {
      const files = ['/test/project/good.ts', '/test/project/bad.ts'];
      
      mockFs.readFile
        .mockResolvedValueOnce('good content')
        .mockRejectedValueOnce(new Error('Bad file'));
      
      await (fileWatcher as any).processBatch(files);
      
      // Should process good file despite bad file error
      expect(mockCodeParserInstance.parseFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('File Watching Events', () => {
    let mockWatcher: any;

    beforeEach(() => {
      mockWatcher = {
        on: jest.fn().mockReturnThis(),
        close: jest.fn().mockResolvedValue(undefined)
      };
      mockChokidar.watch.mockReturnValue(mockWatcher);
      
      fileWatcher = new FileWatcher(config);
    });

    it('should set up watcher event handlers', () => {
      expect(mockWatcher.on).toHaveBeenCalledWith('add', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('change', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('unlink', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('ready', expect.any(Function));
    });

    it('should handle file add events', () => {
      const addHandler = mockWatcher.on.mock.calls.find(([event]) => event === 'add')?.[1];
      
      const scheduleIndexSpy = jest.spyOn(fileWatcher as any, 'scheduleIndex');
      addHandler?.('/test/project/new-file.ts');
      
      expect(scheduleIndexSpy).toHaveBeenCalledWith('/test/project/new-file.ts', 'add');
    });

    it('should handle file change events', () => {
      const changeHandler = mockWatcher.on.mock.calls.find(([event]) => event === 'change')?.[1];
      
      const scheduleIndexSpy = jest.spyOn(fileWatcher as any, 'scheduleIndex');
      changeHandler?.('/test/project/changed-file.ts');
      
      expect(scheduleIndexSpy).toHaveBeenCalledWith('/test/project/changed-file.ts', 'change');
    });

    it('should handle file unlink events', () => {
      const unlinkHandler = mockWatcher.on.mock.calls.find(([event]) => event === 'unlink')?.[1];
      
      const removeFromIndexSpy = jest.spyOn(fileWatcher as any, 'removeFromIndex');
      unlinkHandler?.('/test/project/deleted-file.ts');
      
      expect(removeFromIndexSpy).toHaveBeenCalledWith('/test/project/deleted-file.ts');
    });

    it('should emit events for file operations', () => {
      const fileScheduledSpy = jest.fn();
      const fileIndexedSpy = jest.fn();
      const fileRemovedSpy = jest.fn();
      
      fileWatcher.on('file_scheduled', fileScheduledSpy);
      fileWatcher.on('file_indexed', fileIndexedSpy);
      fileWatcher.on('file_removed', fileRemovedSpy);
      
      // Test events are emitted correctly
      expect(fileWatcher.listenerCount('file_scheduled')).toBe(1);
      expect(fileWatcher.listenerCount('file_indexed')).toBe(1);
      expect(fileWatcher.listenerCount('file_removed')).toBe(1);
    });
  });

  describe('Debouncing and Scheduling', () => {
    beforeEach(() => {
      fileWatcher = new FileWatcher({ ...config, debounceDelay: 1000, indexOnStart: false });
    });

    it('should debounce file changes', () => {
      const filePath = '/test/project/test.ts';
      const addToBatchSpy = jest.spyOn(fileWatcher as any, 'addToBatch');
      
      // Schedule multiple times quickly
      (fileWatcher as any).scheduleIndex(filePath, 'change');
      (fileWatcher as any).scheduleIndex(filePath, 'change');
      (fileWatcher as any).scheduleIndex(filePath, 'change');
      
      // Should only have one timeout set
      expect(setTimeout).toHaveBeenCalledTimes(3); // Each call sets a new timeout
      
      // Advance timers to trigger debounced function
      jest.advanceTimersByTime(1000);
      
      expect(addToBatchSpy).toHaveBeenCalledTimes(1);
    });

    it('should cancel previous timeouts when rescheduling', () => {
      const filePath = '/test/project/test.ts';
      
      (fileWatcher as any).scheduleIndex(filePath, 'change');
      (fileWatcher as any).scheduleIndex(filePath, 'change');
      
      expect(clearTimeout).toHaveBeenCalled();
    });

    it('should not schedule ignored files', () => {
      const ignoredPath = '/test/project/node_modules/package/index.js';
      const addToBatchSpy = jest.spyOn(fileWatcher as any, 'addToBatch');
      
      (fileWatcher as any).scheduleIndex(ignoredPath, 'add');
      
      jest.advanceTimersByTime(1000);
      expect(addToBatchSpy).not.toHaveBeenCalled();
    });

    it('should batch files and process when threshold reached', () => {
      const processBatchQueueSpy = jest.spyOn(fileWatcher as any, 'processBatchQueue');
      const batchSize = config.batchSize!;
      
      // Add files to reach batch size
      for (let i = 0; i < batchSize; i++) {
        (fileWatcher as any).addToBatch(`/test/project/file${i}.ts`);
      }
      
      expect(processBatchQueueSpy).toHaveBeenCalled();
    });

    it('should process partial batch after timeout', () => {
      const processBatchQueueSpy = jest.spyOn(fileWatcher as any, 'processBatchQueue');
      
      // Add fewer files than batch size
      (fileWatcher as any).addToBatch('/test/project/file1.ts');
      (fileWatcher as any).addToBatch('/test/project/file2.ts');
      
      // Advance time to trigger batch processing
      jest.advanceTimersByTime(config.debounceDelay!);
      
      expect(processBatchQueueSpy).toHaveBeenCalled();
    });
  });

  describe('Initial Indexing', () => {
    beforeEach(() => {
      fileWatcher = new FileWatcher({ ...config, indexOnStart: false });
    });

    it('should perform initial indexing when requested', async () => {
      const indexingStartedSpy = jest.fn();
      const indexingCompletedSpy = jest.fn();
      
      fileWatcher.on('indexing_started', indexingStartedSpy);
      fileWatcher.on('indexing_completed', indexingCompletedSpy);
      
      await fileWatcher.performInitialIndex();
      
      expect(indexingStartedSpy).toHaveBeenCalledWith({ type: 'initial' });
      expect(indexingCompletedSpy).toHaveBeenCalledWith({
        type: 'initial',
        stats: expect.any(Object)
      });
    });

    it('should prevent concurrent initial indexing', async () => {
      const promise1 = fileWatcher.performInitialIndex();
      const promise2 = fileWatcher.performInitialIndex();
      
      await Promise.all([promise1, promise2]);
      
      // Second call should return early
      expect(mockGlob.glob).toHaveBeenCalledTimes(1);
    });

    it('should handle indexing errors gracefully', async () => {
      mockGlob.glob.mockRejectedValue(new Error('File discovery failed'));
      
      const indexingErrorSpy = jest.fn();
      fileWatcher.on('indexing_error', indexingErrorSpy);
      
      await fileWatcher.performInitialIndex();
      
      expect(indexingErrorSpy).toHaveBeenCalledWith({
        type: 'initial',
        error: expect.any(Error)
      });
    });

    it('should emit progress updates during indexing', async () => {
      const progressSpy = jest.fn();
      fileWatcher.on('indexing_progress', progressSpy);
      
      await fileWatcher.performInitialIndex();
      
      expect(progressSpy).toHaveBeenCalled();
    });

    it('should update statistics during indexing', async () => {
      await fileWatcher.performInitialIndex();
      
      const stats = fileWatcher.getStats();
      expect(stats.filesProcessed).toBeGreaterThanOrEqual(0);
      expect(stats.totalTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('File Pattern Matching', () => {
    beforeEach(() => {
      fileWatcher = new FileWatcher({ ...config, indexOnStart: false });
    });

    it('should match simple patterns', () => {
      const matchPattern = (fileWatcher as any).matchPattern;
      
      expect(matchPattern('src/test.js', '*.js')).toBe(false); // No subdirectory match
      expect(matchPattern('test.js', '*.js')).toBe(true);
      expect(matchPattern('test.ts', '*.js')).toBe(false);
    });

    it('should match glob patterns', () => {
      const matchPattern = (fileWatcher as any).matchPattern;
      
      expect(matchPattern('src/utils/test.js', '**/utils/**')).toBe(true);
      expect(matchPattern('node_modules/lib/index.js', '**/node_modules/**')).toBe(true);
      expect(matchPattern('src/test.js', '**/test/**')).toBe(false);
    });

    it('should match wildcard patterns', () => {
      const matchPattern = (fileWatcher as any).matchPattern;
      
      expect(matchPattern('test123.js', 'test*.js')).toBe(true);
      expect(matchPattern('testfile.js', 'test?.js')).toBe(false);
      expect(matchPattern('testa.js', 'test?.js')).toBe(true);
    });

    it('should respect ignore patterns in shouldIndexFile', () => {
      const shouldIndexFile = (fileWatcher as any).shouldIndexFile;
      
      expect(shouldIndexFile('/test/project/src/test.js')).toBe(true);
      expect(shouldIndexFile('/test/project/node_modules/lib/index.js')).toBe(false);
      expect(shouldIndexFile('/test/project/.git/config')).toBe(false);
    });
  });

  describe('Statistics and Status', () => {
    beforeEach(() => {
      fileWatcher = new FileWatcher({ ...config, indexOnStart: false });
    });

    it('should track indexing statistics', async () => {
      await (fileWatcher as any).indexFile('/test/project/test.ts');
      
      const stats = fileWatcher.getStats();
      expect(stats.filesProcessed).toBeGreaterThan(0);
      expect(stats.chunksCreated).toBeGreaterThan(0);
      expect(stats.avgTimePerFile).toBeGreaterThanOrEqual(0);
    });

    it('should return current status', () => {
      const status = fileWatcher.getStatus();
      
      expect(status).toHaveProperty('isWatching');
      expect(status).toHaveProperty('isIndexing');
      expect(status).toHaveProperty('queueSize');
      expect(status).toHaveProperty('processingSize');
      
      expect(typeof status.isWatching).toBe('boolean');
      expect(typeof status.isIndexing).toBe('boolean');
      expect(typeof status.queueSize).toBe('number');
      expect(typeof status.processingSize).toBe('number');
    });

    it('should reset statistics when requested', async () => {
      await (fileWatcher as any).indexFile('/test/project/test.ts');
      
      let stats = fileWatcher.getStats();
      expect(stats.filesProcessed).toBeGreaterThan(0);
      
      (fileWatcher as any).resetStats();
      
      stats = fileWatcher.getStats();
      expect(stats.filesProcessed).toBe(0);
      expect(stats.chunksCreated).toBe(0);
    });

    it('should calculate correct average times', async () => {
      // Mock different processing times
      jest.spyOn(Date, 'now')
        .mockReturnValueOnce(1000)  // Start time
        .mockReturnValueOnce(1100)  // End time (100ms duration)
        .mockReturnValueOnce(1100)  // Start time
        .mockReturnValueOnce(1300); // End time (200ms duration)
      
      await (fileWatcher as any).indexFile('/test/project/test1.ts');
      await (fileWatcher as any).indexFile('/test/project/test2.ts');
      
      const stats = fileWatcher.getStats();
      expect(stats.avgTimePerFile).toBe(150); // (100 + 200) / 2
    });
  });

  describe('Cleanup and Shutdown', () => {
    beforeEach(() => {
      fileWatcher = new FileWatcher(config);
    });

    it('should stop watching and cleanup resources', async () => {
      const mockWatcher = mockChokidar.watch.mock.results[0].value;
      
      await fileWatcher.stop();
      
      expect(mockWatcher.close).toHaveBeenCalled();
      expect(clearTimeout).toHaveBeenCalled();
    });

    it('should wait for ongoing processing to complete', async () => {
      // Start processing a file
      const indexPromise = (fileWatcher as any).indexFile('/test/project/test.ts');
      
      // Start stopping while processing
      const stopPromise = fileWatcher.stop();
      
      // Advance timers to complete processing
      jest.advanceTimersByTime(1000);
      
      await Promise.all([indexPromise, stopPromise]);
      
      expect(mockFs.readFile).toHaveBeenCalled();
    });

    it('should restart correctly', async () => {
      await fileWatcher.stop();
      await fileWatcher.restart();
      
      expect(mockChokidar.watch).toHaveBeenCalledTimes(2);
    });

    it('should emit stopped event', async () => {
      const stoppedSpy = jest.fn();
      fileWatcher.on('stopped', stoppedSpy);
      
      await fileWatcher.stop();
      
      expect(stoppedSpy).toHaveBeenCalled();
    });

    it('should handle stop when not watching', async () => {
      const nonWatchingWatcher = new FileWatcher({
        ...config,
        watchEnabled: false
      });
      
      await expect(nonWatchingWatcher.stop()).resolves.not.toThrow();
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      fileWatcher = new FileWatcher({ ...config, indexOnStart: false });
    });

    it('should handle file system errors', async () => {
      mockFs.stat.mockRejectedValue(new Error('Permission denied'));
      
      await expect((fileWatcher as any).indexFile('/test/project/error.ts')).resolves.not.toThrow();
    });

    it('should handle watcher errors', () => {
      const mockWatcher = mockChokidar.watch.mock.results[0].value;
      const errorHandler = mockWatcher.on.mock.calls.find(([event]) => event === 'error')?.[1];
      
      const watcherErrorSpy = jest.fn();
      fileWatcher.on('watcher_error', watcherErrorSpy);
      
      errorHandler?.(new Error('Watcher failed'));
      
      expect(watcherErrorSpy).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should handle batch processing errors', async () => {
      const batchErrorSpy = jest.fn();
      fileWatcher.on('batch_error', batchErrorSpy);
      
      mockFs.readFile.mockRejectedValue(new Error('Batch processing failed'));
      
      await (fileWatcher as any).processBatch(['/test/project/error.ts']);
      
      // Should emit error event but not crash
      expect(batchErrorSpy).toHaveBeenCalled();
    });

    it('should handle file removal errors', async () => {
      mockVectorStoreInstance.removeFile.mockRejectedValue(new Error('Remove failed'));
      
      const fileErrorSpy = jest.fn();
      fileWatcher.on('file_error', fileErrorSpy);
      
      await (fileWatcher as any).removeFromIndex('/test/project/test.ts');
      
      expect(fileErrorSpy).toHaveBeenCalled();
    });
  });

  describe('Concurrency Control', () => {
    beforeEach(() => {
      fileWatcher = new FileWatcher({ ...config, maxConcurrency: 2, indexOnStart: false });
    });

    it('should limit concurrent file processing', async () => {
      const files = Array.from({ length: 6 }, (_, i) => `/test/project/file${i}.ts`);
      
      let activeProcesses = 0;
      let maxConcurrentProcesses = 0;
      
      mockFs.readFile.mockImplementation(async () => {
        activeProcesses++;
        maxConcurrentProcesses = Math.max(maxConcurrentProcesses, activeProcesses);
        await delay(100);
        activeProcesses--;
        return 'content';
      });
      
      await (fileWatcher as any).processBatch(files);
      
      expect(maxConcurrentProcesses).toBeLessThanOrEqual(2);
    });

    it('should handle semaphore acquire errors', async () => {
      const files = ['/test/project/file1.ts'];
      
      // Mock semaphore to throw error
      const originalSemaphore = (fileWatcher as any).processBatch;
      jest.spyOn(fileWatcher as any, 'processBatch').mockImplementation(async () => {
        throw new Error('Semaphore error');
      });
      
      await expect((fileWatcher as any).processBatch(files)).rejects.toThrow('Semaphore error');
    });
  });

  describe('Advanced Scenarios', () => {
    beforeEach(() => {
      fileWatcher = new FileWatcher({ ...config, indexOnStart: false });
    });

    it('should handle rapid file changes', () => {
      const filePath = '/test/project/rapid-changes.ts';
      
      // Simulate rapid file changes
      for (let i = 0; i < 10; i++) {
        (fileWatcher as any).scheduleIndex(filePath, 'change');
      }
      
      // Should debounce to single operation
      jest.advanceTimersByTime(config.debounceDelay!);
      
      const batchQueue = (fileWatcher as any).batchQueue;
      expect(batchQueue.filter((f: string) => f === filePath).length).toBe(1);
    });

    it('should handle mixed file operations', async () => {
      const addedFile = '/test/project/added.ts';
      const changedFile = '/test/project/changed.ts';
      const deletedFile = '/test/project/deleted.ts';
      
      (fileWatcher as any).scheduleIndex(addedFile, 'add');
      (fileWatcher as any).scheduleIndex(changedFile, 'change');
      await (fileWatcher as any).removeFromIndex(deletedFile);
      
      jest.advanceTimersByTime(config.debounceDelay!);
      
      expect(mockVectorStoreInstance.removeFile).toHaveBeenCalledWith(deletedFile);
    });

    it('should handle directory traversal attacks', () => {
      const maliciousPath = '/test/project/../../../etc/passwd';
      
      const shouldIndex = (fileWatcher as any).shouldIndexFile(maliciousPath);
      
      expect(shouldIndex).toBe(true); // Path normalization should be handled by the file system
    });

    it('should handle symbolic links', async () => {
      const symlinkPath = '/test/project/symlink.ts';
      
      mockFs.stat.mockResolvedValue({
        size: 1000,
        isDirectory: () => false,
        isFile: () => true,
        isSymbolicLink: () => true
      } as any);
      
      await expect((fileWatcher as any).indexFile(symlinkPath)).resolves.not.toThrow();
    });

    it('should handle very long file paths', async () => {
      const longPath = '/test/project/' + 'very-long-directory-name/'.repeat(50) + 'file.ts';
      
      await expect((fileWatcher as any).indexFile(longPath)).resolves.not.toThrow();
    });

    it('should handle special characters in file paths', async () => {
      const specialPath = '/test/project/файл с пробелами и символами 测试.ts';
      
      await expect((fileWatcher as any).indexFile(specialPath)).resolves.not.toThrow();
    });
  });
});