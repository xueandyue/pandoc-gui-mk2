import {
  buildOutputPath,
  deriveTauriFileState,
  ensureTrailingSeparator,
  getSyntaxHighlightingArgument
} from './command-utils.js';

// Pandoc GUI v2 - Main Application Logic

// State
let inputFilePath = null;
let inputFileName = null;
let inputFileContent = null;
let outputDirPath = null;
let isTauri = false;

// Dependency availability state
const installedDeps = {
  pandoc: false,
  tectonic: false,
  texlive: false,  // Consolidated: includes pdflatex, xelatex, lualatex
  'mermaid-filter': false,
  'pandoc-crossref': false
};

// Track active event listener to prevent leaks
let activeDepListener = null;

// Detect Tauri environment
async function detectTauri() {
  try {
    // In Tauri v2, we check if the core module is available
    const { invoke } = await import('@tauri-apps/api/core');
    isTauri = true;
    return true;
  } catch (e) {
    isTauri = false;
    return false;
  }
}

// Font detection - populated from system fonts via queryLocalFonts() API
let systemFonts = [];
let monoFonts = [];

// Code theme colors
const themeColors = {
  'pygments': { bg: '#f8f8f8', kw: '#008000', fn: '#0000ff', st: '#ba2121', cm: '#408080' },
  'kate': { bg: '#ffffff', kw: '#1f1c1b', fn: '#644a9b', st: '#bf0303', cm: '#898887' },
  'tango': { bg: '#f8f8f8', kw: '#204a87', fn: '#000000', st: '#4e9a06', cm: '#8f5902' },
  'breezedark': { bg: '#232629', kw: '#cfcfc2', fn: '#8e44ad', st: '#f44f4f', cm: '#7a7c7d' },
  'zenburn': { bg: '#3f3f3f', kw: '#f0dfaf', fn: '#efef8f', st: '#cc9393', cm: '#7f9f7f' },
  'nord': { bg: '#2e3440', kw: '#81a1c1', fn: '#88c0d0', st: '#a3be8c', cm: '#616e88' },
  'dracula': { bg: '#282a36', kw: '#ff79c6', fn: '#50fa7b', st: '#f1fa8c', cm: '#6272a4' },
  'monokai': { bg: '#272822', kw: '#f92672', fn: '#a6e22e', st: '#e6db74', cm: '#75715e' },
  'gruvbox-dark': { bg: '#282828', kw: '#fb4934', fn: '#b8bb26', st: '#fabd2f', cm: '#928374' },
  'solarized-dark': { bg: '#002b36', kw: '#859900', fn: '#268bd2', st: '#2aa198', cm: '#586e75' },
};

// DOM helper
const $ = id => document.getElementById(id);

const LANGUAGE_STORAGE_KEY = 'appLanguage';
const DEFAULT_LANGUAGE = 'zh-CN';
let currentLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY) || DEFAULT_LANGUAGE;

const translations = {
  en: {
    'app.title': 'Pandoc GUI',
    'button.open': 'Open',
    'button.copy': 'Copy',
    'button.copyCommand': 'Copy Command',
    'button.convert': 'Convert Document',
    'button.save': 'Save',
    'button.cancel': 'Cancel',
    'button.close': 'Close',
    'button.downloadUpdate': 'Download Update',
    'button.showInFinder': 'Show in Folder',
    'button.checkUpdates': 'Check for Updates',
    'label.output': 'Output:',
    'label.outputPath': 'Output: Select input file first',
    'label.noFile': 'No file selected',
    'label.outputPlaceholder': 'output filename',
    'label.openWhenDone': 'Open when done',
    'label.layout': 'Layout',
    'label.fonts': 'Fonts',
    'label.document': 'Document',
    'label.content': 'Content',
    'label.advanced': 'Advanced',
    'label.command': 'Command',
    'label.paperSize': 'Paper Size',
    'label.orientation': 'Orientation',
    'label.fontSize': 'Font Size (pt)',
    'label.lineHeight': 'Line Height',
    'label.margins': 'Margins',
    'label.uniform': 'Uniform',
    'label.unit': 'Unit',
    'label.allSides': 'All Sides',
    'label.top': 'Top',
    'label.bottom': 'Bottom',
    'label.left': 'Left',
    'label.right': 'Right',
    'label.mainFont': 'Main Font',
    'label.monoFont': 'Monospace Font',
    'label.codeHighlighting': 'Code Highlighting',
    'label.theme': 'Theme',
    'label.lineNumbers': 'Line Numbers',
    'label.background': 'Background',
    'label.bgColor': 'BG Color',
    'label.preview': 'Preview',
    'label.titlePage': 'Title Page',
    'label.tableOfContents': 'Table of Contents',
    'label.numberSections': 'Number Sections',
    'label.listOfFigures': 'List of Figures',
    'label.listOfTables': 'List of Tables',
    'label.darkMode': 'Dark Mode',
    'label.standalone': 'Standalone',
    'label.tocDepth': 'TOC Depth:',
    'label.newPageAfterToc': 'New page after TOC',
    'label.documentClass': 'Document Class',
    'label.topLevelHeadings': 'Top-Level Headings',
    'label.tokens': 'Tokens (drag to fields)',
    'label.title': 'Title',
    'label.author': 'Author',
    'label.date': 'Date',
    'label.headers': 'Headers',
    'label.footers': 'Footers',
    'label.pageNumberFormat': 'Page Number Format',
    'label.position': 'Position',
    'label.style': 'Style',
    'label.mermaid': 'Mermaid Diagrams',
    'label.detectedSvg': 'Detected (SVG)',
    'label.coloredLinks': 'Colored links',
    'label.extraArgs': 'Extra Pandoc Arguments',
    'label.extraArgsHint': 'Advanced',
    'label.presets': 'Presets',
    'label.themeMenu': 'Theme',
    'label.languageMenu': 'Language',
    'label.loadSelected': 'Load Selected',
    'label.saveNew': 'Save New...',
    'label.updateSelected': 'Update Selected',
    'label.deleteSelected': 'Delete Selected',
    'label.dependencies': 'Dependencies',
    'label.reset': 'Reset',
    'label.about': 'About',
    'label.presetName': 'Preset Name',
    'label.savePreset': 'Save Preset',
    'label.dependencyCheck': 'Dependency Check',
    'label.checkingDependencies': 'Checking dependencies...',
    'label.installing': 'Installing...',
    'label.version': 'Version',
    'label.githubRepository': 'GitHub Repository',
    'label.frontendDeps': 'Frontend Dependencies',
    'label.backendDeps': 'Backend Dependencies (Rust)',
    'label.poweredBy': 'Powered By',
    'label.license': 'License',
    'label.updateAvailable': 'Update Available',
    'label.releaseNotes': 'Release Notes',
    'label.loading': 'Loading...',
    'label.downloadingUpdate': 'Downloading update...',
    'label.downloadComplete': 'Download complete!',
    'label.savedTo': 'Saved to:',
    'label.newVersionAvailable': 'A new version of Pandoc GUI is available!',
    'label.current': 'Current:',
    'label.latest': 'Latest:',
    'label.aboutIntro': 'A modern, cross-platform graphical user interface for Pandoc, the universal document converter.',
    'label.aboutRights': 'All rights reserved.',
    'label.licenseSummary': 'Pandoc GUI is released under the MIT License.',
    'label.systemDefault': 'System Default',
    'label.fontPermission': '(Grant font permission or use Tauri app)',
    'label.selectPreset': 'Select preset...',
    'label.enterPresetName': 'Enter preset name...',
    'label.changeOutputFolder': 'Change output folder',
    'label.removeToken': 'Remove',
    'value.portrait': 'Portrait',
    'value.landscape': 'Landscape',
    'value.single': 'Single',
    'value.double': 'Double',
    'value.light': 'Light',
    'value.dark': 'Dark',
    'value.default': 'Default',
    'value.article': 'Article',
    'value.report': 'Report',
    'value.book': 'Book',
    'value.memoir': 'Memoir',
    'value.komaArticle': 'KOMA Article',
    'value.parts': 'Parts',
    'value.chapters': 'Chapters',
    'value.sections': 'Sections',
    'value.pageN': 'Page N',
    'value.pageNOfX': 'Page N of X',
    'value.nOfX': 'N of X',
    'value.nOnly': 'N only',
    'value.bottomCenter': 'Bottom Center',
    'value.bottomRight': 'Bottom Right',
    'value.topRight': 'Top Right',
    'desc.titlePage': 'Separate title page',
    'desc.toc': 'Auto from headings',
    'desc.numberSections': '1. Intro, 1.1 Sub...',
    'desc.lof': 'Figure index',
    'desc.lot': 'Table index',
    'desc.darkMode': 'Dark background',
    'desc.standalone': 'Complete document',
    'placeholder.left': 'Left',
    'placeholder.center': 'Center',
    'placeholder.right': 'Right',
    'placeholder.page': 'Page {page}',
    'message.insertedToken': 'Inserted {token}',
    'message.commandCopied': 'Command copied to clipboard!',
    'message.commandCopyFailed': 'Failed to copy command',
    'message.selectInputFirst': 'Please select an input file first',
    'message.fileOverwrite': 'File "{file}" already exists. Overwrite?',
    'message.converting': 'Converting...',
    'message.generatingReferenceDoc': 'Generating reference document...',
    'message.preparingDarkMode': 'Preparing dark mode...',
    'message.runningPandoc': 'Running pandoc...',
    'message.finalizing': 'Finalizing...',
    'message.conversionComplete': 'Conversion complete!',
    'message.conversionSuccess': 'Document converted successfully!',
    'message.copyCommandTerminal': 'Copy the command to run in your terminal',
    'message.webModeCopy': 'In web mode, copy the command and run it in your terminal',
    'message.error': 'Error: {error}',
    'message.conversionFailed': 'Conversion failed: {error}',
    'message.openFileDialogFailed': 'Failed to open file dialog: {error}',
    'message.openFolderDialogFailed': 'Failed to open folder dialog: {error}',
    'message.outputDirDesktopOnly': 'Output directory can only be changed in desktop app',
    'message.enterPresetName': 'Please enter a preset name',
    'message.selectPresetFirst': 'Please select a preset first',
    'message.presetSaved': 'Preset "{name}" saved',
    'message.presetLoaded': 'Preset "{name}" loaded',
    'message.presetUpdated': 'Preset "{name}" updated',
    'message.deletePreset': 'Are you sure you want to delete the preset "{name}"?',
    'message.presetDeleted': 'Preset "{name}" deleted',
    'message.settingsReset': 'Settings reset to defaults',
    'message.runInstall': 'Run: brew install {name} (or npm/cargo equivalent)',
    'message.reinstallConfirm': 'Reinstall {name}? This will uninstall and reinstall the package.',
    'message.confirmReinstallTitle': 'Confirm Reinstall',
    'message.uninstallConfirm': 'Are you sure you want to uninstall {name}?',
    'message.confirmUninstallTitle': 'Confirm Uninstall',
    'message.starting': 'Starting...',
    'message.operationCancelled': 'Operation cancelled',
    'message.cancelFailed': 'Failed to cancel: {error}',
    'message.releaseNotFound': 'No releases found. You are running the latest development version.',
    'message.alreadyLatest': 'You are running the latest version!',
    'message.updateCheckFailed': 'Update check failed: {error}',
    'message.noReleaseNotes': 'No release notes available.',
    'message.noCompatibleDownload': 'No compatible download found for your platform.',
    'message.downloadFailed': 'Download failed: {error}',
    'message.updateDownloaded': 'Update downloaded successfully!',
    'message.openLocationFailed': 'Failed to open file location',
    'message.placeholderNotReplaced': 'A placeholder was not properly replaced. Please try again or contact support.',
    'message.pdfOnlyPaperSize': 'Paper size only applies to PDF and LaTeX output',
    'message.pdfOnlyOrientation': 'Orientation only applies to PDF and LaTeX output',
    'message.marginsFormats': 'Margins only apply to PDF, LaTeX, DOCX, and ODT output',
    'message.fontSettingsFormats': 'Font settings only apply to PDF, LaTeX, DOCX, and ODT output',
    'message.lineHeightFormats': 'Line height only applies to PDF and LaTeX output',
    'message.headersFootersPdf': 'Headers and footers only apply to PDF output',
    'message.pageNumbersPdf': 'Page number settings only apply to PDF output',
    'message.noPdfEngine': 'No PDF engine installed. Check Dependencies to install one.',
    'message.notInstalled': 'not installed',
    'message.mermaidNotInstalled': 'mermaid-filter not installed. Check Dependencies to install.',
    'message.crossrefNotInstalled': 'pandoc-crossref not installed. Check Dependencies to install.',
    'generic.document': 'document',
    'generic.output': 'output',
    'generic.user': 'User',
    'dep.required': 'required',
    'dep.optional': 'optional',
    'dep.pandoc.desc': 'Document converter (required)',
    'dep.tectonic.desc': 'PDF engine - auto-downloads packages (recommended)',
    'dep.texlive.desc': 'TeX Live - includes pdflatex, xelatex, lualatex',
    'dep.mermaid.desc': 'Mermaid diagram support',
    'dep.crossref.desc': 'Cross-reference filter',
    'dep.docs': 'Docs',
    'dep.reinstall': 'Reinstall',
    'dep.uninstall': 'Uninstall',
    'dep.installHomebrew': 'Install via Homebrew',
    'dep.installApt': 'Install via apt',
    'dep.installNpm': 'Install via npm',
    'dep.installCargo': 'Install via cargo'
  },
  'zh-CN': {
    'app.title': 'Pandoc 图形界面',
    'button.open': '打开',
    'button.copy': '复制',
    'button.copyCommand': '复制命令',
    'button.convert': '转换文档',
    'button.save': '保存',
    'button.cancel': '取消',
    'button.close': '关闭',
    'button.downloadUpdate': '下载更新',
    'button.showInFinder': '打开所在文件夹',
    'button.checkUpdates': '检查更新',
    'label.output': '输出:',
    'label.outputPath': '输出: 请先选择输入文件',
    'label.noFile': '未选择文件',
    'label.outputPlaceholder': '输出文件名',
    'label.openWhenDone': '完成后打开',
    'label.layout': '版式',
    'label.fonts': '字体',
    'label.document': '文档',
    'label.content': '内容',
    'label.advanced': '高级',
    'label.command': '命令',
    'label.paperSize': '纸张大小',
    'label.orientation': '方向',
    'label.fontSize': '字号 (pt)',
    'label.lineHeight': '行高',
    'label.margins': '页边距',
    'label.uniform': '统一',
    'label.unit': '单位',
    'label.allSides': '四边一致',
    'label.top': '上',
    'label.bottom': '下',
    'label.left': '左',
    'label.right': '右',
    'label.mainFont': '正文字体',
    'label.monoFont': '等宽字体',
    'label.codeHighlighting': '代码高亮',
    'label.theme': '主题',
    'label.lineNumbers': '行号',
    'label.background': '背景',
    'label.bgColor': '背景色',
    'label.preview': '预览',
    'label.titlePage': '标题页',
    'label.tableOfContents': '目录',
    'label.numberSections': '章节编号',
    'label.listOfFigures': '插图目录',
    'label.listOfTables': '表格目录',
    'label.darkMode': '深色模式',
    'label.standalone': '独立文档',
    'label.tocDepth': '目录深度:',
    'label.newPageAfterToc': '目录后新起一页',
    'label.documentClass': '文档类',
    'label.topLevelHeadings': '顶级标题层级',
    'label.tokens': '令牌（拖到字段中）',
    'label.title': '标题',
    'label.author': '作者',
    'label.date': '日期',
    'label.headers': '页眉',
    'label.footers': '页脚',
    'label.pageNumberFormat': '页码格式',
    'label.position': '位置',
    'label.style': '样式',
    'label.mermaid': 'Mermaid 图表',
    'label.detectedSvg': '已检测 (SVG)',
    'label.coloredLinks': '彩色链接',
    'label.extraArgs': '额外 Pandoc 参数',
    'label.extraArgsHint': '高级',
    'label.presets': '预设',
    'label.themeMenu': '主题',
    'label.languageMenu': '语言',
    'label.loadSelected': '加载所选',
    'label.saveNew': '另存为新预设...',
    'label.updateSelected': '更新所选',
    'label.deleteSelected': '删除所选',
    'label.dependencies': '依赖检查',
    'label.reset': '重置',
    'label.about': '关于',
    'label.presetName': '预设名称',
    'label.savePreset': '保存预设',
    'label.dependencyCheck': '依赖检查',
    'label.checkingDependencies': '正在检查依赖...',
    'label.installing': '正在安装...',
    'label.version': '版本',
    'label.githubRepository': 'GitHub 仓库',
    'label.frontendDeps': '前端依赖',
    'label.backendDeps': '后端依赖 (Rust)',
    'label.poweredBy': '技术支持',
    'label.license': '许可证',
    'label.updateAvailable': '发现更新',
    'label.releaseNotes': '发行说明',
    'label.loading': '加载中...',
    'label.downloadingUpdate': '正在下载更新...',
    'label.downloadComplete': '下载完成！',
    'label.savedTo': '保存到:',
    'label.newVersionAvailable': 'Pandoc GUI 有新版本可用！',
    'label.current': '当前:',
    'label.latest': '最新:',
    'label.aboutIntro': '一个现代化、跨平台的 Pandoc 通用文档转换器图形界面。',
    'label.aboutRights': '保留所有权利。',
    'label.licenseSummary': 'Pandoc GUI 基于 MIT 许可证发布。',
    'label.systemDefault': '系统默认',
    'label.fontPermission': '（请授权字体访问，或使用 Tauri 桌面应用）',
    'label.selectPreset': '选择预设...',
    'label.enterPresetName': '输入预设名称...',
    'label.changeOutputFolder': '更改输出文件夹',
    'label.removeToken': '移除',
    'value.portrait': '纵向',
    'value.landscape': '横向',
    'value.single': '单倍',
    'value.double': '双倍',
    'value.light': '浅色',
    'value.dark': '深色',
    'value.default': '默认',
    'value.article': '文章',
    'value.report': '报告',
    'value.book': '书籍',
    'value.memoir': '回忆录',
    'value.komaArticle': 'KOMA 文章',
    'value.parts': '部分',
    'value.chapters': '章节',
    'value.sections': '小节',
    'value.pageN': '第 N 页',
    'value.pageNOfX': '第 N / X 页',
    'value.nOfX': 'N / X',
    'value.nOnly': '仅 N',
    'value.bottomCenter': '底部居中',
    'value.bottomRight': '底部右侧',
    'value.topRight': '顶部右侧',
    'desc.titlePage': '单独生成标题页',
    'desc.toc': '根据标题自动生成',
    'desc.numberSections': '1. 引言, 1.1 小节...',
    'desc.lof': '插图索引',
    'desc.lot': '表格索引',
    'desc.darkMode': '深色背景',
    'desc.standalone': '完整文档',
    'placeholder.left': '左侧',
    'placeholder.center': '中间',
    'placeholder.right': '右侧',
    'placeholder.page': '第 {page} 页',
    'message.insertedToken': '已插入 {token}',
    'message.commandCopied': '命令已复制到剪贴板！',
    'message.commandCopyFailed': '复制命令失败',
    'message.selectInputFirst': '请先选择输入文件',
    'message.fileOverwrite': '文件“{file}”已存在，是否覆盖？',
    'message.converting': '正在转换...',
    'message.generatingReferenceDoc': '正在生成参考文档...',
    'message.preparingDarkMode': '正在准备深色模式...',
    'message.runningPandoc': '正在运行 pandoc...',
    'message.finalizing': '正在收尾...',
    'message.conversionComplete': '转换完成！',
    'message.conversionSuccess': '文档转换成功！',
    'message.copyCommandTerminal': '请复制命令并在终端中运行',
    'message.webModeCopy': '网页模式下请复制命令并在终端中运行',
    'message.error': '错误: {error}',
    'message.conversionFailed': '转换失败: {error}',
    'message.openFileDialogFailed': '打开文件对话框失败: {error}',
    'message.openFolderDialogFailed': '打开文件夹对话框失败: {error}',
    'message.outputDirDesktopOnly': '只能在桌面应用中更改输出目录',
    'message.enterPresetName': '请输入预设名称',
    'message.selectPresetFirst': '请先选择预设',
    'message.presetSaved': '预设“{name}”已保存',
    'message.presetLoaded': '预设“{name}”已加载',
    'message.presetUpdated': '预设“{name}”已更新',
    'message.deletePreset': '确定要删除预设“{name}”吗？',
    'message.presetDeleted': '预设“{name}”已删除',
    'message.settingsReset': '已重置为默认设置',
    'message.runInstall': '请运行: brew install {name}（或使用 npm/cargo 等方式）',
    'message.reinstallConfirm': '要重新安装 {name} 吗？这会先卸载再安装。',
    'message.confirmReinstallTitle': '确认重新安装',
    'message.uninstallConfirm': '确定要卸载 {name} 吗？',
    'message.confirmUninstallTitle': '确认卸载',
    'message.starting': '正在开始...',
    'message.operationCancelled': '操作已取消',
    'message.cancelFailed': '取消失败: {error}',
    'message.releaseNotFound': '未找到已发布版本，你当前运行的是最新开发版本。',
    'message.alreadyLatest': '你正在运行最新版本！',
    'message.updateCheckFailed': '检查更新失败: {error}',
    'message.noReleaseNotes': '暂无发行说明。',
    'message.noCompatibleDownload': '未找到适用于当前平台的下载包。',
    'message.downloadFailed': '下载失败: {error}',
    'message.updateDownloaded': '更新下载成功！',
    'message.openLocationFailed': '打开文件位置失败',
    'message.placeholderNotReplaced': '占位符未被正确替换。请重试，或联系维护者。',
    'message.pdfOnlyPaperSize': '纸张大小仅适用于 PDF 和 LaTeX 输出',
    'message.pdfOnlyOrientation': '页面方向仅适用于 PDF 和 LaTeX 输出',
    'message.marginsFormats': '页边距仅适用于 PDF、LaTeX、DOCX 和 ODT 输出',
    'message.fontSettingsFormats': '字体设置仅适用于 PDF、LaTeX、DOCX 和 ODT 输出',
    'message.lineHeightFormats': '行高仅适用于 PDF 和 LaTeX 输出',
    'message.headersFootersPdf': '页眉和页脚仅适用于 PDF 输出',
    'message.pageNumbersPdf': '页码设置仅适用于 PDF 输出',
    'message.noPdfEngine': '未安装 PDF 引擎。请在“依赖检查”中安装。',
    'message.notInstalled': '未安装',
    'message.mermaidNotInstalled': '未安装 mermaid-filter。请在“依赖检查”中安装。',
    'message.crossrefNotInstalled': '未安装 pandoc-crossref。请在“依赖检查”中安装。',
    'generic.document': '文档',
    'generic.output': '输出',
    'generic.user': '用户',
    'dep.required': '必需',
    'dep.optional': '可选',
    'dep.pandoc.desc': '文档转换器（必需）',
    'dep.tectonic.desc': 'PDF 引擎，可自动下载宏包（推荐）',
    'dep.texlive.desc': 'TeX Live，包含 pdflatex、xelatex、lualatex',
    'dep.mermaid.desc': 'Mermaid 图表支持',
    'dep.crossref.desc': '交叉引用过滤器',
    'dep.docs': '文档',
    'dep.reinstall': '重装',
    'dep.uninstall': '卸载',
    'dep.installHomebrew': '通过 Homebrew 安装',
    'dep.installApt': '通过 apt 安装',
    'dep.installNpm': '通过 npm 安装',
    'dep.installCargo': '通过 cargo 安装'
  }
};

