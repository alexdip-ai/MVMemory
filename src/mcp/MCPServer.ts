import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { VectorStore } from '../core/VectorStore.js';
import { FileWatcher } from '../indexer/FileWatcher.js';
import { TokenOptimizer } from '../optimization/TokenOptimizer.js';
import { MetricsCollector } from '../monitoring/MetricsCollector.js';
import { CacheManager } from '../optimization/CacheManager.js';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import winston from 'winston';

export interface MCPServerConfig {
  dbPath?: string;
  cacheDir?: string;
  maxTokens?: number;
  autoIndex?: boolean;
  watchFiles?: boolean;
  logLevel?: string;
  cacheSize?: number;
}

/**
 * MCPVectorServer - Model Context Protocol server for semantic code search
 * Provides semantic search, context retrieval, and code similarity tools
 */
export class MCPVectorServer {
  private server: Server;
  private vectorStore: VectorStore;
  private fileWatcher: FileWatcher | null = null;
  private tokenOptimizer: TokenOptimizer;
  private metricsCollector: MetricsCollector;
  private cacheManager: CacheManager;
  private logger: winston.Logger;
  private config: MCPServerConfig;
  
  constructor(config: MCPServerConfig = {}) {
    this.config = {
      dbPath: path.join(os.homedir(), '.mvmemory', 'mvmemory.db'),
      cacheDir: path.join(os.homedir(), '.mvmemory', 'cache'),
      maxTokens: 100000,
      autoIndex: true,
      watchFiles: true,
      logLevel: process.env.MVMEMORY_LOG_LEVEL || 'info',
      cacheSize: parseInt(process.env.MVMEMORY_CACHE_SIZE || '1000'),
      ...config
    };
    
    // Ensure directories exist
    fs.ensureDirSync(path.dirname(this.config.dbPath!));
    fs.ensureDirSync(this.config.cacheDir!);
    
    this.setupLogger();
    this.initializeComponents();
    this.createServer();
    this.setupHandlers();
  }
  
