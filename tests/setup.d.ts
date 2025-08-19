export declare const delay: (ms: number) => Promise<unknown>;
export declare const mockFileSystem: {
    '/test/file1.ts': string;
    '/test/file2.py': string;
    '/test/file3.js': string;
};
export declare const createMockChunk: (overrides?: {}) => {
    id: string;
    type: "function";
    name: string;
    content: string;
    filePath: string;
    startLine: number;
    endLine: number;
    language: string;
    imports: never[];
    exports: never[];
    metadata: {};
};
//# sourceMappingURL=setup.d.ts.map