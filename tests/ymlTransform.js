// Jest transform for .yml/.yaml files: exposes the file content as the default export,
// matching webpack's `asset/source` rule.
module.exports = {
  process(sourceText) {
    return { code: `module.exports = ${JSON.stringify(sourceText)};` };
  },
};