function t(key, vars = {}) {
  const locale = translations[currentLanguage] || translations[DEFAULT_LANGUAGE];
  const fallback = translations.en;
  const template = locale[key] ?? fallback[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? `{${name}}`);
}

function setText(selector, key, vars = {}) {
  const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
  if (el) el.textContent = t(key, vars);
}

function setAttr(selector, attr, key, vars = {}) {
  const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
  if (el) el.setAttribute(attr, t(key, vars));
}

function setAllText(selector, key, vars = {}) {
  document.querySelectorAll(selector).forEach(el => {
    el.textContent = t(key, vars);
  });
}

function formatToday() {
  const locale = currentLanguage === 'zh-CN' ? 'zh-CN' : 'en-US';
  return new Date().toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
}

function updateOutputDisplayText() {
  const outName = $('outputName')?.value || t('generic.output');
  const ext = getExtensionForFormat($('outputFormat')?.value || 'pdf');
  const dir = outputDirPath || '';

  if (dir) {
    $('outputDir').textContent = dir + outName + '.' + ext;
  } else if ($('outputDir')) {
    $('outputDir').textContent = t('label.outputPath');
  }
}

function applyLanguage() {
  document.documentElement.lang = currentLanguage;
  document.title = t('app.title');

  const setNodeText = (node, key, vars = {}) => {
    if (node) node.textContent = t(key, vars);
  };
  const labelFor = id => $(id)?.closest('.form-control')?.querySelector('.label-text');
  const cardTitleFor = id => $(id)?.closest('label')?.querySelector('.label-text');
  const cardDescFor = id => $(id)?.closest('label')?.querySelector('p');

  setText('#browseInputText', 'button.open');
  setText('#copyCmdText', 'button.copy');
  setText('#convertBtnText', 'button.convert');
  if (!inputFilePath) setText('#inputPath', 'label.noFile');
  setAttr('#browseOutput', 'title', 'label.changeOutputFolder');
  setAttr('#outputName', 'placeholder', 'label.outputPlaceholder');
  updateOutputDisplayText();

  const tabs = document.querySelectorAll('input[name="mainTabs"][role="tab"]');
  ['label.layout', 'label.fonts', 'label.document', 'label.content', 'label.advanced', 'label.command']
    .forEach((key, index) => {
      if (tabs[index]) tabs[index].setAttribute('aria-label', t(key));
    });

  setNodeText($('outputDir')?.previousElementSibling, 'label.output');

  setNodeText(labelFor('paperSize'), 'label.paperSize');
  setNodeText(labelFor('orientation'), 'label.orientation');
  setNodeText(labelFor('fontSize'), 'label.fontSize');
  setNodeText(labelFor('lineHeight'), 'label.lineHeight');
  setNodeText(document.querySelector('#paperSize')?.closest('.grid')?.querySelector('.divider'), 'label.margins');
  setNodeText($('uniformMargins')?.closest('.form-control')?.querySelector('.label-text'), 'label.uniform');
  setNodeText($('marginUnit')?.closest('.form-control')?.querySelector('.label-text'), 'label.unit');
  setNodeText($('uniformMarginInput')?.querySelector('.label-text'), 'label.allSides');
  setNodeText($('marginTop')?.closest('.form-control')?.querySelector('.label-text'), 'label.top');
  setNodeText($('marginBottom')?.closest('.form-control')?.querySelector('.label-text'), 'label.bottom');
  setNodeText($('marginLeft')?.closest('.form-control')?.querySelector('.label-text'), 'label.left');
  setNodeText($('marginRight')?.closest('.form-control')?.querySelector('.label-text'), 'label.right');
  setNodeText(document.querySelector('#orientation option[value="portrait"]'), 'value.portrait');
  setNodeText(document.querySelector('#orientation option[value="landscape"]'), 'value.landscape');
  setNodeText(document.querySelector('#lineHeight option[value="1"]'), 'value.single');
  setNodeText(document.querySelector('#lineHeight option[value="2"]'), 'value.double');

  setNodeText(labelFor('mainFont'), 'label.mainFont');
  setNodeText(labelFor('monoFont'), 'label.monoFont');
  setNodeText(document.querySelector('#highlightTheme')?.closest('.grid')?.querySelector('.divider'), 'label.codeHighlighting');
  setNodeText(labelFor('highlightTheme'), 'label.theme');
  setNodeText($('lineNumbers')?.closest('.form-control')?.querySelector('.label-text'), 'label.lineNumbers');
  setNodeText($('codeBlockBg')?.closest('.form-control')?.querySelector('.label-text'), 'label.background');
  setNodeText(labelFor('codeBlockBgColor'), 'label.bgColor');
  setNodeText(document.querySelector('#codePreview')?.previousElementSibling?.querySelector('.label-text'), 'label.preview');
  const optgroups = document.querySelectorAll('#highlightTheme optgroup');
  if (optgroups[0]) optgroups[0].label = t('value.light');
  if (optgroups[1]) optgroups[1].label = t('value.dark');
  if ($('codePreview')) {
    $('codePreview').innerHTML = currentLanguage === 'zh-CN'
      ? '<div><span class="cm">// 问候函数</span></div><div><span class="kw">function</span> <span class="fn">hello</span>() {</div><div>  <span class="kw">const</span> msg = <span class="st">"你好，世界！"</span>;</div><div>  <span class="kw">return</span> msg;</div><div>}</div>'
      : '<div><span class="cm">// Greeting function</span></div><div><span class="kw">function</span> <span class="fn">hello</span>() {</div><div>  <span class="kw">const</span> msg = <span class="st">"Hello, World!"</span>;</div><div>  <span class="kw">return</span> msg;</div><div>}</div>';
  }

  setNodeText(cardTitleFor('titlePage'), 'label.titlePage');
  setNodeText(cardDescFor('titlePage'), 'desc.titlePage');
  setNodeText(cardTitleFor('toc'), 'label.tableOfContents');
  setNodeText(cardDescFor('toc'), 'desc.toc');
  setNodeText(cardTitleFor('numberSections'), 'label.numberSections');
  setNodeText(cardDescFor('numberSections'), 'desc.numberSections');
  setNodeText(cardTitleFor('lof'), 'label.listOfFigures');
  setNodeText(cardDescFor('lof'), 'desc.lof');
  setNodeText(cardTitleFor('lot'), 'label.listOfTables');
  setNodeText(cardDescFor('lot'), 'desc.lot');
  setNodeText(cardTitleFor('darkMode'), 'label.darkMode');
  setNodeText(cardDescFor('darkMode'), 'desc.darkMode');
  setNodeText(cardTitleFor('standalone'), 'label.standalone');
  setNodeText(cardDescFor('standalone'), 'desc.standalone');
  setNodeText(document.querySelector('#tocOptions > div > span'), 'label.tocDepth');
  setNodeText($('tocNewPage')?.closest('label')?.querySelector('.label-text'), 'label.newPageAfterToc');
  setNodeText(labelFor('documentClass'), 'label.documentClass');
  setNodeText(labelFor('topLevelDiv'), 'label.topLevelHeadings');
  setNodeText(document.querySelector('.doc-class-option[data-value="article"] span:first-child'), 'value.article');
  setNodeText(document.querySelector('.doc-class-option[data-value="report"] span:first-child'), 'value.report');
  setNodeText(document.querySelector('.doc-class-option[data-value="book"] span:first-child'), 'value.book');
  setNodeText(document.querySelector('.doc-class-option[data-value="memoir"] span:first-child'), 'value.memoir');
  setNodeText(document.querySelector('.doc-class-option[data-value="scrartcl"] span:first-child'), 'value.komaArticle');
  setNodeText(document.querySelector('.top-level-option[data-value="default"] span:first-child'), 'value.default');
  setNodeText(document.querySelector('.top-level-option[data-value="part"] span:first-child'), 'value.parts');
  setNodeText(document.querySelector('.top-level-option[data-value="chapter"] span:first-child'), 'value.chapters');
  setNodeText(document.querySelector('.top-level-option[data-value="section"] span:first-child'), 'value.sections');

  const docClassLabelMap = { article: 'value.article', report: 'value.report', book: 'value.book', memoir: 'value.memoir', scrartcl: 'value.komaArticle' };
  setNodeText($('documentClassLabel'), docClassLabelMap[$('documentClass')?.value] || 'value.report');
  const topLevelLabelMap = { default: 'value.default', part: 'value.parts', chapter: 'value.chapters', section: 'value.sections' };
  setNodeText($('topLevelDivLabel'), topLevelLabelMap[$('topLevelDiv')?.value] || 'value.default');

  setNodeText(document.querySelector('#tokensCollapse + .collapse-title'), 'label.tokens');
  setNodeText(labelFor('docTitle'), 'label.title');
  setNodeText(labelFor('docAuthor'), 'label.author');
  setNodeText(labelFor('docDate'), 'label.date');
  setNodeText(document.querySelector('#headerLeft')?.closest('.grid')?.children[0], 'label.headers');
  setNodeText(document.querySelector('#footerLeft')?.closest('.grid')?.children[4], 'label.footers');
  setAttr('#headerLeft', 'data-placeholder', 'placeholder.left');
  setAttr('#headerCenter', 'data-placeholder', 'placeholder.center');
  setAttr('#headerRight', 'data-placeholder', 'placeholder.right');
  setAttr('#footerLeft', 'data-placeholder', 'placeholder.left');
  setAttr('#footerCenter', 'data-placeholder', 'placeholder.page');
  setAttr('#footerRight', 'data-placeholder', 'placeholder.right');
  setNodeText(labelFor('pageNumberFormat'), 'label.pageNumberFormat');
  setNodeText(document.querySelector('#pageNumberFormat option[value="page"]'), 'value.pageN');
  setNodeText(document.querySelector('#pageNumberFormat option[value="page-of-x"]'), 'value.pageNOfX');
  setNodeText(document.querySelector('#pageNumberFormat option[value="n-of-x"]'), 'value.nOfX');
  setNodeText(document.querySelector('#pageNumberFormat option[value="number"]'), 'value.nOnly');
  setNodeText(labelFor('pageNumberPosition'), 'label.position');
  setNodeText(document.querySelector('#pageNumberPosition option[value="bottom-center"]'), 'value.bottomCenter');
  setNodeText(document.querySelector('#pageNumberPosition option[value="bottom-right"]'), 'value.bottomRight');
  setNodeText(document.querySelector('#pageNumberPosition option[value="top-right"]'), 'value.topRight');
  setNodeText(labelFor('pageNumberStyle'), 'label.style');

  setNodeText(document.querySelector('#mermaidDetected')?.previousElementSibling, 'label.mermaid');
  setText('#mermaidDetected', 'label.detectedSvg');
  setNodeText($('colorLinks')?.closest('label')?.querySelector('.label-text'), 'label.coloredLinks');
  setNodeText(labelFor('extraArgs'), 'label.extraArgs');
  setNodeText(document.querySelector('#extraArgs')?.closest('.form-control')?.querySelector('.label-text-alt'), 'label.extraArgsHint');

  setText('#fabLanguageLabel', 'label.languageMenu');
  setText('#fabCheckDepsText', 'label.dependencies');
  setText('#fabResetDefaultsText', 'label.reset');
  setText('#fabCopyCmdText', 'button.copyCommand');
  setText('#fabAboutText', 'label.about');
  const fabLabels = document.querySelectorAll('#fabMenu .fab-accordion .flex-1.text-left');
  setNodeText(fabLabels[0], 'label.presets');
  setNodeText(fabLabels[1], 'label.themeMenu');
  setNodeText(fabLabels[2], 'label.languageMenu');
  setText('#loadPreset', 'label.loadSelected');
  setText('#savePreset', 'label.saveNew');
  setText('#updatePreset', 'label.updateSelected');
  setText('#deletePreset', 'label.deleteSelected');

  const presetOption = $('#presetSelect')?.options?.[0];
  if (presetOption) presetOption.textContent = t('label.selectPreset');

  setNodeText($('openOnComplete')?.closest('label')?.querySelector('.label-text'), 'label.openWhenDone');

  const mainFontDefault = $('#mainFont')?.options?.[0];
  const monoFontDefault = $('#monoFont')?.options?.[0];
  if (mainFontDefault) mainFontDefault.textContent = t('label.systemDefault');
  if (monoFontDefault) monoFontDefault.textContent = t('label.systemDefault');
  if (systemFonts.length === 0) {
    const fontHint = $('#mainFont')?.options?.[1];
    if (fontHint?.disabled) fontHint.textContent = t('label.fontPermission');
  }

  setText('#progressCancelBtnText', 'button.cancel');
  setText('#progressCloseBtn', 'button.close');
  setText('#presetModal h3', 'label.savePreset');
  setText('#presetModal .label-text', 'label.presetName');
  setAttr('#presetNameInput', 'placeholder', 'label.enterPresetName');
  setText('#presetSaveConfirm', 'button.save');
  setText('#presetModal .modal-action form .btn', 'button.cancel');
  setText('#depsModal h3', 'label.dependencyCheck');
  setText('#depsResults .loading + span', 'label.checkingDependencies');
  setText('#depsModal .modal-action .btn', 'button.close');
  setText('#progressTitle', 'label.installing');
  setText('#aboutTitleText', 'app.title');
  setText('#checkUpdateBtnText', 'button.checkUpdates');
  setText('#aboutModal .mb-4 p.text-sm.mb-2', 'label.aboutIntro');
  setText('#aboutModal .mb-4 p.text-sm.text-base-content\\/70', 'label.aboutRights');
  setText('#githubRepoText', 'label.githubRepository');
  setText('#aboutModal .collapse:nth-of-type(1) .collapse-title', 'label.frontendDeps');
  setText('#aboutModal .collapse:nth-of-type(2) .collapse-title', 'label.backendDeps');
  setText('#aboutModal .collapse:nth-of-type(3) .collapse-title', 'label.poweredBy');
  setText('#aboutModal .collapse:nth-of-type(4) .collapse-title', 'label.license');
  setText('#aboutModal .collapse:nth-of-type(4) .collapse-content p.mb-2', 'label.licenseSummary');
  setText('#aboutModal .modal-action .btn', 'button.close');
  const versionNode = $('appVersion')?.parentElement;
  if (versionNode) versionNode.childNodes[0].textContent = `${t('label.version')} `;

  setText('#updateTitle', 'label.updateAvailable');
  setText('#updateInfo > p', 'label.newVersionAvailable');
  setText('#updateInfo .collapse-title', 'label.releaseNotes');
  setText('#updateReleaseNotes p', 'label.loading');
  setText('#downloadProgress > p', 'label.downloadingUpdate');
  setText('#downloadComplete .alert span', 'label.downloadComplete');
  setText('#updateDownloadBtn', 'button.downloadUpdate');
  setText('#showInFinderBtn', 'button.showInFinder');
  setText('#updateCloseBtn', 'button.close');
  const currentLatest = document.querySelectorAll('#updateInfo .flex.justify-between.text-sm.text-base-content\\/70 > span');
  if (currentLatest[0]) currentLatest[0].childNodes[0].textContent = `${t('label.current')} `;
  if (currentLatest[1]) currentLatest[1].childNodes[0].textContent = `${t('label.latest')} `;
  const savedToNode = $('downloadPath')?.parentElement;
  if (savedToNode) savedToNode.childNodes[0].textContent = `${t('label.savedTo')} `;

  document.querySelectorAll('.swap-on').forEach(el => { el.textContent = currentLanguage === 'zh-CN' ? '开' : 'ON'; });
  document.querySelectorAll('.swap-off').forEach(el => { el.textContent = currentLanguage === 'zh-CN' ? '关' : 'OFF'; });
}

