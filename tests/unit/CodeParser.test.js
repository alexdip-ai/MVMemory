import { CodeParser } from '../../src/indexer/CodeParser.js';
describe('CodeParser', () => {
    let parser;
    beforeEach(() => {
        parser = new CodeParser({
            logLevel: 'error'
        });
    });
    describe('TypeScript Parsing', () => {
        it('should parse TypeScript functions', async () => {
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
            expect(chunks).toHaveLength(2);
            expect(chunks[0].type).toBe('function');
            expect(chunks[0].name).toBe('calculateTotal');
            expect(chunks[0].language).toBe('typescript');
            expect(chunks[1].type).toBe('class');
            expect(chunks[1].name).toBe('UserService');
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
            expect(chunks[0].imports).toContain("import { Repository } from './repository';");
            expect(chunks[0].imports).toContain("import * as utils from '../utils';");
            expect(chunks[0].exports).toContain("export { UserService } from './services';");
        });
    });
    describe('JavaScript Parsing', () => {
        it('should parse JavaScript functions', async () => {
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
    });
    describe('Python Parsing', () => {
        it('should parse Python functions and classes', async () => {
            const content = `
import os
from typing import List, Optional

def calculate_average(numbers: List[float]) -> float:
    \"\"\"Calculate the average of a list of numbers.\"\"\"
    if not numbers:
        return 0.0
    return sum(numbers) / len(numbers)

class DataProcessor:
    def __init__(self, config: dict):
        self.config = config
    
    def process_data(self, data: List[dict]) -> List[dict]:
        \"\"\"Process a list of data items.\"\"\"
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
            const content = `
# Main Title

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
    });
    describe('Error Handling', () => {
        it('should handle malformed TypeScript gracefully', async () => {
            const content = `
export function broken(
  // Missing closing parenthesis and body
`;
            const chunks = await parser.parseFile('broken.ts', content);
            // Should fallback to generic parsing
            expect(chunks.length).toBeGreaterThan(0);
            expect(chunks[0].language).toBe('typescript');
        });
        it('should handle malformed JavaScript gracefully', async () => {
            const content = `
function incomplete() {
  const x = {
    // Missing closing brace
`;
            const chunks = await parser.parseFile('broken.js', content);
            // Should fallback to generic parsing
            expect(chunks.length).toBeGreaterThan(0);
        });
    });
});
//# sourceMappingURL=CodeParser.test.js.map