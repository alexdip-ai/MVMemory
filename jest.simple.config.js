export default {
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  preset: 'ts-jest/presets/default-esm',
  
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true
    }]
  },
  
  moduleNameMapping: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  
  testMatch: [
    '**/tests/unit/CacheManager.test.ts'
  ],
  
  collectCoverageFrom: [
    'src/optimization/CacheManager.ts'
  ]
};