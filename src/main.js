const { app, BrowserWindow, BrowserView, ipcMain, dialog, session, shell, Menu, Tray, clipboard, desktopCapturer, globalShortcut, net, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { execFile } = require('child_process');

// 启用 Chrome 实验性特性，提高网页兼容性
app.commandLine.appendSwitch('enable-features', 'CSSContainerQueries,CSSLayers,CSSHasPseudoClass');
app.commandLine.appendSwitch('enable-blink-features', 'CSSContainerQueries,CSSLayers,CSSHasPseudoClass');
// 禁用 Private Network Access 限制，允许公网页面访问本地网络（微信客户端检测需要）
app.commandLine.appendSwitch('disable-features', 'IsolateOrigins,site-per-process,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults');

// 提高下载性能：增加每个域名的最大并发连接数（默认6，改为16）
app.commandLine.appendSwitch('max-connections-per-server', '16');

// 修复跨域iframe兼容性（千问等阿里系网站需要）
app.commandLine.appendSwitch('disable-site-isolation-trials', 'true');
app.commandLine.appendSwitch('disable-web-security', 'true');
app.commandLine.appendSwitch('allow-file-access-from-files', 'true');
app.commandLine.appendSwitch('allow-cross-origin-auth-prompt', 'true');
app.commandLine.appendSwitch('disable-renderer-backgrounding', 'true');
app.commandLine.appendSwitch('no-sandbox', 'true');

// 允许本地 HTTPS 自签名证书（微信客户端检测需要访问 https://localhost.weixin.qq.com）
app.commandLine.appendSwitch('ignore-certificate-errors');

// ==================== 运行日志系统 ====================
const MAX_LOG_LINES = 5000;
let runtimeLogs = [];
let logAutoClear = false;

function addLog(level, message, details = '') {
  const timestamp = new Date().toLocaleString('zh-CN');
  const logEntry = `[${timestamp}] [${level}] ${message} ${details}`;
  runtimeLogs.push(logEntry);
  if (runtimeLogs.length > MAX_LOG_LINES) {
    runtimeLogs = runtimeLogs.slice(-MAX_LOG_LINES);
  }
  console.log(logEntry);
}

function getLogs() {
  return runtimeLogs.join('\n');
}

function clearLogs() {
  runtimeLogs = [];
  addLog('INFO', '日志已手动清除');
}

// ==================== 广告拦截规则 ====================
const AD_BLOCK_RULES = [
  '*://*.doubleclick.net/*',
  '*://*.googleadservices.com/*',
  '*://*.googlesyndication.com/*',
  '*://*.google-analytics.com/*',
  '*://*.facebook.com/tr/*',
  '*://*.googletagmanager.com/*',
  '*://*.amazon-adsystem.com/*',
  '*://*.scorecardresearch.com/*',
  '*://*.quantserve.com/*',
  '*://connect.facebook.net/*',
  '*://platform.twitter.com/*',
  '*://*.outbrain.com/*',
  '*://*.taboola.com/*',
  '*://*.mgid.com/*',
  '*://*.revcontent.com/*',
  '*://*.criteo.com/*',
  '*://*.adroll.com/*',
];

function isAdUrl(url) {
  if (!globalState.settings.adblockEnabled) return false;
  // 检查内置规则
  for (const rule of AD_BLOCK_RULES) {
    const regexPattern = rule
      .replace(/\*\:\/\//g, 'https?://')
      .replace(/\*\./g, '([a-zA-Z0-9-]+\.)*')
      .replace(/\.\*/g, '\.([a-zA-Z0-9-]+)*')
      .replace(/\*/g, '.*')
      .replace(/\//g, '\\/');
    try {
      const regex = new RegExp(regexPattern, 'i');
      if (regex.test(url)) {
        addLog('ADBLOCK', '拦截广告', url);
        return true;
      }
    } catch (e) {}
  }
  // 检查用户自定义规则（URL模式）
  for (const rule of globalState.customAdRules) {
    if (rule.urlPattern) {
      try {
        const regex = new RegExp(rule.urlPattern, 'i');
        if (regex.test(url)) {
          addLog('ADBLOCK', '拦截自定义广告', url);
          return true;
        }
      } catch (e) {}
    }
  }
  return false;
}

// ==================== 全局状态 ====================
const globalState = {
  tabs: new Map(),
  activeTabId: null,
  tabCounter: 0,
  bookmarks: [],
  history: [],
  downloads: new Map(),
  customAdRules: [],  // 用户自定义广告规则（CSS选择器 + URL模式）
  settings: {
    homepage: 'https://www.baidu.com',
    searchEngine: 'baidu',
    downloadPath: path.join(app.getPath('downloads'), '超级浏览器下载'),
    darkMode: false,
    privacyMode: false,
    adblockEnabled: true,
    fontSize: 16,
    autoTranslate: true,
    alwaysTranslateNonCjk: true
  },
  mediaUrls: new Map(),
  mediaSizeCache: new Map(), // URL → file size (bytes) from response headers, used when video-element sniffing doesn't have size
  isQuitting: false,
  savedTabs: null
};

const dataPath = path.join(app.getPath('userData'), 'browser-data');
if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true });

function loadData() {
  try {
    const bp = path.join(dataPath, 'bookmarks.json');
    const hp = path.join(dataPath, 'history.json');
    const sp = path.join(dataPath, 'settings.json');
    const dp = path.join(dataPath, 'downloads.json');
    const mp = path.join(dataPath, 'media-urls.json');
    const tp = path.join(dataPath, 'tabs-session.json');
    const ap = path.join(dataPath, 'custom-ad-rules.json');
    if (fs.existsSync(bp)) globalState.bookmarks = JSON.parse(fs.readFileSync(bp, 'utf8'));
    if (fs.existsSync(hp)) globalState.history = JSON.parse(fs.readFileSync(hp, 'utf8'));
    if (fs.existsSync(sp)) globalState.settings = { ...globalState.settings, ...JSON.parse(fs.readFileSync(sp, 'utf8')) };
    if (fs.existsSync(dp)) {
      const downloads = JSON.parse(fs.readFileSync(dp, 'utf8'));
      globalState.downloads = new Map((Array.isArray(downloads) ? downloads : []).map(download => {
        const safeDownload = { ...download };
        if (safeDownload.state === 'progressing') safeDownload.state = 'interrupted';
        safeDownload.paused = false;
        return [safeDownload.id, safeDownload];
      }));
    }
    if (fs.existsSync(mp)) {
      const mediaEntries = JSON.parse(fs.readFileSync(mp, 'utf8'));
      globalState.mediaUrls = new Map(Array.isArray(mediaEntries) ? mediaEntries : []);
    }
    if (fs.existsSync(tp)) {
      globalState.savedTabs = JSON.parse(fs.readFileSync(tp, 'utf8'));
      addLog('SESSION', '加载会话标签页', `${globalState.savedTabs.length} 个`);
    }
    if (fs.existsSync(ap)) {
      globalState.customAdRules = JSON.parse(fs.readFileSync(ap, 'utf8'));
      addLog('ADBLOCK', '加载自定义广告规则', `${globalState.customAdRules.length} 条`);
    }
  } catch (e) { addLog('ERROR', '加载数据失败', e.message); }
}

function saveTabsSession() {
  try {
    const tabs = [];
    globalState.tabs.forEach((tab) => {
      tabs.push({
        url: tab.url,
        title: tab.title,
        favicon: tab.favicon,
        zoomLevel: tab.zoomLevel || 0
      });
    });
    fs.writeFileSync(path.join(dataPath, 'tabs-session.json'), JSON.stringify(tabs));
  } catch (e) { addLog('ERROR', '保存会话失败', e.message); }
}

// 深色模式CSS和函数（全局，确保createTab中did-finish-load可以调用）
const darkModeCSS = `
  html {
    filter: invert(1) hue-rotate(180deg);
  }
  img, video, canvas, svg, picture, iframe {
    filter: invert(1) hue-rotate(180deg);
  }
`;

function applyDarkModeToTab(tab, enabled) {
  if (!tab.webContents || tab.webContents.isDestroyed()) return;
  if (enabled) {
    tab.webContents.executeJavaScript(`
      if (!document.getElementById('__feimaotui_dark_mode__')) {
        var s = document.createElement('style');
        s.id = '__feimaotui_dark_mode__';
        s.textContent = ${JSON.stringify(darkModeCSS)};
        document.head.appendChild(s);
      }
    `).catch(() => {});
  } else {
    tab.webContents.executeJavaScript(`
      var s = document.getElementById('__feimaotui_dark_mode__');
      if (s) s.remove();
    `).catch(() => {});
  }
}

function saveData() {
  try {
    fs.writeFileSync(path.join(dataPath, 'bookmarks.json'), JSON.stringify(globalState.bookmarks));
    fs.writeFileSync(path.join(dataPath, 'history.json'), JSON.stringify(globalState.history.slice(-1000)));
    fs.writeFileSync(path.join(dataPath, 'settings.json'), JSON.stringify(globalState.settings));
    fs.writeFileSync(path.join(dataPath, 'downloads.json'), JSON.stringify(Array.from(globalState.downloads.values()).slice(-500)));
    fs.writeFileSync(path.join(dataPath, 'media-urls.json'), JSON.stringify(Array.from(globalState.mediaUrls.entries())));
    fs.writeFileSync(path.join(dataPath, 'custom-ad-rules.json'), JSON.stringify(globalState.customAdRules || []));
    saveTabsSession();
  } catch (e) { addLog('ERROR', '保存数据失败', e.message); }
}

let mainWindow = null;
let tray = null;
const TOP_OFFSET = 112;
const PANEL_WIDTH = 380;
let rightPanelOpen = false;
const processedDownloadItems = new WeakSet();
const recentDownloadKeys = new Map();
const downloadItems = new Map();
const pendingMediaDownloads = new Map();
const DUPLICATE_DOWNLOAD_WINDOW_MS = 2500;
const PENDING_MEDIA_FALLBACK_WINDOW_MS = 30000;
let downloadListenerRegistered = false;

// ==================== 创建主窗口 ====================
function createMainWindow() {
  addLog('INFO', '开始创建主窗口');

  // 恢复上次会话的标签页（在窗口创建前执行，确保渲染进程启动时标签已存在）
  if (globalState.savedTabs && globalState.savedTabs.length > 0 && globalState.tabs.size === 0) {
    addLog('SESSION', '开始恢复会话', `${globalState.savedTabs.length} 个标签页`);
    globalState.savedTabs.forEach((savedTab, index) => {
      createTab(savedTab.url, {
        active: index === globalState.savedTabs.length - 1,
        title: savedTab.title
      });
    });
    globalState.savedTabs = null;
    addLog('SESSION', '会话恢复完成');
  }

  // 隐藏默认菜单栏，F12 快捷键独立注册
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: '飞毛腿浏览器（BY:老南）',
    icon: path.join(__dirname, '../build/icon.png'),
    // Windows 使用原生标题栏
    frame: true,
    titleBarStyle: 'default',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload', 'preload.js'),
      webSecurity: true,
      sandbox: false
    }
  });

  const indexPath = path.join(__dirname, 'renderer', 'index.html');
  addLog('INFO', '加载渲染页面', indexPath);

  // 检查文件是否存在
  if (!fs.existsSync(indexPath)) {
    addLog('ERROR', 'index.html 不存在', indexPath);
  }

  // 使用 loadURL 而不是 loadFile，兼容性更好
  const fileUrl = 'file://' + indexPath.replace(/\\/g, '/');
  mainWindow.loadURL(fileUrl);

  // 监听文件拖入 → 自动导入书签
  mainWindow.webContents.session.on('will-download', (event, item, webContents) => {
    handleDownload(event, item, webContents);
  });
  // 使用 webContents 的 file-drop-for-security 来处理拖入的书签文件
  mainWindow.on('will-prevent-unload', (event) => {});
  // 监听 preload 发来的关闭按钮诊断信息
  ipcMain.on('close-btn-diag', (event, url, data) => {
    try {
      const items = JSON.parse(data);
      items.forEach(item => addLog('CLOSE-BTN', '关闭按钮诊断', `url=${url} ${item}`));
    } catch(e) {
      addLog('CLOSE-BTN', '关闭按钮诊断', `url=${url} data=${data}`);
    }
  });

  // 监听 preload 发来的关闭按钮修复信息
  ipcMain.on('close-btn-fix', (event, payload) => {
    try {
      const candidates = payload.candidates || [];
      const fixed = payload.fixed || 0;
      const href = payload.href || '';
      addLog('CLOSE-FIX', '修复统计', `href=${href} fixed=${fixed}`);
      candidates.forEach(item => addLog('CLOSE-FIX', '候选元素', item));
    } catch(e) {
      addLog('CLOSE-FIX', '修复信息异常', e.message || 'unknown');
    }
  });

  // 监听渲染进程发来的拖入文件事件
  ipcMain.on('file-dropped', async (event, filePath) => {
    try {
      const lowerPath = String(filePath || '').toLowerCase();
      if (!lowerPath.endsWith('.json') && !lowerPath.endsWith('.html') && !lowerPath.endsWith('.htm')) return;
      const content = fs.readFileSync(filePath, 'utf8');
      const imported = parseBookmarkFile(content, filePath);
      if (!imported || imported.length === 0) return;
      const existingUrls = new Set(globalState.bookmarks.map(b => b.url));
      let addedCount = 0;
      let duplicateCount = 0;
      imported.forEach(item => {
        if (existingUrls.has(item.url)) { duplicateCount++; return; }
        existingUrls.add(item.url);
        globalState.bookmarks.push({
          id: `bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          url: item.url, title: item.title || item.url,
          folder: item.folder || '导入书签', createdAt: Date.now()
        });
        addedCount++;
      });
      saveData();
      addLog('BOOKMARK', '拖入导入书签', `新增 ${addedCount} 个，重复 ${duplicateCount} 个`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bookmarks-imported', { added: addedCount, duplicated: duplicateCount });
      }
    } catch (e) {
      addLog('ERROR', '拖入导入书签失败', e.message);
    }
  });

  // 设置超时，如果 did-finish-load 不触发，强制显示窗口
  const loadTimeout = setTimeout(() => {
    addLog('WARN', '页面加载超时，强制显示窗口');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      setTimeout(() => {
        if (globalState.tabs.size === 0) {
          createTab();
        }
      }, 500);
    }
  }, 3000);

  mainWindow.webContents.on('did-finish-load', () => {
    clearTimeout(loadTimeout);
    addLog('INFO', '渲染页面加载完成');
    mainWindow.show();
    addLog('INFO', '主窗口已显示');
    if (process.env.NODE_ENV === 'development') {
      mainWindow.webContents.openDevTools();
    }
    setTimeout(() => {
      if (globalState.tabs.size === 0) {
        createTab();
        addLog('INFO', '初始标签页已创建');
      }
    }, 300);

  });

  // 注册全局 F12 / Ctrl+Shift+I 快捷键打开/关闭当前标签页的开发者工具
  // 在窗口创建后立即注册，确保快捷键可用
  let devToolsShortcutRegistered = false;
  function toggleActiveTabDevTools() {
    try {
      var activeTab = globalState.tabs.get(globalState.activeTabId);
      var wc = null;
      if (activeTab && activeTab.view && activeTab.view.webContents && !activeTab.view.webContents.isDestroyed()) {
        wc = activeTab.view.webContents;
      } else {
        wc = mainWindow.webContents;
      }
      if (wc && !wc.isDestroyed()) {
        if (wc.isDevToolsOpened()) {
          wc.closeDevTools();
        } else {
          wc.openDevTools({ mode: 'right' });
        }
      }
    } catch(e) {
      addLog('DEVTOOLS', '切换开发者工具失败', e.message || 'unknown');
    }
  }
  if (!devToolsShortcutRegistered) {
    const f12Ok = globalShortcut.register('F12', toggleActiveTabDevTools);
    const csiOk = globalShortcut.register('CommandOrControl+Shift+I', toggleActiveTabDevTools);
    devToolsShortcutRegistered = true;
    addLog('INFO', 'F12快捷键注册', f12Ok ? '成功' : '失败');
    addLog('INFO', 'Ctrl+Shift+I快捷键注册', csiOk ? '成功' : '失败');
  }

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    clearTimeout(loadTimeout);
    addLog('ERROR', '渲染页面加载失败', `${errorDescription} (${errorCode}) URL: ${validatedURL}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  // 监听控制台消息
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const levels = ['debug', 'log', 'warn', 'error'];
    addLog('RENDERER', `[${levels[level] || 'log'}] ${message}`, `${sourceId}:${line}`);
  });

  mainWindow.on('resize', () => {
    if (globalState.activeTabId) {
      resizeActiveTab();
    }
  });

  mainWindow.on('close', (event) => {
    globalState.isQuitting = true;
    saveData();
    // 正常关闭时清除会话文件，下次启动不恢复标签页
    // 只有断电/强制关机时 tabs-session.json 才会保留
    try {
      const sessionFile = path.join(dataPath, 'tabs-session.json');
      if (fs.existsSync(sessionFile)) {
        fs.unlinkSync(sessionFile);
        addLog('SESSION', '正常关闭，清除会话文件');
      }
    } catch (e) {
      addLog('ERROR', '清除会话文件失败', e.message);
    }
    if (logAutoClear) {
      runtimeLogs = [];
    }
    if (tray) {
      tray.destroy();
      tray = null;
    }
    app.quit();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  setupSession();
  return mainWindow;
}

// ==================== 关键修复：三栏布局后的BrowserView尺寸计算 ====================
function resizeActiveTab() {
  updateBrowserViewLayout();
}

function updateBrowserViewLayout() {
  if (!mainWindow || mainWindow.isDestroyed() || !globalState.activeTabId) return;
  const tab = globalState.tabs.get(globalState.activeTabId);
  if (!tab || !tab.view) return;
  const bounds = mainWindow.getContentBounds();
  // 三栏布局：标签栏(36) + 工具栏(44) + 书签栏(32) = 112px
  // 右侧面板是 renderer DOM，BrowserView 是原生层，会压住 DOM。
  // 所以面板打开时必须主动缩小 BrowserView，给右侧 DOM 面板让出空间。
  const reservedRightWidth = rightPanelOpen ? PANEL_WIDTH : 0;
  const viewWidth = Math.max(320, bounds.width - reservedRightWidth);
  tab.view.setBounds({
    x: 0,
    y: TOP_OFFSET,
    width: viewWidth,
    height: bounds.height - TOP_OFFSET
  });
  addLog('TAB', '调整BrowserView尺寸', `x:0, y:${TOP_OFFSET}, w:${viewWidth}, h:${bounds.height - TOP_OFFSET}, rightPanel:${rightPanelOpen}`);
}

function getWheelDirection(inputEvent) {
  const candidates = [
    inputEvent.wheelTicksY,
    inputEvent.deltaY,
    inputEvent.wheelDeltaY,
    inputEvent.y
  ];
  const raw = candidates.find(value => typeof value === 'number' && value !== 0);
  if (typeof raw !== 'number') return 0;
  // Electron 的 wheelTicksY 向上滚动通常为正数，向下为负数；
  // DOM 的 deltaY 则常见为向上负、向下正，所以这里按字段分别处理。
  if (typeof inputEvent.wheelTicksY === 'number' && inputEvent.wheelTicksY !== 0) {
    if (inputEvent.wheelTicksY > 0) return 1;
    return -1;
  }
  if (raw < 0) return 1;
  return -1;
}

function normalizeFontSize(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 16;
  return Math.max(8, Math.min(28, Math.round(parsed)));
}

function applyFontSizeToTab(tab) {
  if (!tab || !tab.webContents || tab.webContents.isDestroyed()) return;
  const fontSize = normalizeFontSize(globalState.settings.fontSize);
  const script = `(() => {
    const styleId = 'feimaotui-font-size-style';
    let style = document.getElementById(styleId);
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      document.documentElement.appendChild(style);
    }
    style.textContent = 'html { font-size: ${fontSize}px !important; }';
  })()`;
  tab.webContents.executeJavaScript(script).catch(error => addLog('SETTINGS', '应用字体大小失败', error.message));
}

function applyFontSizeToAllTabs() {
  for (const tab of globalState.tabs.values()) applyFontSizeToTab(tab);
}

function resetZoomForActiveTab(tabId = globalState.activeTabId) {
  const tab = globalState.tabs.get(tabId);
  if (!tab || !tab.webContents) return;
  tab.zoomLevel = 0;
  tab.webContents.setZoomLevel(0);
  if (globalState.settings) {
    globalState.settings.defaultZoomLevel = 0;
    saveData();
  }
  addLog('SETTINGS', '重置页面缩放', tab.url || tabId);
}

function applyZoomToTab(tab, nextLevel, reason = '页面缩放') {
  if (!tab || !tab.webContents || tab.webContents.isDestroyed()) return;
  const normalizedLevel = Math.max(-3, Math.min(3, Number(nextLevel) || 0));
  tab.zoomLevel = normalizedLevel;
  tab.webContents.setZoomLevel(normalizedLevel);
  // 保存缩放级别到设置
  if (globalState.settings && globalState.settings.defaultZoomLevel !== normalizedLevel) {
    globalState.settings.defaultZoomLevel = normalizedLevel;
    saveData();
  }
  // 同步缩放级别到所有打开的标签页
  for (const otherTab of globalState.tabs.values()) {
    if (otherTab === tab) continue;
    if (!otherTab.webContents || otherTab.webContents.isDestroyed()) continue;
    otherTab.zoomLevel = normalizedLevel;
    otherTab.webContents.setZoomLevel(normalizedLevel);
  }
  addLog('SETTINGS', reason, `级别: ${normalizedLevel}`);
}

function getTabByWebContents(webContents) {
  if (!webContents) return null;
  for (const tab of globalState.tabs.values()) {
    if (tab.webContents && tab.webContents.id === webContents.id) return tab;
  }
  return null;
}

function handleBrowserCtrlWheel(webContents, payload = {}) {
  const tab = getTabByWebContents(webContents);
  if (!tab) return;
  const rawDelta = Number(payload.deltaY || payload.wheelDeltaY || 0);
  if (!rawDelta) return;
  const direction = rawDelta < 0 ? 1 : -1;
  const currentLevel = typeof tab.zoomLevel === 'number' ? tab.zoomLevel : tab.webContents.getZoomLevel();
  applyZoomToTab(tab, currentLevel + direction * 0.5, `Ctrl+滚轮${direction > 0 ? '放大' : '缩小'}`);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJsString(value) {
  return JSON.stringify(String(value || '')).slice(1, -1);
}

function updateBookmark(bookmarkId, patch) {
  const bookmark = globalState.bookmarks.find(b => b.id === bookmarkId);
  if (!bookmark) return null;
  bookmark.title = patch.title || bookmark.title;
  bookmark.url = patch.url || bookmark.url;
  bookmark.folder = patch.folder || bookmark.folder || '默认文件夹';
  bookmark.updatedAt = Date.now();
  saveData();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bookmarks-changed');
  }
  addLog('BOOKMARK', '编辑书签', `${bookmark.title} | ${bookmark.url}`);
  return bookmark;
}

function showBookmarkEditModal(bookmark) {
  if (!mainWindow || mainWindow.isDestroyed() || !bookmark) return;

  const modalId = `bookmark-edit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const saveChannel = `${modalId}-save`;
  const cancelChannel = `${modalId}-cancel`;

  const bookmarkWindow = new BrowserWindow({
    width: 420,
    height: 310,
    parent: mainWindow,
    modal: true,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: '编辑书签',
    frame: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false
    }
  });

  bookmarkWindow.center();

  const cleanup = () => {
    ipcMain.removeAllListeners(saveChannel);
    ipcMain.removeAllListeners(cancelChannel);
  };

  ipcMain.once(saveChannel, (event, payload) => {
    updateBookmark(bookmark.id, payload);
    cleanup();
    if (!bookmarkWindow.isDestroyed()) bookmarkWindow.close();
  });

  ipcMain.once(cancelChannel, () => {
    cleanup();
    if (!bookmarkWindow.isDestroyed()) bookmarkWindow.close();
  });

  bookmarkWindow.on('closed', cleanup);

  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; }
    html { overflow: hidden; }
    body { margin: 0; padding: 22px; overflow: hidden; font-family: "Microsoft YaHei", "Segoe UI", Arial, sans-serif; background: #fff; color: #222; }
    h3 { margin: 0 0 16px; font-size: 18px; font-weight: 600; }
    label { display: block; margin: 12px 0 6px; font-size: 13px; color: #555; }
    input { width: 100%; height: 34px; padding: 6px 10px; border: 1px solid #d9d9d9; border-radius: 6px; outline: none; font-size: 13px; }
    input:focus { border-color: #e65100; box-shadow: 0 0 0 2px rgba(230,81,0,.12); }
    .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; padding-bottom: 2px; }
    button { min-width: 68px; height: 32px; border-radius: 6px; border: 1px solid #d9d9d9; background: #fff; cursor: pointer; }
    button.primary { border-color: #e65100; background: #e65100; color: #fff; }
  </style>
</head>
<body>
  <h3>编辑书签</h3>
  <label>标题</label>
  <input id="title" value="${escapeHtml(bookmark.title)}" />
  <label>网址</label>
  <input id="url" value="${escapeHtml(bookmark.url)}" />
  <div class="actions">
    <button id="cancel">取消</button>
    <button id="save" class="primary">保存</button>
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    const saveChannel = "${escapeJsString(saveChannel)}";
    const cancelChannel = "${escapeJsString(cancelChannel)}";
    document.getElementById('cancel').addEventListener('click', () => ipcRenderer.send(cancelChannel));
    document.getElementById('save').addEventListener('click', () => {
      ipcRenderer.send(saveChannel, {
        title: document.getElementById('title').value.trim(),
        url: document.getElementById('url').value.trim()
      });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') ipcRenderer.send(cancelChannel);
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) document.getElementById('save').click();
    });
    setTimeout(() => document.getElementById('title').focus(), 50);
  </script>
</body>
</html>`;

  bookmarkWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  bookmarkWindow.once('ready-to-show', () => bookmarkWindow.show());
}

let screenshotPickerWindow = null;

function startRegionScreenshot(tabId) {
  if (screenshotPickerWindow) {
    screenshotPickerWindow.close();
    screenshotPickerWindow = null;
  }

  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  screenshotPickerWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    fullscreen: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: true,
    focusable: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  screenshotPickerWindow.loadFile(path.join(__dirname, 'renderer/screenshot-picker.html'));

  screenshotPickerWindow.once('ready-to-show', () => {
    screenshotPickerWindow.show();
    screenshotPickerWindow.focus();
    addLog('SCREENSHOT', '启动区域截图选择');
  });

  screenshotPickerWindow.tabId = tabId;
}

function savePageScreenshot(tab) {
  return tab.webContents.capturePage().then(image => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `screenshot-${timestamp}.png`;
    const filePath = path.join(globalState.settings.downloadPath, fileName);
    if (!fs.existsSync(globalState.settings.downloadPath)) {
      fs.mkdirSync(globalState.settings.downloadPath, { recursive: true });
    }
    fs.writeFileSync(filePath, image.toPNG());
    addLog('SCREENSHOT', '截图保存', filePath);
    shell.showItemInFolder(filePath);
    return filePath;
  });
}

function showPageContextMenu(tabId, params) {
  const tab = globalState.tabs.get(tabId);
  if (!tab || !tab.webContents || !mainWindow || mainWindow.isDestroyed()) return;

  const menuItems = [
    {
      label: '返回',
      enabled: tab.webContents.canGoBack(),
      click: () => tab.webContents.goBack()
    },
    {
      label: '前进',
      enabled: tab.webContents.canGoForward(),
      click: () => tab.webContents.goForward()
    },
    {
      label: '刷新',
      click: () => tab.webContents.reload()
    },
    { type: 'separator' }
  ];

  // 如果选中文本，添加复制选项
  if (params && params.selectionText && params.selectionText.trim()) {
    menuItems.push({
      label: '复制',
      click: () => tab.webContents.copy()
    });
  }

  // 如果是可编辑区域，添加粘贴选项
  if (params && (params.isEditable || params.inputFieldType !== 'none')) {
    menuItems.push({
      label: '粘贴',
      click: () => tab.webContents.paste()
    });
    menuItems.push({
      label: '剪切',
      click: () => tab.webContents.cut()
    });
  }

  menuItems.push({
    label: '全选',
    click: () => tab.webContents.selectAll()
  });

  menuItems.push({ type: 'separator' });

  // 如果是链接，添加"在新标签页打开链接"
  if (params && params.linkURL) {
    menuItems.push({
      label: '在新标签页打开链接',
      click: () => {
        createTab(params.linkURL, { active: false });
      }
    });
    menuItems.push({
      label: '复制链接地址',
      click: () => {
        const { clipboard } = require('electron');
        clipboard.writeText(params.linkURL);
      }
    });
    menuItems.push({ type: 'separator' });
  }

  // 如果是图片，添加"复制图片"和"将图片另存为"
  if (params && params.srcURL) {
    menuItems.push({
      label: '复制图片',
      click: () => tab.webContents.copyImageAt(params.x, params.y)
    });
    menuItems.push({
      label: '将图片另存为',
      click: () => {
        const { dialog } = require('electron');
        const fileName = getFileNameFromUrl(params.srcURL) || 'image.png';
        dialog.showSaveDialog(mainWindow, {
          title: '将图片另存为',
          defaultPath: path.join(globalState.settings.downloadPath || app.getPath('downloads'), fileName),
          filters: [
            { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
            { name: '所有文件', extensions: ['*'] }
          ]
        }).then(result => {
          if (!result.canceled && result.filePath) {
            const https = require('https');
            const http = require('http');
            const url = require('url');
            const imgUrl = params.srcURL;
            const parsedUrl = url.parse(imgUrl);
            const mod = parsedUrl.protocol === 'https:' ? https : http;
            const file = fs.createWriteStream(result.filePath);
            mod.get(imgUrl, (response) => {
              if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                mod.get(response.headers.location, (redirectResponse) => {
                  redirectResponse.pipe(file);
                });
              } else {
                response.pipe(file);
              }
              file.on('finish', () => {
                file.close();
                addLog('INFO', '图片另存为', result.filePath);
              });
            }).on('error', (err) => {
              fs.unlink(result.filePath, () => {});
              addLog('ERROR', '图片另存为失败', err.message);
            });
          }
        });
      }
    });
    menuItems.push({ type: 'separator' });
  }

  menuItems.push({
    label: '打印',
    click: () => tab.webContents.print({ silent: false, printBackground: true })
  });
  menuItems.push({
    label: '截图',
    click: () => startRegionScreenshot(tabId)
  });

  menuItems.push({ type: 'separator' });

  // 标记为广告（支持批量标记）
  menuItems.push({
    label: '标记为广告',
    click: () => {
      addLog('ADBLOCK', '开始标记广告', `坐标: x=${params.x}, y=${params.y}`);
      tab.webContents.executeJavaScript(`
        (function() {
          // 生成CSS选择器
          function getSelector(element) {
            if (element.id) return '#' + CSS.escape(element.id);
            var path = [];
            var current = element;
            while (current && current !== document.body) {
              var selector = current.tagName.toLowerCase();
              if (current.className && typeof current.className === 'string') {
                var classes = current.className.trim().split(/\\s+/).filter(c => c && !/^ad|^banner|^sponsor/i.test(c));
                if (classes.length > 0) {
                  selector += '.' + classes.map(c => CSS.escape(c)).join('.');
                }
              }
              var parent = current.parentElement;
              if (parent) {
                var siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
                if (siblings.length > 1) {
                  var index = siblings.indexOf(current) + 1;
                  selector += ':nth-of-type(' + index + ')';
                }
              }
              path.unshift(selector);
              current = parent;
            }
            return path.join(' > ');
          }
          
          // 从文本选择范围收集元素（只收集最内层元素，避免隐藏大块内容）
          function collectElementsFromTextSelection() {
            var selection = window.getSelection();
            if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return [];
            var range = selection.getRangeAt(0);
            var elements = [];
            var seen = new Set();
            var commonAncestor = range.commonAncestorContainer;
            if (commonAncestor.nodeType === Node.TEXT_NODE) {
              commonAncestor = commonAncestor.parentElement;
            }
            if (!commonAncestor || commonAncestor === document.body || commonAncestor === document.documentElement) return [];
            
            var walker = document.createTreeWalker(commonAncestor, NodeFilter.SHOW_ELEMENT, {
              acceptNode: function(node) {
                if (node === document.body || node === document.documentElement) return NodeFilter.FILTER_REJECT;
                return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
              }
            });
            var node;
            while ((node = walker.nextNode())) {
              if (!seen.has(node)) { seen.add(node); elements.push(node); }
            }
            
            // 过滤掉祖先元素，只保留叶子元素
            var leafElements = elements.filter(function(el) {
              return !elements.some(function(other) {
                return other !== el && el.contains(other);
              });
            });
            
            // 内联元素向上查找到块级容器
            var inlineTags = {'SPAN':1,'A':1,'STRONG':1,'EM':1,'B':1,'I':1,'U':1,'SMALL':1,'SUB':1,'SUP':1,'LABEL':1,'CODE':1,'MARK':1};
            var containers = [];
            var containerSeen = new Set();
            function addContainer(el) {
              if (!el || el === document.body || el === document.documentElement) return;
              if (containerSeen.has(el)) return;
              containerSeen.add(el);
              containers.push(el);
            }
            leafElements.forEach(function(el) {
              if (el.matches && el.matches('img, iframe, video, svg, canvas, embed, object, [style*="background-image"]')) {
                addContainer(el);
                return;
              }
              var current = el, depth = 0;
              while (current && inlineTags[current.tagName] && depth < 5 && current.parentElement && current.parentElement !== document.body) {
                current = current.parentElement;
                depth++;
              }
              addContainer(current);
            });
            
            // 只保留最内层容器
            var result = containers.filter(function(el) {
              return !containers.some(function(other) {
                return other !== el && el.contains(other) && !other.contains(el);
              });
            });
            
            if (result.length > 15) result = result.slice(0, 15);
            return result;
          }
          
          // 收集所有要标记的元素（去重）
          var elementsToMark = [];
          var seenElements = new Set();
          
          function addElement(el) {
            if (!el || el === document.body || el === document.documentElement) return;
            if (seenElements.has(el)) return;
            seenElements.add(el);
            elementsToMark.push({
              selector: getSelector(el),
              tagName: el.tagName,
              text: (el.textContent || '').substring(0, 50).trim(),
              className: el.className || ''
            });
            // 清除选中样式
            el.removeAttribute('data-feimaotui-selected');
            el.style.outline = '';
            el.style.outlineOffset = '';
          }
          
          // 1. 先收集data-feimaotui-selected标记的元素
          document.querySelectorAll('[data-feimaotui-selected="true"]').forEach(addElement);
          
          // 2. 再从文本选择中收集元素
          collectElementsFromTextSelection().forEach(addElement);
          
          // 清除文本选择
          window.getSelection().removeAllRanges();
          
          if (elementsToMark.length > 0) {
            return JSON.stringify({
              mode: elementsToMark.length > 1 ? 'batch' : 'single',
              count: elementsToMark.length,
              elements: elementsToMark
            });
          } else {
            // 单个标记模式：右键点击的元素
            var el = document.elementFromPoint(${params.x}, ${params.y});
            if (!el) return null;
            return JSON.stringify({
              mode: 'single',
              count: 1,
              elements: [{
                selector: getSelector(el),
                tagName: el.tagName,
                text: (el.textContent || '').substring(0, 50).trim(),
                className: el.className || ''
              }]
            });
          }
        })();
      `, true).then(result => {
        if (result) {
          try {
            var data = JSON.parse(result);
            var domain = new URL(tab.webContents.getURL()).hostname;
            var addedCount = 0;
            var existCount = 0;
            
            addLog('ADBLOCK', '标记模式', data.mode === 'batch' ? '批量标记' : '单个标记');
            
            data.elements.forEach(function(info) {
              addLog('ADBLOCK', '获取元素信息', '标签: ' + info.tagName + ', 类名: ' + info.className + ', 文本: ' + info.text);
              var rule = {
                selector: info.selector,
                urlPattern: '',
                domain: domain,
                createdAt: Date.now()
              };
              // 检查是否已存在
              var exists = globalState.customAdRules.some(r => r.selector === rule.selector && r.domain === rule.domain);
              if (!exists) {
                globalState.customAdRules.push(rule);
                addedCount++;
                addLog('ADBLOCK', '保存广告规则', '选择器: ' + info.selector + ', 域名: ' + domain);
              } else {
                existCount++;
                addLog('ADBLOCK', '规则已存在', '选择器: ' + info.selector);
              }
            });
            
            saveData();
            addLog('ADBLOCK', '批量保存完成', '新增: ' + addedCount + ' 条, 已存在: ' + existCount + ' 条');
            
            // 立即隐藏当前页面的所有匹配元素
            tab.webContents.executeJavaScript(`
              (function() {
                var rules = ${JSON.stringify(data.elements.map(e => e.selector))};
                var totalCount = 0;
                rules.forEach(function(selector) {
                  try {
                    var els = document.querySelectorAll(selector);
                    els.forEach(function(el) {
                      el.setAttribute('style', 'display: none !important; visibility: hidden !important; height: 0 !important; overflow: hidden !important;');
                      totalCount++;
                    });
                  } catch(e) {}
                });
                return totalCount;
              })();
            `).then(count => {
              addLog('ADBLOCK', '已隐藏元素', '成功隐藏 ' + count + ' 个元素');
            }).catch(err => {
              addLog('ADBLOCK', '隐藏元素失败', err.message);
            });
          } catch(e) {
            addLog('ADBLOCK', '解析失败', e.message);
          }
        } else {
          addLog('ADBLOCK', '未获取到元素', 'elementFromPoint返回null');
        }
      }).catch(err => {
        addLog('ADBLOCK', '执行JS失败', err.message);
      });
    }
  });

  // 开发者工具
  menuItems.push({
    label: '开发者工具',
    click: () => {
      tab.webContents.openDevTools({ mode: 'right' });
    }
  });

  const menu = Menu.buildFromTemplate(menuItems);

  addLog('INFO', '显示网页右键菜单', tab.url);
  menu.popup({ window: mainWindow });
}

// ==================== 会话设置 ====================
function setupSessionHandlersForPartition(sess, partitionLabel) {
  const filter = { urls: ['*://*/*'] };
  const label = partitionLabel || 'default';

  // onBeforeRequest: 广告拦截 + 崩溃SDK拦截 + URL级媒体嗅探
  sess.webRequest.onBeforeRequest(filter, (details, callback) => {
    const url = details.url;
    if (isAdUrl(url)) {
      callback({ cancel: true });
      return;
    }
    // 阻止阿里系监控SDK加载，避免在Electron中触发渲染进程崩溃（千问等）
    if (url.indexOf('fireyejs') !== -1 || url.indexOf('arms-retcode') !== -1) {
      addLog('BLOCK', '拦截崩溃SDK(' + label + ')', url.substring(0, 100));
      callback({ cancel: true });
      return;
    }
    if (isMediaUrl(url)) {
      registerMediaCandidate(details.webContentsId, url, {
        source: 'url',
        type: getMediaType(url)
      });
    }
    callback({});
  });

  // onBeforeSendHeaders: Range请求媒体嗅探 + 伪装Sec-CH-UA头
  sess.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const requestHeaders = details.requestHeaders || {};
    const rangeHeader = requestHeaders.Range || requestHeaders.range;
    if (rangeHeader && isLikelyMediaRequest(details.url, requestHeaders)) {
      registerMediaCandidate(details.webContentsId, details.url, {
        source: 'range-request',
        type: getMediaType(details.url),
        title: getFileNameFromUrl(details.url)
      });
    }
    // 伪装 Sec-CH-UA 头，让网站认为这是真正的 Chrome 浏览器
    if (requestHeaders['Sec-CH-UA'] || requestHeaders['sec-ch-ua']) {
      const key = requestHeaders['Sec-CH-UA'] ? 'Sec-CH-UA' : 'sec-ch-ua';
      requestHeaders[key] = '"Not_A Brand";v="8", "Chromium";v="148", "Google Chrome";v="148"';
    }
    if (requestHeaders['Sec-CH-UA-Mobile'] || requestHeaders['sec-ch-ua-mobile']) {
      const key = requestHeaders['Sec-CH-UA-Mobile'] ? 'Sec-CH-UA-Mobile' : 'sec-ch-ua-mobile';
      requestHeaders[key] = '?0';
    }
    if (requestHeaders['Sec-CH-UA-Platform'] || requestHeaders['sec-ch-ua-platform']) {
      const key = requestHeaders['Sec-CH-UA-Platform'] ? 'Sec-CH-UA-Platform' : 'sec-ch-ua-platform';
      requestHeaders[key] = '"Windows"';
    }
    callback({ requestHeaders });
  });

  // onHeadersReceived: Content-Type媒体嗅探
  sess.webRequest.onHeadersReceived(filter, (details, callback) => {
    const ct = details.responseHeaders['content-type'] || details.responseHeaders['Content-Type'];
    const cd = details.responseHeaders['content-disposition'] || details.responseHeaders['Content-Disposition'];
    const cl = details.responseHeaders['content-length'] || details.responseHeaders['Content-Length'];
    const contentType = ct && ct[0] ? ct[0] : '';
    const contentDisposition = cd && cd[0] ? cd[0] : '';
    const contentLength = cl && cl[0] ? parseInt(cl[0]) : 0;
    if ((contentType && isMediaContentType(contentType)) || isLikelyMediaResponse(details.url, contentType, contentDisposition, contentLength)) {
      // 缓存文件大小，供 video-element 嗅探时使用
      if (contentLength > 0) {
        const normUrl = normalizeMediaDownloadUrl(details.url);
        globalState.mediaSizeCache.set(normUrl, contentLength);
      }
      registerMediaCandidate(details.webContentsId, details.url, {
        source: 'response-header',
        type: contentType || getMediaType(details.url),
        contentType,
        size: contentLength,
        title: getFileNameFromDisposition(contentDisposition) || getFileNameFromUrl(details.url)
      });
    }
    callback({ responseHeaders: details.responseHeaders });
  });

  // onCompleted: chunked响应更新媒体大小 + 后过滤小文件
  sess.webRequest.onCompleted(filter, (details) => {
    if (details.statusCode !== 200) return;
    const url = details.url;
    const tabId = getTabIdFromWebContents(details.webContentsId);
    
    // 缓存实际文件大小，供后续 video-element 嗅探使用
    if (details.responseHeaders) {
      const cl = details.responseHeaders['content-length'] || details.responseHeaders['Content-Length'];
      const actualSize = cl && cl[0] ? parseInt(cl[0]) : 0;
      if (actualSize > 0) {
        const normUrl = normalizeMediaDownloadUrl(url);
        globalState.mediaSizeCache.set(normUrl, actualSize);
      }
    }
    
    if (!tabId) return;
    const list = globalState.mediaUrls.get(tabId);
    if (!list) return;
    const found = list.find(m => m.url === url);
    if (found && details.responseHeaders) {
      const cl = details.responseHeaders['content-length'] || details.responseHeaders['Content-Length'];
      const actualSize = cl && cl[0] ? parseInt(cl[0]) : 0;
      if (actualSize > 0) {
        // 更新文件大小
        if (actualSize > (found.size || 0)) {
          found.size = actualSize;
        }
        // 后过滤：实际大小 < 800KB 且不是流媒体，移除
        const isStream = /\.(m3u8|mpd)(\?|$)/i.test(url);
        if (actualSize < 800 * 1024 && !isStream) {
          const idx = list.indexOf(found);
          if (idx > -1) {
            list.splice(idx, 1);
            addLog('MEDIA', '过滤小文件', `${found.title}: ${actualSize} bytes < 800KB`);
            saveData();
          }
          return;
        }
        saveData();
        addLog('MEDIA', '更新媒体文件大小', `${found.title}: ${actualSize} bytes`);
      }
    }
  });

  // will-download: 下载监听（每个session只需注册一次）
  sess.on('will-download', (event, item, webContents) => {
    handleDownload(event, item, webContents);
  });
}

function setupSession() {
  // 为所有会用到的分区注册完整的处理器（广告拦截+媒体嗅探+下载）
  // defaultSession: 主窗口（标签栏、设置页等）
  setupSessionHandlersForPartition(session.defaultSession, 'default');

  // persist:main: 普通标签页使用的分区
  try {
    setupSessionHandlersForPartition(session.fromPartition('persist:main'), 'persist:main');
  } catch(e) {
    addLog('WARN', 'persist:main会话配置失败', e.message || 'unknown');
  }

  // persist:privacy: 无痕模式标签页使用的分区
  try {
    setupSessionHandlersForPartition(session.fromPartition('persist:privacy'), 'persist:privacy');
  } catch(e) {
    addLog('WARN', 'persist:privacy会话配置失败', e.message || 'unknown');
  }
}

function isMediaUrl(url) {
  if (isStaticAssetUrl(url)) return false;
  // 获取URL路径部分（去掉查询参数）
  const pathPart = String(url || '').split('?')[0].toLowerCase();
  // 严格匹配：视频扩展名必须在路径末尾
  const videoExts = ['.mp4','.webm','.ogg','.ogv','.mkv','.avi','.mov','.flv','.m3u8','.mpd','.m4v','.3gp','.wmv'];
  const hasVideoExt = videoExts.some(ext => pathPart.endsWith(ext));
  if (hasVideoExt) return true;
  // 检查URL参数中的视频标识
  const lower = url.toLowerCase();
  return lower.includes('mime=video') ||
    /[?&](type|format|mime|content_type)=([^&]*)(video|mp4|m3u8|mov|webm)/i.test(lower);
}

function getMediaType(url) {
  // 获取URL路径部分（去掉查询参数）
  const pathPart = String(url || '').split('?')[0].toLowerCase();
  if (pathPart.endsWith('.mp4')) return 'video/mp4';
  if (pathPart.endsWith('.webm')) return 'video/webm';
  if (pathPart.endsWith('.m3u8')) return 'application/x-mpegURL';
  if (pathPart.endsWith('.mpd')) return 'application/dash+xml';
  if (pathPart.endsWith('.mov')) return 'video/quicktime';
  if (pathPart.endsWith('.mkv')) return 'video/x-matroska';
  if (pathPart.endsWith('.avi')) return 'video/x-msvideo';
  if (pathPart.endsWith('.flv')) return 'video/x-flv';
  return 'video/unknown';
}

function isMediaContentType(ct) {
  const lower = String(ct || '').toLowerCase();
  if (isStaticAssetContentType(lower)) return false;
  return lower.includes('video/') ||
    lower.includes('application/x-mpegurl') ||
    lower.includes('application/vnd.apple.mpegurl') ||
    lower.includes('application/dash+xml');
}

function isStaticAssetUrl(url) {
  const lower = String(url || '').toLowerCase().split('?')[0];
  return /\.(woff2?|ttf|otf|eot|css|js|mjs|map|png|jpe?g|gif|webp|svg|ico|avif|bmp)$/i.test(lower);
}

function isStaticAssetContentType(contentType = '') {
  const lower = String(contentType || '').toLowerCase();
  return lower.includes('font/') ||
    lower.includes('application/font') ||
    lower.includes('application/x-font') ||
    lower.includes('application/woff') ||
    lower.includes('application/woff2') ||
    lower.includes('font-woff2') ||
    lower.includes('text/css') ||
    lower.includes('javascript') ||
    lower.includes('image/');
}

function isLikelyMediaRequest(url, requestHeaders = {}) {
  const lower = String(url || '').toLowerCase();
  if (isStaticAssetUrl(lower)) return false;
  const accept = String(requestHeaders.Accept || requestHeaders.accept || '').toLowerCase();
  if (isStaticAssetContentType(accept)) return false;
  const referer = String(requestHeaders.Referer || requestHeaders.referer || '').toLowerCase();
  return isMediaUrl(lower) ||
    accept.includes('video') ||
    /\/(video|media|vod|play|preview|stream|m3u8|mp4)\b/i.test(lower) ||
    /\/(video|creative|material|asset|library|素材|视频)/i.test(referer);
}

function isLikelyMediaResponse(url, contentType = '', contentDisposition = '', contentLength = 0) {
  const lowerUrl = String(url || '').toLowerCase();
  if (isStaticAssetUrl(lowerUrl) || isStaticAssetContentType(contentType)) return false;
  const lowerDisposition = String(contentDisposition || '').toLowerCase();
  const largeBinary = contentLength > 512 * 1024 && /octet-stream|binary/.test(String(contentType || '').toLowerCase());
  return isMediaUrl(lowerUrl) ||
    /\.(mp4|webm|mov|m4v|m3u8|mpd|m4s|ts)(\?|$)/i.test(lowerDisposition) ||
    /filename=.*\.(mp4|webm|mov|m4v|m3u8|mpd|m4s|ts)/i.test(lowerDisposition) ||
    largeBinary && /\/(video|media|vod|play|preview|stream)\b/i.test(lowerUrl);
}

function isValidVideoCandidate(url, meta = {}) {
  if (!url || isStaticAssetUrl(url) || isStaticAssetContentType(meta.contentType || meta.type || '')) return false;
  
  // 过滤非媒体文件扩展名（.htm, .html, .json, .xml 等）
  const urlPath = String(url).split('?')[0].toLowerCase();
  if (/\.(html?|json|xml|css|js|txt|pdf|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|eot)(\?|$|#)/i.test(urlPath)) return false;
  
  // 忽略小于 800KB 的文件（除非是流媒体格式如 m3u8/mpd）
  const size = meta.size || meta.contentLength || 0;
  const isStream = /\.(m3u8|mpd)(\?|$)/i.test(String(url || ''));
  if (size >= 800 * 1024 || isStream) {
    // 大小已知且 >= 800KB，或者流媒体格式，继续判断
  } else if (size > 0 && size < 800 * 1024) {
    // 大小已知但 < 800KB，直接过滤
    return false;
  } else {
    // size === 0（未知大小），需要进一步判断：
    // 如果是明确的视频类型或视频URL，先放行，后续由 onCompleted 更新大小后再过滤
    const contentType = String(meta.contentType || meta.type || '').toLowerCase();
    if (contentType.includes('video/') || contentType.includes('mpegurl') || contentType.includes('dash+xml')) {
      // 明确是视频类型，放行
    } else if (isMediaUrl(url)) {
      // URL 明确是媒体格式，放行
    } else {
      // 既没有大小信息，也不是明确的视频类型/URL，过滤掉
      return false;
    }
  }
  const title = String(meta.title || getFileNameFromUrl(url) || '').toLowerCase();
  if (isStaticAssetUrl(title)) return false;
  const contentType = String(meta.contentType || meta.type || '').toLowerCase();
  if (contentType.includes('video/') || contentType.includes('mpegurl') || contentType.includes('dash+xml')) return true;
  return isMediaUrl(url) || /\.(mp4|webm|mov|m4v|m3u8|mpd|avi|mkv|flv|wmv)(\?|$)/i.test(title);
}

function getFileNameFromUrl(url) {
  try {
    const u = new URL(url);
    const part = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    return part || u.hostname;
  } catch (e) {
    return String(url || '').split('/').pop() || 'media';
  }
}

function getFileNameFromDisposition(contentDisposition = '') {
  const value = String(contentDisposition || '');
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    try { return decodeURIComponent(utf8Match[1]); } catch (e) {}
  }
  const normalMatch = value.match(/filename="?([^";]+)"?/i);
  return normalMatch ? normalMatch[1] : '';
}

function registerMediaCandidate(webContentsId, url, meta = {}) {
  if (!url || String(url).startsWith('blob:') || String(url).startsWith('data:')) return null;
  if (!isValidVideoCandidate(url, meta)) return null;
  const tabId = getTabIdFromWebContents(webContentsId);
  if (!tabId) return null;
  if (!globalState.mediaUrls.has(tabId)) globalState.mediaUrls.set(tabId, []);
  const existing = globalState.mediaUrls.get(tabId);

  // URL 去重：归一化后检查是否已经存在，避免重复加入
  const normalizedUrl = normalizeMediaDownloadUrl(url);
  const alreadyExists = existing.some(m => normalizeMediaDownloadUrl(m.url) === normalizedUrl);
  if (alreadyExists) {
    addLog('MEDIA', '跳过重复媒体', `${url} (already in list)`);
    return null;
  }
  
  // 从 URL 或 title 中提取视频基础名称（去掉分辨率标识如 _720p, _1080p, -720, 720p 等）
  const rawName = String(meta.title || getFileNameFromUrl(url) || '').replace(/\.(mp4|webm|mov|m4v|avi|mkv|flv|wmv)$/i, '');
  const baseName = rawName.replace(/[_\- ]*(720p|1080p|480p|360p|240p|144p|720|1080|480|360|240|144)[_\- ]*/gi, '').trim() || rawName;

  // 检查是否已有同名视频的多个分辨率版本
  const sameBase = existing.filter(m => {
    const mRaw = String(m.title || '').replace(/\.(mp4|webm|mov|m4v|avi|mkv|flv|wmv)$/i, '');
    const mBase = mRaw.replace(/[_\- ]*(720p|1080p|480p|360p|240p|144p|720|1080|480|360|240|144)[_\- ]*/gi, '').trim() || mRaw;
    return mBase === baseName && m.url !== url;
  });

  const newSize = meta.size || meta.contentLength || 0;
  // 如果嗅探时没有拿到大小，尝试从缓存中查找（onHeadersReceived/onCompleted 提前缓存）
  if (!newSize) {
    const normUrl = normalizeMediaDownloadUrl(url);
    const cachedSize = globalState.mediaSizeCache.get(normUrl);
    if (cachedSize) {
      meta.size = cachedSize;
    }
  }
  if (sameBase.length > 0) {
    const best = sameBase.reduce((a, b) => ((a.size || 0) > (b.size || 0) ? a : b));
    const bestSize = best.size || 0;

    if (newSize > bestSize) {
      // 新版本文件更大，移除旧的
      const idx = existing.indexOf(best);
      existing.splice(idx, 1);
      addLog('MEDIA', `发现更高清版本(${meta.source})`, `${best.title} → ${rawName}`);
    } else if (newSize === bestSize) {
      // 文件大小相同或都未知，比较 URL 中的分辨率标记
      const newRes = extractResolution(url);
      const oldRes = extractResolution(best.url);
      if (newRes > oldRes) {
        // 新版本分辨率更高，替换旧的
        const idx = existing.indexOf(best);
        existing.splice(idx, 1);
        addLog('MEDIA', `替换为更高分辨率版本(${meta.source})`, `${oldRes}p → ${newRes}p`);
      } else if (newRes === oldRes) {
        // 分辨率相同，保留已有的
        return null;
      } else {
        // 旧版本分辨率更高，忽略新的
        return null;
      }
    } else {
      // 旧版本更大，忽略新的
      return null;
    }
  }

  const found = existing.find(m => m.url === url);
  if (found) {
    // 检查是否已有同名视频的更高分辨率版本，避免被替换后又加回来
    const sameBaseNow = existing.filter(m => {
      const mRaw = String(m.title || '').replace(/\.(mp4|webm|mov|m4v|avi|mkv|flv|wmv)$/i, '');
      const mBase = mRaw.replace(/[_\- ]*(720p|1080p|480p|360p|240p|144p|720|1080|480|360|240|144)[_\- ]*/gi, '').trim() || mRaw;
      return mBase === baseName && m.url !== url;
    });
    if (sameBaseNow.length > 0) {
      const best = sameBaseNow.reduce((a, b) => ((a.size || 0) > (b.size || 0) ? a : b));
      const newRes = extractResolution(url);
      const bestRes = extractResolution(best.url);
      if (bestRes > newRes || (best.size || 0) > (meta.size || meta.contentLength || 0)) {
        // 已有更高清版本，跳过
        return null;
      }
    }
    Object.assign(found, {
      ...meta,
      size: meta.size || found.size || 0,
      contentType: meta.contentType || found.contentType,
      title: meta.title || found.title || getFileNameFromUrl(url)
    });
    saveData();
    return found;
  }

  // 再次检查：防止 onHeadersReceived 把被替换掉的低分辨率版本重新加回来
  const sameBaseFinal = existing.filter(m => {
    const mRaw = String(m.title || '').replace(/\.(mp4|webm|mov|m4v|avi|mkv|flv|wmv)$/i, '');
    const mBase = mRaw.replace(/[_\- ]*(720p|1080p|480p|360p|240p|144p|720|1080|480|360|240|144)[_\- ]*/gi, '').trim() || mRaw;
    return mBase === baseName && m.url !== url;
  });
  if (sameBaseFinal.length > 0) {
    const best = sameBaseFinal.reduce((a, b) => ((a.size || 0) > (b.size || 0) ? a : b));
    const newRes = extractResolution(url);
    const bestRes = extractResolution(best.url);
    if (bestRes > newRes || (best.size || 0) > (meta.size || meta.contentLength || 0)) {
      return null;
    }
  }

  const mediaInfo = {
    url,
    type: meta.type || meta.contentType || getMediaType(url),
    contentType: meta.contentType || '',
    size: meta.size || 0,
    timestamp: Date.now(),
    title: meta.title || getFileNameFromUrl(url),
    source: meta.source || 'unknown'
  };
  existing.push(mediaInfo);
  addLog('MEDIA', `嗅探到媒体(${mediaInfo.source})`, url);
  saveData();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('media-detected', { tabId, media: mediaInfo });
  }
  return mediaInfo;
}

// 从 URL 中提取分辨率数字（如 720, 1080, 540 等），返回 0 表示未识别
function extractResolution(url) {
  const lower = String(url || '').toLowerCase();
  const match = lower.match(/[_\- ]*(1080|720|540|480|360|240|144)[_\- p]*/i);
  if (match && match[1]) return parseInt(match[1]);
  // 也尝试匹配 video_1280x720 这种格式
  const dimMatch = lower.match(/(\d{2,4})x(\d{2,4})/i);
  if (dimMatch) return Math.max(parseInt(dimMatch[1]), parseInt(dimMatch[2]));
  return 0;
}

function getTabIdFromWebContents(wcId) {
  for (const [tabId, tab] of globalState.tabs) {
    if (tab.webContents && tab.webContents.id === wcId) return tabId;
  }
  return null;
}

// ==================== 标签页管理 ====================
// ==================== 中转跳转兜底 (go.php / jump.php / url=base64) ====================
// 部分下载站(如 423down.com)使用 go.php?url=<base64> 作为中转页，且服务器会
// 检测 Referer 是否来自站内：若不是则返回"温馨提示"页而非真正跳转。
// 解决方案：1) 打开新标签页时传递来源 Referer；2) 仍然失败时，本地解码 base64 直接跳转。
function extractGoPhpTarget(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (!/(go|jump|link|tz|out|redirect)\.php$/i.test(u.pathname) && !/\/go\//i.test(u.pathname)) return null;
    const candidates = ['url', 'u', 'link', 'target', 'go', 'jump', 'redirect'];
    for (const key of candidates) {
      const v = u.searchParams.get(key);
      if (!v) continue;
      let decoded = v;
      // 尝试 base64 解码
      if (/^[A-Za-z0-9+/=_-]+$/.test(v) && v.length >= 8) {
        try {
          const b64 = v.replace(/-/g, '+').replace(/_/g, '/');
          const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
          const dec = Buffer.from(padded, 'base64').toString('utf8');
          if (/^https?:\/\//i.test(dec)) decoded = dec;
        } catch (e) {}
      }
      // 也可能是 urlencode
      try {
        const dec2 = decodeURIComponent(decoded);
        if (/^https?:\/\//i.test(dec2)) decoded = dec2;
      } catch (e) {}
      if (/^https?:\/\//i.test(decoded)) return decoded;
    }
  } catch (e) {}
  return null;
}

function createTab(url = null, options = {}) {
  const tabId = `tab-${++globalState.tabCounter}`;
  const targetUrl = url || globalState.settings.homepage;
  const referrer = options.referrer || '';
  addLog('TAB', '创建标签页', referrer ? `${targetUrl} (referrer=${referrer})` : targetUrl);

  const view = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload', 'preload.js'),
      webSecurity: false,
      sandbox: false,
      allowRunningInsecureContent: true,
      nodeIntegrationInSubFrames: true,
      partition: options.privacyMode ? 'persist:privacy' : 'persist:main'
    }
  });

  // 伪装成 Chrome 浏览器，避免网页因检测到 Electron 而禁用功能
  const chromeUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
  view.webContents.setUserAgent(chromeUserAgent);

  const tab = {
    id: tabId,
    url: targetUrl,
    title: '新标签页',
    favicon: null,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    zoomLevel: 0,
    webContents: view.webContents,
    view: view,
    referrer: referrer,
    goPhpFallbackTried: false,
    openerTabId: options.openerTabId || null
  };

  // 如果有父标签，将新标签插入到父标签右侧
  if (options.openerTabId && globalState.tabs.has(options.openerTabId)) {
    const newTabs = new Map();
    for (const [key, value] of globalState.tabs) {
      newTabs.set(key, value);
      if (key === options.openerTabId) {
        newTabs.set(tabId, tab);
      }
    }
    globalState.tabs = newTabs;
  } else {
    globalState.tabs.set(tabId, tab);
  }
  view.webContents.setZoomLevel((globalState.settings && typeof globalState.settings.defaultZoomLevel === 'number') ? globalState.settings.defaultZoomLevel : 0);

  // 关键修复：把来源页的 Referer 一并传给目标页，避免中转脚本判定为站外访问
  const loadOptions = {};
  if (referrer) loadOptions.httpReferrer = referrer;
  if (options.userAgent) loadOptions.userAgent = options.userAgent;
  view.webContents.loadURL(targetUrl, loadOptions);

  view.webContents.on('did-start-loading', () => {
    tab.loading = true;
    notifyTabUpdate(tabId, { loading: true });
  });

  view.webContents.on('did-stop-loading', () => {
    tab.loading = false;
    tab.canGoBack = view.webContents.canGoBack();
    tab.canGoForward = view.webContents.canGoForward();
    notifyTabUpdate(tabId, { loading: false, canGoBack: tab.canGoBack, canGoForward: tab.canGoForward });
  });

  view.webContents.on('did-finish-load', () => {
    tab.title = view.webContents.getTitle() || tab.url;
    tab.url = view.webContents.getURL();
    addLog('TAB', '页面加载完成', `${tab.title} | ${tab.url}`);
    notifyTabUpdate(tabId, { title: tab.title, url: tab.url });
    addToHistory(tab.url, tab.title);
    // 不再强制重置缩放为0，使用保存的缩放级别
    var savedZoom = (globalState.settings && typeof globalState.settings.defaultZoomLevel === 'number') ? globalState.settings.defaultZoomLevel : 0;
    if (typeof tab.zoomLevel !== 'number') tab.zoomLevel = savedZoom;
    view.webContents.setZoomLevel(tab.zoomLevel);
    applyZoomToTab(tab, tab.zoomLevel, '页面加载应用缩放');
    applyFontSizeToTab(tab);

    // 如果深色模式开启，向新页面注入深色CSS
    const settings = globalState.settings || {};
    if (settings.darkMode) {
      applyDarkModeToTab(tab, true);
    }

    // 修复微信小店客服弹窗位置：强制覆盖 iframe top 值
    view.webContents.insertCSS(`
      /* 微信小店客服 iframe 被错误下拉，强制修正 */
      .assistant-iframe,
      iframe[src*="platformkfim"] {
        top: 0 !important;
      }
    `).catch(() => {});

    // 注入自定义广告规则CSS：隐藏用户标记的广告元素
    if (globalState.customAdRules && globalState.customAdRules.length > 0) {
      const currentDomain = new URL(tab.url).hostname;
      const domainRules = globalState.customAdRules.filter(r => r.domain === currentDomain || r.domain === '*');
      if (domainRules.length > 0) {
        const adCss = domainRules.map(r => `${r.selector} { display: none !important; visibility: hidden !important; height: 0 !important; overflow: hidden !important; }`).join('\n');
        view.webContents.insertCSS(adCss).catch(() => {});
        addLog('ADBLOCK', '注入广告规则CSS', `${domainRules.length} 条规则 (${currentDomain})`);
      }
    }

        setTimeout(() => autoTranslatePageIfNeeded(tabId), 1200);

    // ==================== go.php / 中转页兜底 ====================
    // 若页面仍然停留在 go.php?url=base64... 之类的中转地址(标题为"温馨提示"等)，
    // 则本地解码 url 参数直接跳到目标地址。
    try {
      const curUrl = tab.url || '';
      const target = extractGoPhpTarget(curUrl);
      const stuckTitles = /温馨提示|处理中|跳转中|安全提示/;
      if (target && !tab.goPhpFallbackTried && (stuckTitles.test(tab.title || '') || /go\.php\?/.test(curUrl))) {
        tab.goPhpFallbackTried = true;
        addLog('TAB', '中转页兜底跳转', `${curUrl} -> ${target}`);
        // 给页面自身的 setTimeout(...)跳转 1 秒机会，再接管
        setTimeout(() => {
          if (!view.webContents || view.webContents.isDestroyed()) return;
          const nowUrl = view.webContents.getURL();
          if (nowUrl === curUrl || /go\.php\?/.test(nowUrl)) {
            view.webContents.loadURL(target, { httpReferrer: curUrl });
          }
        }, 1000);
      }
    } catch (e) {
      addLog('ERROR', '中转页解析失败', e.message);
    }
  });

  view.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // ERR_ABORTED (-3) 是正常的导航取消，不需要报错
    if (errorCode === -3) return;
    addLog('ERROR', '页面加载失败', `${validatedURL} | ${errorDescription} (${errorCode})`);
  });

  // 监听子 frame 加载完成，用于诊断 iframe 加载问题
  view.webContents.on('did-frame-finish-load', (event, isMainFrame, frameProcessId, frameRoutingId) => {
    if (!isMainFrame) {
      try {
        // 尝试获取子 frame 的 URL
        let frameUrl = '';
        try {
          if (typeof view.webContents.getAllFrames === 'function') {
            const allFrames = view.webContents.getAllFrames();
            const frame = allFrames.find(f => f.routingId === frameRoutingId);
            if (frame) frameUrl = frame.url;
          }
        } catch(e) {}
        addLog('FRAME', '子框架加载完成', `url=${frameUrl.substring(0, 120)} routingId=${frameRoutingId}`);

        // 微信/QQ 登录 iframe：注入 JS 代理 fetch 到主进程绕过 PNA
        if (frameUrl.includes('open.weixin.qq.com') || frameUrl.includes('wx.qq.com')) {
          const wxProxyCode = `
(function() {
  try {
    if (navigator.permissions && navigator.permissions.query && !navigator.permissions.__fm) {
      navigator.permissions.__fm = true;
      var _q = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = function(d) {
        if (d && d.name === 'local-network-access') return Promise.resolve({state:'granted',onchange:null});
        return _q(d);
      };
    }
    if (!window.__fmFetch2) {
      window.__fmFetch2 = true;
      var _fetch = window.fetch;
      var _rid = 0;
      var _pending = {};
      window.addEventListener('message', function(e) {
        if (!e.data || e.data._wx !== true) return;
        var p = _pending[e.data._id];
        if (!p) return;
        delete _pending[e.data._id];
        if (e.data.error) { p.reject(new Error(e.data.error)); return; }
        var r = e.data.response;
        p.resolve(new Response(r.body, {status:r.status,statusText:r.statusText,headers:new Headers(r.headers)}));
      });
      window.fetch = function(input, init) {
        var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
        if (url.indexOf('localhost.weixin.qq.com') !== -1) {
          return new Promise(function(resolve, reject) {
            var id = ++_rid;
            _pending[id] = {resolve:resolve, reject:reject};
            window.parent.postMessage({_wx:true,_id:id,url:url,method:(init&&init.method)||'GET',headers:init&&init.headers||{},body:init&&init.body||''}, '*');
            setTimeout(function() { if (_pending[id]) { delete _pending[id]; reject(new Error('wx_proxy_timeout')); } }, 5000);
          });
        }
        return _fetch.apply(this, arguments);
      };
    }
  } catch(e) { console.error('[WX]',e); }
})();`;
          if (typeof view.webContents.executeJavaScriptInFrame === 'function') {
            view.webContents.executeJavaScriptInFrame(frameRoutingId, wxProxyCode).catch(() => {});
          } else {
            view.webContents.executeJavaScript(wxProxyCode).catch(() => {});
          }
        }
        // 在父页面注入 postMessage 监听器（只注一次）
        if (frameUrl.includes('sso.e.qq.com') || frameUrl.includes('open.weixin.qq.com')) {
          const parentProxyCode = `
(function() {
  if (window.__wxParentProxy) return;
  window.__wxParentProxy = true;
  window.addEventListener('message', function(e) {
    if (!e.data || e.data._wx !== true) return;
    var req = e.data;
    // 通过 electronAPI 代理请求
    var api = window.electronAPI;
    if (!api || !api.wxProxy) { e.source.postMessage({_wx:true,_id:req._id,error:'no_api'}, '*'); return; }
    api.wxProxy(req).then(function(result) {
      e.source.postMessage({_wx:true,_id:req._id,response:result}, '*');
    }).catch(function(err) {
      e.source.postMessage({_wx:true,_id:req._id,error:err.message||String(err)}, '*');
    });
  });
})();`;
          view.webContents.executeJavaScript(parentProxyCode).catch(() => {});
        }
      } catch(e) {
        addLog('FRAME', '子框架加载完成', `routingId=${frameRoutingId}`);
      }
    }
  });

  // ========== 腾讯广告面板X按钮检测（主进程驱动，可扫描iframe） ==========
  var _panelScanTimer = null;
  var _lastPanelSig = '';

  function scanForPanel() {
    // 已禁用：改用 preload.js 的 MutationObserver 监听 splitview 面板
    // 之前的扫描会误检测到 spaui-alert-close 等元素
    return;
    if (!view || !view.webContents || view.webContents.isDestroyed()) return;
    var url = view.webContents.getURL();
    if (!url || url.indexOf('ad.qq.com') === -1) return;

    view.webContents.executeJavaScript(`
      (function() {
        var vw = window.innerWidth || 1920;
        var vh = window.innerHeight || 1080;
        var results = [];

        function buildSelector(el, doc) {
          try {
            var parts = [];
            var node = el;
            for (var d = 0; d < 12 && node && node.nodeType === 1; d++) {
              var part = node.tagName.toLowerCase();
              if (node.id) {
                part += '#' + node.id.replace(/"/g, '\\\\"');
                parts.unshift(part);
                break;
              }
              var parent = node.parentNode;
              if (parent && parent.children) {
                var sibs = parent.children;
                var nth = 1;
                for (var si = 0; si < sibs.length; si++) {
                  if (sibs[si] === node) { nth = si + 1; break; }
                }
                part += ':nth-child(' + nth + ')';
              }
              parts.unshift(part);
              node = node.parentElement;
            }
            return parts.join(' > ');
          } catch(e) { return ''; }
        }

        function isVisible(el, dw) {
          if (!el) return false;
          var style;
          try { style = dw.getComputedStyle(el); } catch(e) { return false; }
          if (!style) return false;
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          if (parseFloat(style.opacity) < 0.1) return false;
          var rect;
          try { rect = el.getBoundingClientRect(); } catch(e) { return false; }
          if (!rect || rect.width < 4 || rect.height < 4) return false;
          return rect;
        }

        function searchInDoc(doc, baseX, baseY, iframeIdx) {
          var docResults = [];
          if (!doc) return docResults;
          var dw = doc.defaultView || window;

          // 策略1：直接查找 id="icon-close"（腾讯广告专用）
          var iconClose = doc.getElementById('icon-close');
          if (iconClose) {
            var rect = isVisible(iconClose, dw);
            if (rect) {
              docResults.push({
                tag: iconClose.tagName,
                cls: ((iconClose.className || '').toString()).substring(0, 100),
                text: ((iconClose.textContent || '').trim()).substring(0, 20),
                left: Math.round(baseX + rect.left),
                top: Math.round(baseY + rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                score: 999,
                selector: '#' + iconClose.id,
                inIframe: iframeIdx !== undefined,
                iframeIdx: iframeIdx || 0
              });
            }
          }

          // 策略2：查找其他 id 包含 close 的元素
          if (docResults.length === 0) {
            var allWithId = doc.querySelectorAll('[id]');
            for (var ii = 0; ii < allWithId.length; ii++) {
              var el = allWithId[ii];
              var eid = (el.id || '').toLowerCase();
              if (eid.indexOf('close') === -1 && eid.indexOf('shut') === -1 && eid.indexOf('cancel') === -1) continue;
              if (eid === 'icon-close') continue; // 已在策略1处理
              var rect = isVisible(el, dw);
              if (!rect) continue;
              if (rect.width > 80 || rect.height > 80) continue;
              if (rect.top > vh * 0.5) continue;
              docResults.push({
                tag: el.tagName,
                cls: ((el.className || '').toString()).substring(0, 100),
                text: ((el.textContent || '').trim()).substring(0, 20),
                left: Math.round(baseX + rect.left),
                top: Math.round(baseY + rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                score: 500,
                selector: buildSelector(el, doc),
                inIframe: iframeIdx !== undefined,
                iframeIdx: iframeIdx || 0
              });
              break; // 只取第一个
            }
          }

          // 策略3：查找 class 包含 close 的小元素（<i>、<button>、<span>、<a>）
          if (docResults.length === 0) {
            var candidates = doc.querySelectorAll('i[class*="close"], button[class*="close"], span[class*="close"], a[class*="close"], div[class*="close"]');
            for (var ci = 0; ci < candidates.length; ci++) {
              var el = candidates[ci];
              var rect = isVisible(el, dw);
              if (!rect) continue;
              if (rect.width > 60 || rect.height > 60) continue;
              if (rect.top > vh * 0.5) continue;
              var cls = ((el.className || '').toString()).toLowerCase();
              // 排除 remove 类
              if (cls.indexOf('remove') !== -1 && cls.indexOf('close') === -1) continue;
              docResults.push({
                tag: el.tagName,
                cls: cls.substring(0, 100),
                text: ((el.textContent || '').trim()).substring(0, 20),
                left: Math.round(baseX + rect.left),
                top: Math.round(baseY + rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                score: 300,
                selector: buildSelector(el, doc),
                inIframe: iframeIdx !== undefined,
                iframeIdx: iframeIdx || 0
              });
              break;
            }
          }

          // 策略4：查找 splitview 面板内的关闭按钮
          if (docResults.length === 0) {
            var splitview = doc.getElementById('splitview');
            if (splitview) {
              var scls = ((splitview.className || '').toString()).toLowerCase();
              if (scls.indexOf('show') !== -1) {
                var svChildren = splitview.querySelectorAll('*');
                for (var si = 0; si < svChildren.length; si++) {
                  var el = svChildren[si];
                  var tag = el.tagName;
                  if (tag !== 'I' && tag !== 'BUTTON' && tag !== 'SPAN' && tag !== 'A' && tag !== 'DIV') continue;
                  var ecl = ((el.className || '').toString()).toLowerCase();
                  if (ecl.indexOf('close') === -1 && ecl.indexOf('cancel') === -1 && ecl.indexOf('fold') === -1) continue;
                  var rect = isVisible(el, dw);
                  if (!rect) continue;
                  if (rect.width > 60 || rect.height > 60) continue;
                  docResults.push({
                    tag: el.tagName,
                    cls: ecl.substring(0, 100),
                    text: ((el.textContent || '').trim()).substring(0, 20),
                    left: Math.round(baseX + rect.left),
                    top: Math.round(baseY + rect.top),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                    score: 400,
                    selector: buildSelector(el, doc),
                    inIframe: iframeIdx !== undefined,
                    iframeIdx: iframeIdx || 0
                  });
                  break;
                }
              }
            }
          }

          return docResults;
        }

        // 搜索主文档
        var allResults = searchInDoc(document, 0, 0);

        // 搜索同源iframe
        var iframes = document.querySelectorAll('iframe');
        for (var fi = 0; fi < iframes.length; fi++) {
          try {
            var iframe = iframes[fi];
            var iRect = iframe.getBoundingClientRect();
            if (iRect.width < 100 || iRect.height < 100) continue;
            if (iRect.top > vh + 100 || iRect.bottom < -100) continue;
            var idoc = null;
            try { idoc = iframe.contentDocument; } catch(e) {}
            if (!idoc) continue;
            var iframeResults = searchInDoc(idoc, iRect.left, iRect.top, fi);
            allResults = allResults.concat(iframeResults);
          } catch(e) {}
        }

        if (allResults.length > 0) {
          allResults.sort(function(a, b) { return b.score - a.score; });
          var best = allResults[0];
          window.__feimaotuiCloseTarget = best;
          return JSON.stringify({
            found: true,
            closeBtn: best,
            total: allResults.length,
            top3: allResults.slice(0, 3).map(function(b) {
              return { score: b.score, tag: b.tag, text: b.text, cls: (b.cls||'').substring(0,60), left: b.left, top: b.top, iframe: b.inIframe, selector: (b.selector||'').substring(0,80) };
            })
          });
        }
        window.__feimaotuiCloseTarget = null;
        return JSON.stringify({ found: false, total: 0 });
      })();
    `).then(function(result) {
      try {
        var data = JSON.parse(result);
        if (data.found && data.closeBtn) {
          var btn = data.closeBtn;
          var sig = btn.selector || (btn.left + ',' + btn.top + ',' + btn.score);
          if (sig !== _lastPanelSig) {
            _lastPanelSig = sig;
            addLog('CLOSE-FIX', '检测到关闭按钮', 'score=' + btn.score + ' left=' + btn.left + ' top=' + btn.top +
              ' tag=' + btn.tag + ' cls=' + (btn.cls || '').substring(0, 50) + ' text="' + btn.text + '"' +
              ' selector=' + (btn.selector || '').substring(0, 80) +
              (btn.inIframe ? ' [iframe#' + btn.iframeIdx + ']' : '') +
              ' candidates=' + data.total);
            if (data.top3) {
              for (var ti = 0; ti < data.top3.length; ti++) {
                addLog('CLOSE-FIX', '候选[' + ti + ']', 'score=' + data.top3[ti].score + ' tag=' + data.top3[ti].tag + ' cls=' + data.top3[ti].cls + ' selector=' + data.top3[ti].selector);
              }
            }
          }
          // 直接修复原始关闭按钮的图标显示（不创建覆盖框）
          view.webContents.send('feimaotui-fix-close-btn', {
            selector: btn.selector || '',
            inIframe: btn.inIframe || false,
            iframeIdx: btn.iframeIdx || 0
          });
        } else {
          _lastPanelSig = '';
        }
      } catch(e) {
        addLog('CLOSE-FIX', '解析检测结果异常', e.message || 'unknown');
      }
    }).catch(function(e) {});
  }

  // 页面加载完成后开始扫描
  view.webContents.on('did-finish-load', () => {
    addLog('CLOSE-FIX', 'did-finish-load', '开始扫描面板');
    _lastPanelSig = '';
    setTimeout(scanForPanel, 2000);
    if (_panelScanTimer) clearInterval(_panelScanTimer);
    _panelScanTimer = setInterval(scanForPanel, 1500);
    setTimeout(function() { if (_panelScanTimer) { clearInterval(_panelScanTimer); _panelScanTimer = null; } }, 300000);
  });

  // 页面导航开始时清除状态
  view.webContents.on('did-start-navigation', (event, url, isInPlace, isMainFrame) => {
    if (isMainFrame) {
      addLog('CLOSE-FIX', 'did-start-navigation', '延迟扫描');
      _lastPanelSig = '';
      setTimeout(scanForPanel, 3000);
    }
  });

  // 监听渲染进程崩溃
  view.webContents.on('render-process-gone', (event, details) => {
    addLog('ERROR', '渲染进程崩溃', `reason=${details.reason} exitCode=${details.exitCode}`);
    // 崩溃后延迟1秒自动重新加载页面
    var crashUrl = tab.url || view.webContents.getURL();
    if (crashUrl && crashUrl !== 'about:blank') {
      addLog('INFO', '崩溃恢复', '1秒后自动重新加载页面...');
      setTimeout(function() {
        try {
          if (!view.webContents.isDestroyed()) {
            view.webContents.loadURL(crashUrl);
            addLog('INFO', '崩溃恢复', '页面已重新加载');
          }
        } catch(e) {
          addLog('ERROR', '崩溃恢复失败', e.message || 'unknown');
        }
      }, 1000);
    }
  });

  // 监听证书错误（微信客户端检测需要 localhost.weixin.qq.com 自签名证书）
  view.webContents.on('certificate-error', (event, url, error, certificate, callback) => {
    const isWeixinLocal = url.includes('localhost.weixin.qq.com');
    addLog(isWeixinLocal ? 'INFO' : 'WARN', '证书错误', `url=${url.substring(0, 80)} error=${error} accepted=${isWeixinLocal}`);
    callback(isWeixinLocal);
  });

  // 监听页面控制台消息，捕获 iframe 内的错误
  view.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (level >= 2) { // warn 和 error
      addLog('CONSOLE', `[${['debug','log','warn','error'][level] || '?'}]`, `${message} (${sourceId}:${line})`);
    }
  });

  view.webContents.on('page-title-updated', (event, title) => {
    tab.title = title;
    notifyTabUpdate(tabId, { title });
  });

  view.webContents.on('page-favicon-updated', (event, favicons) => {
    if (favicons && favicons.length > 0) {
      tab.favicon = favicons[0];
      notifyTabUpdate(tabId, { favicon: favicons[0] });
    }
  });

  // 拦截所有非 http/https 协议的链接，避免弹出系统"找不到应用"对话框
  // 允许 about: 协议（iframe 初始化需要 about:blank）
  const isUnknownProtocol = (url) => /^[a-z][a-z0-9+.-]*:/i.test(url) && !/^(https?|about):/i.test(url);

  // 允许通过系统打开的外部协议白名单（微信、QQ、腾讯等）
  const isExternalProtocol = (url) => /^(weixin|tencent|qq|mqq|alipays|mailto|tel|taobao|tmall):/i.test(url);

  // 调试日志：记录所有导航事件，帮助追踪 bytedance 弹窗来源
  view.webContents.on('will-navigate', (event, url) => {
    if (isExternalProtocol(url)) {
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
      addLog('EXT', '通过系统打开外部协议(will-navigate)', url);
      return;
    }
    if (isUnknownProtocol(url)) {
      event.preventDefault();
      addLog('BLOCK', '拦截未知协议(will-navigate)', url);
      return;
    }
    addLog('NAV', 'will-navigate', url);
  });

  view.webContents.on('did-start-navigation', (event, url, isInPlace, isMainFrame, frameProcessId, frameRoutingId) => {
    if (isExternalProtocol(url)) {
      event.preventDefault && event.preventDefault();
      shell.openExternal(url).catch(() => {});
      addLog('EXT', '通过系统打开外部协议(did-start-navigation)', `url=${url} isMainFrame=${isMainFrame}`);
      return;
    }
    if (isUnknownProtocol(url)) {
      event.preventDefault && event.preventDefault();
      addLog('BLOCK', '拦截未知协议(did-start-navigation)', `url=${url} isMainFrame=${isMainFrame}`);
      return;
    }
    addLog('NAV', 'did-start-navigation', `url=${url} isMainFrame=${isMainFrame}`);

    // 在主帧导航开始时注入浏览器伪装代码，确保网页脚本运行前环境已伪装
    if (isMainFrame) {
      view.webContents.executeJavaScript(`
        (function() {
          if (window.__feimaotuiSpoofed) return;
          window.__feimaotuiSpoofed = true;

          // 伪装 navigator 核心属性
          var _realUA = navigator.userAgent;
          var _spoofedUA = _realUA.replace(/Electron\/[\d.]+\s?/g, '').replace(/Feimaotui-Browser\/[\d.]+\s?/g, '');
          Object.defineProperty(navigator, 'userAgent', {
            get: function() { return _spoofedUA || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'; }
          });
          Object.defineProperty(navigator, 'vendor', {
            get: function() { return 'Google Inc.'; }
          });
          Object.defineProperty(navigator, 'platform', {
            get: function() { return 'Win32'; }
          });
          Object.defineProperty(navigator, 'webdriver', {
            get: function() { return false; }
          });
          Object.defineProperty(navigator, 'languages', {
            get: function() { return ['zh-CN', 'zh', 'en']; }
          });
          Object.defineProperty(navigator, 'hardwareConcurrency', {
            get: function() { return 8; }
          });
          Object.defineProperty(navigator, 'deviceMemory', {
            get: function() { return 8; }
          });

          // 删除 Electron 痕迹
          try {
            if (window.process && window.process.versions) {
              delete window.process.versions.electron;
              delete window.process.versions.node;
              delete window.process.versions.chrome;
            }
            try { delete window.process; } catch(e) {}
          } catch(e) {}

          // 伪装 window.chrome
          if (!window.chrome) {
            window.chrome = {
              runtime: { connect: function(){}, sendMessage: function(){} },
              loadTimes: function() { return { commitLoadTime: Date.now()/1000, connectionInfo: 'http/1.1', finishDocumentLoadTime: Date.now()/1000, finishLoadTime: Date.now()/1000, firstPaintAfterLoadTime: 0, firstPaintTime: Date.now()/1000, navigationType: 'Other', npnNegotiatedProtocol: 'unknown', wasAlternateProtocolAvailable: false, wasFetchedViaSpdy: true, wasNpnNegotiated: true }; },
              csi: function() { return { onloadT: Date.now(), pageT: 300, startE: Date.now()-300, tran: 15 }; },
              app: { isInstalled: false, InstallState: { INSTALLED: 'installed', DISABLED: 'disabled', NOT_INSTALLED: 'not_installed' }, RunningState: { RUNNING: 'running', CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run' } },
              storage: {}
            };
          }
        })();
      `, true).catch(() => {});
    }
  });

  view.webContents.on('will-frame-navigate', (event, url, isMainFrame, frameProcessId, frameRoutingId) => {
    if (isExternalProtocol(url)) {
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
      addLog('EXT', '通过系统打开外部协议(will-frame-navigate)', `url=${url} isMainFrame=${isMainFrame}`);
      return;
    }
    if (isUnknownProtocol(url)) {
      event.preventDefault();
      addLog('BLOCK', '拦截未知协议(will-frame-navigate)', `url=${url} isMainFrame=${isMainFrame}`);
      return;
    }
    addLog('NAV', 'will-frame-navigate', `url=${url} isMainFrame=${isMainFrame}`);
  });

  view.webContents.setWindowOpenHandler(({ url, referrer, disposition, features }) => {
    if (isExternalProtocol(url)) {
      shell.openExternal(url).catch(() => {});
      addLog('EXT', '通过系统打开外部协议(setWindowOpenHandler)', `url=${url} disposition=${disposition}`);
      return { action: 'deny' };
    }
    if (isUnknownProtocol(url)) {
      addLog('BLOCK', '拦截未知协议(setWindowOpenHandler)', `url=${url} disposition=${disposition}`);
      return { action: 'deny' };
    }
    addLog('NAV', 'setWindowOpenHandler', `url=${url} disposition=${disposition}`);
    // 微信小店客服/平台相关页面：允许窗口正常打开，否则页面 JS 初始化会失败
    if (/platformkfim|shop\/kf|shop\/platform/i.test(url)) {
      return { action: 'allow' };
    }
    const refUrl = (referrer && referrer.url) ? referrer.url : (tab.url || view.webContents.getURL() || '');
    createTab(url, { referrer: refUrl, openerTabId: tabId });
    return { action: 'deny' };
  });

  view.webContents.on('new-window', (event, url, frameName, disposition, options, additionalFeatures, referrer, postBody) => {
    if (isUnknownProtocol(url)) {
      event.preventDefault();
      addLog('BLOCK', '拦截未知协议(new-window)', `url=${url} disposition=${disposition}`);
      return;
    }
    addLog('NAV', 'new-window', `url=${url} disposition=${disposition}`);
  });

  // 右键菜单：禁用 BrowserView 默认菜单，用自定义 context-menu 事件
  view.webContents.setIgnoreMenuShortcuts(true);
  view.webContents.on('context-menu', (e, params) => {
    showPageContextMenu(tabId, params);
  });

  // Ctrl+滚轮页面缩放 - 在BrowserView层面监听
  view.webContents.on('input-event', (event, inputEvent) => {
    const isCtrlPressed = inputEvent.control === true ||
      inputEvent.ctrlKey === true ||
      (Array.isArray(inputEvent.modifiers) && inputEvent.modifiers.includes('control'));
    if (inputEvent.type === 'mouseWheel' && isCtrlPressed) {
      event.preventDefault();
      const currentLevel = typeof tab.zoomLevel === 'number' ? tab.zoomLevel : view.webContents.getZoomLevel();
      const direction = getWheelDirection(inputEvent);
      if (direction === 0) return;
      const newLevel = Math.max(-3, Math.min(3, currentLevel + direction * 0.5));
      applyZoomToTab(tab, newLevel, `BrowserView输入事件${direction > 0 ? '放大' : '缩小'}`);
    }
    // 右侧面板打开时，点击网页内容区也应收回面板。
    // BrowserView 是原生网页层，点击不会冒泡到 renderer 的 document.mousedown，
    // 因此必须在主进程捕获 mouseDown，再通知 renderer 统一关闭面板。
    if (inputEvent.type === 'mouseDown' && rightPanelOpen) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('browser-view-clicked', { tabId });
      }
    }
  });

  // F5 刷新 - 使用 before-input-event 更可靠地捕获键盘事件
  view.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F5') {
      event.preventDefault();
      view.webContents.reload();
      addLog('NAV', 'F5 刷新页面', tab.url);
    }
  });

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tab-created', {
      id: tabId, url: tab.url, title: tab.title, active: options.active !== false,
      openerTabId: options.openerTabId || null
    });
    // 自动保存会话
    saveTabsSession();
  }

  if (options.active !== false) {
    activateTab(tabId);
  }

  return tabId;
}