  private setupLogger(): void {
    this.logger = winston.createLogger({
      level: this.config.logLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
          return `${timestamp} [${level}] MCPServer: ${message} ${stack || ''} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
        })
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({
          filename: path.join(this.config.cacheDir!, 'mcp-server.log'),
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 5
        })
      ]
    });
  }
  
  private initializeComponents(): void {
    // Initialize vector store
    this.vectorStore = new VectorStore({
      dbPath: this.config.dbPath!,
      cacheDir: this.config.cacheDir,
      logLevel: this.config.logLevel
    });
    
    // Initialize other components
    this.tokenOptimizer = new TokenOptimizer({
      maxTokens: this.config.maxTokens!,
      logLevel: this.config.logLevel
    });
    
    this.metricsCollector = new MetricsCollector();
    this.cacheManager = new CacheManager(this.config.cacheSize!);
    
    // Setup event listeners
    this.vectorStore.on('ready', () => {
      this.logger.info('Vector store ready');
    });
    
    this.vectorStore.on('error', (error) => {
      this.logger.error('Vector store error:', error);
    });
  }
  
  private createServer(): void {
    this.server = new Server(
      {
        name: 'mvmemory',
        version: '1.0.0',
        description: 'Semantic code search with vector embeddings'
      },
      {
        capabilities: {
          tools: {},
          resources: {}
        }
      }
    );
  }
  
  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler('tools/list', async () => ({
      tools: [
        {
          name: 'semantic_search',
          description: 'Search code using semantic similarity',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query (natural language or code snippet)'
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results to return',
                default: 10,
                minimum: 1,
                maximum: 50
              },
              threshold: {
                type: 'number',
                description: 'Minimum relevance threshold (0-1)',
                default: 0.5,
                minimum: 0,
                maximum: 1
              },
              file_types: {
                type: 'array',
                items: { type: 'string' },
                description: 'Filter by file types (e.g., ["ts", "js", "py"])'
              },
              optimize_tokens: {
                type: 'boolean',
                description: 'Optimize results for token usage',
                default: true
              }
            },
            required: ['query']
          }
        },
        {
          name: 'get_context',
          description: 'Get comprehensive context for a function, class, or file',
          inputSchema: {
            type: 'object',
            properties: {
              target: {
                type: 'string',
                description: 'Target function name, class name, or file path'
              },
              depth: {
                type: 'number',
                description: 'Context depth (1=direct, 2=dependencies, 3=full)',
                default: 2,
                minimum: 1,
                maximum: 3
              },
              include_tests: {
                type: 'boolean',
                description: 'Include related test files',
                default: false
              },
              max_tokens: {
                type: 'number',
                description: 'Maximum tokens in response',
                default: 50000,
                minimum: 1000,
                maximum: 200000
              }
            },
            required: ['target']
          }
        },
        {
          name: 'find_similar',
          description: 'Find code similar to a given example',
          inputSchema: {
            type: 'object',
            properties: {
              code: {
                type: 'string',
                description: 'Example code to find similar patterns'
              },
              language: {
                type: 'string',
                description: 'Programming language filter'
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results',
                default: 5,
                minimum: 1,
                maximum: 20
              },
              min_similarity: {
                type: 'number',
                description: 'Minimum similarity score (0-1)',
                default: 0.7,
                minimum: 0,
                maximum: 1
              }
            },
            required: ['code']
          }
        },
        {
          name: 'index_project',
          description: 'Index a project or directory for semantic search',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Project path to index'
              },
              watch: {
                type: 'boolean',
                description: 'Enable real-time file watching',
                default: true
              },
              force: {
                type: 'boolean',
                description: 'Force re-indexing of existing files',
                default: false
              }
            },
            required: ['path']
          }
        },
        {
          name: 'get_stats',
          description: 'Get indexing and search statistics',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false
          }
        },
        {
          name: 'health_check',
          description: 'Check system health and status',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false
          }
        },
        {
          name: 'clear_cache',
          description: 'Clear search and optimization caches',
          inputSchema: {
            type: 'object',
            properties: {
              cache_type: {
                type: 'string',
                enum: ['search', 'token', 'all'],
                description: 'Type of cache to clear',
                default: 'all'
              }
            }
          }
        }
      ]
    }));
    
    // Handle tool calls
    this.server.setRequestHandler('tools/call', async (request) => {
      const { name, arguments: args } = request.params;
      
      try {
        this.logger.debug(`Tool called: ${name}`, args);
        
        switch (name) {
          case 'semantic_search':
            return await this.handleSemanticSearch(args);
          case 'get_context':
            return await this.handleGetContext(args);
          case 'find_similar':
            return await this.handleFindSimilar(args);
          case 'index_project':
            return await this.handleIndexProject(args);
          case 'get_stats':
            return await this.handleGetStats(args);
          case 'health_check':
            return await this.handleHealthCheck(args);
          case 'clear_cache':
            return await this.handleClearCache(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error: any) {
        this.logger.error(`Tool ${name} failed:`, error);
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`
            }
          ],
          isError: true
        };
      }
    });
  }
  
  private async handleSemanticSearch(args: any) {
    const startTime = Date.now();
    const {
      query,
      limit = 10,
      threshold = 0.5,
      file_types,
      optimize_tokens = true
    } = args;
    
    // Check cache first
    const cacheKey = `search:${JSON.stringify(args)}`;
    const cachedResult = this.cacheManager.get(cacheKey);
    if (cachedResult) {
      this.metricsCollector.trackCacheHit();
      return cachedResult;
    }
    
    const results = await this.vectorStore.search(query, limit, threshold);
    
    // Filter by file types if specified
    const filteredResults = file_types
      ? results.filter((r: any) => file_types.includes(r.language))
      : results;
    
    let response;
    if (optimize_tokens) {
      response = this.tokenOptimizer.optimizeSearchResults(
        filteredResults,
        query,
        this.config.maxTokens!
      );
    } else {
      response = {
        content: [
          {
            type: 'text',
            text: this.formatSearchResults(filteredResults, query)
          }
        ]
      };
    }
    
    // Cache the result
    this.cacheManager.set(cacheKey, response, 5 * 60 * 1000); // 5 minutes
    
    // Track metrics
    const duration = Date.now() - startTime;
    this.metricsCollector.trackSearch(duration, filteredResults.length);
    
    return response;
  }
  
  private async handleGetContext(args: any) {
    const {
      target,
      depth = 2,
      include_tests = false,
      max_tokens = 50000
    } = args;
    
    const cacheKey = `context:${JSON.stringify(args)}`;
    const cachedResult = this.cacheManager.get(cacheKey);
    if (cachedResult) {
      this.metricsCollector.trackCacheHit();
      return cachedResult;
    }
    
    // Search for the target
    const mainResults = await this.vectorStore.search(target, 1, 0.7);
    if (mainResults.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No matches found for: ${target}`
          }
        ]
      };
    }
    
    const context = [mainResults[0]];
    
    if (depth > 1) {
      // Find related code based on imports, exports, and function calls
      const related = await this.findRelatedCode(mainResults[0], depth, include_tests);
      context.push(...related);
    }
    
    const response = this.tokenOptimizer.optimizeContext(context, max_tokens);
    
    // Cache the result
    this.cacheManager.set(cacheKey, response, 10 * 60 * 1000); // 10 minutes
    
    return response;
  }
  
  private async handleFindSimilar(args: any) {
    const {
      code,
      language,
      limit = 5,
      min_similarity = 0.7
    } = args;
    
    const cacheKey = `similar:${JSON.stringify(args)}`;
    const cachedResult = this.cacheManager.get(cacheKey);
    if (cachedResult) {
      this.metricsCollector.trackCacheHit();
      return cachedResult;
    }
    
    const results = await this.vectorStore.search(code, limit * 2, min_similarity);
    
    // Filter by language if specified
    const filteredResults = language
      ? results.filter((r: any) => r.language === language)
      : results;
    
    const similarResults = filteredResults.slice(0, limit);
    
    const response = {
      content: [
        {
          type: 'text',
          text: this.formatSimilarResults(similarResults, code)
        }
      ]
    };
    
    // Cache the result
    this.cacheManager.set(cacheKey, response, 5 * 60 * 1000); // 5 minutes
    
    return response;
  }
  
  private async handleIndexProject(args: any) {
    const { path: projectPath, watch = true, force = false } = args;
    
    try {
      // Validate path
      const stats = await fs.stat(projectPath);
      if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${projectPath}`);
      }
      
      // Stop existing watcher if any
      if (this.fileWatcher) {
        await this.fileWatcher.stop();
      }
      
      // Create new file watcher
      this.fileWatcher = new FileWatcher({
        projectPath,
        vectorStore: this.vectorStore,
        watchEnabled: watch,
        indexOnStart: true,
        logLevel: this.config.logLevel!
      });
      
      // Setup event listeners for progress updates
      this.fileWatcher.on('indexing_progress', (progress: any) => {
        this.logger.info(`Indexing progress: ${progress.percentage}% (${progress.processed}/${progress.total})`);
      });
      
      this.fileWatcher.on('indexing_completed', (result: any) => {
        this.logger.info('Indexing completed', result.stats);
      });
      
      return {
        content: [
          {
            type: 'text',
            text: `✅ Project indexing started for: ${projectPath}\n${watch ? '🔍 File watching enabled for real-time updates' : '📁 One-time indexing mode'}`
          }
        ]
      };
      
    } catch (error: any) {
      throw new Error(`Failed to index project: ${error.message}`);
    }
  }
  
  private async handleGetStats(args: any) {
    const vectorStats = await this.vectorStore.getStats();
    const watcherStats = this.fileWatcher?.getStats();
    const watcherStatus = this.fileWatcher?.getStatus();
    const metricsStats = this.metricsCollector.getReport();
    const cacheStats = this.cacheManager.getStats();
    
    const stats = {
      vector_store: vectorStats,
      file_watcher: {
        stats: watcherStats,
        status: watcherStatus
      },
      metrics: metricsStats,
      cache: cacheStats,
      uptime: process.uptime(),
      memory_usage: process.memoryUsage()
    };
    
    return {
      content: [
        {
          type: 'text',
          text: `# MVMemory Statistics\n\n\`\`\`json\n${JSON.stringify(stats, null, 2)}\n\`\`\``
        }
      ]
    };
  }
  
  private async handleHealthCheck(args: any) {
    const vectorHealth = await this.vectorStore.healthCheck();
    const watcherStatus = this.fileWatcher?.getStatus();
    
    const health = {
      status: vectorHealth.ready ? 'healthy' : 'unhealthy',
      components: {
        vector_store: vectorHealth,
        file_watcher: watcherStatus || { status: 'not_initialized' },
        cache: {
          status: 'healthy',
          entries: this.cacheManager.getStats().entries
        }
      },
      timestamp: new Date().toISOString()
    };
    
    return {
      content: [
        {
          type: 'text',
          text: `# Health Check\n\n\`\`\`json\n${JSON.stringify(health, null, 2)}\n\`\`\``
        }
      ]
    };
  }
  
  private async handleClearCache(args: any) {
    const { cache_type = 'all' } = args;
    
    let cleared = 0;
    
    if (cache_type === 'all' || cache_type === 'search') {
      cleared += this.cacheManager.clear();
    }
    
    if (cache_type === 'all' || cache_type === 'token') {
      this.tokenOptimizer.clearCache();
      cleared += 1; // Approximate
    }
    
    return {
      content: [
        {
          type: 'text',
          text: `✅ Cleared ${cleared} cache entries (type: ${cache_type})`
        }
      ]
    };
  }
  
  // Helper methods
  
  private async findRelatedCode(chunk: any, depth: number, includeTests: boolean) {
    const related = [];
    
    // Search for imports
    for (const imp of chunk.imports || []) {
      const importResults = await this.vectorStore.search(imp, 2, 0.8);
      related.push(...importResults);
    }
    
    // Search for function calls in the content
    const functionCalls = this.extractFunctionCalls(chunk.content);
    for (const call of functionCalls.slice(0, depth * 2)) {
      const callResults = await this.vectorStore.search(call, 1, 0.8);
      related.push(...callResults);
    }
    
    // Include tests if requested
    if (includeTests) {
      const testQuery = `test ${chunk.name}`;
      const testResults = await this.vectorStore.search(testQuery, 3, 0.7);
      related.push(...testResults.filter((r: any) => 
        r.filePath.includes('test') || 
        r.filePath.includes('spec') ||
        r.name.includes('test')
      ));
    }
    
    // Remove duplicates and the original chunk
    const uniqueRelated = related.filter((r: any, i: number, arr: any[]) => 
      arr.findIndex((x: any) => x.id === r.id) === i && r.id !== chunk.id
    );
    
    return uniqueRelated.slice(0, depth * 5); // Limit based on depth
  }
  
  private extractFunctionCalls(code: string): string[] {
    const regex = /(\w+)\s*\(/g;
    const calls: string[] = [];
    let match;
    
    while ((match = regex.exec(code)) !== null) {
      const functionName = match[1];
      // Skip common keywords
      if (!['if', 'for', 'while', 'switch', 'catch', 'try', 'return'].includes(functionName)) {
        calls.push(functionName);
      }
    }
    
    return [...new Set(calls)];
  }
  
  private formatSearchResults(results: any[], query: string): string {
    if (results.length === 0) {
      return `No results found for: "${query}"`;
    }
    
    let output = `# Search Results for: "${query}"\n\n`;
    output += `Found ${results.length} relevant code chunks:\n\n`;
    
    results.forEach((result, index) => {
      output += `## ${index + 1}. ${result.name} (${(result.relevance * 100).toFixed(1)}% match)\n`;
      output += `**File**: ${result.filePath}:${result.startLine}-${result.endLine}\n`;
      output += `**Language**: ${result.language}\n\n`;
      output += `\`\`\`${result.language}\n${result.preview || result.content}\n\`\`\`\n\n`;
    });
    
    return output;
  }
  
  private formatSimilarResults(results: any[], originalCode: string): string {
    if (results.length === 0) {
      return 'No similar code patterns found.';
    }
    
    let output = `# Similar Code Patterns\n\n`;
    output += `Found ${results.length} similar patterns:\n\n`;
    
    results.forEach((result, index) => {
      output += `## ${index + 1}. ${result.name} (${(result.relevance * 100).toFixed(1)}% similar)\n`;
      output += `**File**: ${result.filePath}:${result.startLine}-${result.endLine}\n`;
      output += `**Language**: ${result.language}\n\n`;
      output += `\`\`\`${result.language}\n${result.content}\n\`\`\`\n\n`;
    });
    
    return output;
  }
  
  /**
   * Start the MCP server
   */
  async start(): Promise<void> {
    try {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      this.logger.info('MVMemory MCP server started successfully');
      
      // Handle graceful shutdown
      process.on('SIGINT', () => this.shutdown());
      process.on('SIGTERM', () => this.shutdown());
      
    } catch (error) {
      this.logger.error('Failed to start MCP server:', error);
      throw error;
    }
  }
  
  /**
   * Shutdown the server gracefully
   */
  private async shutdown(): Promise<void> {
    this.logger.info('Shutting down MVMemory MCP server...');
    
    try {
      if (this.fileWatcher) {
        await this.fileWatcher.stop();
      }
      
      await this.vectorStore.close();
      
      this.logger.info('MVMemory MCP server shutdown complete');
      process.exit(0);
      
    } catch (error) {
      this.logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const config: MCPServerConfig = {
    dbPath: process.env.MVMEMORY_DB || undefined,
    cacheDir: process.env.MVMEMORY_CACHE_DIR || undefined,
    maxTokens: parseInt(process.env.MVMEMORY_MAX_TOKENS || '100000'),
    autoIndex: process.env.MVMEMORY_AUTO_INDEX !== 'false',
    watchFiles: process.env.MVMEMORY_WATCH_FILES !== 'false',
    logLevel: process.env.MVMEMORY_LOG_LEVEL || 'info',
    cacheSize: parseInt(process.env.MVMEMORY_CACHE_SIZE || '1000')
  };
  
  const server = new MCPVectorServer(config);
  
  server.start().catch((error) => {
    console.error('Failed to start MVMemory MCP server:', error);
    process.exit(1);
  });
}