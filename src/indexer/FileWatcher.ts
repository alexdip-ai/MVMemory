import chokidar from 'chokidar';
import { CodeParser } from './CodeParser.js';
import { VectorStore } from '../core/VectorStore.js';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs-extra';
import { glob } from 'glob';
import winston from 'winston';

export interface FileWatcherConfig {
  projectPath: string;
  vectorStore: VectorStore;
  debounceDelay: number;
  batchSize: number;
  maxConcurrency: number;
  watchEnabled: boolean;
  indexOnStart: boolean;
  ignorePatterns: string[];
  logLevel: string;
}

export interface IndexingStats {
  filesProcessed: number;
  filesIndexed: number;
  filesSkipped: number;
  chunksCreated: number;
  errors: number;
  totalTime: number;
  avgTimePerFile: number;
}

/**
 * FileWatcher - Real-time file monitoring and indexing system
 * Watches for file changes and automatically updates the vector index
 */
export class FileWatcher extends EventEmitter {
  private watcher: chokidar.FSWatcher | null = null;
  private parser: CodeParser;
  private vectorStore: VectorStore;
  private config: FileWatcherConfig;
  private logger: winston.Logger;
  
  // Debouncing and batching
  private indexQueue: Map<string, NodeJS.Timeout> = new Map();
  private processingQueue: Set<string> = new Set();
  private batchQueue: string[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  
  // Statistics
  private stats: IndexingStats = {
    filesProcessed: 0,
    filesIndexed: 0,
    filesSkipped: 0,
    chunksCreated: 0,
    errors: 0,
    totalTime: 0,
    avgTimePerFile: 0
  };
  
  private isIndexing = false;
  private startTime: number = 0;
  
  constructor(config: Partial<FileWatcherConfig> & { projectPath: string; vectorStore: VectorStore }) {
    super();
    
    this.config = {
      debounceDelay: 1000,
      batchSize: 10,
      maxConcurrency: 4,
      watchEnabled: true,
      indexOnStart: true,
      ignorePatterns: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/build/**',
        '**/coverage/**',
        '**/__pycache__/**',
        '**/.pytest_cache/**',
        '**/vendor/**',
        '**/*.min.js',
        '**/*.map',
        '**/.DS_Store',
        '**/Thumbs.db'
      ],
      logLevel: 'info',
      ...config
    };
    
    this.vectorStore = config.vectorStore;
    this.parser = new CodeParser({
      logLevel: this.config.logLevel
    });
    
    this.setupLogger();
    
    if (this.config.indexOnStart) {
      this.performInitialIndex();
    }
    
    if (this.config.watchEnabled) {
      this.startWatching();
    }
  }
  