function activateTab(tabId) {
  if (!globalState.tabs.has(tabId)) return;
  globalState.activeTabId = tabId;
  const tab = globalState.tabs.get(tabId);
  addLog('TAB', '激活标签页', tabId);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBrowserView(tab.view);
    resizeActiveTab();
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tab-activated', { tabId });
  }
}

function closeTab(tabId) {
  if (!globalState.tabs.has(tabId)) return;
  const tab = globalState.tabs.get(tabId);
  addLog('TAB', '关闭标签页', tabId);
  globalState.mediaUrls.delete(tabId);
  if (tab.view) {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.getBrowserView() === tab.view) {
      mainWindow.setBrowserView(null);
    }
    tab.view.webContents.destroy();
  }
  globalState.tabs.delete(tabId);

  if (globalState.activeTabId === tabId) {
    const remaining = Array.from(globalState.tabs.keys());
    if (remaining.length > 0) {
      activateTab(remaining[0]);
    } else {
      globalState.activeTabId = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setBrowserView(null);
      }
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tab-closed', { tabId });
  }
  // 自动保存会话
  saveTabsSession();
}

function reorderTabs(tabIds) {
  if (!Array.isArray(tabIds)) return false;
  const oldTabs = globalState.tabs;
  const reordered = new Map();
  tabIds.forEach(tabId => {
    if (oldTabs.has(tabId)) {
      reordered.set(tabId, oldTabs.get(tabId));
    }
  });
  oldTabs.forEach((tab, tabId) => {
    if (!reordered.has(tabId)) {
      reordered.set(tabId, tab);
    }
  });
  globalState.tabs = reordered;
  addLog('TAB', '标签页排序已更新', Array.from(reordered.keys()).join(','));
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tabs-reordered', { tabIds: Array.from(reordered.keys()) });
  }
  // 自动保存会话（排序变化）
  saveTabsSession();
  return true;
}

