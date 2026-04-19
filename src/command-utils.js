export function detectPathSeparator(path = '') {
  const lastForwardSlash = path.lastIndexOf('/');
  const lastBackslash = path.lastIndexOf('\\');
  return lastBackslash > lastForwardSlash ? '\\' : '/';
}

export function ensureTrailingSeparator(path = '') {
  if (!path) return '';
  if (/[\\/]+$/.test(path)) return path;
  return `${path}${detectPathSeparator(path)}`;
}

export function splitFilePath(filePath = '') {
  const lastForwardSlash = filePath.lastIndexOf('/');
  const lastBackslash = filePath.lastIndexOf('\\');
  const lastSeparator = Math.max(lastForwardSlash, lastBackslash);

  if (lastSeparator === -1) {
    return { dir: '', base: filePath };
  }

  return {
    dir: filePath.slice(0, lastSeparator + 1),
    base: filePath.slice(lastSeparator + 1)
  };
}

export function stripExtension(fileName = '') {
  return fileName.replace(/\.[^./\\]+$/, '');
}

export function deriveTauriFileState(filePath) {
  const { dir, base } = splitFilePath(filePath);
  const inputFileName = base || filePath;

  return {
    inputFileName,
    outputDirPath: dir,
    outputName: stripExtension(inputFileName)
  };
}

export function buildOutputPath(outputDirPath, outName, ext) {
  const fileName = `${outName}.${ext}`;

  if (!outputDirPath) {
    return `./${fileName}`;
  }

  return `${ensureTrailingSeparator(outputDirPath)}${fileName}`;
}

export function getSyntaxHighlightingArgument(theme) {
  if (!theme || theme === 'none') {
    return null;
  }

  return `--syntax-highlighting=${theme}`;
}