  private setupLogger(): void {
    this.logger = winston.createLogger({
      level: this.config.logLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          return `${timestamp} [${level}] FileWatcher: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
        })
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ 
          filename: path.join(this.config.projectPath, '.mvmemory', 'watcher.log'),
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 3
        })
      ]
    });
  }
  
  /**
   * Perform initial indexing of the entire project
   */
  async performInitialIndex(): Promise<void> {
    if (this.isIndexing) {
      this.logger.warn('Initial indexing already in progress');
      return;
    }
    
    this.isIndexing = true;
    this.startTime = Date.now();
    this.resetStats();
    
    this.logger.info('Starting initial project indexing...');
    this.emit('indexing_started', { type: 'initial' });
    
    try {
      // Find all files to index
      const files = await this.findIndexableFiles();
      this.logger.info(`Found ${files.length} files to index`);
      
      // Process files in batches
      const batches = this.createBatches(files, this.config.batchSize);
      
      for (const batch of batches) {
        await this.processBatch(batch);
        
        // Emit progress update
        this.emit('indexing_progress', {
          processed: this.stats.filesProcessed,
          total: files.length,
          percentage: Math.round((this.stats.filesProcessed / files.length) * 100)
        });
      }
      
      this.finalizeStats();
      this.logger.info('Initial indexing completed', this.stats);
      this.emit('indexing_completed', { type: 'initial', stats: this.stats });
      
    } catch (error) {
      this.logger.error('Initial indexing failed:', error);
      this.emit('indexing_error', { type: 'initial', error });
    } finally {
      this.isIndexing = false;
    }
  }
  
  /**
   * Start file watching
   */
  private startWatching(): void {
    if (this.watcher) {
      this.logger.warn('File watcher already started');
      return;
    }
    
    this.logger.info('Starting file watcher...');
    
    this.watcher = chokidar.watch(this.config.projectPath, {
      ignored: this.config.ignorePatterns,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: this.config.debounceDelay / 2,
        pollInterval: 100
      },
      depth: 100,
      usePolling: false
    });
    
    this.setupWatcherEvents();
  }
  
  private setupWatcherEvents(): void {
    if (!this.watcher) return;
    
    this.watcher
      .on('add', (filePath) => {
        this.logger.debug(`File added: ${filePath}`);
        this.scheduleIndex(filePath, 'add');
      })
      .on('change', (filePath) => {
        this.logger.debug(`File changed: ${filePath}`);
        this.scheduleIndex(filePath, 'change');
      })
      .on('unlink', (filePath) => {
        this.logger.debug(`File removed: ${filePath}`);
        this.removeFromIndex(filePath);
      })
      .on('error', (error) => {
        this.logger.error('File watcher error:', error);
        this.emit('watcher_error', error);
      })
      .on('ready', () => {
        this.logger.info('File watcher ready');
        this.emit('watcher_ready');
      });
  }
  
  /**
   * Schedule file indexing with debouncing
   */
  private scheduleIndex(filePath: string, eventType: 'add' | 'change'): void {
    // Check if file should be indexed
    if (!this.shouldIndexFile(filePath)) {
      return;
    }
    
    // Clear existing timeout for this file
    if (this.indexQueue.has(filePath)) {
      clearTimeout(this.indexQueue.get(filePath)!);
    }
    
    // Schedule new indexing
    const timeout = setTimeout(() => {
      this.addToBatch(filePath);
      this.indexQueue.delete(filePath);
    }, this.config.debounceDelay);
    
    this.indexQueue.set(filePath, timeout);
    
    this.emit('file_scheduled', { filePath, eventType });
  }
  
  /**
   * Add file to batch processing queue
   */
  private addToBatch(filePath: string): void {
    if (!this.batchQueue.includes(filePath)) {
      this.batchQueue.push(filePath);
    }
    
    // Clear existing batch timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }
    
    // Process batch if it's full or after a delay
    if (this.batchQueue.length >= this.config.batchSize) {
      this.processBatchQueue();
    } else {
      this.batchTimer = setTimeout(() => {
        this.processBatchQueue();
      }, this.config.debounceDelay);
    }
  }
  
  /**
   * Process the current batch queue
   */
  private async processBatchQueue(): Promise<void> {
    if (this.batchQueue.length === 0) {
      return;
    }
    
    const batch = [...this.batchQueue];
    this.batchQueue = [];
    
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    
    this.logger.debug(`Processing batch of ${batch.length} files`);
    this.emit('batch_started', { size: batch.length });
    
    try {
      await this.processBatch(batch);
      this.emit('batch_completed', { size: batch.length });
    } catch (error) {
      this.logger.error('Batch processing failed:', error);
      this.emit('batch_error', { error, batch });
    }
  }
  
  /**
   * Process a batch of files
   */
  private async processBatch(files: string[]): Promise<void> {
    const semaphore = new Semaphore(this.config.maxConcurrency);
    
    const promises = files.map(async (filePath) => {
      return semaphore.acquire(async () => {
        await this.indexFile(filePath);
      });
    });
    
    await Promise.allSettled(promises);
  }
  
  /**
   * Index a single file
   */
  private async indexFile(filePath: string): Promise<void> {
    if (this.processingQueue.has(filePath)) {
      this.logger.debug(`File already being processed: ${filePath}`);
      return;
    }
    
    this.processingQueue.add(filePath);
    const startTime = Date.now();
    
    try {
      // Check if file exists and get stats
      const fileStats = await fs.stat(filePath);
      
      if (!this.parser.shouldIndex(filePath, fileStats.size)) {
        this.stats.filesSkipped++;
        this.logger.debug(`Skipped file: ${filePath} (size: ${fileStats.size})`);
        return;
      }
      
      // Read file content
      const content = await fs.readFile(filePath, 'utf-8');
      
      // Parse file into chunks
      const chunks = await this.parser.parseFile(filePath, content);
      
      if (chunks.length === 0) {
        this.stats.filesSkipped++;
        this.logger.debug(`No chunks extracted from: ${filePath}`);
        return;
      }
      
      // Remove existing chunks for this file
      await this.vectorStore.removeFile(filePath);
      
      // Add new chunks to vector store
      for (const chunk of chunks) {
        await this.vectorStore.addChunk(chunk);
        this.stats.chunksCreated++;
      }
      
      this.stats.filesIndexed++;
      this.stats.filesProcessed++;
      
      const duration = Date.now() - startTime;
      this.logger.debug(`Indexed ${filePath}: ${chunks.length} chunks in ${duration}ms`);
      
      this.emit('file_indexed', {
        filePath,
        chunks: chunks.length,
        duration
      });
      
    } catch (error) {
      this.stats.errors++;
      this.stats.filesProcessed++;
      this.logger.error(`Failed to index ${filePath}:`, error);
      this.emit('file_error', { filePath, error });
    } finally {
      this.processingQueue.delete(filePath);
    }
  }
  
  /**
   * Remove file from index
   */
  private async removeFromIndex(filePath: string): Promise<void> {
    try {
      await this.vectorStore.removeFile(filePath);
      this.logger.debug(`Removed from index: ${filePath}`);
      this.emit('file_removed', { filePath });
    } catch (error) {
      this.logger.error(`Failed to remove ${filePath} from index:`, error);
      this.emit('file_error', { filePath, error });
    }
  }
  
  /**
   * Find all indexable files in the project
   */
  private async findIndexableFiles(): Promise<string[]> {
    const patterns = [
      '**/*.ts',
      '**/*.tsx',
      '**/*.js',
      '**/*.jsx',
      '**/*.py',
      '**/*.pyi',
      '**/*.json',
      '**/*.md',
      '**/*.go',
      '**/*.rs',
      '**/*.java',
      '**/*.cpp',
      '**/*.c',
      '**/*.h',
      '**/*.cs',
      '**/*.php',
      '**/*.rb',
      '**/*.swift',
      '**/*.kt',
      '**/*.scala',
      '**/*.sh',
      '**/*.sql',
      '**/*.css',
      '**/*.scss',
      '**/*.html',
      '**/*.xml',
      '**/*.yaml',
      '**/*.yml',
      '**/*.toml'
    ];
    
    const allFiles: string[] = [];
    
    for (const pattern of patterns) {
      const files = await glob(pattern, {
        cwd: this.config.projectPath,
        absolute: true,
        ignore: this.config.ignorePatterns,
        nodir: true
      });
      allFiles.push(...files);
    }
    
    // Remove duplicates and filter
    const uniqueFiles = [...new Set(allFiles)];
    const indexableFiles: string[] = [];
    
    for (const file of uniqueFiles) {
      if (this.shouldIndexFile(file)) {
        try {
          const stats = await fs.stat(file);
          if (this.parser.shouldIndex(file, stats.size)) {
            indexableFiles.push(file);
          }
        } catch (error) {
          // File might have been deleted, skip it
          this.logger.debug(`Could not stat file ${file}:`, error);
        }
      }
    }
    
    return indexableFiles;
  }
  
  /**
   * Check if a file should be indexed
   */
  private shouldIndexFile(filePath: string): boolean {
    const relativePath = path.relative(this.config.projectPath, filePath);
    
    // Check ignore patterns
    for (const pattern of this.config.ignorePatterns) {
      if (this.matchPattern(relativePath, pattern)) {
        return false;
      }
    }
    
    return true;
  }
  
  private matchPattern(filePath: string, pattern: string): boolean {
    // Simple pattern matching (could be enhanced with minimatch)
    const regexPattern = pattern
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
  }
  
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }
  
  private resetStats(): void {
    this.stats = {
      filesProcessed: 0,
      filesIndexed: 0,
      filesSkipped: 0,
      chunksCreated: 0,
      errors: 0,
      totalTime: 0,
      avgTimePerFile: 0
    };
  }
  
  private finalizeStats(): void {
    this.stats.totalTime = Date.now() - this.startTime;
    this.stats.avgTimePerFile = this.stats.filesProcessed > 0 
      ? this.stats.totalTime / this.stats.filesProcessed 
      : 0;
  }
  
  /**
   * Get current indexing statistics
   */
  getStats(): IndexingStats {
    return { ...this.stats };
  }
  
  /**
   * Get current status
   */
  getStatus(): {
    isWatching: boolean;
    isIndexing: boolean;
    queueSize: number;
    processingSize: number;
  } {
    return {
      isWatching: this.watcher !== null,
      isIndexing: this.isIndexing,
      queueSize: this.batchQueue.length,
      processingSize: this.processingQueue.size
    };
  }
  
  /**
   * Stop file watching and cleanup
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping file watcher...');
    
    // Clear all timers
    this.indexQueue.forEach(timeout => clearTimeout(timeout));
    this.indexQueue.clear();
    
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    
    // Close file watcher
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    
    // Wait for any ongoing processing to complete
    while (this.processingQueue.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    this.logger.info('File watcher stopped');
    this.emit('stopped');
  }
  
  /**
   * Restart the file watcher
   */
  async restart(): Promise<void> {
    await this.stop();
    
    if (this.config.indexOnStart) {
      await this.performInitialIndex();
    }
    
    if (this.config.watchEnabled) {
      this.startWatching();
    }
  }
}

/**
 * Semaphore for controlling concurrency
 */
class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];
  
  constructor(permits: number) {
    this.permits = permits;
  }
  
  async acquire<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const tryAcquire = () => {
        if (this.permits > 0) {
          this.permits--;
          task()
            .then(resolve)
            .catch(reject)
            .finally(() => {
              this.permits++;
              if (this.queue.length > 0) {
                const next = this.queue.shift()!;
                next();
              }
            });
        } else {
          this.queue.push(tryAcquire);
        }
      };
      
      tryAcquire();
    });
  }
}