function notifyTabUpdate(tabId, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tab-updated', { tabId, ...data });
  }
}

function addToHistory(url, title) {
  if (!url || url === 'about:blank') return;
  const entry = { url, title: title || url, timestamp: Date.now() };
  const idx = globalState.history.findIndex(h => h.url === url);
  if (idx !== -1) globalState.history.splice(idx, 1);
  globalState.history.unshift(entry);
  if (globalState.history.length > 1000) globalState.history = globalState.history.slice(0, 1000);
}

// ==================== 下载管理 ====================
function normalizeDownloadFilePath(filePath) {
  const normalized = path.normalize(String(filePath || ''));
  if (!normalized || !fs.existsSync(normalized)) {
    throw new Error(`文件不存在：${normalized || filePath}`);
  }
  return normalized;
}

function copyFileForChat(filePath) {
  return new Promise((resolve) => {
    const normalized = normalizeDownloadFilePath(filePath);
    clipboard.writeText(normalized);

    // Windows 下把“文件本体”放进剪贴板，这样微信/QQ聊天框里 Ctrl+V 是粘贴文件，
    // 不是只粘贴一段路径。非 Windows 环境则退化为复制完整路径。
    if (process.platform !== 'win32') {
      resolve({ success: true, filePath: normalized, mode: 'text' });
      return;
    }

    const escaped = normalized.replace(/'/g, "''");
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$files = New-Object System.Collections.Specialized.StringCollection',
      `$null = $files.Add('${escaped}')`,
      '[System.Windows.Forms.Clipboard]::SetFileDropList($files)'
    ].join('; ');

    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true }, (error) => {
      if (error) {
        addLog('DOWNLOAD', '复制文件到剪贴板失败，已复制路径', error.message);
        resolve({ success: true, filePath: normalized, mode: 'text', warning: error.message });
        return;
      }
      resolve({ success: true, filePath: normalized, mode: 'file' });
    });
  });
}