function setLanguage(language) {
  currentLanguage = translations[language] ? language : DEFAULT_LANGUAGE;
  localStorage.setItem(LANGUAGE_STORAGE_KEY, currentLanguage);
  applyLanguage();
  handleFormatChange();
  updateCodePreview();
}

function setupLanguageSwitcher() {
  $('setLanguageZh')?.addEventListener('click', () => setLanguage('zh-CN'));
  $('setLanguageEn')?.addEventListener('click', () => setLanguage('en'));
}

// Theme Management
function initTheme() {
  const savedTheme = localStorage.getItem('appTheme') || 'dim';
  document.documentElement.setAttribute('data-theme', savedTheme);

  // Theme menu click handlers
  document.querySelectorAll('[data-set-theme]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const theme = btn.getAttribute('data-set-theme');
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('appTheme', theme);
      // Close dropdown by removing focus
      if (document.activeElement) {
        document.activeElement.blur();
      }
    });
  });
}

// System Fonts - uses Local Font Access API to get actual installed fonts
async function loadSystemFonts() {
  const mainFontSelect = $('mainFont');
  const monoFontSelect = $('monoFont');

  // Known monospace font family patterns
  const monoPatterns = [
    /mono/i, /courier/i, /consolas/i, /menlo/i, /monaco/i,
    /fira\s*code/i, /jetbrains/i, /source\s*code/i, /inconsolata/i,
    /hack/i, /cascadia/i, /iosevka/i, /sf\s*mono/i, /dejavu.*mono/i,
    /liberation.*mono/i, /ubuntu.*mono/i, /roboto.*mono/i, /ibm.*plex.*mono/i,
    /pt\s*mono/i, /droid.*mono/i, /anonymous/i, /terminus/i
  ];

  const isMono = (fontFamily) => monoPatterns.some(p => p.test(fontFamily));

  try {
    // Try Local Font Access API (Chrome 103+, requires permission)
    if ('queryLocalFonts' in window) {
      const fonts = await window.queryLocalFonts();
      const fontFamilies = new Set();
      const monoFamilies = new Set();

      for (const font of fonts) {
        const family = font.family;
        if (!fontFamilies.has(family)) {
          fontFamilies.add(family);
          if (isMono(family)) {
            monoFamilies.add(family);
          }
        }
      }

      systemFonts = [...fontFamilies].sort((a, b) => a.localeCompare(b));
      monoFonts = [...monoFamilies].sort((a, b) => a.localeCompare(b));
    } else {
      throw new Error('queryLocalFonts not available');
    }
  } catch (e) {
    // Try Tauri backend to list fonts
    if (isTauri) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const fonts = await invoke('list_system_fonts');
        if (fonts && fonts.length > 0) {
          systemFonts = fonts.sort((a, b) => a.localeCompare(b));
          monoFonts = fonts.filter(f => isMono(f)).sort((a, b) => a.localeCompare(b));
        }
      } catch (tauriErr) {
        // Font listing not available - not critical
      }
    }
  }

  // Populate dropdowns
  systemFonts.forEach(font => {
    const opt = document.createElement('option');
    opt.value = font;
    opt.textContent = font;
    opt.style.fontFamily = font;
    mainFontSelect.appendChild(opt);
  });

  monoFonts.forEach(font => {
    const opt = document.createElement('option');
    opt.value = font;
    opt.textContent = font;
    opt.style.fontFamily = font;
    monoFontSelect.appendChild(opt);
  });

  // If no fonts loaded, show a message
  if (systemFonts.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = t('label.fontPermission');
    opt.disabled = true;
    mainFontSelect.appendChild(opt);
  }
}

