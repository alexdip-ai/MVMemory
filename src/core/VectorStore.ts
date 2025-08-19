import { spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import winston from 'winston';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

export interface CodeChunk {
  id?: string;
  type: 'function' | 'class' | 'module' | 'generic';
  name: string;
  content: string;
  filePath: string;
  startLine: number;
  endLine: number;
  language: string;
  imports: string[];
  exports: string[];
  metadata?: Record<string, any>;
  relevance?: number;
  preview?: string;
}

export interface SearchResult extends CodeChunk {
  distance: number;
  relevance: number;
}

export interface DatabaseRow {
  id: string;
  file_path: string;
  chunk_type: string;
  name: string;
  content: string;
  start_line: number;
  end_line: number;
  language: string;
  imports: string;
  exports: string;
  metadata: string;
  vector_id?: number;
  created_at: string;
  updated_at: string;
}

export interface FileIndexRow {
  file_path: string;
  last_indexed: string;
  file_hash?: string;
  total_chunks: number;
}

export interface Database {
  embeddings: DatabaseRow[];
  file_index: FileIndexRow[];
}

export class VectorStore extends EventEmitter {
  private database: Database = { embeddings: [], file_index: [] };
  private pythonProcess: ChildProcess | null = null;
  private pythonReady: boolean = false;
  private requestQueue: Map<string, (result: any) => void> = new Map();
  private dbPath: string;
  private logger: winston.Logger;

  constructor(dbPath: string = './mvmemory.json') {
    super();
    this.dbPath = dbPath;
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({ filename: 'mvmemory.log' }),
        new winston.transports.Console({
          format: winston.format.simple()
        })
      ]
    });
    this.initDatabase();
    this.startPythonEngine();
  }

  private async initDatabase(): Promise<void> {
    try {
      const data = await fs.readFile(this.dbPath, 'utf-8');
      this.database = JSON.parse(data);
      // Ensure required structure
      if (!this.database.embeddings) this.database.embeddings = [];
      if (!this.database.file_index) this.database.file_index = [];
    } catch (error) {
      // File doesn't exist or is invalid, create new database
      this.database = { embeddings: [], file_index: [] };
      await this.saveDatabase();
    }
    this.logger.info('Database initialized successfully');
  }

  private async saveDatabase(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
      await fs.writeFile(this.dbPath, JSON.stringify(this.database, null, 2));
    } catch (error) {
      this.logger.error('Failed to save database:', error);
      throw error;
    }
  }

  private async startPythonEngine(): Promise<void> {
    // Handle ES module __dirname equivalent
    const currentFileUrl = import.meta.url;
    const currentDir = dirname(fileURLToPath(currentFileUrl));
    const pythonScriptPath = path.join(currentDir, '..', 'python', 'vector_engine.py');
    
    try {
      await fs.access(pythonScriptPath);
    } catch (error) {
      this.logger.error('Python vector engine script not found:', error);
      return;
    }

    this.pythonProcess = spawn('python', [pythonScriptPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.pythonProcess.stdout?.on('data', (data) => {
      try {
        const lines = data.toString().split('\n').filter((line: string) => line);
        for (const line of lines) {
          const response = JSON.parse(line);
          if (response.type === 'ready') {
            this.pythonReady = true;
            this.logger.info('Python vector engine ready');
          } else if (response.requestId && this.requestQueue.has(response.requestId)) {
            const callback = this.requestQueue.get(response.requestId);
            this.requestQueue.delete(response.requestId);
            callback?.(response);
          }
        }
      } catch (error) {
        this.logger.error('Error parsing Python response:', error);
      }
    });

    this.pythonProcess.stderr?.on('data', (data) => {
      this.logger.error('Python engine error:', data.toString());
    });

    this.pythonProcess.on('exit', (code) => {
      this.logger.warn(`Python engine exited with code ${code}`);
      this.pythonReady = false;
      setTimeout(() => this.startPythonEngine(), 5000);
    });
  }

  private async sendToPython(action: string, data: any): Promise<any> {
    if (!this.pythonReady || !this.pythonProcess) {
      throw new Error('Python engine not ready');
    }

    const requestId = uuidv4();
    const request = {
      requestId,
      action,
      ...data
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.requestQueue.delete(requestId);
        reject(new Error('Python engine timeout'));
      }, 30000);

      this.requestQueue.set(requestId, (response) => {
        clearTimeout(timeout);
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response.result);
        }
      });

      this.pythonProcess?.stdin?.write(JSON.stringify(request) + '\n');
    });
  }

  async addChunk(chunk: CodeChunk): Promise<void> {
    const id = chunk.id || uuidv4();
    const now = new Date().toISOString();
    
    let vectorId: number | undefined = undefined;
    
    if (this.pythonReady) {
      try {
        const result = await this.sendToPython('add', {
          texts: [chunk.content],
          metadata: [{
            id,
            filePath: chunk.filePath,
            name: chunk.name,
            type: chunk.type
          }]
        });
        vectorId = result.vectorIds?.[0];
      } catch (error) {
        this.logger.error('Failed to create embedding:', error);
      }
    }

    // Remove existing entry with same id if it exists
    this.database.embeddings = this.database.embeddings.filter(row => row.id !== id);
    
    // Add new entry
    const row: DatabaseRow = {
      id,
      file_path: chunk.filePath,
      chunk_type: chunk.type,
      name: chunk.name,
      content: chunk.content,
      start_line: chunk.startLine,
      end_line: chunk.endLine,
      language: chunk.language,
      imports: JSON.stringify(chunk.imports),
      exports: JSON.stringify(chunk.exports),
      metadata: JSON.stringify(chunk.metadata || {}),
      vector_id: vectorId,
      created_at: now,
      updated_at: now
    };
    
    this.database.embeddings.push(row);
    await this.saveDatabase();
    this.updateFileIndex(chunk.filePath);
    this.logger.debug(`Added chunk: ${chunk.filePath}:${chunk.startLine}-${chunk.endLine}`);
  }

  async removeFile(filePath: string): Promise<void> {
    const chunks = this.database.embeddings.filter(row => row.file_path === filePath);

    if (this.pythonReady && chunks.length > 0) {
      const vectorIds = chunks
        .filter(c => c.vector_id !== undefined && c.vector_id !== null)
        .map(c => c.vector_id!);
      
      if (vectorIds.length > 0) {
        try {
          await this.sendToPython('remove', { vectorIds });
        } catch (error) {
          this.logger.error('Failed to remove embeddings:', error);
        }
      }
    }

    this.database.embeddings = this.database.embeddings.filter(row => row.file_path !== filePath);
    this.database.file_index = this.database.file_index.filter(row => row.file_path !== filePath);
    
    await this.saveDatabase();
    this.logger.info(`Removed file from index: ${filePath}`);
  }

  async search(query: string, limit: number = 10, fileTypes?: string[]): Promise<SearchResult[]> {
    let results: SearchResult[] = [];

    if (this.pythonReady) {
      try {
        const vectorResults = await this.sendToPython('search', {
          query,
          k: limit * 2
        });

        const ids = vectorResults.map((r: any) => r.metadata.id);
        
        if (ids.length > 0) {
          let rows = this.database.embeddings.filter(row => ids.includes(row.id));

          if (fileTypes && fileTypes.length > 0) {
            rows = rows.filter(row => fileTypes.includes(row.language));
          }

          results = rows.map(row => {
            const vectorResult = vectorResults.find((v: any) => v.metadata.id === row.id);
            return this.rowToSearchResult(row, vectorResult?.distance, vectorResult?.relevance);
          });
        }
      } catch (error) {
        this.logger.error('Vector search failed, falling back to text search:', error);
      }
    }

    if (results.length === 0) {
      let rows = this.database.embeddings.filter(row => 
        row.content.toLowerCase().includes(query.toLowerCase()) || 
        row.name.toLowerCase().includes(query.toLowerCase())
      );

      if (fileTypes && fileTypes.length > 0) {
        rows = rows.filter(row => fileTypes.includes(row.language));
      }

      rows = rows.slice(0, limit);
      results = rows.map(row => this.rowToSearchResult(row, 0, 0.5));
    }

    results.sort((a, b) => b.relevance - a.relevance);
    return results.slice(0, limit);
  }

  async searchByCode(code: string, limit: number = 5): Promise<SearchResult[]> {
    return this.search(code, limit);
  }

  async getContext(target: string, depth: number = 2): Promise<SearchResult[]> {
    const mainResults = await this.search(target, 1);
    if (mainResults.length === 0) {
      return [];
    }

    const context = [...mainResults];
    const main = mainResults[0];

    if (depth > 0 && main.imports.length > 0) {
      for (const imp of main.imports.slice(0, depth)) {
        const imported = await this.search(imp, 1);
        if (imported.length > 0) {
          context.push(imported[0]);
        }
      }
    }

    return context;
  }

  private rowToSearchResult(row: DatabaseRow, distance?: number, relevance?: number): SearchResult {
    return {
      id: row.id,
      type: row.chunk_type as 'function' | 'class' | 'module' | 'generic',
      name: row.name,
      content: row.content,
      filePath: row.file_path,
      startLine: row.start_line,
      endLine: row.end_line,
      language: row.language,
      imports: JSON.parse(row.imports || '[]'),
      exports: JSON.parse(row.exports || '[]'),
      metadata: JSON.parse(row.metadata || '{}'),
      distance: distance || 0,
      relevance: relevance || 0,
      preview: row.content.substring(0, 200) + (row.content.length > 200 ? '...' : '')
    };
  }

  private updateFileIndex(filePath: string): void {
    const count = this.database.embeddings.filter(row => row.file_path === filePath).length;
    const now = new Date().toISOString();
    
    // Remove existing entry
    this.database.file_index = this.database.file_index.filter(row => row.file_path !== filePath);
    
    // Add updated entry
    this.database.file_index.push({
      file_path: filePath,
      last_indexed: now,
      total_chunks: count
    });
  }

  async getStats(): Promise<any> {
    const totalChunks = this.database.embeddings.length;
    const totalFiles = this.database.file_index.length;
    
    // Group by language
    const languageMap = new Map<string, number>();
    this.database.embeddings.forEach(row => {
      const count = languageMap.get(row.language) || 0;
      languageMap.set(row.language, count + 1);
    });
    
    const languages = Array.from(languageMap.entries()).map(([language, count]) => ({
      language,
      count
    }));

    return {
      totalChunks,
      totalFiles,
      languages,
      pythonEngineReady: this.pythonReady
    };
  }

  async close(): Promise<void> {
    if (this.pythonProcess) {
      this.pythonProcess.kill();
    }
    await this.saveDatabase();
    this.logger.info('VectorStore closed');
  }

  // Add health check method
  healthCheck(): boolean {
    return this.pythonReady;
  }
}