async function openChatTarget(target) {
  const normalizedTarget = String(target || '').toLowerCase();
  const protocol = normalizedTarget === 'qq' ? 'tencent://' : 'weixin://';
  const label = normalizedTarget === 'qq' ? 'QQ' : '微信';

  try {
    await shell.openExternal(protocol);
    return { success: true, target: normalizedTarget, label, method: 'protocol' };
  } catch (e) {}

  if (process.platform === 'win32') {
    const candidates = normalizedTarget === 'qq'
      ? [
          path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tencent', 'QQNT', 'QQ.exe'),
          path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Tencent', 'QQNT', 'QQ.exe'),
          path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Tencent', 'QQNT', 'QQ.exe')
        ]
      : [
          path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tencent', 'WeChat', 'WeChat.exe'),
          path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Tencent', 'WeChat', 'WeChat.exe'),
          path.join(process.env.LOCALAPPDATA || '', 'Tencent', 'WeChat', 'WeChat.exe')
        ];
    for (const exePath of candidates) {
      if (exePath && fs.existsSync(exePath)) {
        shell.openPath(exePath);
        return { success: true, target: normalizedTarget, label, method: 'exe' };
      }
    }
  }

  return { success: false, target: normalizedTarget, label, error: `未能自动打开${label}，请手动打开${label}` };
}