// File Handling
async function setupFileHandling() {
  const browseInputBtn = $('browseInput');
  const inputFileEl = $('inputFile');
  const browseOutputBtn = $('browseOutput');

  browseInputBtn.addEventListener('click', async () => {
    if (isTauri) {
      // Use Tauri dialog for file selection
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({
          multiple: false,
          filters: [{
            name: 'Documents',
            extensions: ['md', 'markdown', 'rst', 'tex', 'latex', 'docx', 'doc', 'html', 'htm', 'org', 'txt', 'adoc', 'asciidoc', 'epub', 'odt', 'rtf', 'json', 'yaml', 'yml']
          }]
        });
        if (selected) {
          await handleTauriFileSelect(selected);
        }
      } catch (err) {
        console.error('Dialog error:', err);
        showToast(t('message.openFileDialogFailed', { error: err }), 'error');
      }
    } else {
      inputFileEl.click();
    }
  });

  inputFileEl.addEventListener('change', async (e) => {
    if (e.target.files.length > 0) {
      await handleFileSelect(e.target.files[0]);
    }
  });

  browseOutputBtn.addEventListener('click', async () => {
    if (isTauri) {
      // Use Tauri dialog for folder selection
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({
          directory: true,
          multiple: false
        });
        if (selected) {
          outputDirPath = ensureTrailingSeparator(selected);
          updateOutputDisplay();
          updateCommandPreview();
        }
      } catch (err) {
        console.error('Dialog error:', err);
        showToast(t('message.openFolderDialogFailed', { error: err }), 'error');
      }
    } else {
      showToast(t('message.outputDirDesktopOnly'), 'info');
    }
  });

  $('outputName').addEventListener('input', () => {
    updateOutputDisplay();
    updateCommandPreview();
  });
  $('outputFormat').addEventListener('change', () => {
    handleFormatChange();
    updateOutputDisplay();
    updateCommandPreview();
  });
}

// Handle file selection in Tauri
async function handleTauriFileSelect(filePath) {
  inputFilePath = filePath;
  const derivedState = deriveTauriFileState(filePath);
  inputFileName = derivedState.inputFileName;

  // Update input path display
  $('inputPath').textContent = filePath;

  // Set output directory from input file path
  outputDirPath = derivedState.outputDirPath;

  // Set output filename (without extension)
  $('outputName').value = derivedState.outputName;

  // Read file content for mermaid detection using Tauri fs
  try {
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    inputFileContent = await readTextFile(filePath);
    detectMermaid(inputFileContent);
  } catch (e) {
    console.error('Failed to read file:', e);
    inputFileContent = null;
  }

  // Enable convert button
  $('convertBtn').disabled = false;
  updateOutputDisplay();
  updateCommandPreview();
}

// Update output display with actual path
function updateOutputDisplay() {
  const outName = $('outputName').value || t('generic.output');
  const ext = getExtensionForFormat($('outputFormat').value);
  const dir = outputDirPath || '';

  if (dir) {
    $('outputDir').textContent = buildOutputPath(dir, outName, ext);
  } else {
    $('outputDir').textContent = t('label.outputPath');
  }
}

async function handleFileSelect(file) {
  inputFileName = file.name;
  // In web mode we only get the filename
  inputFilePath = file.name;

  // Update input path display (in web mode just show filename)
  $('inputPath').textContent = file.name;

  // In web mode, output dir is same folder (relative)
  outputDirPath = '';

  // Set output filename (without extension)
  const baseName = file.name.replace(/\.[^/.]+$/, '');
  $('outputName').value = baseName;

  // Read file content for mermaid detection
  try {
    inputFileContent = await file.text();
    detectMermaid(inputFileContent);
  } catch (e) {
    inputFileContent = null;
  }

  // Enable convert button
  $('convertBtn').disabled = false;
  updateOutputDisplay();
  updateCommandPreview();
}

