import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import * as ts from 'typescript';
import path from 'path';
import { CodeChunk } from '../core/VectorStore.js';
import winston from 'winston';

export interface ParserConfig {
  chunkSize: number;
  maxChunkSize: number;
  extractComments: boolean;
  preserveStructure: boolean;
  logLevel: string;
}

/**
 * CodeParser - Multi-language AST-based code parser
 * Supports TypeScript, JavaScript, Python, and generic text parsing
 */
export class CodeParser {
  private config: ParserConfig;
  private logger!: winston.Logger;
  
  constructor(config: Partial<ParserConfig> = {}) {
    this.config = {
      chunkSize: 50, // lines per chunk
      maxChunkSize: 500, // max lines per chunk
      extractComments: true,
      preserveStructure: true,
      logLevel: 'info',
      ...config
    };
    
    this.setupLogger();
  }
  
  private setupLogger(): void {
    this.logger = winston.createLogger({
      level: this.config.logLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `${timestamp} [${level}] CodeParser: ${message}`;
        })
      ),
      transports: [new winston.transports.Console()]
    });
  }
  
  /**
   * Parse a file and extract code chunks
   */
  async parseFile(filePath: string, content: string): Promise<CodeChunk[]> {
    try {
      const extension = path.extname(filePath).toLowerCase();
      const language = this.detectLanguage(extension);
      
      this.logger.debug(`Parsing file: ${filePath} (${language})`);
      
      switch (language) {
        case 'typescript':
          return this.parseTypeScript(content, filePath);
        case 'javascript':
          return this.parseJavaScript(content, filePath);
        case 'python':
          return this.parsePython(content, filePath);
        case 'json':
          return this.parseJSON(content, filePath);
        case 'markdown':
          return this.parseMarkdown(content, filePath);
        default:
          return this.parseGeneric(content, filePath, language);
      }
    } catch (error) {
      this.logger.error(`Failed to parse ${filePath}:`, error);
      // Fallback to generic parsing
      return this.parseGeneric(content, filePath, 'text');
    }
  }
  
  private detectLanguage(extension: string): string {
    const languageMap: { [key: string]: string } = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.mjs': 'javascript',
      '.py': 'python',
      '.pyi': 'python',
      '.json': 'json',
      '.md': 'markdown',
      '.mdx': 'markdown',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
      '.cpp': 'cpp',
      '.c': 'c',
      '.h': 'c',
      '.cs': 'csharp',
      '.php': 'php',
      '.rb': 'ruby',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.scala': 'scala',
      '.sh': 'bash',
      '.sql': 'sql',
      '.css': 'css',
      '.scss': 'scss',
      '.html': 'html',
      '.xml': 'xml',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.toml': 'toml'
    };
    
    return languageMap[extension] || 'text';
  }
  
  /**
   * Parse TypeScript files using TypeScript compiler API
   */
  private parseTypeScript(content: string, filePath: string): CodeChunk[] {
    try {
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
      );
      
      const chunks: CodeChunk[] = [];
      const imports: string[] = [];
      const exports: string[] = [];
      
      // Extract imports and exports
      sourceFile.statements.forEach(statement => {
        if (ts.isImportDeclaration(statement)) {
          imports.push(statement.getText(sourceFile));
        } else if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) {
          exports.push(statement.getText(sourceFile));
        }
      });
      
      const visit = (node: ts.Node) => {
        const chunk = this.extractTSChunk(node, sourceFile, imports, exports);
        if (chunk) {
          chunks.push(chunk);
        }
        
        ts.forEachChild(node, visit);
      };
      
      visit(sourceFile);
      
      // If no specific chunks found, create generic chunks
      if (chunks.length === 0) {
        chunks.push(...this.createGenericChunks(content, filePath, 'typescript', imports, exports));
      }
      
      this.logger.debug(`Extracted ${chunks.length} TypeScript chunks from ${filePath}`);
      return chunks;
      
    } catch (error) {
      this.logger.warn(`TypeScript parsing failed for ${filePath}, falling back to generic:`, error);
      return this.parseGeneric(content, filePath, 'typescript');
    }
  }
  
  private extractTSChunk(
    node: ts.Node,
    sourceFile: ts.SourceFile,
    imports: string[],
    exports: string[]
  ): CodeChunk | null {
    const getPosition = (node: ts.Node) => {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      return { start: start.line + 1, end: end.line + 1 };
    };
    
    const getName = (node: ts.Node): string => {
      if ('name' in node && node.name) {
        return (node.name as any).getText(sourceFile);
      }
      return 'anonymous';
    };
    
    const position = getPosition(node);
    const nodeText = node.getText(sourceFile);
    
    // Skip very small chunks
    if (position.end - position.start < 2 || nodeText.length < 50) {
      return null;
    }
    
    if (ts.isFunctionDeclaration(node)) {
      return {
        type: 'function',
        name: getName(node),
        content: nodeText,
        filePath: sourceFile.fileName,
        startLine: position.start,
        endLine: position.end,
        language: 'typescript',
        imports,
        exports
      };
    }
    
    if (ts.isClassDeclaration(node)) {
      return {
        type: 'class',
        name: getName(node),
        content: nodeText,
        filePath: sourceFile.fileName,
        startLine: position.start,
        endLine: position.end,
        language: 'typescript',
        imports,
        exports
      };
    }
    
    if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
      return {
        type: 'function',
        name: getName(node),
        content: nodeText,
        filePath: sourceFile.fileName,
        startLine: position.start,
        endLine: position.end,
        language: 'typescript',
        imports,
        exports
      };
    }
    
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      return {
        type: 'class', // Treat interfaces/types as class-like
        name: getName(node),
        content: nodeText,
        filePath: sourceFile.fileName,
        startLine: position.start,
        endLine: position.end,
        language: 'typescript',
        imports,
        exports
      };
    }
    
    return null;
  }
  
  /**
   * Parse JavaScript files using Babel parser
   */
  private parseJavaScript(content: string, filePath: string): CodeChunk[] {
    try {
      const ast = parser.parse(content, {
        sourceType: 'module',
        allowImportExportEverywhere: true,
        allowReturnOutsideFunction: true,
        plugins: [
          'jsx',
          'typescript',
          'decorators-legacy',
          'classProperties',
          'objectRestSpread',
          'asyncGenerators',
          'functionBind',
          'exportDefaultFrom',
          'exportNamespaceFrom',
          'dynamicImport',
          'nullishCoalescingOperator',
          'optionalChaining'
        ]
      });
      
      const chunks: CodeChunk[] = [];
      const imports: string[] = [];
      const exports: string[] = [];
      
      traverse(ast, {
        ImportDeclaration(path) {
          imports.push(content.slice(path.node.start!, path.node.end!));
        },
        
        ExportDeclaration(path) {
          exports.push(content.slice(path.node.start!, path.node.end!));
        },
        
        FunctionDeclaration: (path: any) => {
          const chunk = this.extractBabelChunk(path, content, filePath, 'function', imports, exports);
          if (chunk) chunks.push(chunk);
        },
        
        ClassDeclaration: (path: any) => {
          const chunk = this.extractBabelChunk(path, content, filePath, 'class', imports, exports);
          if (chunk) chunks.push(chunk);
        },
        
        ArrowFunctionExpression: (path: any) => {
          // Only extract if it's a top-level assignment or export
          if (t.isVariableDeclarator(path.parent) || t.isExportDefaultDeclaration(path.parent)) {
            const chunk = this.extractBabelChunk(path, content, filePath, 'function', imports, exports);
            if (chunk) chunks.push(chunk);
          }
        }
      });
      
      // If no specific chunks found, create generic chunks
      if (chunks.length === 0) {
        chunks.push(...this.createGenericChunks(content, filePath, 'javascript', imports, exports));
      }
      
      this.logger.debug(`Extracted ${chunks.length} JavaScript chunks from ${filePath}`);
      return chunks;
      
    } catch (error) {
      this.logger.warn(`JavaScript parsing failed for ${filePath}, falling back to generic:`, error);
      return this.parseGeneric(content, filePath, 'javascript');
    }
  }
  
  private extractBabelChunk(
    path: any,
    content: string,
    filePath: string,
    type: 'function' | 'class',
    imports: string[],
    exports: string[]
  ): CodeChunk | null {
    const node = path.node;
    
    if (!node.start || !node.end) {
      return null;
    }
    
    const lines = content.slice(0, node.start).split('\n');
    const startLine = lines.length;
    const endLines = content.slice(0, node.end).split('\n');
    const endLine = endLines.length;
    
    // Skip very small chunks
    if (endLine - startLine < 2) {
      return null;
    }
    
    const name = node.id?.name || node.key?.name || 'anonymous';
    const chunkContent = content.slice(node.start, node.end);
    
    return {
      type,
      name,
      content: chunkContent,
      filePath,
      startLine,
      endLine,
      language: 'javascript',
      imports,
      exports
    };
  }
  
  /**
   * Parse Python files with basic pattern matching
   */
  private parsePython(content: string, filePath: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lines = content.split('\n');
    const imports: string[] = [];
    const exports: string[] = [];
    
    // Extract imports
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('import ') || line.startsWith('from ')) {
        imports.push(line);
      }
    }
    
    // Find functions and classes
    let currentChunk: { type: string; name: string; start: number; indent: number } | null = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      const indent = line.length - line.trimStart().length;
      
      // Function or class definition
      const funcMatch = trimmed.match(/^def\s+(\w+)/);
      const classMatch = trimmed.match(/^class\s+(\w+)/);
      
      if (funcMatch || classMatch) {
        // Save previous chunk
        if (currentChunk) {
          const chunkContent = lines.slice(currentChunk.start, i).join('\n');
          if (chunkContent.trim().length > 50) {
            chunks.push({
              type: currentChunk.type as 'function' | 'class',
              name: currentChunk.name,
              content: chunkContent,
              filePath,
              startLine: currentChunk.start + 1,
              endLine: i,
              language: 'python',
              imports,
              exports
            });
          }
        }
        
        // Start new chunk
        currentChunk = {
          type: funcMatch ? 'function' : 'class',
          name: funcMatch ? funcMatch[1] : classMatch![1],
          start: i,
          indent
        };
      } else if (currentChunk && trimmed && indent <= currentChunk.indent && !trimmed.startsWith('#')) {
        // End of current chunk (found code at same or lower indentation)
        const chunkContent = lines.slice(currentChunk.start, i).join('\n');
        if (chunkContent.trim().length > 50) {
          chunks.push({
            type: currentChunk.type as 'function' | 'class',
            name: currentChunk.name,
            content: chunkContent,
            filePath,
            startLine: currentChunk.start + 1,
            endLine: i,
            language: 'python',
            imports,
            exports
          });
        }
        currentChunk = null;
      }
    }
    
    // Handle last chunk
    if (currentChunk) {
      const chunkContent = lines.slice(currentChunk.start).join('\n');
      if (chunkContent.trim().length > 50) {
        chunks.push({
          type: currentChunk.type as 'function' | 'class',
          name: currentChunk.name,
          content: chunkContent,
          filePath,
          startLine: currentChunk.start + 1,
          endLine: lines.length,
          language: 'python',
          imports,
          exports
        });
      }
    }
    
    // If no specific chunks found, create generic chunks
    if (chunks.length === 0) {
      chunks.push(...this.createGenericChunks(content, filePath, 'python', imports, exports));
    }
    
    this.logger.debug(`Extracted ${chunks.length} Python chunks from ${filePath}`);
    return chunks;
  }
  
  /**
   * Parse JSON files
   */
  private parseJSON(content: string, filePath: string): CodeChunk[] {
    try {
      JSON.parse(content); // Validate JSON
      
      return [{
        type: 'module',
        name: path.basename(filePath, '.json'),
        content,
        filePath,
        startLine: 1,
        endLine: content.split('\n').length,
        language: 'json',
        imports: [],
        exports: []
      }];
    } catch (error) {
      this.logger.warn(`Invalid JSON in ${filePath}`);
      return this.parseGeneric(content, filePath, 'json');
    }
  }
  
  /**
   * Parse Markdown files
   */
  private parseMarkdown(content: string, filePath: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lines = content.split('\n');
    
    let currentSection: { name: string; start: number; level: number } | null = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
      
      if (headerMatch) {
        // Save previous section
        if (currentSection) {
          const sectionContent = lines.slice(currentSection.start, i).join('\n');
          if (sectionContent.trim().length > 50) {
            chunks.push({
              type: 'module',
              name: currentSection.name,
              content: sectionContent,
              filePath,
              startLine: currentSection.start + 1,
              endLine: i,
              language: 'markdown',
              imports: [],
              exports: []
            });
          }
        }
        
        // Start new section
        currentSection = {
          name: headerMatch[2],
          start: i,
          level: headerMatch[1].length
        };
      }
    }
    
    // Handle last section
    if (currentSection) {
      const sectionContent = lines.slice(currentSection.start).join('\n');
      if (sectionContent.trim().length > 50) {
        chunks.push({
          type: 'module',
          name: currentSection.name,
          content: sectionContent,
          filePath,
          startLine: currentSection.start + 1,
          endLine: lines.length,
          language: 'markdown',
          imports: [],
          exports: []
        });
      }
    }
    
    // If no sections found, treat as single chunk
    if (chunks.length === 0) {
      chunks.push({
        type: 'module',
        name: path.basename(filePath),
        content,
        filePath,
        startLine: 1,
        endLine: lines.length,
        language: 'markdown',
        imports: [],
        exports: []
      });
    }
    
    return chunks;
  }
  
  /**
   * Generic parser for unknown file types
   */
  private parseGeneric(content: string, filePath: string, language: string): CodeChunk[] {
    return this.createGenericChunks(content, filePath, language, [], []);
  }
  
  /**
   * Create generic chunks by splitting content into manageable pieces
   */
  private createGenericChunks(
    content: string,
    filePath: string,
    language: string,
    imports: string[] = [],
    exports: string[] = []
  ): CodeChunk[] {
    const lines = content.split('\n');
    const chunks: CodeChunk[] = [];
    
    // For small files, create a single chunk
    if (lines.length <= this.config.chunkSize) {
      chunks.push({
        type: 'module',
        name: path.basename(filePath),
        content,
        filePath,
        startLine: 1,
        endLine: lines.length,
        language,
        imports,
        exports
      });
      return chunks;
    }
    
    // Split into chunks of configurable size
    for (let i = 0; i < lines.length; i += this.config.chunkSize) {
      const endLine = Math.min(i + this.config.chunkSize, lines.length);
      const chunkLines = lines.slice(i, endLine);
      const chunkContent = chunkLines.join('\n');
      
      // Skip empty or very small chunks
      if (chunkContent.trim().length < 20) {
        continue;
      }
      
      chunks.push({
        type: 'generic',
        name: `${path.basename(filePath)}_chunk_${Math.floor(i / this.config.chunkSize) + 1}`,
        content: chunkContent,
        filePath,
        startLine: i + 1,
        endLine,
        language,
        imports,
        exports
      });
    }
    
    return chunks;
  }
  
  /**
   * Check if a file should be indexed based on its extension and size
   */
  shouldIndex(filePath: string, size: number): boolean {
    const extension = path.extname(filePath).toLowerCase();
    
    // Skip files that are too large
    if (size > 1024 * 1024) { // 1MB
      return false;
    }
    
    // Skip binary files and common ignore patterns
    const skipExtensions = [
      '.bin', '.exe', '.dll', '.so', '.dylib',
      '.jpg', '.jpeg', '.png', '.gif', '.svg',
      '.mp3', '.mp4', '.avi', '.mov',
      '.zip', '.tar', '.gz', '.rar',
      '.pdf', '.doc', '.docx',
      '.lock', '.log'
    ];
    
    if (skipExtensions.includes(extension)) {
      return false;
    }
    
    // Skip common ignore patterns
    const ignorePaths = [
      'node_modules',
      '.git',
      '.svn',
      'dist',
      'build',
      'coverage',
      '.nyc_output',
      'vendor',
      '__pycache__',
      '.pytest_cache'
    ];
    
    return !ignorePaths.some(pattern => filePath.includes(pattern));
  }
}