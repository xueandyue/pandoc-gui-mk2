import assert from 'node:assert/strict';

import {
  buildOutputPath,
  deriveTauriFileState,
  ensureTrailingSeparator,
  getSyntaxHighlightingArgument
} from '../src/command-utils.js';

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

runTest('deriveTauriFileState handles Windows paths', () => {
  const state = deriveTauriFileState('C:\\Users\\jian\\Desktop\\notes\\report.md');

  assert.equal(state.inputFileName, 'report.md');
  assert.equal(state.outputDirPath, 'C:\\Users\\jian\\Desktop\\notes\\');
  assert.equal(state.outputName, 'report');
});

runTest('deriveTauriFileState handles POSIX paths', () => {
  const state = deriveTauriFileState('/Users/jian/Desktop/report.md');

  assert.equal(state.inputFileName, 'report.md');
  assert.equal(state.outputDirPath, '/Users/jian/Desktop/');
  assert.equal(state.outputName, 'report');
});

runTest('ensureTrailingSeparator preserves Windows separator', () => {
  assert.equal(ensureTrailingSeparator('C:\\Users\\jian\\Desktop'), 'C:\\Users\\jian\\Desktop\\');
});

runTest('buildOutputPath does not prefix dot-slash onto absolute Windows paths', () => {
  const outputPath = buildOutputPath('C:\\Users\\jian\\Desktop\\', 'report', 'html');

  assert.equal(outputPath, 'C:\\Users\\jian\\Desktop\\report.html');
});

runTest('buildOutputPath falls back to relative path when output directory is empty', () => {
  assert.equal(buildOutputPath('', 'report', 'html'), './report.html');
});

runTest('getSyntaxHighlightingArgument uses non-deprecated pandoc flag', () => {
  assert.equal(getSyntaxHighlightingArgument('breezedark'), '--syntax-highlighting=breezedark');
  assert.equal(getSyntaxHighlightingArgument('none'), null);
});

console.log('All command utility regression tests passed.');