function buildDownloadKey(item) {
  const url = item.getURL() || '';
  const fileName = item.getFilename() || '';
  const totalBytes = item.getTotalBytes() || 0;
  return `${url}|${fileName}|${totalBytes}`;
}

function normalizeMediaDownloadUrl(rawUrl) {
  if (!rawUrl) return '';
  const text = String(rawUrl).trim();
  try {
    const parsed = new URL(text);
    parsed.hash = '';
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    const normalized = parsed.toString();
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  } catch (e) {
    const withoutHash = text.split('#')[0];
    return withoutHash.endsWith('/') ? withoutHash.slice(0, -1) : withoutHash;
  }
}

function sanitizeRoughMediaTitle(title) {
  const rawTitle = String(title || '').trim();
  const cleaned = rawTitle
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[^\p{Script=Han}a-zA-Z0-9]+/gu, '')
    .trim();
  const result = cleaned || '未命名视频';
  // 命名规则样例：sanitizeRoughMediaTitle('AA-老南6月13日素材1.剪辑') === 'AA老南6月13日素材1剪辑'
  // 命名规则样例：sanitizeRoughMediaTitle('子凤6月11日.混剪小文5') === '子凤6月11日混剪小文5'
  return result.slice(0, 120);
}

function getSafeExtension(fileName) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(ext)) return ext;
  return '.mp4';
}

function ensureUniqueFilePath(dir, fileName) {
  const ext = path.extname(fileName);
  const base = ext ? fileName.slice(0, -ext.length) : fileName;
  let target = path.join(dir, fileName);
  let index = 1;
  while (fs.existsSync(target)) {
    target = path.join(dir, `${base} (${index})${ext}`);
    index++;
  }
  return target;
}

function buildMediaSaveFileName(pendingMedia, originalFileName) {
  if (!pendingMedia || !pendingMedia.roughName) return originalFileName;
  const baseName = sanitizeRoughMediaTitle(pendingMedia.fileName || pendingMedia.title || originalFileName);
  // 从URL提取扩展名，避免服务器返回的.htm被误用
  let extension = getSafeExtension(pendingMedia.url || originalFileName);
  if (extension === '.htm' || extension === '.html') {
    extension = '.mp4';
  }
  return `${baseName}${extension}`;
}

function getDownloadUrlCandidates(item, downloadUrl) {
  const candidates = new Set();
  if (downloadUrl) candidates.add(downloadUrl);

  try {
    if (typeof item.getURLChain === 'function') {
      const chain = item.getURLChain() || [];
      chain.forEach(url => {
        if (url) candidates.add(url);
      });
    }
  } catch (e) {}

  return Array.from(candidates);
}

function findRecentPendingMediaDownload(webContents) {
  const now = Date.now();
  const webContentsId = webContents && webContents.id;
  let best = null;
  for (const [key, pending] of pendingMediaDownloads.entries()) {
    if (!pending) continue;
    if (webContentsId && pending.webContentsId && pending.webContentsId !== webContentsId) continue;
    if (now - (pending.startedAt || 0) > PENDING_MEDIA_FALLBACK_WINDOW_MS) continue;
    if (!best || (pending.startedAt || 0) > (best.startedAt || 0)) {
      best = { key, ...pending };
    }
  }
  if (best) {
    pendingMediaDownloads.get(best.key).roughName = true;
  }
  return best;
}

function findPendingMediaDownload(item, downloadUrl, webContents, _downloadId) {
  const candidates = getDownloadUrlCandidates(item, downloadUrl);
  const normalizedCandidates = new Set(candidates.map(normalizeMediaDownloadUrl).filter(Boolean));

  for (const candidate of candidates) {
    const pending = pendingMediaDownloads.get(candidate);
    if (pending) return { key: candidate, ...pending };
  }

  for (const [key, pending] of pendingMediaDownloads.entries()) {
    const pendingUrl = normalizeMediaDownloadUrl(key || pending.url);
    if (pendingUrl && normalizedCandidates.has(pendingUrl)) {
      return { key, ...pending };
    }
  }

  const fallback = findRecentPendingMediaDownload(webContents);
  if (fallback) {
    addLog('DOWNLOAD', '媒体匹配(时间fallback)', `${item.getFilename()} -> ${fallback.fileName || fallback.url}`);
  }
  return fallback;
}

function cancelDuplicateDownload(event, item, key, reason) {
  try {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (item && typeof item.cancel === 'function') item.cancel();
  } catch (e) {}
  addLog('DOWNLOAD', '忽略重复下载', reason);
}

function handleDownload(event, item, webContents) {
  if (processedDownloadItems.has(item)) {
    addLog('DOWNLOAD', '忽略重复下载', item.getFilename());
    return;
  }
  processedDownloadItems.add(item);

  const downloadUrl = item.getURL();
  const pendingMedia = findPendingMediaDownload(item, downloadUrl, webContents, '');
  const isMediaDownload = Boolean(pendingMedia);

  // 媒体下载跳过recentDownloadKeys去重（由download-media-list统一调度）
  if (!isMediaDownload) {
    const now = Date.now();
    const key = buildDownloadKey(item);
    for (const [oldKey, oldTime] of recentDownloadKeys) {
      if (now - oldTime > DUPLICATE_DOWNLOAD_WINDOW_MS) {
        recentDownloadKeys.delete(oldKey);
      }
    }
    const lastTime = recentDownloadKeys.get(key);
    if (lastTime && now - lastTime < DUPLICATE_DOWNLOAD_WINDOW_MS) {
      cancelDuplicateDownload(event, item, key, item.getFilename());
      return;
    }
    recentDownloadKeys.set(key, now);
  }

  const downloadId = `download-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const fileName = item.getFilename();
  if (!isMediaDownload) {
    addLog('DOWNLOAD', '非媒体下载(未匹配嗅探)', `${item.getURL()} -> ${fileName}`);
  }
  if (isMediaDownload) pendingMediaDownloads.delete(pendingMedia.key);
  const saveFileName = isMediaDownload ? buildMediaSaveFileName(pendingMedia, fileName) : fileName;
  if (!fs.existsSync(globalState.settings.downloadPath)) {
    fs.mkdirSync(globalState.settings.downloadPath, { recursive: true });
  }
  const filePath = isMediaDownload && pendingMedia.roughName
    ? ensureUniqueFilePath(globalState.settings.downloadPath, saveFileName)
    : path.join(globalState.settings.downloadPath, saveFileName);
  item.setSavePath(filePath);

  const mediaTitle = pendingMedia ? (pendingMedia.fileName || pendingMedia.title || getFileNameFromUrl(downloadUrl)) : '';
  if (isMediaDownload) {
    addLog('DOWNLOAD', '媒体下载命名', `${mediaTitle} -> ${saveFileName}`);
  }

  const info = {
    id: downloadId, fileName: saveFileName, filePath, url: downloadUrl,
    totalBytes: item.getTotalBytes(), receivedBytes: 0,
    startTime: Date.now(), state: 'progressing', paused: false,
    category: isMediaDownload ? 'media' : 'normal',
    mediaUrl: isMediaDownload ? pendingMedia.url : '',
    mediaTitle,
  };
  downloadItems.set(downloadId, item);
  globalState.downloads.set(downloadId, info);
  addLog('DOWNLOAD', '开始下载', fileName);
  saveData();

  item.on('updated', (event, state) => {
    info.receivedBytes = item.getReceivedBytes();
    info.totalBytes = item.getTotalBytes();
    info.state = state;
    info.paused = item.isPaused();
    saveData();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(isMediaDownload ? 'media-download-progress' : 'download-progress', info);
    }
  });

  item.on('done', (event, state) => {
    info.state = state;
    info.endTime = Date.now();
    info.paused = false;
    downloadItems.delete(downloadId);
    addLog('DOWNLOAD', state === 'completed' ? '下载完成' : '下载失败', fileName);
    saveData();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(isMediaDownload ? 'media-download-completed' : 'download-completed', info);
    }
  });

  if (mainWindow && !mainWindow.isDestroyed()) {
    saveData();
    mainWindow.webContents.send(isMediaDownload ? 'media-download-started' : 'download-started', info);
  }
}

function getAllMediaUrls() {
  const result = [];
  const seen = new Set();
  globalState.mediaUrls.forEach((items, tabId) => {
    (items || []).forEach(media => {
      if (!media || !media.url || seen.has(media.url)) return;
      seen.add(media.url);
      const download = Array.from(globalState.downloads.values()).find(item => item.category === 'media' && (item.mediaUrl === media.url || item.url === media.url));
      result.push({ ...media, tabId, download });
    });
  });
  globalState.downloads.forEach(download => {
    if (!download || download.category !== 'media') return;
    const url = download.mediaUrl || download.url;
    if (!url || seen.has(url)) return;
    seen.add(url);
    result.push({
      url,
      type: download.contentType || 'video/unknown',
      contentType: download.contentType || '',
      size: download.totalBytes || 0,
      timestamp: download.startTime || Date.now(),
      title: download.mediaTitle || download.fileName || getFileNameFromUrl(url),
      source: 'download-record',
      tabId: 'download-record',
      download
    });
  });
  return result;
}

function pauseDownload(downloadId) {
  const item = downloadItems.get(downloadId);
  const info = globalState.downloads.get(downloadId);
  if (!item || !info) return { success: false, error: '下载任务不存在或已完成' };
  try {
    if (!item.isPaused()) item.pause();
    info.paused = true;
    info.state = 'progressing';
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('download-progress', info);
    addLog('DOWNLOAD', '暂停下载', info.fileName);
    return { success: true, download: info };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function resumeDownload(downloadId) {
  const item = downloadItems.get(downloadId);
  const info = globalState.downloads.get(downloadId);
  if (!item || !info) return { success: false, error: '下载任务不存在或已完成' };
  try {
    if (item.canResume && item.canResume()) {
      item.resume();
    } else if (item.isPaused()) {
      item.resume();
    }
    info.paused = false;
    info.state = 'progressing';
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('download-progress', info);
    addLog('DOWNLOAD', '继续下载', info.fileName);
    return { success: true, download: info };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 一键暂停所有进行中的下载
function pauseAllDownloads() {
  let count = 0;
  for (const [downloadId, info] of globalState.downloads) {
    if (info.state === 'progressing' && !info.paused) {
      const item = downloadItems.get(downloadId);
      if (item && !item.isPaused()) {
        try { item.pause(); } catch (e) {}
      }
      info.paused = true;
      info.state = 'progressing';
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('download-progress', info);
      count++;
    }
  }
  addLog('DOWNLOAD', '一键暂停全部下载', `共暂停 ${count} 个任务`);
  return { success: true, pausedCount: count };
}

// 一键继续所有已暂停的下载
function resumeAllDownloads() {
  let count = 0;
  for (const [downloadId, info] of globalState.downloads) {
    if (info.state === 'progressing' && info.paused) {
      const item = downloadItems.get(downloadId);
      if (item) {
        try {
          if (item.canResume && item.canResume()) item.resume();
          else if (item.isPaused()) item.resume();
        } catch (e) {}
      }
      info.paused = false;
      info.state = 'progressing';
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('download-progress', info);
      count++;
    }
  }
  addLog('DOWNLOAD', '一键继续全部下载', `共继续 ${count} 个任务`);
  return { success: true, resumedCount: count };
}

// 获取所有下载的暂停状态
function getAllDownloadPauseState() {
  let total = 0;
  let pausedCount = 0;
  for (const [downloadId, info] of globalState.downloads) {
    if (info.state === 'progressing') {
      total++;
      if (info.paused) pausedCount++;
    }
  }
  return { total, pausedCount };
}

// ==================== 翻译功能 ====================
const TRANSLATE_TIMEOUT = 4500;
let edgeTranslateToken = null;
let edgeTranslateTokenAt = 0;

async function getEdgeTranslateToken() {
  const now = Date.now();
  if (edgeTranslateToken && now - edgeTranslateTokenAt < 8 * 60 * 1000) return edgeTranslateToken;
  const response = await axios.get('https://edge.microsoft.com/translate/auth', {
    timeout: TRANSLATE_TIMEOUT,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/120.0' }
  });
  edgeTranslateToken = typeof response.data === 'string' ? response.data : String(response.data || '');
  edgeTranslateTokenAt = now;
  return edgeTranslateToken;
}

const TRANSLATE_PROVIDERS = [
  {
    name: 'EdgeTranslate',
    request: async (text, targetLang) => {
      const token = await getEdgeTranslateToken();
      const to = targetLang === 'zh' ? 'zh-Hans' : targetLang;
      const response = await axios.post(
        `https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&to=${encodeURIComponent(to)}`,
        [{ Text: text }],
        {
          timeout: TRANSLATE_TIMEOUT,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/120.0'
          }
        }
      );
      return response.data && response.data[0] && response.data[0].translations && response.data[0].translations[0]
        ? response.data[0].translations[0].text
        : '';
    }
  },
  {
    name: 'MyMemory',
    request: async (text, targetLang) => {
      const langPair = targetLang === 'zh' ? 'en|zh-CN' : `auto|${targetLang}`;
      const response = await axios.get('https://api.mymemory.translated.net/get', {
        params: { q: text, langpair: langPair },
        timeout: TRANSLATE_TIMEOUT,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      return response.data && response.data.responseData ? response.data.responseData.translatedText : '';
    }
  }
];

const LOCAL_TRANSLATION_DICTIONARY = {
  people: '人民', daily: '日报', china: '中国', chinese: '中国的', world: '世界',
  news: '新闻', latest: '最新', politics: '政治', economy: '经济', culture: '文化',
  society: '社会', international: '国际', business: '商业', travel: '旅游',
  sports: '体育', health: '健康', technology: '科技', science: '科学',
  opinion: '观点', photo: '图片', video: '视频', report: '报道', said: '表示',
  says: '表示', president: '总统', government: '政府', development: '发展',
  cooperation: '合作', global: '全球', local: '本地', english: '英文',
  home: '首页', about: '关于', contact: '联系', search: '搜索', more: '更多',
  read: '阅读', full: '完整', story: '故事', article: '文章', editor: '编辑',
  country: '国家', countries: '国家', city: '城市', market: '市场', trade: '贸易'
};

function fallbackLocalTranslate(text, targetLang = 'zh') {
  if (targetLang !== 'zh') return text;
  const sourceText = String(text || '').trim();
  if (!sourceText) return '';
  let translated = sourceText.replace(/\b[A-Za-z][A-Za-z-]*\b/g, (word) => {
    const key = word.toLowerCase();
    return LOCAL_TRANSLATION_DICTIONARY[key] || word;
  });
  if (translated === sourceText && /[A-Za-z]/.test(sourceText)) {
    translated = `[本地翻译] ${sourceText}`;
  }
  return translated;
}

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} 超时`)), timeoutMs))
  ]);
}

