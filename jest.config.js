/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  testMatch: ["**/tests/**/*.test.ts", "**/tests/**/*.test.tsx"],
  setupFilesAfterEnv: ["@testing-library/jest-dom"],
  // Webpack loads .css/.yml as plain strings (asset/source); mirror that in jest.
  moduleNameMapper: {
    "\\.(css|less)$": "<rootDir>/tests/styleStub.js",
  },
  transform: {
    "\\.(ya?ml)$": "<rootDir>/tests/ymlTransform.js",
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "CommonJS",
          strict: true,
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          resolveJsonModule: true,
          skipLibCheck: true,
        },
      },
    ],
  },
};
