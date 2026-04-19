import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function resolveRepoRoot() {
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), '..');
}

function canExecute(command, args = ['--version']) {
  const result = spawnSync(command, args, { stdio: 'pipe', encoding: 'utf8' });
  return result.status === 0;
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function resolvePandocExecutable(repoRoot) {
  if (process.env.PANDOC_TEST_BIN) {
    return process.env.PANDOC_TEST_BIN;
  }

  const bundledCandidates = [];
  if (process.platform === 'win32' && process.arch === 'x64') {
    bundledCandidates.push(path.join(repoRoot, 'src-tauri', 'resources', 'pandoc', 'windows-x64', 'pandoc.exe'));
  } else if (process.platform === 'linux' && process.arch === 'x64') {
    bundledCandidates.push(path.join(repoRoot, 'src-tauri', 'resources', 'pandoc', 'linux-x64', 'pandoc'));
  } else if (process.platform === 'darwin' && process.arch === 'x64') {
    bundledCandidates.push(path.join(repoRoot, 'src-tauri', 'resources', 'pandoc', 'macos-x64', 'pandoc'));
  } else if (process.platform === 'darwin' && process.arch === 'arm64') {
    bundledCandidates.push(path.join(repoRoot, 'src-tauri', 'resources', 'pandoc', 'macos-aarch64', 'pandoc'));
  }

  for (const candidate of bundledCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  if (canExecute('pandoc')) {
    return 'pandoc';
  }

  return null;
}

function resolvePdfEngine() {
  const repoRoot = resolveRepoRoot();

  if (process.env.PANDOC_TEST_PDF_ENGINE && canExecute(process.env.PANDOC_TEST_PDF_ENGINE)) {
    return process.env.PANDOC_TEST_PDF_ENGINE;
  }

  const bundledCandidates = [];
  if (process.platform === 'win32' && process.arch === 'x64') {
    bundledCandidates.push(path.join(repoRoot, 'src-tauri', 'resources', 'tectonic', 'windows-x64', 'tectonic.exe'));
  }

  for (const candidate of bundledCandidates) {
    if (fs.existsSync(candidate) && canExecute(candidate)) {
      return candidate;
    }
  }

  for (const candidate of ['tectonic', 'xelatex', 'lualatex', 'pdflatex']) {
    if (canExecute(candidate)) {
      return candidate;
    }
  }

  return null;
}

const repoRoot = resolveRepoRoot();
const pandocBin = resolvePandocExecutable(repoRoot);

if (!pandocBin) {
  console.log('SKIP pandoc integration: no pandoc binary available for this platform');
  console.log('Pandoc integration regression test completed.');
  process.exit(0);
}

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pandoc-gui-integration-'));
}

function readFixture() {
  return fs.readFileSync(path.join(repoRoot, 'test', 'fixtures', 'sample.md'), 'utf8');
}

function runPandoc(args, message) {
  const result = spawnSync(pandocBin, args, { stdio: 'pipe', encoding: 'utf8' });

  if (result.error) {
    throw result.error;
  }

  assert.equal(result.status, 0, message || result.stderr || result.stdout || 'pandoc conversion failed');
  return result;
}

function assertZipArtifactExists(outputPath) {
  assert.equal(fs.existsSync(outputPath), true, `expected output file to exist: ${outputPath}`);
  const fileBuffer = fs.readFileSync(outputPath);
  assert.equal(fileBuffer.subarray(0, 2).toString('utf8'), 'PK', 'expected ZIP-based pandoc output');
}

function assertTextArtifactContains(outputPath, patterns) {
  assert.equal(fs.existsSync(outputPath), true, `expected output file to exist: ${outputPath}`);
  const content = fs.readFileSync(outputPath, 'utf8');
  for (const pattern of patterns) {
    assert.match(content, pattern);
  }
}

runTest('pandoc converts a real markdown fixture into html', () => {
  const tempDir = createTempDir();
  const inputPath = path.join(repoRoot, 'test', 'fixtures', 'sample.md');
  const outputPath = path.join(tempDir, 'sample.html');

  try {
    runPandoc(
      [inputPath, '-t', 'html', '-o', outputPath, '-s', '--syntax-highlighting=breezedark'],
      'html conversion failed'
    );

    assertTextArtifactContains(outputPath, [
      /<h1[^>]*>\s*Integration Test Title\s*<\/h1>/,
      /pandoc integration test/,
      /UTF-8/
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('pandoc converts a real markdown fixture into docx', () => {
  const tempDir = createTempDir();
  const inputPath = path.join(repoRoot, 'test', 'fixtures', 'sample.md');
  const outputPath = path.join(tempDir, 'sample.docx');

  try {
    runPandoc([inputPath, '-t', 'docx', '-o', outputPath, '-s'], 'docx conversion failed');
    assertZipArtifactExists(outputPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('pandoc converts a real markdown fixture into epub', () => {
  const tempDir = createTempDir();
  const inputPath = path.join(repoRoot, 'test', 'fixtures', 'sample.md');
  const outputPath = path.join(tempDir, 'sample.epub');

  try {
    runPandoc([inputPath, '-t', 'epub', '-o', outputPath, '-s'], 'epub conversion failed');
    assertZipArtifactExists(outputPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('pandoc converts a real markdown fixture into latex', () => {
  const tempDir = createTempDir();
  const inputPath = path.join(repoRoot, 'test', 'fixtures', 'sample.md');
  const outputPath = path.join(tempDir, 'sample.tex');

  try {
    runPandoc([inputPath, '-t', 'latex', '-o', outputPath, '-s'], 'latex conversion failed');
    assertTextArtifactContains(outputPath, [
      /Integration Test Title/,
      /pandoc integration test/,
      /\\subsection\{Subheading\}/
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('pandoc converts files from Chinese and space-containing paths', () => {
  const tempDir = createTempDir();
  const nestedInputDir = path.join(tempDir, '中文 路径', '带 空格');
  const nestedOutputDir = path.join(tempDir, '输出 目录', '中文 结果');
  const inputPath = path.join(nestedInputDir, '测试 文档.md');
  const outputPath = path.join(nestedOutputDir, '测试 文档.html');

  try {
    fs.mkdirSync(nestedInputDir, { recursive: true });
    ensureParentDir(outputPath);
    fs.writeFileSync(inputPath, readFixture(), 'utf8');

    runPandoc(
      [inputPath, '-t', 'html', '-o', outputPath, '-s', '--syntax-highlighting=breezedark'],
      'conversion with Chinese and spaced paths failed'
    );

    assertTextArtifactContains(outputPath, [
      /<h1[^>]*>\s*Integration Test Title\s*<\/h1>/,
      /pandoc integration test/
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('pandoc supports absolute output paths on Windows', () => {
  const tempDir = createTempDir();
  const inputPath = path.join(repoRoot, 'test', 'fixtures', 'sample.md');
  const outputPath = path.resolve(tempDir, 'absolute-output', 'sample-absolute.html');

  try {
    ensureParentDir(outputPath);
    runPandoc(
      [inputPath, '-t', 'html', '-o', outputPath, '-s', '--syntax-highlighting=breezedark'],
      'conversion with absolute output path failed'
    );

    assertTextArtifactContains(outputPath, [
      /<h1[^>]*>\s*Integration Test Title\s*<\/h1>/,
      /pandoc integration test/
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('pandoc converts markdown into pdf when a PDF engine is available', () => {
  const pdfEngine = resolvePdfEngine();
  if (!pdfEngine) {
    console.log('SKIP pdf integration: no supported PDF engine available');
    return;
  }

  const tempDir = createTempDir();
  const inputPath = path.join(tempDir, 'pdf-smoke.md');
  const outputPath = path.join(tempDir, 'pdf-smoke.pdf');
  const pdfFixture = [
    '# PDF Integration Test',
    '',
    'This PDF fixture intentionally stays ASCII-only so it works across engines.',
    '',
    '- alpha',
    '- beta'
  ].join('\n');

  try {
    fs.writeFileSync(inputPath, pdfFixture, 'utf8');
    runPandoc(
      [inputPath, '-t', 'pdf', '-o', outputPath, '-s', `--pdf-engine=${pdfEngine}`],
      `pdf conversion failed with engine ${pdfEngine}`
    );

    assert.equal(fs.existsSync(outputPath), true, `expected output file to exist: ${outputPath}`);
    assert.ok(fs.statSync(outputPath).size > 0, 'expected generated PDF to be non-empty');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

console.log('Pandoc integration regression test completed.');