async function translateText(text, targetLang = 'zh') {
  const sourceText = String(text || '').trim();
  if (!sourceText) return { success: true, text: '', sourceLang: 'auto', targetLang };

  for (const provider of TRANSLATE_PROVIDERS) {
    try {
      const translated = await withTimeout(provider.request(sourceText, targetLang), TRANSLATE_TIMEOUT + 1000, provider.name);
      if (translated && translated.trim() && translated.trim() !== sourceText) {
        addLog('TRANSLATE', `${provider.name} 翻译成功`, `${sourceText.substring(0, 30)}... -> ${targetLang}`);
        return { success: true, text: translated.trim(), sourceLang: 'auto', targetLang, provider: provider.name };
      }
      addLog('TRANSLATE', `${provider.name} 翻译结果为空或未变化`, sourceText.substring(0, 30));
    } catch (error) {
      addLog('TRANSLATE', `${provider.name} 翻译失败`, error.message);
    }
  }

  const localText = fallbackLocalTranslate(sourceText, targetLang);
  if (localText && localText !== sourceText) {
    addLog('TRANSLATE', '外部接口不可用，使用本地兜底翻译', sourceText.substring(0, 30));
    return { success: true, text: localText, sourceLang: 'auto', targetLang, provider: 'LocalFallback' };
  }

  return { success: false, text: sourceText, sourceLang: 'auto', targetLang, error: '所有翻译接口均不可用，请检查网络或稍后重试' };
}

async function translateTextBatchEdgeTranslate(texts, targetLang = 'zh') {
  const uniqueTexts = Array.from(new Set(texts.map(t => String(t || '').trim()).filter(Boolean)));
  const results = [];
  const to = targetLang === 'zh' ? 'zh-Hans' : targetLang;
  const token = await getEdgeTranslateToken();

  for (let i = 0; i < uniqueTexts.length; i += 80) {
    const batch = uniqueTexts.slice(i, i + 80);
    try {
      const response = await axios.post(
        `https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&to=${encodeURIComponent(to)}`,
        batch.map(text => ({ Text: text })),
        {
          timeout: 12000,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/120.0'
          }
        }
      );
      const data = Array.isArray(response.data) ? response.data : [];
      data.forEach((item, index) => {
        const translated = item && item.translations && item.translations[0] ? item.translations[0].text : '';
        if (translated && translated.trim()) {
          results.push({ original: batch[index], translated: translated.trim() });
        }
      });
      addLog('TRANSLATE', 'EdgeTranslate 批量翻译成功', `本批 ${batch.length} 条`);
    } catch (error) {
      addLog('TRANSLATE', 'EdgeTranslate 批量翻译失败，改用本地兜底', error.message);
      batch.forEach(text => {
        const translated = fallbackLocalTranslate(text, targetLang);
        if (translated && translated !== text) results.push({ original: text, translated });
      });
    }
  }

  return results;
}

async function translateTextBatch(texts, targetLang = 'zh') {
  try {
    return await translateTextBatchEdgeTranslate(texts, targetLang);
  } catch (error) {
    addLog('TRANSLATE', '批量翻译异常，改用逐条兜底', error.message);
    const results = [];
    const uniqueTexts = Array.from(new Set(texts.map(t => String(t || '').trim()).filter(Boolean)));
    for (const text of uniqueTexts) {
      const result = await translateText(text, targetLang);
      if (result.success) results.push({ original: text, translated: result.text });
    }
    return results;
  }
}

async function detectNonCjkPage(tab) {
  if (!tab || !tab.webContents) return false;
  try {
    const sample = await tab.webContents.executeJavaScript(`(() => {
      const title = document.title || '';
      const meta = document.querySelector('meta[name="description"]')?.content || '';
      const body = (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 2500);
      return [title, meta, body].join(' ');
    })()`);
    const cjkChars = (sample.match(/[\\u3040-\\u30ff\\u3400-\\u9fff\\uf900-\\ufaff]/g) || []).length;
    const nonCjkChars = (sample.match(/[A-Za-zÀ-ÿĀ-žА-яЁё]/g) || []).length;
    return nonCjkChars > 80 && nonCjkChars > cjkChars * 3;
  } catch (error) {
    addLog('TRANSLATE', '检测非 CJK 页面失败', error.message);
    return false;
  }
}

const MAX_TRANSLATE_NODES = 1500;

async function showTranslateStatus(tab, message) {
  if (!tab || !tab.webContents || tab.webContents.isDestroyed()) return;
  const script = `(() => {
    let box = document.getElementById('feimaotui-translate-status');
    if (!box) {
      box = document.createElement('div');
      box.id = 'feimaotui-translate-status';
      box.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;background:#111;color:#fff;padding:8px 12px;border-radius:8px;font-size:13px;box-shadow:0 4px 18px rgba(0,0,0,.25);font-family:Microsoft YaHei,Arial,sans-serif;';
      document.documentElement.appendChild(box);
    }
    box.textContent = ${JSON.stringify(message)};
    clearTimeout(window.__feimaotuiTranslateStatusTimer);
    window.__feimaotuiTranslateStatusTimer = setTimeout(() => box.remove(), 2600);
  })()`;
  await tab.webContents.executeJavaScript(script).catch(() => {});
}

async function collectTranslatableTexts(tab, force = false) {
  const script = `(() => {
    const skipTags = new Set(['SCRIPT','STYLE','NOSCRIPT','TEXTAREA','INPUT','CODE','PRE']);
    const maxNodes = ${MAX_TRANSLATE_NODES};
    const forceTranslate = ${force ? 'true' : 'false'};
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || skipTags.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.closest('[contenteditable="true"], [aria-hidden="true"], #feimaotui-translate-status')) return NodeFilter.FILTER_REJECT;
        const text = node.textContent.trim();
        if (!text || text.length < 2 || text.length > 1200) return NodeFilter.FILTER_REJECT;
        if (!/[A-Za-zÀ-ÿĀ-žА-яЁё]/.test(text)) return NodeFilter.FILTER_REJECT;
        if (!forceTranslate && /[\\u3040-\\u30ff\\u3400-\\u9fff\\uf900-\\ufaff]/.test(text)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const texts = [];
    let node;
    while ((node = walker.nextNode()) && texts.length < maxNodes) texts.push(node.textContent.trim());
    return texts;
  })()`;
  return await tab.webContents.executeJavaScript(script);
}

async function translatePageContent(tab, targetLang = 'zh', options = {}) {
  await showTranslateStatus(tab, '正在翻译当前页面...');
  const texts = await collectTranslatableTexts(tab, Boolean(options.force));
  const translatedTexts = await translateTextBatch(texts, targetLang);
  if (translatedTexts.length === 0) {
    await showTranslateStatus(tab, '没有找到可翻译内容');
    return { success: false, error: '没有可替换的翻译结果', translatedCount: 0 };
  }

  const inject = `(() => {
    const translations = ${JSON.stringify(translatedTexts)};
    const map = new Map(translations.map(item => [item.original, item.translated]));
    const skipTags = new Set(['SCRIPT','STYLE','NOSCRIPT','TEXTAREA','INPUT','CODE','PRE']);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || skipTags.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        return map.has(node.textContent.trim()) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    let node;
    let count = 0;
    while ((node = walker.nextNode())) {
      const original = node.textContent.trim();
      const translated = map.get(original);
      if (translated) {
        node.textContent = node.textContent.replace(original, translated);
        if (node.parentElement) node.parentElement.dataset.feimaotuiTranslated = '1';
        count++;
      }
    }
    document.documentElement.dataset.feimaotuiTranslated = 'zh';
    return count;
  })()`;

  const replacedCount = await tab.webContents.executeJavaScript(inject);
  await showTranslateStatus(tab, `翻译完成：${replacedCount} 处`);
  return { success: true, message: '页面翻译完成', translatedCount: replacedCount };
}

function scheduleDynamicAutoTranslate(tabId) {
  [2500, 6000, 12000].forEach(delay => {
    setTimeout(async () => {
      const tab = globalState.tabs.get(tabId);
      if (!tab || !tab.webContents || tab.webContents.isDestroyed()) return;
      try {
        const result = await translatePageContent(tab, 'zh', { force: false });
        addLog('TRANSLATE', '动态内容补翻译完成', `延迟 ${delay}ms，翻译 ${result.translatedCount || 0} 处`);
      } catch (error) {
        addLog('TRANSLATE', '动态内容补翻译失败', error.message);
      }
    }, delay);
  });
}

async function autoTranslateFullPage(tabId) {
  const tab = globalState.tabs.get(tabId);
  if (!tab || !tab.webContents || tab.webContents.isDestroyed()) return;
  await showTranslateStatus(tab, '检测到外文页面，正在自动翻译...');
  const result = await translatePageContent(tab, 'zh', { force: false });
  scheduleDynamicAutoTranslate(tabId);
  return result;
}

async function autoTranslatePageIfNeeded(tabId) {
  const tab = globalState.tabs.get(tabId);
  if (!tab || !tab.webContents || globalState.settings.autoTranslate === false) return;
  const url = tab.webContents.getURL();
  if (!url || url.startsWith('about:') || url.startsWith('file:')) return;

  try {
    const alreadyTranslated = await tab.webContents.executeJavaScript(`document.documentElement.dataset.feimaotuiTranslated === 'zh'`);
    if (alreadyTranslated) return;
    const shouldTranslateNonCjk = await detectNonCjkPage(tab);
    if (!shouldTranslateNonCjk) return;
    if (url.includes('en.people.cn')) {
      addLog('TRANSLATE', '检测到 en.people.cn 非 CJK 页面，开始 EdgeTranslate 自动翻译', url);
    } else {
      addLog('TRANSLATE', '检测到非 CJK 页面，开始 EdgeTranslate 自动翻译', url);
    }
    const result = await autoTranslateFullPage(tabId);
    addLog('TRANSLATE', result.success ? '自动翻译完成' : '自动翻译失败', result.success ? `翻译 ${result.translatedCount} 处` : result.error);
  } catch (error) {
    addLog('TRANSLATE', '自动翻译异常', error.message);
  }
}

// ==================== 书签文件解析 ====================
function parseBookmarkFile(content, filePath) {
  const lowerPath = String(filePath || '').toLowerCase();
  // JSON 格式（飞毛腿导出格式）
  if (lowerPath.endsWith('.json')) {
    try {
      const data = JSON.parse(content);
      // 飞毛腿格式
      if (data.appName === '飞毛腿浏览器' && Array.isArray(data.bookmarks)) {
        return data.bookmarks.map(b => ({
          url: b.url,
          title: b.title,
          folder: b.folder || '导入书签'
        })).filter(b => b.url);
      }
      // Chrome/Edge 格式（roots.bookmark_bar.children）
      if (data.roots && data.roots.bookmark_bar && Array.isArray(data.roots.bookmark_bar.children)) {
        return flattenChromeBookmarks(data.roots.bookmark_bar.children);
      }
      // 通用 JSON 数组
      if (Array.isArray(data)) {
        return data.map(b => ({
          url: b.url || b.href,
          title: b.title || b.name || b.text,
          folder: b.folder || '导入书签'
        })).filter(b => b.url);
      }
    } catch (e) {
      addLog('ERROR', '解析JSON书签失败', e.message);
    }
    return [];
  }
  // HTML 格式（Netscape Bookmark File Format - Chrome/Edge/Firefox 通用）
  if (lowerPath.endsWith('.html') || lowerPath.endsWith('.htm')) {
    return parseHtmlBookmarks(content);
  }
  // 尝试自动检测格式
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const data = JSON.parse(content);
      if (data.appName === '飞毛腿浏览器' && Array.isArray(data.bookmarks)) {
        return data.bookmarks.map(b => ({ url: b.url, title: b.title, folder: b.folder || '导入书签' })).filter(b => b.url);
      }
      if (data.roots && data.roots.bookmark_bar && Array.isArray(data.roots.bookmark_bar.children)) {
        return flattenChromeBookmarks(data.roots.bookmark_bar.children);
      }
      if (Array.isArray(data)) {
        return data.map(b => ({ url: b.url || b.href, title: b.title || b.name, folder: b.folder || '导入书签' })).filter(b => b.url);
      }
    } catch (e) {}
  }
  if (trimmed.includes('<DT>') || trimmed.includes('<A ') || trimmed.toLowerCase().includes('<a ')) {
    return parseHtmlBookmarks(content);
  }
  return [];
}

function flattenChromeBookmarks(nodes, folder = '导入书签') {
  const result = [];
  if (!Array.isArray(nodes)) return result;
  nodes.forEach(node => {
    if (!node) return;
    if (node.type === 'url' && node.url) {
      result.push({ url: node.url, title: node.name || node.url, folder });
    } else if (node.type === 'folder' && node.children) {
      const subFolder = node.name || folder;
      result.push(...flattenChromeBookmarks(node.children, subFolder));
    }
  });
  return result;
}

function parseHtmlBookmarks(html) {
  const results = [];
  // 匹配 <A HREF="url">title</A> 模式
  const regex = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const url = match[1].trim();
    const title = match[2].replace(/<[^>]*>/g, '').trim();
    if (url && !url.startsWith('javascript:') && !url.startsWith('place:')) {
      results.push({ url, title: title || url, folder: '导入书签' });
    }
  }
  return results;
}

// ==================== 自动嗅探滚动 ====================
let autoSniffState = {
  active: false,
  paused: false,        // 是否暂停
  tab: null,
  scrollTimer: null,
  startPos: null,       // 嗅探起始坐标
  pagePos: null,        // 翻页按钮坐标
  scrollHeight: 0,      // 上次滚动高度
  sameCount: 0,         // 连续未变化次数
  sniffingCount: 0,     // 当前嗅探数量
  isFirstPage: true,    // 是否第一页（第一页需要翻页确认）
  notifiedBottom: false // 是否已通知底部
};

function startAutoSniffScroll(tab, options = {}) {
  // 清理之前的定时器
  if (autoSniffState.scrollTimer) {
    clearInterval(autoSniffState.scrollTimer);
    autoSniffState.scrollTimer = null;
  }

  autoSniffState.active = true;
  autoSniffState.tab = tab;
  autoSniffState.startPos = options.startPos || null;
  autoSniffState.pagePos = options.pagePos || autoSniffState.pagePos || null; // 保留之前记住的翻页坐标
  autoSniffState.scrollHeight = 0;
  autoSniffState.sameCount = 0;
  autoSniffState.sniffingCount = getMediaCount();
  autoSniffState.isFirstPage = !autoSniffState.pagePos; // 没有翻页坐标说明是第一页
  autoSniffState.notifiedBottom = false;

  addLog('AUTO_SNIFF', '启动自动嗅探', `起始位置: ${JSON.stringify(autoSniffState.startPos)}, 翻页坐标: ${JSON.stringify(autoSniffState.pagePos)}`);

  // 如果有起始坐标，先滚动到该位置
  if (autoSniffState.startPos) {
    scrollToStartPosition(tab);
  }

  // 开始定时滚动
  autoSniffState.scrollTimer = setInterval(() => {
    if (!autoSniffState.active || autoSniffState.paused || !autoSniffState.tab || autoSniffState.tab.webContents.isDestroyed()) {
      if (autoSniffState.paused) return; // 暂停时不停止，只是跳过本次滚动
      stopAutoSniffScroll();
      return;
    }
    performAutoSniffScroll();
  }, 800); // 每 800ms 滚动一次

  return { success: true };
}

function stopAutoSniffScroll() {
  if (autoSniffState.scrollTimer) {
    clearInterval(autoSniffState.scrollTimer);
    autoSniffState.scrollTimer = null;
  }
  autoSniffState.active = false;
  autoSniffState.paused = false;
  addLog('AUTO_SNIFF', '停止自动嗅探');
}

function pauseAutoSniffScroll() {
  if (!autoSniffState.active || autoSniffState.paused) return;
  if (autoSniffState.scrollTimer) {
    clearInterval(autoSniffState.scrollTimer);
    autoSniffState.scrollTimer = null;
  }
  autoSniffState.paused = true;
  addLog('AUTO_SNIFF', '暂停自动嗅探');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('auto-sniff-paused');
  }
}

function resumeAutoSniffScroll() {
  if (!autoSniffState.active || !autoSniffState.paused) return;
  autoSniffState.paused = false;
  addLog('AUTO_SNIFF', '继续自动嗅探');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('auto-sniff-resumed');
  }
  // 重新启动滚动定时器
  autoSniffState.scrollTimer = setInterval(() => {
    if (!autoSniffState.active || autoSniffState.paused || !autoSniffState.tab || autoSniffState.tab.webContents.isDestroyed()) {
      if (autoSniffState.scrollTimer) {
        clearInterval(autoSniffState.scrollTimer);
        autoSniffState.scrollTimer = null;
      }
      return;
    }
    performAutoSniffScroll();
  }, 1500);
}

function scrollToStartPosition(tab) {
  if (!tab || !tab.webContents || tab.webContents.isDestroyed()) return;
  // 使用 executeJavaScript 滚动到指定位置
  const script = `
    (function() {
      window.scrollTo(${autoSniffState.startPos.x}, ${autoSniffState.startPos.y});
      return {
        scrollTop: window.scrollY,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: window.innerHeight
      };
    })()
  `;
  tab.webContents.executeJavaScript(script).catch(() => {});
}

function performAutoSniffScroll() {
  const tab = autoSniffState.tab;
  if (!tab || !tab.webContents || tab.webContents.isDestroyed()) {
    stopAutoSniffScroll();
    return;
  }

  // 执行滚动
  const scrollAmount = 400; // 每次滚动 400px
  const script = `
    (function() {
      const before = window.scrollY;
      window.scrollBy(0, ${scrollAmount});
      const after = window.scrollY;
      return {
        scrollTop: after,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: window.innerHeight,
        changed: after !== before,
        atBottom: (document.documentElement.scrollHeight - window.innerHeight - after) < 50
      };
    })()
  `;

  tab.webContents.executeJavaScript(script).then((result) => {
    if (!result) return;

    // 检查是否到达底部
    if (result.atBottom) {
      autoSniffState.sameCount++;
      if (autoSniffState.sameCount >= 3) { // 连续 3 次到底认为真的到底了
        handleSniffPageBottom();
        return;
      }
    } else {
      autoSniffState.sameCount = 0;
    }

    // 更新嗅探计数并通知渲染进程
    const currentCount = getMediaCount();
    if (currentCount !== autoSniffState.sniffingCount) {
      autoSniffState.sniffingCount = currentCount;
      notifySniffCountUpdate(currentCount);
    }

    // 更新滚动高度
    autoSniffState.scrollHeight = result.scrollTop;
  }).catch((err) => {
    console.error('[AUTO_SNIFF] 滚动失败:', err);
  });
}

function handleSniffPageBottom() {
  // 停止滚动定时器
  if (autoSniffState.scrollTimer) {
    clearInterval(autoSniffState.scrollTimer);
    autoSniffState.scrollTimer = null;
  }

  addLog('AUTO_SNIFF', '检测到页面底部');

  // 检查是否需要翻页
  if (autoSniffState.isFirstPage && !autoSniffState.pagePos) {
    // 第一页还没标记翻页坐标，通知渲染进程显示确认弹窗
    notifySniffScrollBottom();
    return;
  }

  // 有翻页坐标，直接点击翻页
  if (autoSniffState.pagePos) {
    autoSniffState.isFirstPage = false;
    clickPageButton();
  } else {
    // 没有翻页坐标且不是第一页，停止
    stopAutoSniffScroll();
  }
}

