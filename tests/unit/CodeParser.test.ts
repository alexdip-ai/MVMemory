import { CodeParser } from '../../src/indexer/CodeParser.js';
import { createMockChunk } from '../setup.js';
import path from 'path';
import { jest } from '@jest/globals';

// Mock winston
jest.mock('winston');

describe('CodeParser', () => {
  let parser: CodeParser;
  
  beforeEach(() => {
    parser = new CodeParser({
      logLevel: 'error',
      chunkSize: 50,
      maxChunkSize: 500,
      extractComments: true,
      preserveStructure: true
    });
  });
  
  describe('Constructor and Configuration', () => {
    it('should initialize with default config', () => {
      const defaultParser = new CodeParser();
      expect(defaultParser).toBeInstanceOf(CodeParser);
    });
    
    it('should initialize with custom config', () => {
      const customParser = new CodeParser({
        chunkSize: 100,
        maxChunkSize: 1000,
        extractComments: false,
        preserveStructure: false,
        logLevel: 'debug'
      });
      expect(customParser).toBeInstanceOf(CodeParser);
    });
  });
  
  describe('Language Detection', () => {
    it('should detect language from file extension', async () => {
      const tests = [
        { file: 'test.ts', expected: 'typescript' },
        { file: 'test.tsx', expected: 'typescript' },
        { file: 'test.js', expected: 'javascript' },
        { file: 'test.jsx', expected: 'javascript' },
        { file: 'test.py', expected: 'python' },
        { file: 'test.json', expected: 'json' },
        { file: 'test.md', expected: 'markdown' },
        { file: 'test.go', expected: 'go' },
        { file: 'test.rs', expected: 'rust' },
        { file: 'test.unknown', expected: 'text' }
      ];
      
      for (const test of tests) {
        const chunks = await parser.parseFile(test.file, 'content');
        expect(chunks[0].language).toBe(test.expected);
      }
    });
  });
  
  describe('TypeScript Parsing', () => {
    it('should parse TypeScript functions and classes', async () => {
      const content = `
export function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}

export class UserService {
  async findUser(id: string): Promise<User | null> {
    return this.repository.findById(id);
  }
}
`;
      
      const chunks = await parser.parseFile('test.ts', content);
      
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      
      const functionChunk = chunks.find(c => c.name === 'calculateTotal');
      const classChunk = chunks.find(c => c.name === 'UserService');
      
      expect(functionChunk).toBeDefined();
      expect(functionChunk?.type).toBe('function');
      expect(functionChunk?.language).toBe('typescript');
      
      expect(classChunk).toBeDefined();
      expect(classChunk?.type).toBe('class');
      expect(classChunk?.language).toBe('typescript');
    });
    
    it('should extract imports and exports', async () => {
      const content = `
import { Repository } from './repository';
import * as utils from '../utils';

export function processData(data: any[]): ProcessedData {
  return utils.transform(data);
}

export { UserService } from './services';
`;
      
      const chunks = await parser.parseFile('test.ts', content);
      
      const functionChunk = chunks.find(c => c.name === 'processData');
      expect(functionChunk).toBeDefined();
      expect(functionChunk?.imports).toContain("import { Repository } from './repository';");
      expect(functionChunk?.imports).toContain("import * as utils from '../utils';");
      expect(functionChunk?.exports).toContain("export { UserService } from './services';");
    });
    
    it('should parse interfaces and type aliases', async () => {
      const content = `
interface User {
  id: string;
  name: string;
  email: string;
}

type ProcessedData = {
  id: number;
  value: string;
  processed: boolean;
};
`;
      
      const chunks = await parser.parseFile('test.ts', content);
      
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      expect(chunks.some(c => c.name === 'User')).toBe(true);
      expect(chunks.some(c => c.name === 'ProcessedData')).toBe(true);
    });
    
    it('should parse methods in classes', async () => {
      const content = `
class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
  
  subtract(a: number, b: number): number {
    return a - b;
  }
}
`;
      
      const chunks = await parser.parseFile('test.ts', content);
      
      expect(chunks.some(c => c.name === 'Calculator')).toBe(true);
      expect(chunks.some(c => c.name === 'add')).toBe(true);
      expect(chunks.some(c => c.name === 'subtract')).toBe(true);
    });
    
    it('should handle anonymous functions and arrow functions', async () => {
      const content = `
export const processData = (data: any[]) => {
  return data.map(item => item.value);
};

const handler = function(event: Event) {
  console.log(event);
};
`;
      
      const chunks = await parser.parseFile('test.ts', content);
      
      expect(chunks.some(c => c.name === 'processData' || c.name === 'anonymous')).toBe(true);
    });
    
    it('should skip very small chunks', async () => {
      const content = `
const x = 1;
`;
      
      const chunks = await parser.parseFile('test.ts', content);
      
      // Should create generic chunks for very small content
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].type).toBe('module');
    });
  });
  
  describe('JavaScript Parsing', () => {
    it('should parse JavaScript functions and classes', async () => {
      const content = `
function calculateDiscount(price, percentage) {
  return price * (percentage / 100);
}

const processOrder = async (order) => {
  const discount = calculateDiscount(order.total, order.discountPercent);
  return { ...order, discount };
};

class OrderProcessor {
  constructor(config) {
    this.config = config;
  }
  
  process(order) {
    return processOrder(order);
  }
}
`;
      
      const chunks = await parser.parseFile('test.js', content);
      
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some(c => c.name === 'calculateDiscount')).toBe(true);
      expect(chunks.some(c => c.name === 'OrderProcessor')).toBe(true);
      expect(chunks.every(c => c.language === 'javascript')).toBe(true);
    });
    
    it('should handle ES6 features', async () => {
      const content = `
import { fetch } from 'node-fetch';

export const apiClient = {
  async get(url) {
    const response = await fetch(url);
    return response.json();
  },
  
  post: async (url, data) => {
    const response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(data)
    });
    return response.json();
  }
};

export default apiClient;
`;
      
      const chunks = await parser.parseFile('test.js', content);
      
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.every(c => c.language === 'javascript')).toBe(true);
    });
    
    it('should handle JSX components', async () => {
      const content = `
import React from 'react';

const Button = ({ children, onClick }) => {
  return (
    <button onClick={onClick}>
      {children}
    </button>
  );
};

class App extends React.Component {
  render() {
    return (
      <div>
        <Button onClick={() => console.log('clicked')}>Click me</Button>
      </div>
    );
  }
}

export default App;
`;
      
      const chunks = await parser.parseFile('test.jsx', content);
      
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some(c => c.name === 'App')).toBe(true);
      expect(chunks.every(c => c.language === 'javascript')).toBe(true);
    });
    
    it('should handle complex arrow functions', async () => {
      const content = `
const complexProcessor = (data) => ({
  processed: data.map(item => ({
    ...item,
    normalized: item.value.toLowerCase().trim()
  })),
  metadata: {
    count: data.length,
    timestamp: Date.now()
  }
});

export { complexProcessor };
`;
      
      const chunks = await parser.parseFile('test.js', content);
      
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.every(c => c.language === 'javascript')).toBe(true);
    });
  });
  
  describe('Python Parsing', () => {
    it('should parse Python functions and classes', async () => {
      const content = `import os
from typing import List, Optional

def calculate_average(numbers: List[float]) -> float:
    """Calculate the average of a list of numbers."""
    if not numbers:
        return 0.0
    return sum(numbers) / len(numbers)

class DataProcessor:
    def __init__(self, config: dict):
        self.config = config
    
    def process_data(self, data: List[dict]) -> List[dict]:
        """Process a list of data items."""
        results = []
        for item in data:
            processed = self._process_item(item)
            results.append(processed)
        return results
    
    def _process_item(self, item: dict) -> dict:
        return {**item, 'processed': True}
`;
      
      const chunks = await parser.parseFile('test.py', content);
      
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some(c => c.name === 'calculate_average')).toBe(true);
      expect(chunks.some(c => c.name === 'DataProcessor')).toBe(true);
      expect(chunks.every(c => c.language === 'python')).toBe(true);
    });
    
    it('should handle Python decorators and async functions', async () => {
      const content = `from functools import wraps
import asyncio

def cache_result(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        return func(*args, **kwargs)
    return wrapper

@cache_result
async def fetch_data(url: str) -> dict:
    """Fetch data from URL asynchronously."""
    await asyncio.sleep(1)
    return {'data': 'example'}

class AsyncProcessor:
    async def process(self, items):
        tasks = [self._process_item(item) for item in items]
        return await asyncio.gather(*tasks)
    
    async def _process_item(self, item):
        await asyncio.sleep(0.1)
        return item
`;
      
      const chunks = await parser.parseFile('test.py', content);
      
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some(c => c.name === 'cache_result')).toBe(true);
      expect(chunks.some(c => c.name === 'fetch_data')).toBe(true);
      expect(chunks.some(c => c.name === 'AsyncProcessor')).toBe(true);
    });
    
    it('should handle nested functions and classes', async () => {
      const content = `class OuterClass:
    def method(self):
        def inner_function():
            return "inner"
        
        class InnerClass:
            def inner_method(self):
                return inner_function()
        
        return InnerClass()

def outer_function():
    def nested_function(x):
        def deeply_nested(y):
            return x + y
        return deeply_nested
    return nested_function
`;
      
      const chunks = await parser.parseFile('test.py', content);
      
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some(c => c.name === 'OuterClass')).toBe(true);
      expect(chunks.some(c => c.name === 'outer_function')).toBe(true);
    });
    
    it('should handle indentation correctly', async () => {
      const content = `def function_one():
    print("first function")
    if True:
        print("nested")

def function_two():
    print("second function")

class MyClass:
    def method_one(self):
        pass
    
    def method_two(self):
        pass

def function_three():
    print("third function")
`;
      
      const chunks = await parser.parseFile('test.py', content);
      
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some(c => c.name === 'function_one')).toBe(true);
      expect(chunks.some(c => c.name === 'function_two')).toBe(true);
      expect(chunks.some(c => c.name === 'function_three')).toBe(true);
      expect(chunks.some(c => c.name === 'MyClass')).toBe(true);
    });
  });
  
  describe('Generic Parsing', () => {
    it('should handle unknown file types', async () => {
      const content = `
This is a generic text file
with multiple lines of content.

It should be split into chunks
based on the configuration.
`.repeat(20); // Make it long enough to split
      
      const chunks = await parser.parseFile('test.txt', content);
      
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].type).toBe('generic');
      expect(chunks[0].language).toBe('text');
    });
    
    it('should create single chunk for small files', async () => {
      const content = 'Small file content';
      
      const chunks = await parser.parseFile('small.txt', content);
      
      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe('module');
      expect(chunks[0].content).toBe(content);
    });
  });
  
  describe('Markdown Parsing', () => {
    it('should parse markdown sections', async () => {
      const content = `# Main Title

This is the introduction section.

## Section 1

Content for section 1 with code examples:

\`\`\`typescript
function example() {
  return 'hello';
}
\`\`\`

## Section 2

More content here.

### Subsection 2.1

Detailed information.
`;
      
      const chunks = await parser.parseFile('test.md', content);
      
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some(c => c.name === 'Main Title')).toBe(true);
      expect(chunks.some(c => c.name === 'Section 1')).toBe(true);
      expect(chunks.every(c => c.language === 'markdown')).toBe(true);
    });
    
    it('should handle different header levels', async () => {
      const content = `# H1 Header

Content 1

## H2 Header

Content 2

### H3 Header

Content 3

#### H4 Header

Content 4

##### H5 Header

Content 5

###### H6 Header

Content 6
`;
      
      const chunks = await parser.parseFile('test.md', content);
      
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some(c => c.name === 'H1 Header')).toBe(true);
      expect(chunks.some(c => c.name === 'H2 Header')).toBe(true);
      expect(chunks.some(c => c.name === 'H3 Header')).toBe(true);
    });
    
    it('should handle markdown without headers', async () => {
      const content = `This is a markdown file without any headers.

It has multiple paragraphs and should be treated as a single module.

With various content including:
- Lists
- Code blocks
- Links
`;
      
      const chunks = await parser.parseFile('test.md', content);
      
      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe('module');
      expect(chunks[0].name).toBe('test.md');
    });
  });
  
  describe('JSON Parsing', () => {
    it('should parse valid JSON files', async () => {
      const content = `{
  "name": "test-package",
  "version": "1.0.0",
  "dependencies": {
    "express": "^4.18.0",
    "lodash": "^4.17.21"
  }
}`;
      
      const chunks = await parser.parseFile('package.json', content);
      
      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe('module');
      expect(chunks[0].name).toBe('package');
      expect(chunks[0].language).toBe('json');
    });
    
    it('should handle invalid JSON gracefully', async () => {
      const content = `{
  "name": "broken",
  "invalid": // comment not allowed in JSON
}`;
      
      const chunks = await parser.parseFile('broken.json', content);
      
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].language).toBe('json');
    });
  });
  
  describe('File Filtering', () => {
    it('should accept indexable files', () => {
      expect(parser.shouldIndex('src/main.ts', 1000)).toBe(true);
      expect(parser.shouldIndex('lib/utils.js', 5000)).toBe(true);
      expect(parser.shouldIndex('readme.md', 2000)).toBe(true);
    });
    
    it('should reject non-indexable files', () => {
      expect(parser.shouldIndex('image.jpg', 1000)).toBe(false);
      expect(parser.shouldIndex('binary.exe', 1000)).toBe(false);
      expect(parser.shouldIndex('node_modules/package/index.js', 1000)).toBe(false);
      expect(parser.shouldIndex('large-file.txt', 2 * 1024 * 1024)).toBe(false); // 2MB
    });

    it('should reject files with ignore patterns', () => {
      const ignorePaths = [
        'node_modules/lib/file.js',
        '.git/config',
        'dist/bundle.js',
        'build/output.js',
        'coverage/report.html',
        '__pycache__/module.pyc',
        '.pytest_cache/test.py',
        'vendor/library.php'
      ];

      ignorePaths.forEach(filePath => {
        expect(parser.shouldIndex(filePath, 1000)).toBe(false);
      });
    });

    it('should reject binary file extensions', () => {
      const binaryFiles = [
        'image.jpg',
        'photo.jpeg',
        'icon.png',
        'logo.gif',
        'vector.svg',
        'song.mp3',
        'video.mp4',
        'archive.zip',
        'document.pdf'
      ];

      binaryFiles.forEach(filePath => {
        expect(parser.shouldIndex(filePath, 1000)).toBe(false);
      });
    });
  });
  
  describe('Error Handling', () => {
    it('should handle malformed TypeScript gracefully', async () => {
      const content = `export function broken(
  // Missing closing parenthesis and body
`;
      
      const chunks = await parser.parseFile('broken.ts', content);
      
      // Should fallback to generic parsing
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].language).toBe('typescript');
    });
    
    it('should handle malformed JavaScript gracefully', async () => {
      const content = `function incomplete() {
  const x = {
    // Missing closing brace
`;
      
      const chunks = await parser.parseFile('broken.js', content);
      
      // Should fallback to generic parsing
      expect(chunks.length).toBeGreaterThan(0);
    });
    
    it('should handle empty files', async () => {
      const chunks = await parser.parseFile('empty.ts', '');
      
      expect(chunks).toHaveLength(0);
    });
    
    it('should handle very large files', async () => {
      const largeContent = 'console.log("test");\n'.repeat(1000);
      
      const chunks = await parser.parseFile('large.js', largeContent);
      
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.every(c => c.language === 'javascript')).toBe(true);
    });
    
    it('should handle files with special characters', async () => {
      const content = `function test() {
  console.log("Hello 世界! 🌍");
  return "Émojis: 🚀💻📊";
}`;
      
      const chunks = await parser.parseFile('unicode.js', content);
      
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some(c => c.content.includes('世界'))).toBe(true);
    });

    it('should handle parsing exceptions gracefully', async () => {
      const content = 'function test() { throw new Error("test"); }';
      
      // Should not throw even if content causes parsing issues
      const chunks = await parser.parseFile('exception.js', content);
      
      expect(chunks.length).toBeGreaterThan(0);
    });
  });
  
  describe('Generic File Handling', () => {
    it('should create appropriate chunks for different file sizes', async () => {
      const smallContent = 'small content';
      const smallChunks = await parser.parseFile('small.txt', smallContent);
      
      expect(smallChunks).toHaveLength(1);
      expect(smallChunks[0].type).toBe('module');
      
      const largeContent = 'line\n'.repeat(200);
      const largeChunks = await parser.parseFile('large.txt', largeContent);
      
      expect(largeChunks.length).toBeGreaterThan(1);
      expect(largeChunks.every(c => c.type === 'generic')).toBe(true);
    });
    
    it('should skip very small chunks in generic parsing', async () => {
      const content = '\n\n   \n\nvalid content here\n\n   \n';
      
      const chunks = await parser.parseFile('sparse.txt', content);
      
      expect(chunks.length).toBeGreaterThan(0);
      chunks.forEach(chunk => {
        expect(chunk.content.trim().length).toBeGreaterThan(10);
      });
    });
  });

  describe('Advanced Features', () => {
    it('should preserve line numbers correctly', async () => {
      const content = `line 1
line 2
function test() {
  return "hello";
}
line 6`;
      
      const chunks = await parser.parseFile('test.js', content);
      
      const functionChunk = chunks.find(c => c.name === 'test');
      expect(functionChunk).toBeDefined();
      expect(functionChunk?.startLine).toBe(3);
      expect(functionChunk?.endLine).toBeGreaterThan(3);
    });
    
    it('should include file path in all chunks', async () => {
      const content = 'function test() { return true; }';
      const filePath = '/project/src/utils/test.js';
      
      const chunks = await parser.parseFile(filePath, content);
      
      chunks.forEach(chunk => {
        expect(chunk.filePath).toBe(filePath);
      });
    });
    
    it('should handle configuration changes', () => {
      const parser1 = new CodeParser({ chunkSize: 10 });
      const parser2 = new CodeParser({ chunkSize: 100 });
      
      expect(parser1).toBeInstanceOf(CodeParser);
      expect(parser2).toBeInstanceOf(CodeParser);
    });
    
    it('should extract meaningful chunk names', async () => {
      const content = `function meaningfulName() {
  return "test";
}

class ImportantClass {
  criticalMethod() {
    return 42;
  }
}`;
      
      const chunks = await parser.parseFile('test.js', content);
      
      expect(chunks.some(c => c.name === 'meaningfulName')).toBe(true);
      expect(chunks.some(c => c.name === 'ImportantClass')).toBe(true);
      expect(chunks.some(c => c.name === 'criticalMethod')).toBe(true);
    });

    it('should handle chunk size configuration', async () => {
      const smallChunkParser = new CodeParser({ chunkSize: 5 });
      const largeChunkParser = new CodeParser({ chunkSize: 100 });
      
      const content = 'line\n'.repeat(50);
      
      const smallChunks = await smallChunkParser.parseFile('test.txt', content);
      const largeChunks = await largeChunkParser.parseFile('test.txt', content);
      
      expect(smallChunks.length).toBeGreaterThan(largeChunks.length);
    });

    it('should handle max chunk size limits', async () => {
      const content = 'very long line '.repeat(1000);
      
      const chunks = await parser.parseFile('huge.txt', content);
      
      chunks.forEach(chunk => {
        const lineCount = chunk.endLine - chunk.startLine;
        expect(lineCount).toBeLessThanOrEqual(500); // maxChunkSize
      });
    });
  });
});