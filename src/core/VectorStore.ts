import * as sqlite3 from 'sqlite3';
import { spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import winston from 'winston';

const logger = winston.createLogger({
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

export class VectorStore {
  private db: sqlite3.Database;
  private pythonProcess: ChildProcess | null = null;
  private pythonReady: boolean = false;
  private requestQueue: Map<string, (result: any) => void> = new Map();
  private dbPath: string;

  constructor(dbPath: string = './mvmemory.db') {
    this.dbPath = dbPath;
    this.db = new sqlite3.Database(dbPath);
    this.initDatabase();
    this.startPythonEngine();
  }

  private async initDatabase(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        chunk_type TEXT NOT NULL,
        name TEXT,
        content TEXT NOT NULL,
        start_line INTEGER,
        end_line INTEGER,
        language TEXT,
        imports TEXT,
        exports TEXT,
        metadata TEXT,
        vector_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_file_path 
      ON embeddings(file_path)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_chunk_type 
      ON embeddings(chunk_type)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_language 
      ON embeddings(language)
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS file_index (
        file_path TEXT PRIMARY KEY,
        last_indexed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        file_hash TEXT,
        total_chunks INTEGER DEFAULT 0
      )
    `);

    logger.info('Database initialized successfully');
  }

  private async startPythonEngine(): Promise<void> {
    const pythonScriptPath = path.join(__dirname, '..', 'python', 'vector_engine.py');
    
    try {
      await fs.access(pythonScriptPath);
    } catch (error) {
      logger.error('Python vector engine script not found:', error);
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
            logger.info('Python vector engine ready');
          } else if (response.requestId && this.requestQueue.has(response.requestId)) {
            const callback = this.requestQueue.get(response.requestId);
            this.requestQueue.delete(response.requestId);
            callback?.(response);
          }
        }
      } catch (error) {
        logger.error('Error parsing Python response:', error);
      }
    });

    this.pythonProcess.stderr?.on('data', (data) => {
      logger.error('Python engine error:', data.toString());
    });

    this.pythonProcess.on('exit', (code) => {
      logger.warn(`Python engine exited with code ${code}`);
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
    
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO embeddings (
        id, file_path, chunk_type, name, content,
        start_line, end_line, language, imports, exports, metadata, vector_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let vectorId = null;
    
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
        logger.error('Failed to create embedding:', error);
      }
    }

    stmt.run(
      id,
      chunk.filePath,
      chunk.type,
      chunk.name,
      chunk.content,
      chunk.startLine,
      chunk.endLine,
      chunk.language,
      JSON.stringify(chunk.imports),
      JSON.stringify(chunk.exports),
      JSON.stringify(chunk.metadata || {}),
      vectorId
    );

    this.updateFileIndex(chunk.filePath);
    logger.debug(`Added chunk: ${chunk.filePath}:${chunk.startLine}-${chunk.endLine}`);
  }

  async removeFile(filePath: string): Promise<void> {
    const chunks = this.db.prepare('SELECT id, vector_id FROM embeddings WHERE file_path = ?')
      .all(filePath) as any[];

    if (this.pythonReady && chunks.length > 0) {
      const vectorIds = chunks
        .filter(c => c.vector_id !== null)
        .map(c => c.vector_id);
      
      if (vectorIds.length > 0) {
        try {
          await this.sendToPython('remove', { vectorIds });
        } catch (error) {
          logger.error('Failed to remove embeddings:', error);
        }
      }
    }

    this.db.prepare('DELETE FROM embeddings WHERE file_path = ?').run(filePath);
    this.db.prepare('DELETE FROM file_index WHERE file_path = ?').run(filePath);
    
    logger.info(`Removed file from index: ${filePath}`);
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
          const placeholders = ids.map(() => '?').join(',');
          let sqlQuery = `
            SELECT * FROM embeddings 
            WHERE id IN (${placeholders})
          `;

          const params: any[] = [...ids];

          if (fileTypes && fileTypes.length > 0) {
            const fileTypePlaceholders = fileTypes.map(() => '?').join(',');
            sqlQuery += ` AND language IN (${fileTypePlaceholders})`;
            params.push(...fileTypes);
          }

          const rows = this.db.prepare(sqlQuery).all(...params) as any[];

          results = rows.map(row => {
            const vectorResult = vectorResults.find((v: any) => v.metadata.id === row.id);
            return this.rowToSearchResult(row, vectorResult?.distance, vectorResult?.relevance);
          });
        }
      } catch (error) {
        logger.error('Vector search failed, falling back to text search:', error);
      }
    }

    if (results.length === 0) {
      let sqlQuery = `
        SELECT * FROM embeddings 
        WHERE content LIKE ? OR name LIKE ?
      `;
      const params: any[] = [`%${query}%`, `%${query}%`];

      if (fileTypes && fileTypes.length > 0) {
        const placeholders = fileTypes.map(() => '?').join(',');
        sqlQuery += ` AND language IN (${placeholders})`;
        params.push(...fileTypes);
      }

      sqlQuery += ' LIMIT ?';
      params.push(limit);

      const rows = this.db.prepare(sqlQuery).all(...params) as any[];
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

  private rowToSearchResult(row: any, distance?: number, relevance?: number): SearchResult {
    return {
      id: row.id,
      type: row.chunk_type,
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
    const count = this.db.prepare('SELECT COUNT(*) as count FROM embeddings WHERE file_path = ?')
      .get(filePath) as any;

    this.db.prepare(`
      INSERT OR REPLACE INTO file_index (file_path, last_indexed, total_chunks)
      VALUES (?, CURRENT_TIMESTAMP, ?)
    `).run(filePath, count.count);
  }

  async getStats(): Promise<any> {
    const totalChunks = (this.db.prepare('SELECT COUNT(*) as count FROM embeddings').get() as any).count;
    const totalFiles = (this.db.prepare('SELECT COUNT(*) as count FROM file_index').get() as any).count;
    const languages = this.db.prepare('SELECT language, COUNT(*) as count FROM embeddings GROUP BY language').all();

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
    this.db.close();
    logger.info('VectorStore closed');
  }
}