function clickPageButton() {
  const tab = autoSniffState.tab;
  if (!tab || !tab.webContents || tab.webContents.isDestroyed()) return;

  const { x, y } = autoSniffState.pagePos;
  addLog('AUTO_SNIFF', '点击翻页按钮', `坐标: ${x}, ${y}`);

  // 使用 executeJavaScript 模拟鼠标点击
  const script = `
    (function() {
      // 创建一个点击事件
      function simulateClick(x, y) {
        const clickEvent = new MouseEvent('click', {
          view: window,
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y
        });

        // 找到对应坐标的元素
        const element = document.elementFromPoint(x, y);
        if (element) {
          // 先让元素可见（如果有的话）
          element.scrollIntoViewIfNeeded ? element.scrollIntoViewIfNeeded() : null;

          // 触发点击
          const rect = element.getBoundingClientRect();
          const adjustedX = x - rect.left;
          const adjustedY = y - rect.top;

          const newEvent = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX: adjustedX,
            clientY: adjustedY
          });
          element.dispatchEvent(newEvent);
          return { success: true, tagName: element.tagName, text: element.textContent.trim().substring(0, 50) };
        }
        return { success: false };
      }
      return simulateClick(${x}, ${y});
    })()
  `;

  tab.webContents.executeJavaScript(script).then((result) => {
    if (result && result.success) {
      addLog('AUTO_SNIFF', '翻页点击成功', result.tagName + ': ' + result.text);
    }

    // 等待页面加载，然后继续滚动
    setTimeout(() => {
      // 重置状态并继续滚动
      autoSniffState.scrollHeight = 0;
      autoSniffState.sameCount = 0;
      autoSniffState.sniffingCount = getMediaCount();
      autoSniffState.notifiedBottom = false;

      notifySniffPageNext();

      // 重新开始滚动定时器
      autoSniffState.scrollTimer = setInterval(() => {
        if (!autoSniffState.active || autoSniffState.paused || !autoSniffState.tab || autoSniffState.tab.webContents.isDestroyed()) {
          if (autoSniffState.paused) return;
          stopAutoSniffScroll();
          return;
        }
        performAutoSniffScroll();
      }, 800);
    }, 2000); // 等待 2 秒让页面加载
  }).catch((err) => {
    addLog('ERROR', '翻页点击失败', err.message);
    stopAutoSniffScroll();
  });
}

function getMediaCount() {
  let count = 0;
  globalState.mediaUrls.forEach((list) => {
    (list || []).forEach((media) => {
      if (media && media.url) count++;
    });
  });
  return count;
}

function notifySniffScrollBottom() {
  autoSniffState.active = false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('auto-sniff-scroll-bottom');
  }
}

function notifySniffPageNext() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('auto-sniff-page-next');
  }
}

function notifySniffCountUpdate(count) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('auto-sniff-count-update', count);
  }
}

