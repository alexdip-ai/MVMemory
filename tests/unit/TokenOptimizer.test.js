import { TokenOptimizer } from '../../src/optimization/TokenOptimizer.js';
describe('TokenOptimizer', () => {
    let optimizer;
    beforeEach(() => {
        optimizer = new TokenOptimizer({
            maxTokens: 1000,
            logLevel: 'error'
        });
    });
    afterEach(() => {
        optimizer.clearCache();
    });
    const createMockResult = (override = {}) => ({
        id: 1,
        type: 'function',
        name: 'testFunction',
        content: 'function test() { return "hello"; }',
        filePath: '/test/file.ts',
        startLine: 1,
        endLine: 3,
        language: 'typescript',
        imports: [],
        exports: [],
        relevance: 0.8,
        distance: 0.2,
        ...override
    });
    describe('Search Results Optimization', () => {
        it('should format search results properly', () => {
            const results = [
                createMockResult({
                    name: 'calculateTotal',
                    content: 'function calculateTotal(items) { return items.reduce((sum, item) => sum + item.price, 0); }',
                    relevance: 0.9,
                    filePath: '/src/utils.js',
                    language: 'javascript'
                }),
                createMockResult({
                    name: 'validateUser',
                    content: 'function validateUser(user) { return user && user.email; }',
                    relevance: 0.7,
                    filePath: '/src/auth.js',
                    language: 'javascript'
                })
            ];
            const optimized = optimizer.optimizeSearchResults(results, 'calculation functions');
            expect(optimized.content[0].text).toContain('# Search Results for: "calculation functions"');
            expect(optimized.content[0].text).toContain('calculateTotal');
            expect(optimized.content[0].text).toContain('validateUser');
            expect(optimized.content[0].text).toContain('90.0% match');
            expect(optimized.content[0].text).toContain('70.0% match');
        });
        it('should handle empty results', () => {
            const optimized = optimizer.optimizeSearchResults([], 'nonexistent');
            expect(optimized.content[0].text).toContain('No results found for: "nonexistent"');
            expect(optimized.originalTokens).toBe(0);
            expect(optimized.chunksIncluded).toBe(0);
            expect(optimized.chunksExcluded).toBe(0);
        });
        it('should sort results by relevance', () => {
            const results = [
                createMockResult({ relevance: 0.5, name: 'lowRelevance' }),
                createMockResult({ relevance: 0.9, name: 'highRelevance' }),
                createMockResult({ relevance: 0.7, name: 'mediumRelevance' })
            ];
            const optimized = optimizer.optimizeSearchResults(results, 'test');
            const text = optimized.content[0].text;
            const highPos = text.indexOf('highRelevance');
            const medPos = text.indexOf('mediumRelevance');
            const lowPos = text.indexOf('lowRelevance');
            expect(highPos).toBeLessThan(medPos);
            expect(medPos).toBeLessThan(lowPos);
        });
        it('should exclude results when token limit is exceeded', () => {
            const smallOptimizer = new TokenOptimizer({ maxTokens: 100 });
            const largeContent = 'x'.repeat(1000); // Very large content
            const results = [
                createMockResult({ content: largeContent, name: 'function1' }),
                createMockResult({ content: largeContent, name: 'function2' }),
                createMockResult({ content: largeContent, name: 'function3' })
            ];
            const optimized = smallOptimizer.optimizeSearchResults(results, 'test');
            expect(optimized.chunksExcluded).toBeGreaterThan(0);
            expect(optimized.content[0].text).toContain('Additional Files');
        });
    });
    describe('Context Optimization', () => {
        it('should build context with file grouping', () => {
            const chunks = [
                createMockResult({
                    filePath: '/src/auth.ts',
                    name: 'validateUser',
                    content: 'function validateUser(user: User) { return user.isValid; }'
                }),
                createMockResult({
                    filePath: '/src/auth.ts',
                    name: 'authenticateUser',
                    content: 'function authenticateUser(token: string) { return jwt.verify(token); }'
                }),
                createMockResult({
                    filePath: '/src/utils.ts',
                    name: 'formatDate',
                    content: 'function formatDate(date: Date) { return date.toISOString(); }'
                })
            ];
            const optimized = optimizer.optimizeContext(chunks);
            expect(optimized.content[0].text).toContain('# Code Context');
            expect(optimized.content[0].text).toContain('## File: /src/auth.ts');
            expect(optimized.content[0].text).toContain('## File: /src/utils.ts');
            expect(optimized.content[0].text).toContain('validateUser');
            expect(optimized.content[0].text).toContain('authenticateUser');
            expect(optimized.content[0].text).toContain('formatDate');
        });
        it('should handle empty context', () => {
            const optimized = optimizer.optimizeContext([]);
            expect(optimized.content[0].text).toBe('No context available');
        });
    });
    describe('Code Compression', () => {
        it('should remove comments', () => {
            const code = `
// This is a comment
function test() {
  /* Multi-line
     comment */
  return 42; // End comment
}
`;
            const compressed = optimizer.removeComments(code);
            expect(compressed).not.toContain('This is a comment');
            expect(compressed).not.toContain('Multi-line');
            expect(compressed).not.toContain('End comment');
            expect(compressed).toContain('function test()');
            expect(compressed).toContain('return 42;');
        });
        it('should remove empty lines', () => {
            const code = `
function test() {

  return 42;

}

`;
            const compressed = optimizer.removeEmptyLines(code);
            expect(compressed.split('\n').filter(line => line.trim() === '')).toHaveLength(0);
        });
        it('should simplify whitespace while preserving structure', () => {
            const code = `
function    test(  a,   b  ) {
  if   (  a   >   b  ) {
    return    a   +   b;
  }
}
`;
            const simplified = optimizer.simplifyWhitespace(code);
            expect(simplified).toContain('function test( a, b ) {');
            expect(simplified).toContain('if ( a > b ) {');
            expect(simplified).toContain('return a + b;');
        });
        it('should intelligently truncate long functions', () => {
            const longCode = 'function test() {\n' +
                Array(100).fill('  console.log("line");').join('\n') +
                '\n}';
            const truncated = optimizer.intelligentTruncate(longCode, 200);
            expect(truncated).toContain('function test()');
            expect(truncated).toContain('... ');
            expect(truncated).toContain('lines omitted');
            expect(truncated).toContain('}');
        });
    });
    describe('Token Estimation', () => {
        it('should estimate tokens approximately', () => {
            const shortText = 'hello world';
            const longText = 'a'.repeat(1000);
            const shortTokens = optimizer.estimateTokens(shortText);
            const longTokens = optimizer.estimateTokens(longText);
            expect(shortTokens).toBeGreaterThan(0);
            expect(longTokens).toBeGreaterThan(shortTokens);
            expect(longTokens).toBeCloseTo(250, 50); // ~4 chars per token
        });
    });
    describe('Chunk Prioritization', () => {
        it('should prioritize by relevance first', () => {
            const chunks = [
                createMockResult({ relevance: 0.5, type: 'function' }),
                createMockResult({ relevance: 0.9, type: 'generic' }),
                createMockResult({ relevance: 0.7, type: 'class' })
            ];
            const prioritized = optimizer.prioritizeChunks(chunks);
            expect(prioritized[0].relevance).toBe(0.9);
            expect(prioritized[1].relevance).toBe(0.7);
            expect(prioritized[2].relevance).toBe(0.5);
        });
        it('should prioritize by type when relevance is similar', () => {
            const chunks = [
                createMockResult({ relevance: 0.8, type: 'generic' }),
                createMockResult({ relevance: 0.8, type: 'function' }),
                createMockResult({ relevance: 0.8, type: 'class' })
            ];
            const prioritized = optimizer.prioritizeChunks(chunks);
            expect(prioritized[0].type).toBe('function');
            expect(prioritized[1].type).toBe('class');
            expect(prioritized[2].type).toBe('generic');
        });
        it('should consider chunk size appropriately', () => {
            const chunks = [
                createMockResult({
                    relevance: 0.8,
                    type: 'function',
                    startLine: 1,
                    endLine: 3 // Small chunk
                }),
                createMockResult({
                    relevance: 0.8,
                    type: 'function',
                    startLine: 1,
                    endLine: 50 // Medium chunk
                }),
                createMockResult({
                    relevance: 0.8,
                    type: 'function',
                    startLine: 1,
                    endLine: 200 // Large chunk
                })
            ];
            const prioritized = optimizer.prioritizeChunks(chunks);
            // Medium-sized chunk should be prioritized
            expect(prioritized[0].endLine).toBe(50);
        });
    });
    describe('Cache Management', () => {
        it('should clear cache', () => {
            // Set up some cache state (implementation specific)
            optimizer.clearCache();
            // Should not throw and should clear internal caches
            expect(() => optimizer.clearCache()).not.toThrow();
        });
    });
    describe('Compression Ratio Calculation', () => {
        it('should calculate compression ratio correctly', () => {
            const results = [
                createMockResult({
                    content: 'x'.repeat(400) // 400 chars ≈ 100 tokens
                })
            ];
            const optimized = optimizer.optimizeSearchResults(results, 'test', 50); // Very low limit
            expect(optimized.compressionRatio).toBeGreaterThan(0);
            expect(optimized.compressionRatio).toBeLessThan(1);
            expect(optimized.optimizedTokens).toBeLessThan(optimized.originalTokens);
        });
    });
    describe('Configuration Edge Cases', () => {
        it('should handle extreme configuration values', () => {
            const extremeConfig = {
                maxTokens: 1,
                compressionRatio: 0.001,
                preserveStructure: false,
                includeMetadata: false
            };
            const extremeOptimizer = new TokenOptimizer(extremeConfig);
            const results = [createMockResult()];
            expect(() => extremeOptimizer.optimizeSearchResults(results, 'test')).not.toThrow();
        });
        it('should use default configuration when not provided', () => {
            const defaultOptimizer = new TokenOptimizer();
            const results = [createMockResult()];
            const optimized = defaultOptimizer.optimizeSearchResults(results, 'test');
            expect(optimized).toBeDefined();
            expect(optimized.content).toBeDefined();
        });
        it('should handle partial configuration', () => {
            const partialOptimizer = new TokenOptimizer({ maxTokens: 500 });
            const results = [createMockResult()];
            const optimized = partialOptimizer.optimizeSearchResults(results, 'test');
            expect(optimized.optimizedTokens).toBeLessThanOrEqual(500);
        });
    });
    describe('Large Dataset Handling', () => {
        it('should handle many search results efficiently', () => {
            const results = Array.from({ length: 1000 }, (_, i) => createMockResult({
                id: i,
                name: `function${i}`,
                content: `function test${i}() { return ${i}; }`,
                relevance: Math.random()
            }));
            const start = Date.now();
            const optimized = optimizer.optimizeSearchResults(results, 'test functions');
            const duration = Date.now() - start;
            expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
            expect(optimized.content[0].text).toContain('Search Results for');
            expect(optimized.chunksIncluded + optimized.chunksExcluded).toBe(1000);
        });
        it('should handle very large individual results', () => {
            const largeContent = Array.from({ length: 1000 }, (_, i) => `  const variable${i} = "This is a very long line of code with lots of content";`).join('\n');
            const results = [createMockResult({
                    content: largeContent,
                    name: 'largeFunction',
                    startLine: 1,
                    endLine: 1000
                })];
            const optimized = optimizer.optimizeSearchResults(results, 'large function');
            expect(optimized.content[0].text).toContain('largeFunction');
            expect(optimized.optimizedTokens).toBeLessThan(optimized.originalTokens);
        });
    });
    describe('Language-Specific Compression', () => {
        it('should handle Python code compression', () => {
            const pythonCode = `
# This is a Python function
def calculate_fibonacci(n):
    """Calculate fibonacci number recursively."""
    if n <= 1:
        return n
    else:
        return calculate_fibonacci(n-1) + calculate_fibonacci(n-2)

# Another function
def factorial(n):
    """Calculate factorial."""
    if n == 0:
        return 1
    else:
        return n * factorial(n-1)
`;
            const results = [createMockResult({
                    content: pythonCode,
                    language: 'python',
                    name: 'math_functions'
                })];
            const optimized = optimizer.optimizeSearchResults(results, 'python math');
            expect(optimized.content[0].text).toContain('```python');
            expect(optimized.content[0].text).toContain('calculate_fibonacci');
            expect(optimized.content[0].text).not.toContain('# This is a Python function');
        });
        it('should handle JavaScript/TypeScript code compression', () => {
            const jsCode = `
// TypeScript interface
interface User {
  id: number;
  name: string;
  email: string;
}

/* 
 * Multi-line comment
 * about the function
 */
function validateUser(user: User): boolean {
  // Check if user is valid
  return user && user.email && user.name;
}

// Export the function
export { validateUser };
`;
            const results = [createMockResult({
                    content: jsCode,
                    language: 'typescript',
                    name: 'user_validation'
                })];
            const optimized = optimizer.optimizeSearchResults(results, 'user validation');
            expect(optimized.content[0].text).toContain('```typescript');
            expect(optimized.content[0].text).toContain('interface User');
            expect(optimized.content[0].text).not.toContain('Multi-line comment');
        });
        it('should handle mixed language results', () => {
            const results = [
                createMockResult({
                    content: 'function jsFunc() { /* comment */ return true; }',
                    language: 'javascript',
                    name: 'jsFunction'
                }),
                createMockResult({
                    content: 'def py_func():\n    # comment\n    return True',
                    language: 'python',
                    name: 'pyFunction'
                }),
                createMockResult({
                    content: 'public class JavaClass {\n    // comment\n    public void method() {}\n}',
                    language: 'java',
                    name: 'JavaClass'
                })
            ];
            const optimized = optimizer.optimizeSearchResults(results, 'mixed languages');
            expect(optimized.content[0].text).toContain('```javascript');
            expect(optimized.content[0].text).toContain('```python');
            expect(optimized.content[0].text).toContain('```java');
        });
    });
    describe('Error Handling and Edge Cases', () => {
        it('should handle null and undefined query gracefully', () => {
            const results = [createMockResult()];
            expect(() => optimizer.optimizeSearchResults(results, null)).not.toThrow();
            expect(() => optimizer.optimizeSearchResults(results, undefined)).not.toThrow();
            expect(() => optimizer.optimizeSearchResults(results, '')).not.toThrow();
        });
        it('should handle results with malformed data', () => {
            const malformedResults = [
                { ...createMockResult(), content: null },
                { ...createMockResult(), name: undefined },
                { ...createMockResult(), relevance: 'invalid' },
                { ...createMockResult(), startLine: -1, endLine: -5 }
            ];
            expect(() => optimizer.optimizeSearchResults(malformedResults, 'test')).not.toThrow();
        });
        it('should handle extremely long file paths', () => {
            const longPath = '/very/long/path/to/file/' + 'subdirectory/'.repeat(100) + 'file.ts';
            const result = createMockResult({ filePath: longPath });
            const optimized = optimizer.optimizeSearchResults([result], 'test');
            expect(optimized.content[0].text).toContain(longPath);
        });
        it('should handle special characters in code content', () => {
            const specialContent = `
function test() {
  const emoji = "🎉";
  const unicode = "测试";
  const symbols = "!@#$%^&*()";
  const quotes = 'single' + "double" + \`template\`;
  return \`\${emoji} \${unicode} \${symbols}\`;
}
`;
            const result = createMockResult({ content: specialContent });
            const optimized = optimizer.optimizeSearchResults([result], 'special chars');
            expect(optimized.content[0].text).toContain('emoji');
            expect(optimized.content[0].text).toContain('unicode');
        });
        it('should handle code with nested structures', () => {
            const nestedCode = `
class OuterClass {
  constructor() {
    this.inner = {
      method: function() {
        return {
          nested: {
            deep: {
              value: "deeply nested"
            }
          }
        };
      }
    };
  }
}
`;
            const result = createMockResult({ content: nestedCode });
            const optimized = optimizer.optimizeSearchResults([result], 'nested structures');
            expect(optimized.content[0].text).toContain('OuterClass');
            expect(optimized.optimizedTokens).toBeLessThan(optimized.originalTokens);
        });
    });
    describe('Performance Optimization', () => {
        it('should optimize token usage effectively', () => {
            const longResults = Array.from({ length: 50 }, (_, i) => createMockResult({
                content: 'x'.repeat(1000) + `\n// Function ${i}`,
                name: `function${i}`,
                relevance: 0.8 - (i * 0.01) // Decreasing relevance
            }));
            const optimized = optimizer.optimizeSearchResults(longResults, 'test', 500);
            expect(optimized.optimizedTokens).toBeLessThanOrEqual(500);
            expect(optimized.compressionRatio).toBeLessThan(0.8); // Should achieve good compression
            expect(optimized.chunksIncluded).toBeGreaterThan(0);
        });
        it('should prioritize high-relevance content', () => {
            const results = [
                createMockResult({
                    relevance: 0.9,
                    name: 'highRelevance',
                    content: 'function highRelevance() { return "important"; }'
                }),
                createMockResult({
                    relevance: 0.1,
                    name: 'lowRelevance',
                    content: 'function lowRelevance() { return "less important"; }'
                })
            ];
            const optimized = optimizer.optimizeSearchResults(results, 'test', 100); // Very limited tokens
            expect(optimized.content[0].text.indexOf('highRelevance'))
                .toBeLessThan(optimized.content[0].text.indexOf('lowRelevance'));
        });
    });
    describe('Context Building', () => {
        it('should build context with proper file organization', () => {
            const chunks = [
                createMockResult({
                    filePath: '/src/auth/login.ts',
                    name: 'login',
                    content: 'export function login(user: string) { return authenticate(user); }'
                }),
                createMockResult({
                    filePath: '/src/auth/login.ts',
                    name: 'authenticate',
                    content: 'function authenticate(user: string) { return user === "admin"; }'
                }),
                createMockResult({
                    filePath: '/src/utils/helpers.ts',
                    name: 'formatDate',
                    content: 'export function formatDate(date: Date) { return date.toISOString(); }'
                })
            ];
            const context = optimizer.optimizeContext(chunks);
            expect(context.content[0].text).toContain('# Code Context');
            expect(context.content[0].text).toContain('## File: /src/auth/login.ts');
            expect(context.content[0].text).toContain('## File: /src/utils/helpers.ts');
        });
        it('should handle context optimization with token limits', () => {
            const chunks = Array.from({ length: 20 }, (_, i) => createMockResult({
                filePath: `/src/file${i}.ts`,
                name: `function${i}`,
                content: 'x'.repeat(500) // Large content
            }));
            const context = optimizer.optimizeContext(chunks, 1000); // Limited tokens
            expect(context.content[0].text).toContain('# Code Context');
            // Should include some but not all files due to token limit
        });
    });
    describe('Truncation Strategies', () => {
        it('should intelligently truncate long functions', () => {
            const longFunction = 'function longFunc() {\n' +
                Array.from({ length: 200 }, (_, i) => `  const line${i} = ${i};`).join('\n') +
                '\n  return "end";\n}';
            const result = createMockResult({ content: longFunction });
            const optimized = optimizer.optimizeSearchResults([result], 'test', 100);
            expect(optimized.content[0].text).toContain('longFunc');
            expect(optimized.content[0].text).toContain('... ');
            expect(optimized.content[0].text).toContain('omitted');
        });
        it('should preserve important parts of functions during truncation', () => {
            const functionWithImportantParts = `
function importantFunction() {
  // This is the start
  const important = "keep this";
  
  ${Array.from({ length: 100 }, (_, i) => `  const filler${i} = ${i};`).join('\n')}
  
  return important; // This is the end
}
`;
            const result = createMockResult({ content: functionWithImportantParts });
            const optimized = optimizer.optimizeSearchResults([result], 'test', 150);
            const text = optimized.content[0].text;
            expect(text).toContain('importantFunction');
            expect(text).toContain('return important');
        });
    });
    describe('Memory and Cache Management', () => {
        it('should handle cache clearing without errors', () => {
            // Build up some internal cache state
            const results = Array.from({ length: 10 }, (_, i) => createMockResult({ id: i }));
            optimizer.optimizeSearchResults(results, 'test');
            expect(() => optimizer.clearCache()).not.toThrow();
            // Should still work after cache clear
            const optimized = optimizer.optimizeSearchResults(results, 'test');
            expect(optimized).toBeDefined();
        });
        it('should handle memory-intensive operations', () => {
            const memoryIntensiveResults = Array.from({ length: 100 }, (_, i) => createMockResult({
                content: 'x'.repeat(10000), // 10KB per result
                name: `largeFunction${i}`
            }));
            expect(() => {
                const optimized = optimizer.optimizeSearchResults(memoryIntensiveResults, 'memory test');
                expect(optimized.chunksIncluded + optimized.chunksExcluded).toBe(100);
            }).not.toThrow();
        });
    });
    describe('Token Estimation Accuracy', () => {
        it('should provide reasonable token estimates', () => {
            const testCases = [
                { text: 'hello world', expectedRange: [2, 4] },
                { text: 'function test() { return 42; }', expectedRange: [6, 12] },
                { text: 'x'.repeat(100), expectedRange: [20, 30] },
                { text: '', expectedRange: [0, 1] }
            ];
            testCases.forEach(({ text, expectedRange }) => {
                const tokens = optimizer.estimateTokens(text);
                expect(tokens).toBeGreaterThanOrEqual(expectedRange[0]);
                expect(tokens).toBeLessThanOrEqual(expectedRange[1]);
            });
        });
        it('should handle token estimation for various languages', () => {
            const codeExamples = {
                javascript: 'const result = array.map(x => x * 2).filter(x => x > 10);',
                python: 'result = [x * 2 for x in array if x > 5]',
                java: 'List<Integer> result = array.stream().map(x -> x * 2).collect(Collectors.toList());',
                sql: 'SELECT * FROM users WHERE age > 18 AND status = "active";'
            };
            Object.entries(codeExamples).forEach(([language, code]) => {
                const tokens = optimizer.estimateTokens(code);
                expect(tokens).toBeGreaterThan(0);
                expect(typeof tokens).toBe('number');
            });
        });
    });
    describe('Excluded Content Summary', () => {
        it('should create meaningful summaries for excluded content', () => {
            const manyResults = Array.from({ length: 20 }, (_, i) => createMockResult({
                name: `function${i}`,
                filePath: `/path/file${i}.ts`,
                relevance: 0.5,
                startLine: i * 10,
                endLine: (i * 10) + 5
            }));
            const optimized = optimizer.optimizeSearchResults(manyResults, 'test', 200); // Force exclusions
            if (optimized.chunksExcluded > 0) {
                expect(optimized.content[0].text).toContain('Additional Files');
                expect(optimized.content[0].text).toContain('more results');
            }
        });
        it('should limit excluded summary length appropriately', () => {
            const manyResults = Array.from({ length: 100 }, (_, i) => createMockResult({
                name: `function${i}`,
                filePath: `/very/long/path/to/file/number${i}.ts`,
                relevance: 0.1
            }));
            const optimized = optimizer.optimizeSearchResults(manyResults, 'test', 100);
            // Summary should not be longer than the main content
            const summaryStart = optimized.content[0].text.indexOf('Additional Files');
            if (summaryStart > -1) {
                const summaryLength = optimized.content[0].text.length - summaryStart;
                const mainContentLength = summaryStart;
                expect(summaryLength).toBeLessThan(mainContentLength);
            }
        });
    });
});
//# sourceMappingURL=TokenOptimizer.test.js.map