function detectMermaid(content) {
  const hasMermaid = /```mermaid/i.test(content);
  $('mermaidDetected').classList.toggle('hidden', !hasMermaid);
}

// Format change handling
function handleFormatChange() {
  const format = $('outputFormat').value;
  const isPdf = format === 'pdf';
  const isDocx = format === 'docx';
  const isOdt = format === 'odt';
  const isLatexBased = isPdf || format === 'latex';
  const supportsTypography = isLatexBased || isDocx || isOdt; // Formats that support font/margin settings
  const needsStandalone = ['html', 'latex'].includes(format);

  // Show/hide PDF engine section
  $('pdfEngineSection').classList.toggle('hidden', !isPdf);

  // Show/hide standalone option
  $('standaloneLabel').classList.toggle('hidden', !needsStandalone);

  // Layout tab - margins work for PDF/LaTeX/DOCX/ODT
  // Paper size and orientation only work for PDF/LaTeX
  const layoutTab = document.querySelector('[aria-label="Layout"]')?.closest('.tab-content, [role="tabpanel"]');
  if (layoutTab) {
    // Paper size and orientation only for PDF/LaTeX
    const paperSizeSection = $('paperSize')?.closest('.form-control');
    const orientationSection = $('orientation')?.closest('.form-control');
    if (paperSizeSection) {
      if (!isLatexBased) {
        paperSizeSection.classList.add('opacity-50');
        paperSizeSection.setAttribute('title', t('message.pdfOnlyPaperSize'));
      } else {
        paperSizeSection.classList.remove('opacity-50');
        paperSizeSection.removeAttribute('title');
      }
    }
    if (orientationSection) {
      if (!isLatexBased) {
        orientationSection.classList.add('opacity-50');
        orientationSection.setAttribute('title', t('message.pdfOnlyOrientation'));
      } else {
        orientationSection.classList.remove('opacity-50');
        orientationSection.removeAttribute('title');
      }
    }

    // Margins work for PDF/LaTeX/DOCX/ODT
    const marginSection = $('marginAll')?.closest('.grid, .space-y-2');
    if (marginSection) {
      if (!supportsTypography) {
        marginSection.classList.add('opacity-50');
        marginSection.setAttribute('title', t('message.marginsFormats'));
      } else {
        marginSection.classList.remove('opacity-50');
        marginSection.removeAttribute('title');
      }
    }
  }

  // Fonts tab - font family, size work for PDF/LaTeX/DOCX/ODT
  // Line height only works for PDF/LaTeX
  const fontsTab = document.querySelector('[aria-label="Fonts"]')?.closest('.tab-content, [role="tabpanel"]');
  if (fontsTab) {
    // Font family and size work for PDF/LaTeX/DOCX/ODT
    const fontControls = fontsTab.querySelectorAll('#mainFont, #monoFont, #fontSize');
    fontControls.forEach(el => {
      const parent = el.closest('.form-control');
      if (parent) {
        if (!supportsTypography) {
          parent.classList.add('opacity-50');
          parent.setAttribute('title', t('message.fontSettingsFormats'));
        } else {
          parent.classList.remove('opacity-50');
          parent.removeAttribute('title');
        }
      }
    });

    // Line height only for PDF/LaTeX
    const lineHeightControl = fontsTab.querySelector('#lineHeight')?.closest('.form-control');
    if (lineHeightControl) {
      if (!isLatexBased) {
        lineHeightControl.classList.add('opacity-50');
        lineHeightControl.setAttribute('title', t('message.lineHeightFormats'));
      } else {
        lineHeightControl.classList.remove('opacity-50');
        lineHeightControl.removeAttribute('title');
      }
    }
  }

  // Content tab - headers/footers/page numbers only work for PDF
  const headerFooterSection = document.querySelector('#headerLeft')?.closest('.grid');
  if (headerFooterSection) {
    if (!isPdf) {
      headerFooterSection.classList.add('opacity-50');
      headerFooterSection.setAttribute('title', t('message.headersFootersPdf'));
    } else {
      headerFooterSection.classList.remove('opacity-50');
      headerFooterSection.removeAttribute('title');
    }
  }

  const pageNumberSection = document.querySelector('#pageNumberFormat')?.closest('.grid');
  if (pageNumberSection) {
    if (!isPdf) {
      pageNumberSection.classList.add('opacity-50');
      pageNumberSection.setAttribute('title', t('message.pageNumbersPdf'));
    } else {
      pageNumberSection.classList.remove('opacity-50');
      pageNumberSection.removeAttribute('title');
    }
  }
}

// Margin handling
function setupMargins() {
  const uniformCheckbox = $('uniformMargins');

  uniformCheckbox.addEventListener('change', () => {
    const uniform = uniformCheckbox.checked;
    $('uniformMarginInput').classList.toggle('hidden', !uniform);
    $('individualMargins').classList.toggle('hidden', uniform);
    updateCommandPreview();
  });

  $('marginAll').addEventListener('input', () => {
    const val = $('marginAll').value;
    $('marginTop').value = val;
    $('marginBottom').value = val;
    $('marginLeft').value = val;
    $('marginRight').value = val;
    updateCommandPreview();
  });

  // Individual margin inputs
  ['marginTop', 'marginBottom', 'marginLeft', 'marginRight'].forEach(id => {
    $(id).addEventListener('input', updateCommandPreview);
  });
}

// Code Preview
function updateCodePreview() {
  const theme = $('highlightTheme').value;
  const colors = themeColors[theme] || themeColors['breezedark'];
  const preview = $('codePreview');
  const useBg = $('codeBlockBg').checked;
  const bgColor = useBg ? ($('codeBlockBgColor').value || colors.bg) : 'transparent';

  preview.style.backgroundColor = bgColor;
  preview.querySelectorAll('.kw').forEach(el => el.style.color = colors.kw);
  preview.querySelectorAll('.fn').forEach(el => el.style.color = colors.fn);
  preview.querySelectorAll('.st').forEach(el => el.style.color = colors.st);
  preview.querySelectorAll('.cm').forEach(el => el.style.color = colors.cm);

  // Set text color based on theme brightness
  const isLightTheme = ['pygments', 'kate', 'tango'].includes(theme);
  preview.style.color = isLightTheme ? '#333' : '#ddd';

  // Update color picker if user hasn't customized it
  if (!$('codeBlockBgColor').dataset.userSet) {
    $('codeBlockBgColor').value = colors.bg;
  }
}

function setupCodePreview() {
  $('highlightTheme').addEventListener('change', () => {
    // Reset user customization flag when theme changes
    $('codeBlockBgColor').dataset.userSet = '';
    updateCodePreview();
    updateCommandPreview();
  });

  $('codeBlockBg').addEventListener('change', updateCodePreview);

  $('codeBlockBgColor').addEventListener('input', () => {
    $('codeBlockBgColor').dataset.userSet = 'true';
    updateCodePreview();
  });

  updateCodePreview();
}

// TOC Toggle
function setupTocHandling() {
  $('toc').addEventListener('change', () => {
    $('tocOptions').classList.toggle('hidden', !$('toc').checked);
    updateCommandPreview();
  });

  $('tocDepth').addEventListener('input', () => {
    $('tocDepthValue').textContent = $('tocDepth').value;
    updateCommandPreview();
  });
}

// Token drag and drop - with click as primary interaction
let lastFocusedTokenField = null;

// Token color mapping based on badge classes
const tokenColors = {
  '{today}': 'primary',
  '{year}': 'primary',
  '{file}': 'secondary',
  '{user}': 'secondary',
  '{title}': 'accent',
  '{author}': 'accent',
  '{date}': 'accent',
  '{page}': 'info',
  '{pages}': 'info',
  '{section}': 'warning',
  '{chapter}': 'warning'
};

// Create a colored token pill element
function createTokenPill(tokenValue) {
  const color = tokenColors[tokenValue] || 'primary';
  const pill = document.createElement('span');
  pill.className = `token-pill token-${color}`;
  pill.dataset.token = tokenValue;
  pill.innerHTML = `${tokenValue}<span class="remove-token" title="Remove">×</span>`;
  pill.contentEditable = 'false';

  // Handle remove click
  pill.querySelector('.remove-token').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    pill.remove();
    updateCommandPreview();
  });

  return pill;
}

// Insert token pill at cursor position in contenteditable
function insertTokenPill(field, tokenValue) {
  const pill = createTokenPill(tokenValue);

  // Get current selection
  const selection = window.getSelection();

  if (field.contains(selection.anchorNode) || field === selection.anchorNode) {
    // Insert at cursor
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(pill);

    // Move cursor after pill
    range.setStartAfter(pill);
    range.setEndAfter(pill);
    selection.removeAllRanges();
    selection.addRange(range);
  } else {
    // No cursor in field, append at end
    field.appendChild(pill);
  }

  field.focus();
  updateCommandPreview();
}

// Insert token text into regular input (for header/footer fields)
function insertTokenText(input, tokenValue) {
  const pos = input.selectionStart ?? input.value.length;
  input.value = input.value.slice(0, pos) + tokenValue + input.value.slice(pos);
  input.focus();
  const newPos = pos + tokenValue.length;
  input.setSelectionRange(newPos, newPos);
  updateCommandPreview();
}

// Get text content from a token field (converts pills to token strings)
function getTokenFieldValue(field) {
  if (!field) return '';

  // If it's a regular input, just return the value
  if (field.tagName === 'INPUT') {
    return field.value;
  }

  // For contenteditable, traverse children and build string
  let result = '';
  field.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.classList.contains('token-pill')) {
        result += node.dataset.token;
      } else {
        result += node.textContent;
      }
    }
  });
  return result.trim();
}

// Set content of a token field, converting token strings to colored pills
function setTokenFieldValue(field, value) {
  if (!field) return;

  // Clear current content
  field.innerHTML = '';

  if (!value) return;

  // Parse value and create pills for tokens
  const tokenRegex = /(\{[^}]+\})/g;
  const parts = value.split(tokenRegex);

  parts.forEach(part => {
    if (part.match(tokenRegex)) {
      // It's a token - create a pill
      const pill = createTokenPill(part);
      field.appendChild(pill);
    } else if (part) {
      // Regular text
      field.appendChild(document.createTextNode(part));
    }
  });
}

function setupTokenDrag() {
  const tokenList = $('tokenList');
  if (!tokenList) {
    return;
  }

  // Token fields (contenteditable) - get colored pills
  const tokenFieldIds = [
    'docTitle', 'docAuthor', 'docDate',
    'headerLeft', 'headerCenter', 'headerRight',
    'footerLeft', 'footerCenter', 'footerRight'
  ];

  // Regular text inputs - get plain text tokens
  const textInputIds = ['outputName', 'extraArgs'];

  const allTargetIds = [...tokenFieldIds, ...textInputIds];

  // Track last focused field
  allTargetIds.forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('focus', () => {
      lastFocusedTokenField = el;
    });
  });

  // Get all tokens
  const tokens = tokenList.querySelectorAll('[data-token]');

  // Click handler for tokens - insert into last focused field
  tokens.forEach(token => {
    token.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const tokenValue = token.dataset.token;
      let target = lastFocusedTokenField;
      if (!target || !allTargetIds.includes(target.id)) {
        target = $('docTitle');
      }
      if (target) {
        if (tokenFieldIds.includes(target.id)) {
          insertTokenPill(target, tokenValue);
        } else {
          insertTokenText(target, tokenValue);
        }
        showToast(t('message.insertedToken', { token: tokenValue }), 'success');
      }
    });

    // Setup drag - native HTML5 drag and drop
    token.setAttribute('draggable', 'true');

    token.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', token.dataset.token);
      e.dataTransfer.effectAllowed = 'copy';
      token.classList.add('dragging');

      // Create a custom drag image
      const dragImage = token.cloneNode(true);
      dragImage.style.position = 'absolute';
      dragImage.style.top = '-1000px';
      dragImage.style.transform = 'scale(1.2)';
      document.body.appendChild(dragImage);
      e.dataTransfer.setDragImage(dragImage, dragImage.offsetWidth / 2, dragImage.offsetHeight / 2);
      setTimeout(() => dragImage.remove(), 0);
    });

    token.addEventListener('dragend', () => {
      token.classList.remove('dragging');
    });
  });

  // Setup drop targets for contenteditable fields (colored pills)
  tokenFieldIds.forEach(id => {
    const field = $(id);
    if (!field) {
      return;
    }

    // Use capture phase to intercept before contenteditable's default behavior
    field.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.dataTransfer.dropEffect = 'copy';
      field.classList.add('drop-active');
    }, true);

    field.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      field.classList.add('drop-active');
    }, true);

    field.addEventListener('dragleave', (e) => {
      if (!field.contains(e.relatedTarget)) {
        field.classList.remove('drop-active');
      }
    }, true);

    field.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      field.classList.remove('drop-active');

      const tokenValue = e.dataTransfer.getData('text/plain');

      if (tokenValue && tokenValue.startsWith('{') && tokenValue.endsWith('}')) {
        // Create colored pill
        const pill = createTokenPill(tokenValue);

        // Use requestAnimationFrame to run after browser's default behavior
        requestAnimationFrame(() => {
          // Find and remove any plain text nodes containing the token
          // BUT only text nodes that are direct children of field, not inside pills
          const nodesToFix = [];
          field.childNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE && node.textContent.includes(tokenValue)) {
              nodesToFix.push(node);
            }
          });
          nodesToFix.forEach(textNode => {
            textNode.textContent = textNode.textContent.split(tokenValue).join('');
            // Remove empty text nodes
            if (!textNode.textContent.trim()) {
              textNode.remove();
            }
          });

          // Append pill
          field.appendChild(pill);

          field.focus();
          updateCommandPreview();
          showToast(t('message.insertedToken', { token: tokenValue }), 'success');
        });
      }
    }, true); // Capture phase
  });

  // Setup drop targets for regular text inputs
  textInputIds.forEach(id => {
    const input = $(id);
    if (!input) return;

    input.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      input.classList.add('drop-active');
    });

    input.addEventListener('dragenter', (e) => {
      e.preventDefault();
      input.classList.add('drop-active');
    });

    input.addEventListener('dragleave', () => {
      input.classList.remove('drop-active');
    });

    input.addEventListener('drop', (e) => {
      e.preventDefault();
      input.classList.remove('drop-active');

      const tokenValue = e.dataTransfer.getData('text/plain');
      if (tokenValue && tokenValue.startsWith('{') && tokenValue.endsWith('}')) {
        insertTokenText(input, tokenValue);
        showToast(t('message.insertedToken', { token: tokenValue }), 'success');
      }
    });
  });
}

// Replace metadata tokens with actual values
function replaceMetadataTokens(str) {
  if (!str) return str;
  const now = new Date();
  const today = formatToday();
  const year = now.getFullYear().toString();
  const baseName = inputFileName ? inputFileName.replace(/\.[^/.]+$/, '') : t('generic.document');

  return str
    .replace(/\{today\}/g, today)
    .replace(/\{year\}/g, year)
    .replace(/\{file\}/g, baseName)
    .replace(/\{user\}/g, t('generic.user'));
}

// Build Pandoc Command
function buildPandocCommand() {
  const args = ['pandoc'];

  // Input file
  const input = inputFilePath || `${t('generic.document')}.md`;
  args.push(`"${input}"`);

  // Output format
  const format = $('outputFormat').value;
  args.push(`-t ${format}`);

  // Output file
  const outName = $('outputName').value || t('generic.output');
  const ext = getExtensionForFormat(format);
  const finalOutput = buildOutputPath(outputDirPath, outName, ext);
  args.push(`-o "${finalOutput}"`);

  // Standalone flag
  const isPdf = format === 'pdf';
  const isDocx = format === 'docx';
  const isOdt = format === 'odt';
  if (isPdf || isDocx || isOdt || ($('standalone') && $('standalone').checked)) {
    args.push('-s');
  }

  // DOCX/ODT-specific options - use reference doc for styling
  if (isDocx || isOdt) {
    // Check if user has customized any settings that need reference doc
    const hasCustomFont = $('mainFont').value || $('monoFont').value;
    const hasCustomSize = $('fontSize').value && $('fontSize').value !== '12';
    const hasCustomMargins = $('marginTop').value || $('marginBottom').value ||
                             $('marginLeft').value || $('marginRight').value ||
                             ($('uniformMargins').checked && $('marginAll').value);

    if (hasCustomFont || hasCustomSize || hasCustomMargins) {
      // Placeholder - will be replaced with actual reference doc path during conversion
      args.push('--REFERENCE-DOC-PLACEHOLDER--');
    }
  }

  // PDF-specific options
  if (isPdf) {
    args.push(`--pdf-engine=${$('pdfEngine').value}`);
    args.push(`-V documentclass=${$('documentClass').value}`);
    args.push(`-V papersize=${$('paperSize').value}`);

    // Load underscore package early to handle underscores in text mode (common in technical docs)
    // Must be loaded before hyperref to work correctly in links and references
    // The [strings] option enables underscores in \url and file paths
    args.push('-V header-includes="\\usepackage[strings]{underscore}"');

    if ($('orientation').value === 'landscape') {
      args.push('-V geometry:landscape');
    }

    // Margins
    const unit = $('marginUnit').value;
    const margins = [];
    if ($('uniformMargins').checked) {
      const m = $('marginAll').value;
      margins.push(`margin=${m}${unit}`);
    } else {
      if ($('marginTop').value) margins.push(`top=${$('marginTop').value}${unit}`);
      if ($('marginBottom').value) margins.push(`bottom=${$('marginBottom').value}${unit}`);
      if ($('marginLeft').value) margins.push(`left=${$('marginLeft').value}${unit}`);
      if ($('marginRight').value) margins.push(`right=${$('marginRight').value}${unit}`);
    }
    if (margins.length > 0) {
      args.push(`-V geometry:${margins.join(',')}`);
    }

    // Title page (KOMA-Script or custom)
    if ($('titlePage').checked) {
      // Use titlepages package for article class or titlepage for others
      args.push('-V titlepage=true');
      args.push('-V titlepage-rule-height=0');
    }

    // Link colors - dark mode overrides custom colors
    const isDarkMode = $('darkMode') && $('darkMode').checked;
    if (isDarkMode) {
      // Set link colors for dark mode (cyan works well on dark background)
      args.push('-V colorlinks=true');
      args.push('-V linkcolor=cyan');
      args.push('-V urlcolor=cyan');
      args.push('-V filecolor=cyan');
      args.push('-V citecolor=cyan');
      // Mark that dark mode is enabled (placeholder for header path)
      // This will be replaced during conversion with actual -H flag
      args.push('--DARK-MODE-PLACEHOLDER--');
    } else if ($('colorLinks').checked) {
      // Custom link colors (only if not in dark mode)
      args.push('-V colorlinks=true');
      const color = $('linkColor').value.replace('#', '');
      args.push(`-V 'linkcolor=[HTML]{${color}}'`);
      args.push(`-V 'urlcolor=[HTML]{${color}}'`);
    }

    // Headers and Footers - only add if user specifies custom content
    const headerLeft = replaceHeaderFooterTokens(getTokenFieldValue($('headerLeft')));
    const headerCenter = replaceHeaderFooterTokens(getTokenFieldValue($('headerCenter')));
    const headerRight = replaceHeaderFooterTokens(getTokenFieldValue($('headerRight')));
    const footerLeft = replaceHeaderFooterTokens(getTokenFieldValue($('footerLeft')));
    const footerCenter = replaceHeaderFooterTokens(getTokenFieldValue($('footerCenter')));
    const footerRight = replaceHeaderFooterTokens(getTokenFieldValue($('footerRight')));

    // Page numbering options
    const pageFormat = $('pageNumberFormat').value;
    const pagePosition = $('pageNumberPosition').value;
    const pageStyle = $('pageNumberStyle').value;

    // Build page number string based on format
    let pageNumStr = '';
    if (pageFormat === 'page') {
      pageNumStr = 'Page \\thepage';
    } else if (pageFormat === 'page-of-x') {
      pageNumStr = 'Page \\thepage\\ of \\pageref{LastPage}';
    } else if (pageFormat === 'n-of-x') {
      pageNumStr = '\\thepage\\ of \\pageref{LastPage}';
    } else {
      pageNumStr = '\\thepage';
    }

    // Determine position for fancyhdr
    let pageNumPosition = 'C'; // center
    let pageNumHeader = false;
    if (pagePosition === 'bottom-center') {
      pageNumPosition = 'C';
    } else if (pagePosition === 'bottom-right') {
      pageNumPosition = 'R';
    } else if (pagePosition === 'top-right') {
      pageNumPosition = 'R';
      pageNumHeader = true;
    }

    const hasCustomHeadersFooters = headerLeft || headerCenter || headerRight || footerLeft || footerCenter || footerRight;

    // Always add fancyhdr for page numbering control
    args.push('-V header-includes="\\usepackage{fancyhdr}"');
    args.push('-V header-includes="\\usepackage{lastpage}"');
    // underscore package already loaded early (see above) - do not duplicate
    args.push('-V header-includes="\\pagestyle{fancy}"');
    args.push('-V header-includes="\\fancyhf{}"');

    // Page style (arabic, roman, Roman)
    if (pageStyle === 'roman') {
      args.push('-V header-includes="\\pagenumbering{roman}"');
    } else if (pageStyle === 'Roman') {
      args.push('-V header-includes="\\pagenumbering{Roman}"');
    }

    // Add custom headers/footers if specified
    if (headerLeft) args.push(`-V header-includes="\\fancyhead[L]{${headerLeft}}"`);
    if (headerCenter) args.push(`-V header-includes="\\fancyhead[C]{${headerCenter}}"`);
    if (headerRight) args.push(`-V header-includes="\\fancyhead[R]{${headerRight}}"`);
    if (footerLeft) args.push(`-V header-includes="\\fancyfoot[L]{${footerLeft}}"`);
    if (footerCenter) args.push(`-V header-includes="\\fancyfoot[C]{${footerCenter}}"`);
    if (footerRight) args.push(`-V header-includes="\\fancyfoot[R]{${footerRight}}"`);

    // Add page number if no custom footer at that position
    if (!hasCustomHeadersFooters) {
      if (pageNumHeader) {
        args.push(`-V header-includes="\\fancyhead[${pageNumPosition}]{${pageNumStr}}"`);
      } else {
        args.push(`-V header-includes="\\fancyfoot[${pageNumPosition}]{${pageNumStr}}"`);
      }
    }
  }

  // Typography - LaTeX variables only work for PDF/LaTeX output
  const isLatexBased = isPdf || format === 'latex';
  if (isLatexBased) {
    if ($('mainFont').value) {
      args.push(`-V mainfont="${$('mainFont').value}"`);
    }
    if ($('monoFont').value) {
      args.push(`-V monofont="${$('monoFont').value}"`);
    }
    const fontSize = $('fontSize').value;
    if (fontSize && fontSize !== '12') {
      args.push(`-V fontsize=${fontSize}pt`);
    }
    if ($('lineHeight').value !== '1.5') {
      args.push(`-V linestretch=${$('lineHeight').value}`);
    }
  }

  // Code highlighting
  const highlightTheme = $('highlightTheme').value;
  const syntaxHighlightingArg = getSyntaxHighlightingArgument(highlightTheme);
  if (syntaxHighlightingArg) {
    args.push(syntaxHighlightingArg);
  }

  // TOC
  if ($('toc').checked) {
    args.push('--toc');
    args.push(`--toc-depth=${$('tocDepth').value}`);
    // Page break after TOC
    if ($('tocNewPage').checked) {
      args.push('-V toc-own-page=true');
    }
  }

  // List of Figures / Tables
  if ($('lof') && $('lof').checked) args.push('-V lof=true');
  if ($('lot') && $('lot').checked) args.push('-V lot=true');

  // Top-level division
  const topLevelDiv = $('topLevelDiv');
  if (topLevelDiv && topLevelDiv.value !== 'default') {
    args.push(`--top-level-division=${topLevelDiv.value}`);
  }

  // Number sections
  if ($('numberSections').checked) {
    args.push('-N');
  }

  // Metadata with token replacement (use getTokenFieldValue for contenteditable)
  const title = replaceMetadataTokens(getTokenFieldValue($('docTitle')));
  const author = replaceMetadataTokens(getTokenFieldValue($('docAuthor')));
  const date = replaceMetadataTokens(getTokenFieldValue($('docDate')));

  if (title) args.push(`-M title="${title}"`);
  if (author) args.push(`-M author="${author}"`);
  if (date) args.push(`-M date="${date}"`);

  // Mermaid filter - configured via environment variables in Rust backend
  const hasMermaid = !$('mermaidDetected').classList.contains('hidden');
  if (hasMermaid) {
    args.push('-F mermaid-filter');
    // Note: mermaid-filter is configured via MERMAID_FILTER_* environment variables
    // in the Rust backend to use SVG format with transparent background
  }

  // Dark mode for HTML/EPUB
  const isHtmlLike = ['html', 'epub'].includes(format);
  if (isHtmlLike && $('darkMode') && $('darkMode').checked) {
    args.push('--css=data:text/css,body{background-color:%231e1e2e;color:%23cdd6f4}a{color:%2389b4fa}pre,code{background-color:%23313244}');
  }

  // Other filters
  if ($('filterCrossref').checked) args.push('-F pandoc-crossref');
  if ($('filterCiteproc').checked) args.push('--citeproc');

  // Extra arguments
  const extraArgs = $('extraArgs').value.trim();
  if (extraArgs) {
    args.push(extraArgs);
  }

  return args.join(' \\\n  ');
}

// Replace header/footer tokens with LaTeX commands
function replaceHeaderFooterTokens(str) {
  if (!str) return '';
  return str
    .replace(/\{page\}/g, '\\thepage')
    .replace(/\{pages\}/g, '\\pageref{LastPage}')
    .replace(/\{section\}/g, '\\leftmark')
    .replace(/\{chapter\}/g, '\\rightmark')
    .replace(/\{title\}/g, replaceMetadataTokens('{title}'))
    .replace(/\{author\}/g, replaceMetadataTokens('{author}'))
    .replace(/\{date\}/g, replaceMetadataTokens('{date}'))
    .replace(/\{today\}/g, replaceMetadataTokens('{today}'))
    .replace(/\{year\}/g, replaceMetadataTokens('{year}'))
    .replace(/\{file\}/g, replaceMetadataTokens('{file}'))
    .replace(/\{user\}/g, replaceMetadataTokens('{user}'));
}

function getExtensionForFormat(format) {
  const extensions = {
    pdf: 'pdf', docx: 'docx', odt: 'odt', html: 'html',
    epub: 'epub', latex: 'tex', pptx: 'pptx',
    markdown: 'md', rst: 'rst', plain: 'txt',
  };
  return extensions[format] || format;
}

function updateCommandPreview() {
  $('commandPreview').textContent = buildPandocCommand();
}

// Copy Command
function setupCopyCommand() {
  $('copyCmd').addEventListener('click', async () => {
    const cmd = $('commandPreview').textContent;
    // Convert multi-line command to single line
    const singleLineCmd = cmd.replace(/\\\n\s+/g, ' ');
    try {
      await navigator.clipboard.writeText(singleLineCmd);
      showToast(t('message.commandCopied'), 'success');
    } catch (err) {
      showToast(t('message.commandCopyFailed'), 'error');
    }
  });
}

// Toast Notifications
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `alert alert-${type} shadow-lg`;
  toast.innerHTML = `<span>${message}</span>`;
  $('toastContainer').appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// Conversion
function setupConversion() {
  $('convertBtn').addEventListener('click', async () => {
    if (!inputFilePath) {
      showToast(t('message.selectInputFirst'), 'warning');
      return;
    }

    const outName = $('outputName').value || t('generic.output');
    const ext = getExtensionForFormat($('outputFormat').value);
    const finalPath = buildOutputPath(outputDirPath, outName, ext);

    // Check if file exists and confirm overwrite
    if (isTauri) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const exists = await invoke('file_exists', { path: finalPath });
        if (exists) {
          if (!confirm(t('message.fileOverwrite', { file: `${outName}.${ext}` }))) {
            return;
          }
        }
      } catch (e) {
        // Non-critical - proceed with conversion
      }
    }

    $('statusArea').classList.remove('hidden');
    $('statusText').textContent = t('message.converting');
    $('progressBar').max = 100;
    $('progressBar').value = 10;
    $('convertBtn').disabled = true;

    try {
      if (isTauri) {
        const { invoke } = await import('@tauri-apps/api/core');
        let command = buildPandocCommand().replace(/\\\n\s+/g, ' ');

        // Handle reference document for DOCX/ODT
        if (command.includes('--REFERENCE-DOC-PLACEHOLDER--')) {
          $('progressBar').value = 20;
          $('statusText').textContent = t('message.generatingReferenceDoc');

          // Gather margin values
          const marginUnit = $('marginUnit').value;
          let marginTop, marginBottom, marginLeft, marginRight;

          if ($('uniformMargins').checked) {
            const m = parseFloat($('marginAll').value) || 1;
            marginTop = marginBottom = marginLeft = marginRight = m;
          } else {
            marginTop = parseFloat($('marginTop').value) || 1;
            marginBottom = parseFloat($('marginBottom').value) || 1;
            marginLeft = parseFloat($('marginLeft').value) || 1;
            marginRight = parseFloat($('marginRight').value) || 1;
          }

          const refDocPath = await invoke('generate_reference_docx', {
            mainFont: $('mainFont').value || '',
            monoFont: $('monoFont').value || '',
            fontSize: parseInt($('fontSize').value) || 12,
            marginTop,
            marginBottom,
            marginLeft,
            marginRight,
            marginUnit
          });

          command = command.replace('--REFERENCE-DOC-PLACEHOLDER--', `--reference-doc="${refDocPath}"`);
        }

        // Handle dark mode header file for PDF
        if (command.includes('--DARK-MODE-PLACEHOLDER--')) {
          $('progressBar').value = 25;
          $('statusText').textContent = t('message.preparingDarkMode');
          const headerPath = await invoke('write_dark_mode_header');
          command = command.replace('--DARK-MODE-PLACEHOLDER--', `-H "${headerPath}"`);
        }

        // Safety check: ensure no placeholder made it through
        if (command.includes('--DARK-MODE-PLACEHOLDER--') || command.includes('--REFERENCE-DOC-PLACEHOLDER--')) {
          throw new Error(t('message.placeholderNotReplaced'));
        }

        $('progressBar').value = 50;
        $('statusText').textContent = t('message.runningPandoc');
        await invoke('run_pandoc', { command });

        $('progressBar').value = 90;
        $('statusText').textContent = t('message.finalizing');
        setTimeout(() => {
          $('statusText').textContent = t('message.conversionComplete');
          $('progressBar').value = 100;
        }, 200);
        showToast(t('message.conversionSuccess'), 'success');

        // Open file if checkbox is checked
        if ($('openOnComplete').checked) {
          await invoke('open_file', { path: finalPath });
        }
      } else {
        // Web mode - can't actually run pandoc
        setTimeout(() => {
          $('statusText').textContent = t('message.copyCommandTerminal');
          $('progressBar').value = 100;
          showToast(t('message.webModeCopy'), 'info');
        }, 500);
      }
    } catch (err) {
      $('statusText').textContent = t('message.error', { error: err });
      showToast(t('message.conversionFailed', { error: err }), 'error');
    } finally {
      $('convertBtn').disabled = !inputFilePath;
    }
  });
}

// Setup all input listeners for command preview updates
function setupInputListeners() {
  const excludeIds = ['inputFile', 'presetSelect', 'tokensCollapse', 'inputPath', 'outputDir'];

  document.querySelectorAll('input, select').forEach(input => {
    if (!excludeIds.includes(input.id) && input.type !== 'file') {
      input.addEventListener('change', updateCommandPreview);
      if (input.type !== 'checkbox' && input.type !== 'radio') {
        input.addEventListener('input', updateCommandPreview);
      }
    }
  });
}

// Preset Management
const PRESET_STORAGE_KEY = 'pandoc-gui-presets';

function getPresets() {
  try {
    return JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function savePresetsToStorage(presets) {
  localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
}

function getSettingsIds() {
  return [
    'outputFormat', 'pdfEngine', 'titlePage', 'toc', 'lof', 'lot',
    'numberSections', 'standalone', 'darkMode', 'tocDepth', 'tocNewPage', 'topLevelDiv',
    'paperSize', 'orientation', 'marginUnit', 'uniformMargins', 'marginAll',
    'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
    'headerLeft', 'headerCenter', 'headerRight', 'footerLeft', 'footerCenter', 'footerRight',
    'pageNumberFormat', 'pageNumberStyle', 'pageNumberPosition',
    'mainFont', 'monoFont', 'fontSize', 'lineHeight',
    'highlightTheme', 'lineNumbers', 'codeBlockBg', 'codeBlockBgColor',
    'docTitle', 'docAuthor', 'docDate', 'documentClass',
    'filterCrossref', 'filterCiteproc', 'extraArgs', 'colorLinks', 'linkColor', 'openOnComplete'
  ];
}

// Contenteditable fields that need special handling
const contenteditableIds = [
  'docTitle', 'docAuthor', 'docDate',
  'headerLeft', 'headerCenter', 'headerRight',
  'footerLeft', 'footerCenter', 'footerRight'
];

function getCurrentSettings() {
  const settings = {};
  getSettingsIds().forEach(id => {
    const el = $(id);
    if (el) {
      if (el.type === 'checkbox') {
        settings[id] = el.checked;
      } else if (contenteditableIds.includes(id)) {
        // For contenteditable, get the text value
        settings[id] = getTokenFieldValue(el);
      } else {
        settings[id] = el.value;
      }
    }
  });
  return settings;
}

function applySettings(settings) {
  getSettingsIds().forEach(id => {
    const el = $(id);
    if (el && settings[id] !== undefined) {
      if (el.type === 'checkbox') {
        el.checked = settings[id];
      } else if (contenteditableIds.includes(id)) {
        // For contenteditable, set textContent and recreate pills for tokens
        setTokenFieldValue(el, settings[id]);
      } else {
        el.value = settings[id];
      }
    }
  });
  // Trigger UI updates
  $('uniformMargins').dispatchEvent(new Event('change'));
  $('toc').dispatchEvent(new Event('change'));
  handleFormatChange();
  updateCodePreview();
  updateCommandPreview();
}

function updatePresetDropdown() {
  const select = $('presetSelect');
  const presets = getPresets();
  // Clear existing options except first
  while (select.options.length > 1) {
    select.remove(1);
  }
  // Add presets
  Object.keys(presets).sort().forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });
}

function setupPresets() {
  updatePresetDropdown();

  $('savePreset').addEventListener('click', () => {
    // Show the modal
    $('presetNameInput').value = '';
    $('presetModal').showModal();
    $('presetNameInput').focus();
  });

  // Handle preset save confirmation from modal
  $('presetSaveConfirm').addEventListener('click', () => {
    const name = $('presetNameInput').value.trim();
    if (!name) {
      showToast(t('message.enterPresetName'), 'warning');
      return;
    }
    const presets = getPresets();
    presets[name] = getCurrentSettings();
    savePresetsToStorage(presets);
    updatePresetDropdown();
    $('presetSelect').value = name;
    $('presetModal').close();
    showToast(t('message.presetSaved', { name }), 'success');
  });

  // Allow Enter key in preset name input
  $('presetNameInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('presetSaveConfirm').click();
    }
  });

  $('loadPreset').addEventListener('click', () => {
    const name = $('presetSelect').value;
    if (!name) {
      showToast(t('message.selectPresetFirst'), 'warning');
      return;
    }
    const presets = getPresets();
    if (presets[name]) {
      applySettings(presets[name]);
      showToast(t('message.presetLoaded', { name }), 'success');
    }
  });

  $('updatePreset').addEventListener('click', () => {
    const name = $('presetSelect').value;
    if (!name) {
      showToast(t('message.selectPresetFirst'), 'warning');
      return;
    }
    const presets = getPresets();
    presets[name] = getCurrentSettings();
    savePresetsToStorage(presets);
    showToast(t('message.presetUpdated', { name }), 'success');
  });

  $('deletePreset').addEventListener('click', () => {
    const name = $('presetSelect').value;
    if (!name) {
      showToast(t('message.selectPresetFirst'), 'warning');
      return;
    }
    if (!confirm(t('message.deletePreset', { name }))) return;
    const presets = getPresets();
    delete presets[name];
    savePresetsToStorage(presets);
    updatePresetDropdown();
    showToast(t('message.presetDeleted', { name }), 'info');
  });

  // Double-click to load
  $('presetSelect').addEventListener('dblclick', () => {
    if ($('presetSelect').value) {
      $('loadPreset').click();
    }
  });
}

// FAB Menu
function setupFabMenu() {
  // Check dependencies
  $('fabCheckDeps')?.addEventListener('click', async (e) => {
    e.preventDefault();
    document.activeElement?.blur();
    await checkDependencies();
  });

  // Reset to defaults
  $('fabResetDefaults')?.addEventListener('click', (e) => {
    e.preventDefault();
    resetToDefaults();
    document.activeElement?.blur();
    showToast(t('message.settingsReset'), 'info');
  });

  // Copy command from FAB
  $('fabCopyCmd')?.addEventListener('click', (e) => {
    e.preventDefault();
    const cmd = $('commandPreview').textContent;
    const singleLineCmd = cmd.replace(/\\\n\s+/g, ' ');
    navigator.clipboard.writeText(singleLineCmd).then(() => {
      showToast(t('message.commandCopied'), 'success');
    }).catch(() => {
      showToast(t('message.commandCopyFailed'), 'error');
    });
    document.activeElement?.blur();
  });

  // About dialog
  $('fabAbout')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.activeElement?.blur();
    $('aboutModal')?.showModal();
  });
}

// Dependency checker with install commands
const depInstallInfo = {
  'pandoc': {
    brew: 'brew install pandoc',
    apt: 'sudo apt install pandoc',
    url: 'https://pandoc.org/installing.html'
  },
  'tectonic': {
    brew: 'brew install tectonic',
    cargo: 'cargo install tectonic',
    url: 'https://tectonic-typesetting.github.io/'
  },
  'texlive': {
    brew: 'brew install --cask basictex',
    apt: 'sudo apt install texlive-latex-base texlive-fonts-recommended texlive-latex-extra',
    url: 'https://www.tug.org/texlive/',
    note: 'BasicTeX (~100MB). Use tlmgr to install additional packages if needed.'
  },
  'mermaid-filter': {
    npm: 'npm install -g mermaid-filter',
    url: 'https://github.com/raghur/mermaid-filter'
  },
  'pandoc-crossref': {
    brew: 'brew install pandoc-crossref',
    url: 'https://github.com/lierdakil/pandoc-crossref'
  }
};

async function checkDependencies() {
  const modal = $('depsModal');
  const results = $('depsResults');

  // Show modal with loading state
  results.innerHTML = `
    <div class="flex items-center justify-center py-4">
      <span class="loading loading-spinner loading-md"></span>
      <span class="ml-2">${t('label.checkingDependencies')}</span>
    </div>
  `;
  modal.showModal();

  const deps = [
    { name: 'pandoc', cmd: 'pandoc --version', required: true, desc: t('dep.pandoc.desc') },
    { name: 'tectonic', cmd: 'tectonic --version', required: false, desc: t('dep.tectonic.desc') },
    { name: 'texlive', cmd: 'pdflatex --version', required: false, desc: t('dep.texlive.desc') },
    { name: 'mermaid-filter', cmd: 'which mermaid-filter', required: false, desc: t('dep.mermaid.desc') },
    { name: 'pandoc-crossref', cmd: 'pandoc-crossref --version', required: false, desc: t('dep.crossref.desc') },
  ];

  const checkResults = [];

  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');

    for (const dep of deps) {
      try {
        const result = await invoke('check_command', { command: dep.cmd });
        const version = extractVersion(result, dep.name);
        checkResults.push({ ...dep, installed: true, version });
        installedDeps[dep.name] = true;
      } catch (err) {
        checkResults.push({ ...dep, installed: false, version: null });
        installedDeps[dep.name] = false;
      }
    }
  } else {
    // Web mode - assume all installed (can't check)
    checkResults.push(...deps.map(d => ({ ...d, installed: null, version: 'Cannot check in web mode' })));
    Object.keys(installedDeps).forEach(k => installedDeps[k] = true);
  }

  // Update UI based on installed deps
  updateFeatureAvailability();

  // Render results
  results.innerHTML = checkResults.map(dep => {
    const statusIcon = dep.installed === null
      ? `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`
      : dep.installed
        ? `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 ${dep.required ? 'text-error' : 'text-base-content/50'}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;

    const statusClass = dep.installed === null ? 'opacity-70' : (dep.installed ? '' : (dep.required ? 'text-error' : 'opacity-60'));

    // Build action buttons based on installation status
    let actionButtons = '';
    if (dep.installed === false && depInstallInfo[dep.name]) {
      // Install buttons for missing deps
      const info = depInstallInfo[dep.name];
      const buttons = [];

      if (info.brew) {
        buttons.push(`<button class="btn btn-xs btn-primary install-dep-btn" data-method="brew" data-dep="${dep.name}" title="${t('dep.installHomebrew')}">Homebrew</button>`);
      }
      if (info.apt) {
        buttons.push(`<button class="btn btn-xs btn-secondary install-dep-btn" data-method="apt" data-dep="${dep.name}" title="${t('dep.installApt')}">apt</button>`);
      }
      if (info.npm) {
        buttons.push(`<button class="btn btn-xs btn-accent install-dep-btn" data-method="npm" data-dep="${dep.name}" title="${t('dep.installNpm')}">npm</button>`);
      }
      if (info.cargo) {
        buttons.push(`<button class="btn btn-xs btn-info install-dep-btn" data-method="cargo" data-dep="${dep.name}" title="${t('dep.installCargo')}">cargo</button>`);
      }
      if (info.url) {
        buttons.push(`<a href="${info.url}" target="_blank" class="btn btn-xs btn-ghost">${t('dep.docs')}</a>`);
      }
      // Show note for texlive (special case - no auto-install)
      if (info.note) {
        actionButtons = `<div class="flex flex-col gap-1 mt-1">
          <span class="text-xs text-base-content/60">${info.note}</span>
          <div class="flex gap-1">${buttons.join('')}</div>
        </div>`;
      } else if (buttons.length > 0) {
        actionButtons = `<div class="flex gap-1 mt-1 flex-wrap">${buttons.join('')}</div>`;
      }
    } else if (dep.installed === true && dep.name !== 'pandoc') {
      // Reinstall and Uninstall buttons for installed optional deps
      const info = depInstallInfo[dep.name];
      const defaultMethod = info?.brew ? 'brew' : (info?.npm ? 'npm' : (info?.cargo ? 'cargo' : 'brew'));
      actionButtons = `<div class="flex gap-1 mt-1">
        <button class="btn btn-xs btn-ghost reinstall-dep-btn" data-dep="${dep.name}" data-method="${defaultMethod}" title="${t('dep.reinstall')} ${dep.name}">${t('dep.reinstall')}</button>
        <button class="btn btn-xs btn-ghost text-error uninstall-dep-btn" data-dep="${dep.name}" title="${t('dep.uninstall')} ${dep.name}">${t('dep.uninstall')}</button>
      </div>`;
    }

    return `
      <div class="flex items-start gap-3 p-2 rounded-lg bg-base-200 ${statusClass}" data-dep-row="${dep.name}">
        <div class="mt-0.5">${statusIcon}</div>
        <div class="flex-1">
          <div class="font-medium">${dep.name} ${dep.required ? `<span class="badge badge-xs badge-error">${t('dep.required')}</span>` : `<span class="badge badge-xs badge-ghost">${t('dep.optional')}</span>`}</div>
          <div class="text-xs text-base-content/70">${dep.desc}</div>
          ${dep.version ? `<div class="text-xs font-mono text-base-content/50">${dep.version}</div>` : ''}
          ${actionButtons}
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers for install buttons
  results.querySelectorAll('.install-dep-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const method = btn.dataset.method;
      const depName = btn.dataset.dep;

      if (isTauri) {
        await runDepOperation('install_dependency', { name: depName, method }, `${t('label.installing')} ${depName}`);
      } else {
        // Web mode - show info
        showToast(t('message.runInstall', { name: depName }), 'info');
      }
    });
  });

  // Add click handlers for reinstall buttons
  results.querySelectorAll('.reinstall-dep-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const method = btn.dataset.method;
      const depName = btn.dataset.dep;

      if (isTauri) {
        // Use Tauri's dialog API for proper async confirmation
        const { ask } = await import('@tauri-apps/plugin-dialog');
        const confirmed = await ask(t('message.reinstallConfirm', { name: depName }), {
          title: t('message.confirmReinstallTitle'),
          kind: 'warning'
        });

        if (!confirmed) {
          return;
        }

        await runDepOperation('reinstall_dependency', { name: depName, method }, `${t('dep.reinstall')} ${depName}`);
      }
    });
  });

  // Add click handlers for uninstall buttons
  results.querySelectorAll('.uninstall-dep-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const depName = btn.dataset.dep;

      if (isTauri) {
        // Use Tauri's dialog API for proper async confirmation
        const { ask } = await import('@tauri-apps/plugin-dialog');
        const confirmed = await ask(t('message.uninstallConfirm', { name: depName }), {
          title: t('message.confirmUninstallTitle'),
          kind: 'warning'
        });

        if (!confirmed) {
          return;
        }

        await runDepOperation('uninstall_dependency', { name: depName }, `${t('dep.uninstall')} ${depName}`);
      }
    });
  });
}

// Run a dependency operation with progress modal
async function runDepOperation(command, params, title) {
  const progressModal = $('progressModal');
  const progressTitle = $('progressTitle');
  const progressCommand = $('progressCommand');
  const progressOutput = $('progressOutput');
  const cancelBtn = $('progressCancelBtn');
  const closeBtn = $('progressCloseBtn');

  // Clean up any previous listener
  if (activeDepListener) {
    activeDepListener();
    activeDepListener = null;
  }

  // Reset modal
  progressTitle.textContent = title;
  progressCommand.textContent = '';
  progressOutput.textContent = `${t('message.starting')}\n`;
  cancelBtn.classList.remove('hidden');
  closeBtn.classList.add('hidden');

  // Show modal FIRST before setting up listeners
  progressModal.showModal();

  // Setup event listener for output
  const { listen } = await import('@tauri-apps/api/event');
  const { invoke } = await import('@tauri-apps/api/core');

  activeDepListener = await listen('command-output', (event) => {
    const data = event.payload;

    if (data.type === 'start') {
      progressCommand.textContent = data.command;
      progressOutput.textContent = `> ${data.command}\n\n`;
    } else if (data.type === 'stdout' || data.type === 'stderr') {
      progressOutput.textContent += data.line + '\n';
      // Auto-scroll to bottom
      progressOutput.scrollTop = progressOutput.scrollHeight;
    } else if (data.type === 'end') {
      if (data.success) {
        progressOutput.textContent += `\n✓ ${data.message}\n`;
      } else {
        progressOutput.textContent += `\n✗ ${data.message}\n`;
      }
      // Show close button, hide cancel
      cancelBtn.classList.add('hidden');
      closeBtn.classList.remove('hidden');
    }
  });

  // Cancel button handler
  const handleCancel = async () => {
    try {
      await invoke('cancel_all_installs');
      progressOutput.textContent += `\n⚠ ${t('message.operationCancelled')}\n`;
      cancelBtn.classList.add('hidden');
      closeBtn.classList.remove('hidden');
    } catch (e) {
      progressOutput.textContent += `\n${t('message.cancelFailed', { error: e })}\n`;
    }
  };

  cancelBtn.onclick = handleCancel;

  // Close button handler
  closeBtn.onclick = () => {
    progressModal.close();
    if (activeDepListener) {
      activeDepListener();
      activeDepListener = null;
    }
    // Refresh dependency list
    checkDependencies();
  };

  // Run the command
  try {
    await invoke(command, params);
  } catch (e) {
    progressOutput.textContent += `\n✗ Error: ${e}\n`;
    cancelBtn.classList.add('hidden');
    closeBtn.classList.remove('hidden');
  }
}

// Extract version from command output
function extractVersion(output, name) {
  const lines = output.split('\n');
  // Try to find a line with version number
  for (const line of lines) {
    if (line.toLowerCase().includes('version') || line.match(/\d+\.\d+/)) {
      return line.trim().substring(0, 60);
    }
  }
  return lines[0]?.trim().substring(0, 60) || 'Installed';
}

// Update UI features based on installed dependencies
function updateFeatureAvailability() {
  const hasPdfEngine = installedDeps.tectonic || installedDeps.texlive;
  const hasMermaid = installedDeps['mermaid-filter'];
  const hasCrossref = installedDeps['pandoc-crossref'];

  // PDF engine section
  const pdfSection = $('pdfEngineSection');
  const pdfDropdown = pdfSection?.querySelector('.dropdown');
  if (pdfDropdown) {
    if (!hasPdfEngine) {
      pdfDropdown.classList.add('opacity-50', 'pointer-events-none');
      pdfDropdown.setAttribute('title', t('message.noPdfEngine'));
    } else {
      pdfDropdown.classList.remove('opacity-50', 'pointer-events-none');
      pdfDropdown.removeAttribute('title');

      // Disable individual PDF engine options that aren't installed
      const menuItems = pdfSection.querySelectorAll('ul li');
      menuItems.forEach(li => {
        const engineName = li.dataset.engine;
        if (!engineName) return;

        // Map engine names to installed deps
        let isInstalled = false;
        if (engineName === 'tectonic') {
          isInstalled = installedDeps.tectonic;
        } else if (['lualatex', 'xelatex', 'pdflatex'].includes(engineName)) {
          isInstalled = installedDeps.texlive;
        }

        if (!isInstalled) {
          li.classList.add('opacity-40');
          li.querySelector('a')?.classList.add('pointer-events-none');
          const label = li.querySelector('span');
          if (label && !label.dataset.originalText) {
            label.dataset.originalText = label.textContent;
            label.textContent += ` (${t('message.notInstalled')})`;
          }
        } else {
          li.classList.remove('opacity-40');
          li.querySelector('a')?.classList.remove('pointer-events-none');
          const label = li.querySelector('span');
          if (label?.dataset.originalText) {
            label.textContent = label.dataset.originalText;
            delete label.dataset.originalText;
          }
        }
      });

      // Auto-select first available engine if current selection isn't installed
      const currentEngine = $('pdfEngine')?.value;
      const currentEngineInstalled =
        (currentEngine === 'tectonic' && installedDeps.tectonic) ||
        (['lualatex', 'xelatex', 'pdflatex'].includes(currentEngine) && installedDeps.texlive);

      if (!currentEngineInstalled) {
        // Find first available engine
        let firstAvailable = null;
        if (installedDeps.tectonic) firstAvailable = 'tectonic';
        else if (installedDeps.texlive) firstAvailable = 'pdflatex';

        if (firstAvailable) {
          const pdfEngineHidden = $('pdfEngine');
          const pdfEngineLabel = $('pdfEngineLabel');
          if (pdfEngineHidden && pdfEngineLabel) {
            pdfEngineHidden.value = firstAvailable;
            pdfEngineLabel.textContent = firstAvailable === 'tectonic' ? 'Tectonic' : 'pdfLaTeX';
          }
        }
      }
    }
  }

  // Mermaid badge
  const mermaidBadge = document.getElementById('mermaidDetected');
  if (mermaidBadge) {
    const mermaidSection = mermaidBadge.closest('.flex.items-center');
    if (mermaidSection) {
      if (!hasMermaid) {
        mermaidSection.classList.add('opacity-50');
        mermaidSection.setAttribute('title', t('message.mermaidNotInstalled'));
      } else {
        mermaidSection.classList.remove('opacity-50');
        mermaidSection.removeAttribute('title');
      }
    }
  }

  // Crossref checkbox
  const crossrefCheckbox = $('filterCrossref');
  const crossrefLabel = crossrefCheckbox?.closest('label');
  if (crossrefLabel) {
    if (!hasCrossref) {
      crossrefLabel.classList.add('opacity-50');
      crossrefCheckbox.disabled = true;
      crossrefCheckbox.checked = false;
      crossrefLabel.setAttribute('title', t('message.crossrefNotInstalled'));
    } else {
      crossrefLabel.classList.remove('opacity-50');
      crossrefCheckbox.disabled = false;
      crossrefLabel.removeAttribute('title');
    }
  }
}

// Silently check dependencies on startup (no modal)
async function checkDependenciesSilent() {
  if (!isTauri) {
    // Web mode - assume all installed
    Object.keys(installedDeps).forEach(k => installedDeps[k] = true);
    return;
  }

  const deps = [
    { name: 'pandoc', cmd: 'pandoc --version' },
    { name: 'tectonic', cmd: 'tectonic --version' },
    { name: 'texlive', cmd: 'pdflatex --version' },  // Check for TeX Live via pdflatex
    { name: 'mermaid-filter', cmd: 'which mermaid-filter' },
    { name: 'pandoc-crossref', cmd: 'pandoc-crossref --version' },
  ];

  try {
    const { invoke } = await import('@tauri-apps/api/core');

    for (const dep of deps) {
      try {
        await invoke('check_command', { command: dep.cmd });
        installedDeps[dep.name] = true;
      } catch {
        installedDeps[dep.name] = false;
      }
    }
  } catch (e) {
    console.error('Failed to check dependencies:', e);
  }

  updateFeatureAvailability();
}

// Reset to defaults
function resetToDefaults() {
  // Layout
  $('paperSize').value = 'a4';
  $('orientation').value = 'portrait';
  $('fontSize').value = '12';
  $('lineHeight').value = '1.5';
  $('uniformMargins').checked = true;
  $('marginUnit').value = 'in';
  $('marginAll').value = '1';
  $('marginTop').value = '1';
  $('marginBottom').value = '1';
  $('marginLeft').value = '1';
  $('marginRight').value = '1';
  $('pdfEngine').value = 'tectonic';

  // Fonts
  $('mainFont').value = '';
  $('monoFont').value = '';
  $('highlightTheme').value = 'breezedark';
  $('lineNumbers').checked = false;
  $('codeBlockBg').checked = true;
  $('codeBlockBgColor').value = '#282a36';

  // Document
  $('titlePage').checked = false;
  $('toc').checked = false;
  $('numberSections').checked = false;
  $('lof').checked = false;
  $('lot').checked = false;
  $('standalone').checked = true;
  $('tocDepth').value = '3';
  $('tocNewPage').checked = false;
  $('documentClass').value = 'report';
  $('documentClassLabel').textContent = t('value.report');
  $('topLevelDiv').value = 'default';
  $('topLevelDivLabel').textContent = t('value.default');
  if ($('darkMode')) $('darkMode').checked = false;

  // Content (use innerHTML for contenteditable fields)
  $('docTitle').innerHTML = '';
  $('docAuthor').innerHTML = '';
  $('docDate').innerHTML = '';
  $('headerLeft').innerHTML = '';
  $('headerCenter').innerHTML = '';
  $('headerRight').innerHTML = '';
  $('footerLeft').innerHTML = '';
  $('footerCenter').innerHTML = '';
  $('footerRight').innerHTML = '';
  $('pageNumberFormat').value = 'page';
  $('pageNumberPosition').value = 'bottom-center';
  $('pageNumberStyle').value = 'arabic';

  // Advanced
  $('filterCrossref').checked = false;
  $('filterCiteproc').checked = false;
  $('colorLinks').checked = true;
  $('linkColor').value = '#0066cc';
  $('extraArgs').value = '';
  $('openOnComplete').checked = true;

  // Trigger UI updates
  $('uniformMargins').dispatchEvent(new Event('change'));
  $('toc').dispatchEvent(new Event('change'));
  handleFormatChange();
  updateCodePreview();
  updateCommandPreview();
}

// PDF Engine custom dropdown
function setupPdfEngineDropdown() {
  const options = document.querySelectorAll('.pdf-engine-option');
  const label = $('pdfEngineLabel');
  const hiddenInput = $('pdfEngine');

  options.forEach(option => {
    option.addEventListener('click', (e) => {
      // Check if click was on the info-tip icon - if so, don't select
      if (e.target.closest('.info-tip')) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const value = option.dataset.value;
      const text = option.querySelector('span:first-child').textContent;
      label.textContent = text;
      hiddenInput.value = value;
      updateCommandPreview();

      // Close dropdown
      document.activeElement?.blur();
    });
  });
}

// Setup custom FAB menu with accordion submenus
function setupFabMenu2() {
  const fabContainer = $('fabContainer');
  const fabToggle = $('fabToggle');
  const fabMenu = $('fabMenu');
  if (!fabContainer || !fabToggle || !fabMenu) return;

  const closeMenu = () => {
    fabContainer.classList.remove('open');
    fabMenu.querySelectorAll('.fab-accordion').forEach(acc => {
      acc.classList.remove('open');
    });
  };

  // Toggle main menu on button click
  fabToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (fabContainer.classList.contains('open')) {
      closeMenu();
    } else {
      fabContainer.classList.add('open');
    }
  });

  // Close menu when clicking outside (but not on select dropdown options)
  document.addEventListener('click', (e) => {
    // Don't close if clicking inside the fab container
    if (fabContainer.contains(e.target)) {
      return;
    }
    closeMenu();
  });

  // Prevent clicks inside the menu from bubbling up
  fabMenu.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // Setup accordion triggers - only one open at a time
  const accordions = fabMenu.querySelectorAll('.fab-accordion');
  accordions.forEach(accordion => {
    const trigger = accordion.querySelector('.fab-accordion-trigger');
    if (!trigger) return;

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isOpen = accordion.classList.contains('open');
      // Close all other accordions first
      accordions.forEach(acc => acc.classList.remove('open'));
      // Toggle this one (if it was closed, open it)
      if (!isOpen) {
        accordion.classList.add('open');
      }
    });
  });

  // Close menu after clicking certain action items
  const closeActions = ['fabCheckDeps', 'fabResetDefaults', 'fabCopyCmd', 'fabAbout'];
  closeActions.forEach(id => {
    const el = $(id);
    if (el) {
      el.addEventListener('click', () => {
        setTimeout(closeMenu, 100);
      });
    }
  });

  // Theme items should close menu
  fabMenu.querySelectorAll('[data-set-theme]').forEach(link => {
    link.addEventListener('click', () => {
      setTimeout(closeMenu, 100);
    });
  });
}

// ========== UPDATE CHECKER ==========

const GITHUB_REPO = 'ivg-design/pandoc-gui-mk2';
let currentAppVersion = '2.1.1'; // Fallback, will be updated from Rust
let latestReleaseInfo = null;
let downloadedFilePath = null;

// Compare semantic versions (returns 1 if a > b, -1 if a < b, 0 if equal)
function compareVersions(a, b) {
  const partsA = a.replace(/^v/, '').split('.').map(Number);
  const partsB = b.replace(/^v/, '').split('.').map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}

// Check for updates from GitHub releases
async function checkForUpdates(silent = false) {
  try {
    // Get current version from Rust if in Tauri mode
    if (isTauri) {
      const { invoke } = await import('@tauri-apps/api/core');
      try {
        currentAppVersion = await invoke('get_app_version');
        // Update version display in About modal
        const versionSpan = $('appVersion');
        if (versionSpan) versionSpan.textContent = currentAppVersion;
      } catch (e) {
        console.warn('Could not get app version from Rust:', e);
      }
    }

    // Fetch latest release from GitHub API
    const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

    let release;
    if (isTauri) {
      try {
        const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
        const response = await tauriFetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Pandoc-GUI-Update-Checker'
          }
        });
        if (response.status === 404) {
          // No releases published yet
          if (!silent) {
            showToast(t('message.releaseNotFound'), 'info');
          }
          return false;
        }
        if (!response.ok) {
          throw new Error(`GitHub API returned ${response.status}`);
        }
        release = await response.json();
      } catch (httpError) {
        // Fallback to native fetch if Tauri HTTP fails
        const response = await fetch(url);
        if (response.status === 404) {
          if (!silent) {
            showToast(t('message.releaseNotFound'), 'info');
          }
          return false;
        }
        if (!response.ok) {
          throw new Error(`GitHub API returned ${response.status}`);
        }
        release = await response.json();
      }
    } else {
      // Web mode
      const response = await fetch(url);
      if (response.status === 404) {
        if (!silent) {
          showToast(t('message.releaseNotFound'), 'info');
        }
        return false;
      }
      if (!response.ok) {
        throw new Error(`GitHub API returned ${response.status}`);
      }
      release = await response.json();
    }

    const latestVersion = release.tag_name.replace(/^v/, '');

    if (compareVersions(latestVersion, currentAppVersion) > 0) {
      // Update available
      latestReleaseInfo = release;
      showUpdateModal(release);
      return true;
    } else {
      // Already up to date
      if (!silent) {
        showToast(t('message.alreadyLatest'), 'success');
      }
      return false;
    }
  } catch (e) {
    console.error('Failed to check for updates:', e);
    if (!silent) {
      showToast(t('message.updateCheckFailed', { error: e.message }), 'error');
    }
    return false;
  }
}

// Show the update modal with release info
function showUpdateModal(release) {
  const modal = $('updateModal');
  if (!modal) return;

  // Reset modal state
  $('updateInfo').classList.remove('hidden');
  $('downloadProgress').classList.add('hidden');
  $('downloadComplete').classList.add('hidden');
  $('updateDownloadBtn').classList.remove('hidden');
  $('showInFinderBtn').classList.add('hidden');
  $('updateTitle').textContent = t('label.updateAvailable');
  downloadedFilePath = null;

  // Fill in version info
  $('currentVersion').textContent = currentAppVersion;
  $('latestVersion').textContent = release.tag_name.replace(/^v/, '');

  // Parse and display release notes (markdown body)
  const notesContainer = $('updateReleaseNotes');
  if (release.body) {
    // Simple markdown to HTML conversion for common elements
    let notes = release.body
      .replace(/^### (.+)$/gm, '<strong>$1</strong>')
      .replace(/^## (.+)$/gm, '<strong>$1</strong>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
    notesContainer.innerHTML = `<p>${notes}</p>`;
  } else {
    notesContainer.innerHTML = `<p class="text-base-content/70">${t('message.noReleaseNotes')}</p>`;
  }

  modal.showModal();
}

// Get the appropriate DMG asset for this platform
function getDownloadAsset(release) {
  const assets = release.assets || [];

  // Detect architecture
  // On macOS, we can check navigator.userAgent for hints, but
  // for now we'll look for both and prefer universal/aarch64
  const dmgAssets = assets.filter(a => a.name.endsWith('.dmg'));

  if (dmgAssets.length === 0) {
    return null;
  }

  // Prefer universal, then aarch64 (M1/M2), then x64
  const universal = dmgAssets.find(a => a.name.includes('universal'));
  if (universal) return universal;

  const arm = dmgAssets.find(a => a.name.includes('aarch64') || a.name.includes('arm64'));
  if (arm) return arm;

  const x64 = dmgAssets.find(a => a.name.includes('x64') || a.name.includes('x86_64'));
  if (x64) return x64;

  // Fallback to first DMG
  return dmgAssets[0];
}

// Download the update with progress
async function downloadUpdate() {
  if (!latestReleaseInfo || !isTauri) return;

  const asset = getDownloadAsset(latestReleaseInfo);
  if (!asset) {
    showToast(t('message.noCompatibleDownload'), 'error');
    return;
  }

  const { invoke } = await import('@tauri-apps/api/core');
  const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');

  // Switch to progress view
  $('updateInfo').classList.add('hidden');
  $('downloadProgress').classList.remove('hidden');
  $('updateDownloadBtn').classList.add('hidden');
  $('updateTitle').textContent = t('label.downloadingUpdate');

  const progressBar = $('downloadProgressBar');
  const percentText = $('downloadPercent');

  try {
    // Get downloads directory
    const downloadsPath = await invoke('get_downloads_path');
    const filePath = `${downloadsPath}/${asset.name}`;

    // Download with progress using Tauri HTTP plugin
    const response = await tauriFetch(asset.browser_download_url, {
      method: 'GET',
      responseType: 3, // Binary/ArrayBuffer
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    // Get total size for progress
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    const data = await response.arrayBuffer();

    // Update progress to 100%
    progressBar.value = 100;
    percentText.textContent = '100';

    // Write to file using Tauri FS
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    await writeFile(filePath, new Uint8Array(data));

    downloadedFilePath = filePath;

    // Show completion
    $('downloadProgress').classList.add('hidden');
    $('downloadComplete').classList.remove('hidden');
    $('showInFinderBtn').classList.remove('hidden');
    $('downloadPath').textContent = filePath;
    $('updateTitle').textContent = t('label.downloadComplete');

    showToast(t('message.updateDownloaded'), 'success');
  } catch (e) {
    console.error('Download failed:', e);
    showToast(t('message.downloadFailed', { error: e.message }), 'error');

    // Reset modal state
    $('downloadProgress').classList.add('hidden');
    $('updateInfo').classList.remove('hidden');
    $('updateDownloadBtn').classList.remove('hidden');
    $('updateTitle').textContent = t('label.updateAvailable');
  }
}

// Show downloaded file in Finder/Explorer
async function showInFinder() {
  if (!downloadedFilePath || !isTauri) return;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('reveal_in_finder', { path: downloadedFilePath });
  } catch (e) {
    console.error('Failed to reveal in finder:', e);
    showToast(t('message.openLocationFailed'), 'error');
  }
}

// Setup update checker button handlers
function setupUpdateChecker() {
  const checkBtn = $('checkUpdateBtn');
  const downloadBtn = $('updateDownloadBtn');
  const finderBtn = $('showInFinderBtn');

  if (checkBtn) {
    checkBtn.addEventListener('click', () => checkForUpdates(false));
  }

  if (downloadBtn) {
    downloadBtn.addEventListener('click', downloadUpdate);
  }

  if (finderBtn) {
    finderBtn.addEventListener('click', showInFinder);
  }
}

// Initialize everything
async function init() {
  // Detect Tauri first
  await detectTauri();

  initTheme();
  await loadSystemFonts();
  setupFileHandling();
  setupMargins();
  setupCodePreview();
  setupTocHandling();
  setupTokenDrag();
  setupCopyCommand();
  setupConversion();
  setupInputListeners();
  setupPresets();
  setupFabMenu();
  setupLanguageSwitcher();
  setupPdfEngineDropdown();
  setupFabMenu2();
  setupUpdateChecker();

  // Listen for menu About event from Tauri
  if (isTauri) {
    const { listen } = await import('@tauri-apps/api/event');
    listen('show-about', () => {
      $('aboutModal')?.showModal();
    });
  }

  // Check dependencies silently to enable/disable features
  checkDependenciesSilent();

  // Check for updates silently on startup (don't block or show error)
  if (isTauri) {
    setTimeout(() => checkForUpdates(true), 2000);
  }

  // Initial format change to set up visibility
  handleFormatChange();
  applyLanguage();
  updateCodePreview();

  // Initial command preview
  updateCommandPreview();
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', init);