// ==================== IPC 处理 ====================
function setupIPC() {
  // 截图区域选择完成（crop 是屏幕坐标 {x, y, w, h}）
  ipcMain.on('screenshot-region', async (event, crop) => {
    addLog('SCREENSHOT', '收到屏幕坐标', `x:${crop.x}, y:${crop.y}, w:${crop.w}, h:${crop.h}`);
    if (!screenshotPickerWindow) {
      addLog('ERROR', '截图窗口已关闭');
      return;
    }

    // 先关闭选择窗口
    const win = screenshotPickerWindow;
    screenshotPickerWindow = null;
    win.close();

    try {
      if (!mainWindow || mainWindow.isDestroyed()) return;

      // 获取主窗口在屏幕上的位置
      const winBounds = mainWindow.getBounds();
      addLog('SCREENSHOT', '主窗口位置', JSON.stringify(winBounds));

      // 截取主窗口
      const winImage = await mainWindow.capturePage();
      const winImgSize = winImage.getSize();
      addLog('SCREENSHOT', '主窗口截图', `${winImgSize.width}x${winImgSize.height}`);

      // 计算主窗口的 DPI 缩放
      const winScaleX = winImgSize.width / winBounds.width;
      const winScaleY = winImgSize.height / winBounds.height;

      // 截取当前活动标签的 BrowserView
      const tabId = win.tabId;
      const tab = globalState.tabs.get(tabId);
      let viewImage = null;
      let viewBounds = null;
      let viewScaleX = 1, viewScaleY = 1;

      if (tab && tab.view && tab.webContents) {
        viewBounds = tab.view.getBounds();
        viewImage = await tab.webContents.capturePage();
        const viewImgSize = viewImage.getSize();
        viewScaleX = viewImgSize.width / viewBounds.width;
        viewScaleY = viewImgSize.height / viewBounds.height;
        addLog('SCREENSHOT', 'BrowserView截图', `${viewImgSize.width}x${viewImgSize.height}, bounds:${JSON.stringify(viewBounds)}`);
      }

      // 将屏幕坐标转换为主窗口内坐标
      const relX = crop.x - winBounds.x;
      const relY = crop.y - winBounds.y;

      // 转换为图片像素坐标
      const imgX = Math.round(relX * winScaleX);
      const imgY = Math.round(relY * winScaleY);
      const imgW = Math.round(crop.w * winScaleX);
      const imgH = Math.round(crop.h * winScaleY);

      addLog('SCREENSHOT', '图片坐标', `x:${imgX}, y:${imgY}, w:${imgW}, h:${imgH}`);

      // 检查选区是否与 BrowserView 重叠
      let finalImage = winImage;
      if (viewImage && viewBounds) {
        const viewImgX = Math.round(viewBounds.x * winScaleX);
        const viewImgY = Math.round(viewBounds.y * winScaleY);
        const viewImgW = Math.round(viewBounds.width * winScaleX);
        const viewImgH = Math.round(viewBounds.height * winScaleY);

        // 如果选区与 BrowserView 有重叠，需要合成
        const cropRight = imgX + imgW;
        const cropBottom = imgY + imgH;
        const viewRight = viewImgX + viewImgW;
        const viewBottom = viewImgY + viewImgH;

        if (imgX < viewRight && cropRight > viewImgX &&
            imgY < viewBottom && cropBottom > viewImgY) {
          addLog('SCREENSHOT', '选区包含网页内容，需要合成');

          // 用 offscreen canvas 合成（在截图完成后的隐藏窗口中）
          const { nativeImage } = require('electron');

          // 创建一个空白图片作为画布
          const canvasSize = { width: imgW, height: imgH };

          // 先从主窗口裁剪
          const winCrop = winImage.crop({
            x: Math.max(0, imgX),
            y: Math.max(0, imgY),
            width: Math.min(imgW, winImgSize.width - imgX),
            height: Math.min(imgH, winImgSize.height - imgY)
          });

          // 计算 BrowserView 在裁剪区域中的相对位置
          const viewRelX = viewImgX - imgX;
          const viewRelY = viewImgY - imgY;

          // 从 BrowserView 裁剪对应区域
          const bvCropX = Math.max(0, Math.round(-viewRelX));
          const bvCropY = Math.max(0, Math.round(-viewRelY));
          const bvCropW = Math.min(viewImgW - bvCropX, imgW - Math.max(0, viewRelX));
          const bvCropH = Math.min(viewImgH - bvCropY, imgH - Math.max(0, viewRelY));

          if (bvCropW > 0 && bvCropH > 0) {
            const bvCrop = viewImage.crop({
              x: bvCropX,
              y: bvCropY,
              width: bvCropW,
              height: bvCropH
            });

            // 将 BrowserView 内容粘贴到主窗口截图的正确位置
            // 使用 nativeImage 无法直接合成，需要用 data URL + canvas
            const tempWin = new BrowserWindow({
              width: imgW,
              height: imgH,
              show: false,
              webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                offscreen: true
              }
            });

            const composited = await new Promise((resolve, reject) => {
              tempWin.webContents.once('did-finish-load', async () => {
                try {
                  const result = await tempWin.webContents.executeJavaScript(`
                    new Promise((res) => {
                      const c = document.createElement('canvas');
                      c.width = ${imgW};
                      c.height = ${imgH};
                      const ctx = c.getContext('2d');
                      const base = new Image();
                      base.onload = () => {
                        ctx.drawImage(base, 0, 0);
                        const overlay = new Image();
                        overlay.onload = () => {
                          ctx.drawImage(overlay, ${Math.max(0, viewRelX)}, ${Math.max(0, viewRelY)}, ${bvCropW}, ${bvCropH});
                          res(c.toDataURL('image/png'));
                        };
                        overlay.src = '${bvCrop.toDataURL()}';
                      };
                      base.src = '${winCrop.toDataURL()}';
                    })
                  `);
                  resolve(nativeImage.createFromDataURL(result));
                } catch (e) { reject(e); }
                tempWin.close();
              });
              tempWin.loadURL('about:blank');
            });

            finalImage = composited;
          }
        }
      }

      // 最终裁剪
      const finalSize = finalImage.getSize();
      const cropped = finalImage.crop({
        x: 0,
        y: 0,
        width: Math.min(imgW, finalSize.width),
        height: Math.min(imgH, finalSize.height)
      });

      clipboard.writeImage(cropped);
      addLog('SCREENSHOT', '截图已复制到剪贴板');
    } catch (error) {
      addLog('ERROR', '截图失败', error.message);
    }
  });

  // 截图取消
  ipcMain.on('screenshot-cancel', () => {
    if (screenshotPickerWindow) {
      screenshotPickerWindow.close();
      screenshotPickerWindow = null;
    }
    addLog('SCREENSHOT', '区域截图已取消');
  });

  // 深色模式 - 向所有网页注入/移除深色CSS
  ipcMain.on('set-dark-mode-pages', (event, enabled) => {
    addLog('SETTINGS', '网页深色模式', enabled ? '开启' : '关闭');
    globalState.tabs.forEach((tab) => {
      applyDarkModeToTab(tab, enabled);
    });
  });
  
  ipcMain.on('media-element-detected', (event, payload = {}) => {
    const senderId = event.sender && event.sender.id;
    const candidates = Array.isArray(payload.sources) ? payload.sources : [];
    candidates.forEach(src => {
      if (!src || !src.url || String(src.url).startsWith('blob:')) return;
      registerMediaCandidate(senderId, src.url, {
        source: 'video-element',
        type: src.type || getMediaType(src.url),
        title: src.title || getFileNameFromUrl(src.url)
      });
    });
  });

  ipcMain.handle('create-tab', (event, url, options = {}) => {
    // 如果没有指定 opener，自动使用当前活动标签页
    if (!options.openerTabId && globalState.activeTabId) {
      options.openerTabId = globalState.activeTabId;
    }
    return createTab(url, options);
  });
  ipcMain.handle('close-tab', (event, tabId) => closeTab(tabId));
  ipcMain.handle('activate-tab', (event, tabId) => activateTab(tabId));
  ipcMain.handle('reorder-tabs', (event, tabIds) => reorderTabs(tabIds));
  ipcMain.handle('get-tabs', () => {
    return Array.from(globalState.tabs.values()).map(tab => ({
      id: tab.id, url: tab.url, title: tab.title, favicon: tab.favicon,
      loading: tab.loading, canGoBack: tab.canGoBack, canGoForward: tab.canGoForward,
      active: tab.id === globalState.activeTabId
    }));
  });

  ipcMain.handle('navigate-to', (event, tabId, url) => {
    const tab = globalState.tabs.get(tabId);
    if (tab && tab.webContents) {
      let targetUrl = url;
      if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
        if (url.includes('.') && !url.includes(' ')) {
          targetUrl = 'https://' + url;
        } else {
          const engines = {
            baidu: `https://www.baidu.com/s?wd=${encodeURIComponent(url)}`,
            google: `https://www.google.com/search?q=${encodeURIComponent(url)}`,
            bing: `https://www.bing.com/search?q=${encodeURIComponent(url)}`
          };
          targetUrl = engines[globalState.settings.searchEngine] || engines.baidu;
        }
      }
      addLog('NAVIGATE', '导航到', targetUrl);
      tab.webContents.loadURL(targetUrl);
    }
  });

  ipcMain.handle('go-back', (event, tabId) => {
    const tab = globalState.tabs.get(tabId);
    if (tab && tab.webContents && tab.webContents.canGoBack()) tab.webContents.goBack();
  });

  ipcMain.handle('go-forward', (event, tabId) => {
    const tab = globalState.tabs.get(tabId);
    if (tab && tab.webContents && tab.webContents.canGoForward()) tab.webContents.goForward();
  });

  ipcMain.handle('reload', (event, tabId) => {
    const tab = globalState.tabs.get(tabId);
    if (tab && tab.webContents) tab.webContents.reload();
  });

  ipcMain.handle('stop-loading', (event, tabId) => {
    const tab = globalState.tabs.get(tabId);
    if (tab && tab.webContents) tab.webContents.stop();
  });

  // 书签
  ipcMain.handle('add-bookmark', (event, bookmark) => {
    const newBookmark = {
      id: `bookmark-${Date.now()}`, url: bookmark.url, title: bookmark.title,
      folder: bookmark.folder || '默认文件夹', createdAt: Date.now()
    };
    globalState.bookmarks.push(newBookmark);
    saveData();
    addLog('BOOKMARK', '添加书签', bookmark.title);
    return newBookmark;
  });

  ipcMain.handle('remove-bookmark', (event, bookmarkId) => {
    globalState.bookmarks = globalState.bookmarks.filter(b => b.id !== bookmarkId);
    saveData();
  });

  ipcMain.handle('get-bookmarks', () => globalState.bookmarks);

  ipcMain.handle('update-bookmark-order', (event, bookmarks) => {
    if (Array.isArray(bookmarks) && bookmarks.length === globalState.bookmarks.length) {
        globalState.bookmarks = bookmarks;
        saveData();
        addLog('BOOKMARK', '更新书签排序', `${bookmarks.length} 个书签`);
    }
  });

  // 导出书签（飞毛腿格式 JSON）
  ipcMain.handle('export-bookmarks', async (event) => {
    try {
      const exportData = {
        appName: '飞毛腿浏览器',
        version: '1.0.74',
        exportTime: new Date().toISOString(),
        bookmarks: globalState.bookmarks.map(b => ({
          url: b.url,
          title: b.title,
          folder: b.folder || '默认文件夹',
          createdAt: b.createdAt
        }))
      };
      const { dialog } = require('electron');
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '导出书签',
        defaultPath: '飞毛腿浏览器书签.json',
        filters: [
          { name: '飞毛腿书签文件', extensions: ['json'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      });
      if (result.canceled || !result.filePath) return { success: false, canceled: true };
      fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2), 'utf8');
      addLog('BOOKMARK', '导出书签', `${exportData.bookmarks.length} 个 → ${result.filePath}`);
      return { success: true, count: exportData.bookmarks.length, filePath: result.filePath };
    } catch (e) {
      addLog('ERROR', '导出书签失败', e.message);
      return { success: false, error: e.message };
    }
  });

  // 导入书签（支持飞毛腿格式和其他浏览器格式，按网址查重）
  ipcMain.handle('import-bookmarks', async (event) => {
    try {
      const { dialog } = require('electron');
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '导入书签',
        properties: ['openFile'],
        filters: [
          { name: '书签文件', extensions: ['json', 'html', 'htm'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      });
      if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true };
      const filePath = result.filePaths[0];
      const content = fs.readFileSync(filePath, 'utf8');
      const imported = parseBookmarkFile(content, filePath);
      if (!imported || imported.length === 0) return { success: false, error: '未找到可导入的书签' };
      // 按网址查重：已有相同网址的书签不重复添加
      const existingUrls = new Set(globalState.bookmarks.map(b => b.url));
      let addedCount = 0;
      let duplicateCount = 0;
      imported.forEach(item => {
        if (existingUrls.has(item.url)) {
          duplicateCount++;
          return;
        }
        existingUrls.add(item.url);
        globalState.bookmarks.push({
          id: `bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          url: item.url,
          title: item.title || item.url,
          folder: item.folder || '导入书签',
          createdAt: Date.now()
        });
        addedCount++;
      });
      saveData();
      addLog('BOOKMARK', '导入书签', `新增 ${addedCount} 个，重复 ${duplicateCount} 个，来源: ${filePath}`);
      return { success: true, added: addedCount, duplicated: duplicateCount, total: imported.length };
    } catch (e) {
      addLog('ERROR', '导入书签失败', e.message);
      return { success: false, error: e.message };
    }
  });

  // 拖入文件导入书签
  ipcMain.handle('import-bookmarks-from-file', async (event, filePath) => {
    try {
      if (!fs.existsSync(filePath)) return { success: false, error: '文件不存在' };
      const content = fs.readFileSync(filePath, 'utf8');
      const imported = parseBookmarkFile(content, filePath);
      if (!imported || imported.length === 0) return { success: false, error: '未找到可导入的书签' };
      const existingUrls = new Set(globalState.bookmarks.map(b => b.url));
      let addedCount = 0;
      let duplicateCount = 0;
      imported.forEach(item => {
        if (existingUrls.has(item.url)) {
          duplicateCount++;
          return;
        }
        existingUrls.add(item.url);
        globalState.bookmarks.push({
          id: `bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          url: item.url,
          title: item.title || item.url,
          folder: item.folder || '导入书签',
          createdAt: Date.now()
        });
        addedCount++;
      });
      saveData();
      addLog('BOOKMARK', '拖入导入书签', `新增 ${addedCount} 个，重复 ${duplicateCount} 个`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bookmarks-changed');
      }
      return { success: true, added: addedCount, duplicated: duplicateCount, total: imported.length };
    } catch (e) {
      addLog('ERROR', '拖入导入书签失败', e.message);
      return { success: false, error: e.message };
    }
  });

  // 历史
  ipcMain.handle('get-history', () => globalState.history);
  ipcMain.handle('clear-history', () => {
    globalState.history = [];
    saveData();
    addLog('HISTORY', '清除历史记录');
  });

  // 下载
  ipcMain.handle('get-downloads', () => Array.from(globalState.downloads.values()).filter(download => download.category !== 'media'));
  ipcMain.handle('clear-download-records', () => {
    let cleared = 0;
    Array.from(globalState.downloads.entries()).forEach(([id, download]) => {
      if (download.state !== 'progressing' && download.category !== 'media') {
        globalState.downloads.delete(id);
        cleared++;
      }
    });
    addLog('DOWNLOAD', '清除下载记录', `${cleared} 条，不删除本地文件`);
    saveData();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-records-cleared', { cleared });
    }
    return { success: true, cleared };
  });
  ipcMain.handle('open-download', async (event, filePath) => {
    try {
      const normalized = normalizeDownloadFilePath(filePath);
      const error = await shell.openPath(normalized);
      if (error) throw new Error(error);
      addLog('DOWNLOAD', '打开文件', normalized);
      return { success: true, filePath: normalized };
    } catch (error) {
      addLog('DOWNLOAD', '打开文件失败', error.message);
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('show-download-in-folder', (event, filePath) => {
    try {
      const normalized = normalizeDownloadFilePath(filePath);
      shell.showItemInFolder(normalized);
      addLog('DOWNLOAD', '打开文件所在文件夹', normalized);
      return { success: true, filePath: normalized };
    } catch (error) {
      addLog('DOWNLOAD', '打开文件夹失败', error.message);
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('delete-download', (event, downloadId, filePath) => {
    try {
      const item = downloadItems.get(downloadId);
      if (item && typeof item.cancel === 'function') {
        try { item.cancel(); } catch (e) {}
        downloadItems.delete(downloadId);
      }
      const normalized = normalizeDownloadFilePath(filePath);
      fs.unlinkSync(normalized);
      globalState.downloads.delete(downloadId);
      addLog('DOWNLOAD', '删除下载文件', normalized);
      saveData();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-deleted', { id: downloadId, filePath: normalized });
      }
      return { success: true, id: downloadId, filePath: normalized };
    } catch (error) {
      addLog('DOWNLOAD', '删除下载文件失败', error.message);
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('remove-download-record', (event, downloadId) => {
    const download = globalState.downloads.get(downloadId);
    if (!download) return { success: true, id: downloadId, removed: false };
    const item = downloadItems.get(downloadId);
    if (item && typeof item.cancel === 'function' && download.state === 'progressing') {
      try { item.cancel(); } catch (e) {}
      downloadItems.delete(downloadId);
    }
    globalState.downloads.delete(downloadId);
    addLog('DOWNLOAD', '移除下载记录', download.fileName || downloadId);
    saveData();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-deleted', { id: downloadId, filePath: download.filePath || '', recordOnly: true });
    }
    return { success: true, id: downloadId, removed: true };
  });
  ipcMain.handle('redownload', async (event, download = {}) => {
    try {
      const sender = BrowserWindow.fromWebContents(event.sender);
      if (!sender || sender.isDestroyed()) throw new Error('主窗口不存在');
      const isMedia = download.category === 'media' || download.mediaUrl;
      const mediaUrl = download.mediaUrl || download.url;
      if (!mediaUrl) throw new Error('原始下载地址为空，无法重新下载');
      if (isMedia) {
        pendingMediaDownloads.set(mediaUrl, {
          url: mediaUrl,
          fileName: download.mediaTitle || download.fileName || getFileNameFromUrl(mediaUrl),
          roughName: true,
          webContentsId: sender.webContents.id,
          startedAt: Date.now()
        });
      }
      sender.webContents.downloadURL(download.url);
      addLog('DOWNLOAD', '重新下载', download.fileName || download.url);
      return { success: true, url: download.url, mediaUrl };
    } catch (error) {
      addLog('DOWNLOAD', '重新下载失败', error.message);
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('share-download', async (event, filePath, target) => {
    try {
      const normalized = normalizeDownloadFilePath(filePath);
      const clipboardResult = await copyFileForChat(normalized);
      const openResult = await openChatTarget(target);
      addLog('DOWNLOAD', '准备分享文件', `${normalized} -> ${openResult.label || target}`);
      return { success: true, filePath: normalized, clipboard: clipboardResult, target: openResult };
    } catch (error) {
      addLog('DOWNLOAD', '分享文件失败', error.message);
      return { success: false, error: error.message };
    }
  });

  // 媒体
  ipcMain.handle('get-media-urls', (event, tabId) => globalState.mediaUrls.get(tabId) || []);
  ipcMain.handle('get-all-media-urls', () => getAllMediaUrls());
  ipcMain.handle('delete-media-url', (event, tabId, url) => {
    const removeFromList = (list) => {
      const before = list.length;
      const next = list.filter(media => media.url !== url);
      return { next, removed: before - next.length };
    };
    let removed = 0;
    if (tabId && globalState.mediaUrls.has(tabId)) {
      const result = removeFromList(globalState.mediaUrls.get(tabId));
      globalState.mediaUrls.set(tabId, result.next);
      removed += result.removed;
    } else {
      globalState.mediaUrls.forEach((list, key) => {
        const result = removeFromList(list);
        globalState.mediaUrls.set(key, result.next);
        removed += result.removed;
      });
    }
    addLog('MEDIA', '删除嗅探记录', `${removed} 条 | ${url}`);
    saveData();
    return { success: true, removed };
  });
  ipcMain.handle('clear-media-list', (event, options = {}) => {
    const clearType = options.clearType || 'all';
    let cleared = 0;
    let clearedDownloads = 0;
    
    if (clearType === 'sniff' || clearType === 'all') {
      cleared = getAllMediaUrls().length;
      globalState.mediaUrls.clear();
      Array.from(globalState.downloads.entries()).forEach(([id, download]) => {
        if (download.category === 'media' && download.state !== 'progressing' && download.state !== 'completed') {
          globalState.downloads.delete(id);
          clearedDownloads++;
        }
      });
    }
    
    if (clearType === 'downloaded' || clearType === 'all') {
      if (clearType === 'downloaded') cleared = getAllMediaUrls().length;
      Array.from(globalState.downloads.entries()).forEach(([id, download]) => {
        if (download.category === 'media' && download.state === 'completed') {
          globalState.downloads.delete(id);
          clearedDownloads++;
        }
      });
    }
    
    addLog('MEDIA', `清空${clearType === 'sniff' ? '嗅探' : clearType === 'downloaded' ? '已下载' : '全部'}列表`, `${cleared} 条，媒体下载记录 ${clearedDownloads} 条`);
    saveData();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('media-list-cleared', { cleared, clearedDownloads, clearType });
    }
    return { success: true, cleared, clearedDownloads, clearType };
  });
  ipcMain.handle('download-media', async (event, url, fileName, options = {}) => {
    try {
      const sender = BrowserWindow.fromWebContents(event.sender);
      if (!sender || sender.isDestroyed()) throw new Error('主窗口不存在');
      pendingMediaDownloads.set(url, { url, fileName: fileName || getFileNameFromUrl(url), roughName: Boolean(options.roughName), webContentsId: sender.webContents.id, startedAt: Date.now() });
      sender.webContents.downloadURL(url);
      addLog('DOWNLOAD', '开始媒体下载', fileName || url);
      return { success: true, url, fileName };
    } catch (error) {
      addLog('DOWNLOAD', '媒体下载失败', error.message);
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('download-media-list', async (event, mediaList = [], options = {}) => {
    const sender = BrowserWindow.fromWebContents(event.sender);
    if (!sender || sender.isDestroyed()) return { success: false, error: '主窗口不存在' };
    const list = Array.isArray(mediaList) ? mediaList : [];

    // 先清理已暂停或已失败的旧媒体下载项，避免阻碍重新下载
    const mediaUrls = new Set(list.map(m => m && m.url).filter(Boolean));
    for (const [downloadId, info] of globalState.downloads) {
      if (info.category === 'media' && mediaUrls.has(info.mediaUrl) && (info.paused || info.state === 'cancelled' || info.state === 'interrupted')) {
        const oldItem = downloadItems.get(downloadId);
        if (oldItem) {
          try { oldItem.cancel(); } catch (e) {}
        }
        downloadItems.delete(downloadId);
        globalState.downloads.delete(downloadId);
      }
    }

    let count = 0;
    let skipped = 0;
    // 直接逐个下载，每次等待前一个完成初始化后再发起下一个
    for (const media of list) {
      if (!media || !media.url) {
        addLog('DOWNLOAD', '跳过无效媒体', 'info missing');
        skipped++;
        continue;
      }
      const url = normalizeMediaDownloadUrl(media.url);
      addLog('DOWNLOAD', `准备下载(${count + 1}/${list.length})`, `${media.title || getFileNameFromUrl(media.url)} [${url}]`);
      await new Promise(resolve => {
        const pending = { url: media.url, fileName: media.title || getFileNameFromUrl(media.url), roughName: Boolean(options.roughName), webContentsId: sender.webContents.id, startedAt: Date.now() };
        pendingMediaDownloads.set(media.url, pending);
        // 如果URL是HTTP，也注册HTTPS版本作为pending key，防止Chromium自动升级导致匹配失败
        if (typeof media.url === 'string' && media.url.startsWith('http://')) {
          const httpsUrl = media.url.replace(/^http:\/\//, 'https://');
          pendingMediaDownloads.set(httpsUrl, { ...pending, url: httpsUrl });
        }
        sender.webContents.downloadURL(media.url);
        count++;
        setTimeout(resolve, 400);
      });
    }
    addLog('DOWNLOAD', '一键下载全部媒体', `共 ${list.length} 个，发起 ${count} 个，跳过 ${skipped} 个`);
    return { success: true, count, skipped };
  });

  // 自动嗅探滚动
  ipcMain.handle('start-auto-sniff-scroll', async (event, webContentsId, options = {}) => {
    const tabId = getTabIdFromWebContents(webContentsId);
    if (!tabId) return { success: false, error: '标签页不存在' };
    const tab = globalState.tabs.get(tabId);
    if (!tab || !tab.webContents || tab.webContents.isDestroyed()) return { success: false, error: 'BrowserView 不存在' };
    const { startPos, pagePos } = options;
    return startAutoSniffScroll(tab, { startPos, pagePos });
  });

  ipcMain.handle('pause-auto-sniff', () => {
    pauseAutoSniffScroll();
    return { success: true, paused: autoSniffState.paused };
  });

  ipcMain.handle('resume-auto-sniff', () => {
    resumeAutoSniffScroll();
    return { success: true, paused: autoSniffState.paused };
  });

  ipcMain.handle('get-auto-sniff-state', () => {
    return { active: autoSniffState.active, paused: autoSniffState.paused };
  });

  ipcMain.handle('pause-all-downloads', () => pauseAllDownloads());
  ipcMain.handle('resume-all-downloads', () => resumeAllDownloads());
  ipcMain.handle('get-all-download-pause-state', () => getAllDownloadPauseState());

  ipcMain.handle('pause-download', (event, downloadId) => pauseDownload(downloadId));
  ipcMain.handle('resume-download', (event, downloadId) => resumeDownload(downloadId));

  // 翻译
  ipcMain.handle('translate-text', async (event, text, targetLang) => await translateText(text, targetLang));
  ipcMain.handle('translate-page', async (event, tabId, targetLang) => {
    const tab = globalState.tabs.get(tabId);
    if (!tab || !tab.webContents) return { success: false, error: '标签页不存在' };
    try {
      targetLang = targetLang || 'zh';
      const result = await translatePageContent(tab, targetLang, { force: true });
      addLog('TRANSLATE', result.success ? '页面翻译完成' : '页面翻译失败', result.success ? `翻译了 ${result.translatedCount} 处` : result.error);
      return result;
    } catch (error) {
      addLog('TRANSLATE', '页面翻译失败', error.message);
      return { success: false, error: error.message };
    }
  });

  // 设置
  ipcMain.handle('get-settings', () => globalState.settings);
  ipcMain.handle('update-settings', (event, newSettings) => {
    const normalized = { ...newSettings };
    if (Object.prototype.hasOwnProperty.call(normalized, 'fontSize')) {
      normalized.fontSize = normalizeFontSize(normalized.fontSize);
    }
    globalState.settings = { ...globalState.settings, ...normalized };
    saveData();
    if (Object.prototype.hasOwnProperty.call(normalized, 'fontSize')) {
      applyFontSizeToAllTabs();
    }
    addLog('SETTINGS', '更新设置', JSON.stringify(normalized));
    return globalState.settings;
  });

  // 自定义广告规则管理
  ipcMain.handle('get-custom-ad-rules', () => {
    return globalState.customAdRules || [];
  });

  ipcMain.handle('delete-custom-ad-rule', (event, index) => {
    if (globalState.customAdRules && index >= 0 && index < globalState.customAdRules.length) {
      const removed = globalState.customAdRules.splice(index, 1);
      saveData();
      addLog('ADBLOCK', '删除广告规则', removed[0].selector);
      // 通知所有标签页重新加载以移除CSS
      globalState.tabs.forEach((tab) => {
        if (tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
          tab.view.webContents.reload();
        }
      });
      return { success: true };
    }
    return { success: false, error: '索引无效' };
  });

  ipcMain.handle('clear-custom-ad-rules', () => {
    const count = (globalState.customAdRules || []).length;
    globalState.customAdRules = [];
    saveData();
    addLog('ADBLOCK', '清空所有广告规则', `${count} 条`);
    globalState.tabs.forEach((tab) => {
      if (tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
        tab.view.webContents.reload();
      }
    });
    return { success: true, count };
  });

  ipcMain.handle('select-download-path', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: '选择下载目录' });
    if (!result.canceled && result.filePaths.length > 0) {
      globalState.settings.downloadPath = result.filePaths[0];
      saveData();
      return result.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('get-active-tab', () => {
    if (!globalState.activeTabId) return null;
    const tab = globalState.tabs.get(globalState.activeTabId);
    if (!tab) return null;
    return { id: tab.id, url: tab.url, title: tab.title, favicon: tab.favicon, loading: tab.loading, canGoBack: tab.canGoBack, canGoForward: tab.canGoForward };
  });

  ipcMain.handle('open-external', (event, url) => shell.openExternal(url));
  ipcMain.handle('get-app-version', () => app.getVersion());
  ipcMain.handle('get-versions', () => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }));

  // 日志功能
  ipcMain.handle('get-logs', () => getLogs());
  ipcMain.handle('clear-logs', () => clearLogs());
  ipcMain.handle('set-log-auto-clear', (event, enabled) => {
    logAutoClear = enabled;
    addLog('SETTINGS', `退出自动清除日志: ${enabled ? '开启' : '关闭'}`);
  });

  // 右侧面板状态：面板打开时缩小 BrowserView，避免原生网页层压住 renderer 面板
  ipcMain.handle('set-panel-open', (event, open) => {
    rightPanelOpen = Boolean(open);
    updateBrowserViewLayout();
    addLog('SETTINGS', '右侧面板状态', rightPanelOpen ? '打开' : '关闭');
  });

  // 书签栏右键菜单：必须使用 Electron 原生菜单，不能使用 DOM 菜单，否则会被 BrowserView 遮挡
  ipcMain.handle('show-bookmark-menu', async (event, bookmarkId) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bookmark = globalState.bookmarks.find(b => b.id === bookmarkId);
    if (!bookmark) return;

    const menu = Menu.buildFromTemplate([
      {
        label: '打开书签',
        click: () => createTab(bookmark.url)
      },
      {
        label: '编辑书签',
        click: () => {
          showBookmarkEditModal(bookmark);
        }
      },
      { type: 'separator' },
      {
        label: '删除书签',
        click: () => {
          globalState.bookmarks = globalState.bookmarks.filter(b => b.id !== bookmarkId);
          saveData();
          mainWindow.webContents.send('bookmarks-changed');
          addLog('BOOKMARK', '删除书签', bookmark.title);
        }
      }
    ]);

    menu.popup({ window: mainWindow });
  });

  // 书签栏溢出菜单（原生Menu，避免被遮挡）
  ipcMain.handle('show-bookmark-overflow-menu', async (event, bookmarkIds, btnRect) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!Array.isArray(bookmarkIds) || bookmarkIds.length === 0) return;
    
    const menuItems = bookmarkIds.map(id => {
      const bookmark = globalState.bookmarks.find(b => b.id === id);
      if (!bookmark) return null;
      const label = bookmark.title.length > 40 ? bookmark.title.slice(0, 37) + '...' : bookmark.title;
      return {
        label,
        submenu: [
          { label: '打开书签', click: () => createTab(bookmark.url) },
          { label: '编辑书签', click: () => { showBookmarkEditModal(bookmark); } },
          { type: 'separator' },
          { label: '删除书签', click: () => {
            globalState.bookmarks = globalState.bookmarks.filter(b => b.id !== id);
            saveData();
            mainWindow.webContents.send('bookmarks-changed');
            addLog('BOOKMARK', '删除书签', bookmark.title);
          }}
        ]
      };
    }).filter(Boolean);
    
    if (menuItems.length === 0) return;
    
    const menu = Menu.buildFromTemplate(menuItems);
    // 菜单弹出在按钮左侧
    const popupOpts = { window: mainWindow };
    if (btnRect && typeof btnRect.x === 'number') {
      popupOpts.x = Math.round(btnRect.x);
      popupOpts.y = Math.round(btnRect.y);
    }
    menu.popup(popupOpts);
  });

  // 下载/嗅探列表右键菜单（原生 Menu，避免被 BrowserView 遮挡）
  ipcMain.handle('show-download-context-menu', async (event, downloadData) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const { id, state, paused, filePath, source } = downloadData || {};
    const items = [];
    // 未下载的媒体（来自媒体嗅探列表）
    if (source === 'media-undownloaded' || state === 'not_started') {
      items.push({
        label: '下载',
        click: () => {
          mainWindow.webContents.send('download-context-action', { action: 'download', downloadId: id, source });
        }
      });
    } else {
      // 已下载的项
      if (state === 'progressing') {
        items.push({
          label: paused ? '继续下载' : '暂停',
          click: () => {
            if (paused) {
              ipcMain.emit('resume-download', event, id);
            } else {
              ipcMain.emit('pause-download', event, id);
            }
            mainWindow.webContents.send('download-context-action', { action: paused ? 'resume' : 'pause', downloadId: id, source });
          }
        });
      }
      if (state !== 'progressing') {
        items.push({
          label: '重新下载',
          click: () => {
            mainWindow.webContents.send('download-context-action', { action: 'redownload', downloadId: id, source });
          }
        });
      }
      if (filePath) {
        items.push({
          label: '打开文件夹',
          click: () => {
            shell.showItemInFolder(filePath);
          }
        });
      }
    }
    items.push({ type: 'separator' });
    items.push({
      label: '删除',
      click: () => {
        mainWindow.webContents.send('download-context-action', { action: 'delete', downloadId: id, source });
      }
    });
    const menu = Menu.buildFromTemplate(items);
    menu.popup({ window: mainWindow });
  });

  // 地址栏右键菜单（原生 Menu，避免被 BrowserView 遮挡）
  ipcMain.handle('show-address-bar-menu', async (event, data) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const { hasSelection, hasClipboard } = data || {};
    const menu = Menu.buildFromTemplate([
      {
        label: '复制',
        enabled: hasSelection,
        click: () => {
          mainWindow.webContents.send('address-bar-action', { action: 'copy' });
        }
      },
      {
        label: '粘贴',
        click: () => {
          mainWindow.webContents.send('address-bar-action', { action: 'paste' });
        }
      },
      {
        label: '剪切',
        enabled: hasSelection,
        click: () => {
          mainWindow.webContents.send('address-bar-action', { action: 'cut' });
        }
      },
      { type: 'separator' },
      {
        label: '全选',
        click: () => {
          mainWindow.webContents.send('address-bar-action', { action: 'select-all' });
        }
      },
      { type: 'separator' },
      {
        label: '删除',
        click: () => {
          mainWindow.webContents.send('address-bar-action', { action: 'delete' });
        }
      }
    ]);
    menu.popup({ window: mainWindow });
  });

  // 页面缩放
  ipcMain.handle('set-zoom-level', (event, tabId, level) => {
    const tab = globalState.tabs.get(tabId);
    if (tab && tab.webContents) {
      const normalizedLevel = Math.max(-3, Math.min(3, Number(level) || 0));
      tab.zoomLevel = normalizedLevel;
      tab.webContents.setZoomLevel(normalizedLevel);
      addLog('SETTINGS', '页面缩放', `级别: ${normalizedLevel}`);
    }
  });

  ipcMain.handle('reset-zoom-level', (event, tabId) => {
    resetZoomForActiveTab(tabId);
  });

  ipcMain.on('browser-ctrl-wheel', (event, payload) => {
    handleBrowserCtrlWheel(event.sender, payload);
  });

  ipcMain.on('browser-reset-zoom', (event) => {
    const tab = getTabByWebContents(event.sender);
    if (tab) resetZoomForActiveTab(tab.id);
  });

  ipcMain.handle('get-zoom-level', (event, tabId) => {
    const tab = globalState.tabs.get(tabId);
    if (tab && tab.webContents) {
      return tab.webContents.getZoomLevel();
    }
    return 0;
  });

  // 截图功能
  ipcMain.handle('capture-page', async (event, tabId) => {
    const tab = globalState.tabs.get(tabId);
    if (!tab || !tab.webContents) return { success: false, error: '标签页不存在' };
    try {
      const image = await tab.webContents.capturePage();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `screenshot-${timestamp}.png`;
      const filePath = path.join(globalState.settings.downloadPath, fileName);
      if (!fs.existsSync(globalState.settings.downloadPath)) {
        fs.mkdirSync(globalState.settings.downloadPath, { recursive: true });
      }
      fs.writeFileSync(filePath, image.toPNG());
      addLog('SCREENSHOT', '截图保存', filePath);
      return { success: true, filePath };
    } catch (error) {
      addLog('ERROR', '截图失败', error.message);
      return { success: false, error: error.message };
    }
  });

  // 打印功能
  ipcMain.handle('print-page', async (event, tabId) => {
    const tab = globalState.tabs.get(tabId);
    if (!tab || !tab.webContents) return { success: false, error: '标签页不存在' };
    try {
      tab.webContents.print({ silent: false, printBackground: true });
      addLog('PRINT', '打印页面');
      return { success: true };
    } catch (error) {
      addLog('ERROR', '打印失败', error.message);
      return { success: false, error: error.message };
    }
  });
}

// ==================== 托盘 ====================
function createTray() {
  const trayIcon = path.join(__dirname, '../assets/tray-icon.png');
  try { tray = new Tray(trayIcon); } catch (e) { addLog('ERROR', '托盘图标加载失败'); return; }
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { label: '新建标签页', click: () => { if (mainWindow) { mainWindow.show(); createTab(); } } },
    { type: 'separator' },
    { label: '退出', click: () => { globalState.isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip('飞毛腿浏览器');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
}

// ==================== 应用生命周期 ====================
// Windows 任务栏图标设置
if (process.platform === 'win32') {
  app.setAppUserModelId('com.feimaotui.browser');
}
// ==================== 微信快捷登录：IPC 代理 localhost.weixin.qq.com 请求 ====================
// Chromium 148 的 Private Network Access 在渲染层阻止公网→本地请求
// 通过 IPC 代理：页面 JS -> preload -> IPC -> 主进程 net.fetch -> 微信本地服务器
function setupWxProxy() {
  ipcMain.handle('wx-proxy', async (event, req) => {
    const url = req.url;
    addLog('WX', '代理请求', `${req.method || 'GET'} ${url.substring(0, 80)}`);
    try {
      const https = require('https');
      const http = require('http');
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const agent = isHttps
        ? new https.Agent({ rejectUnauthorized: false })
        : new http.Agent();

      const response = await new Promise((resolve, reject) => {
        const options = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (isHttps ? 443 : 80),
          path: parsedUrl.pathname + parsedUrl.search,
          method: req.method || 'GET',
          headers: req.headers || {},
          agent: agent,
          rejectUnauthorized: false
        };
        const lib = isHttps ? https : http;
        const hreq = lib.request(options, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            resolve({
              status: res.statusCode,
              statusText: res.statusMessage,
              headers: res.headers,
              body: body
            });
          });
        });
        hreq.on('error', reject);
        if (req.body) hreq.write(req.body);
        hreq.end();
        setTimeout(() => reject(new Error('request_timeout')), 5000);
      });

      addLog('WX', '代理响应', `status=${response.status} size=${response.body.length}`);
      return response;
    } catch (e) {
      addLog('WX', '代理失败', `error=${e.message}`);
      return { status: 502, statusText: 'Bad Gateway', headers: {}, body: JSON.stringify({ error: e.message }) };
    }
  });
}

app.whenReady().then(() => {
  setupWxProxy();
  loadData();
  createMainWindow();
  setupIPC();
  createTray();
  addLog('INFO', '飞毛腿浏览器启动完成');

  // 每30秒自动保存会话（防止直接关机/断电丢失）
  setInterval(() => {
    if (globalState.tabs.size > 0) {
      saveTabsSession();
    }
  }, 30000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else if (mainWindow) mainWindow.show();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  globalState.isQuitting = true;
  // 正常退出时清空会话，下次不自动恢复
  try {
    fs.writeFileSync(path.join(dataPath, 'tabs-session.json'), JSON.stringify([]));
    addLog('SESSION', '正常退出，清空会话');
  } catch (e) {}
  saveData();
  if (logAutoClear) runtimeLogs = [];
});

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      const url = commandLine.find(arg => arg.startsWith('http'));
      if (url) createTab(url);
    }
  });
}
