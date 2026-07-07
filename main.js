const { app, BrowserWindow, BrowserView, ipcMain, dialog, session, shell, Menu, Tray, clipboard, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { execFile } = require('child_process');

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
  isQuitting: false
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
  } catch (e) { addLog('ERROR', '加载数据失败', e.message); }
}

function saveData() {
  try {
    fs.writeFileSync(path.join(dataPath, 'bookmarks.json'), JSON.stringify(globalState.bookmarks));
    fs.writeFileSync(path.join(dataPath, 'history.json'), JSON.stringify(globalState.history.slice(-1000)));
    fs.writeFileSync(path.join(dataPath, 'settings.json'), JSON.stringify(globalState.settings));
    fs.writeFileSync(path.join(dataPath, 'downloads.json'), JSON.stringify(Array.from(globalState.downloads.values()).slice(-500)));
    fs.writeFileSync(path.join(dataPath, 'media-urls.json'), JSON.stringify(Array.from(globalState.mediaUrls.entries())));
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

  // 隐藏默认菜单栏
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: '飞毛腿浏览器（BY:老南）',
    icon: path.join(__dirname, '../assets/icon.png'),
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
  return Math.max(12, Math.min(28, Math.round(parsed)));
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
    style.textContent = 'body, body * { font-size: ${fontSize}px !important; }';
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
  addLog('SETTINGS', '重置页面缩放', tab.url || tabId);
}

function applyZoomToTab(tab, nextLevel, reason = '页面缩放') {
  if (!tab || !tab.webContents || tab.webContents.isDestroyed()) return;
  const normalizedLevel = Math.max(-3, Math.min(3, Number(nextLevel) || 0));
  tab.zoomLevel = normalizedLevel;
  tab.webContents.setZoomLevel(normalizedLevel);
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
let lastScreenshotDataUrl = null; // 预截取的屏幕图片

async function startRegionScreenshot(tabId) {
  if (screenshotPickerWindow) {
    screenshotPickerWindow.close();
    screenshotPickerWindow = null;
  }

  // 1. 用 capturePage 截取主窗口（不闪烁）
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const winImage = await mainWindow.capturePage();
    const winSize = winImage.getSize();
    addLog('SCREENSHOT', '主窗口截图', `${winSize.width}x${winSize.height}`);

    // 2. 截取当前活动标签的 BrowserView
    const tab = globalState.tabs.get(tabId);
    let viewImage = null;
    let viewBounds = null;

    if (tab && tab.view && tab.webContents) {
      viewBounds = tab.view.getBounds();
      viewImage = await tab.webContents.capturePage();
      const viewSize = viewImage.getSize();
      addLog('SCREENSHOT', 'BrowserView截图', `${viewSize.width}x${viewSize.height}, bounds:${JSON.stringify(viewBounds)}`);
    }

    // 3. 在隐藏窗口中用 canvas 合成完整截图
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    const composeWin = new BrowserWindow({
      width: winSize.width,
      height: winSize.height,
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        offscreen: true
      }
    });

    await new Promise(resolve => {
      composeWin.webContents.once('did-finish-load', async () => {
        try {
          // 将合成逻辑注入隐藏窗口
          const result = await composeWin.webContents.executeJavaScript(`
            new Promise((resolve) => {
              const canvas = document.createElement('canvas');
              canvas.width = ${winSize.width};
              canvas.height = ${winSize.height};
              const ctx = canvas.getContext('2d');

              // 绘制主窗口截图
              const winImg = new Image();
              winImg.onload = () => {
                ctx.drawImage(winImg, 0, 0);
                
                // 如果有 BrowserView 截图，叠加到正确位置
                ${viewImage && viewBounds ? `
                  const viewImg = new Image();
                  viewImg.onload = () => {
                    ctx.drawImage(viewImg, ${viewBounds.x}, ${viewBounds.y}, ${viewBounds.width}, ${viewBounds.height});
                    resolve(canvas.toDataURL('image/png'));
                  };
                  viewImg.src = '${viewImage.toDataURL()}';
                ` : `
                  resolve(canvas.toDataURL('image/png'));
                `}
              };
              winImg.src = '${winImage.toDataURL()}';
            });
          `);

          lastScreenshotDataUrl = result;
          addLog('SCREENSHOT', '合成截图完成');
        } catch (e) {
          addLog('ERROR', '合成失败', e.message);
          lastScreenshotDataUrl = winImage.toDataURL();
        }
        composeWin.close();
        resolve();
      });
      composeWin.loadURL('about:blank');
    });

  } catch (error) {
    addLog('ERROR', '截图失败', error.message);
    return;
  }

  // 4. 打开截图选择窗口
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  screenshotPickerWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    frame: false,
    transparent: false,
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

  screenshotPickerWindow.webContents.once('did-finish-load', () => {
    if (lastScreenshotDataUrl) {
      screenshotPickerWindow.webContents.send('screenshot-image', lastScreenshotDataUrl);
    }
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

function showPageContextMenu(tabId) {
  const tab = globalState.tabs.get(tabId);
  if (!tab || !tab.webContents || !mainWindow || mainWindow.isDestroyed()) return;

  const menu = Menu.buildFromTemplate([
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
    { type: 'separator' },
    {
      label: '复制',
      click: () => tab.webContents.copy()
    },
    {
      label: '粘贴',
      click: () => tab.webContents.paste()
    },
    {
      label: '全选',
      click: () => tab.webContents.selectAll()
    },
    { type: 'separator' },
    {
      label: '打印',
      click: () => tab.webContents.print({ silent: false, printBackground: true })
    },
    {
      label: '截图',
      click: () => startRegionScreenshot(tabId)
    }
  ]);

  addLog('INFO', '显示网页右键菜单', tab.url);
  menu.popup({ window: mainWindow });
}

// ==================== 会话设置 ====================
function setupSession() {
  const filter = { urls: ['*://*/*'] };

  session.defaultSession.webRequest.onBeforeRequest(filter, (details, callback) => {
    const url = details.url;
    if (isAdUrl(url)) {
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

  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const requestHeaders = details.requestHeaders || {};
    const rangeHeader = requestHeaders.Range || requestHeaders.range;
    if (rangeHeader && isLikelyMediaRequest(details.url, requestHeaders)) {
      registerMediaCandidate(details.webContentsId, details.url, {
        source: 'range-request',
        type: getMediaType(details.url),
        title: getFileNameFromUrl(details.url)
      });
    }
    callback({ requestHeaders });
  });

  session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
    const ct = details.responseHeaders['content-type'] || details.responseHeaders['Content-Type'];
    const cd = details.responseHeaders['content-disposition'] || details.responseHeaders['Content-Disposition'];
    const cl = details.responseHeaders['content-length'] || details.responseHeaders['Content-Length'];
    const contentType = ct && ct[0] ? ct[0] : '';
    const contentDisposition = cd && cd[0] ? cd[0] : '';
    const contentLength = cl && cl[0] ? parseInt(cl[0]) : 0;
    if ((contentType && isMediaContentType(contentType)) || isLikelyMediaResponse(details.url, contentType, contentDisposition, contentLength)) {
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

  // 下载监听必须只注册一次。
  // 之前写在 createTab() 里，导致每创建一个标签页就多注册一个监听器；
  // 用户点一次下载时，同一个 DownloadItem 会被 N 个监听器重复处理，表现为下载很多相同文件。
  if (!downloadListenerRegistered) {
    downloadListenerRegistered = true;
    session.defaultSession.on('will-download', (event, item, webContents) => {
      handleDownload(event, item, webContents);
    });
  }
}

function isMediaUrl(url) {
  if (isStaticAssetUrl(url)) return false;
  const exts = ['.mp4','.webm','.ogg','.ogv','.mkv','.avi','.mov','.flv','.m3u8','.mpd','.m4v','.3gp','.wmv'];
  const lower = url.toLowerCase();
  return exts.some(ext => lower.includes(ext)) ||
    lower.includes('mime=video') ||
    /[?&](type|format|mime|content_type)=([^&]*)(video|mp4|m3u8|mov|webm)/i.test(lower);
}

function getMediaType(url) {
  const lower = url.toLowerCase();
  if (lower.includes('.mp4')) return 'video/mp4';
  if (lower.includes('.webm')) return 'video/webm';
  if (lower.includes('.m3u8')) return 'application/x-mpegURL';
  if (lower.includes('.mpd')) return 'application/dash+xml';
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
  // 忽略小于 500KB 的文件（除非是流媒体格式如 m3u8/mpd）
  const size = meta.size || meta.contentLength || 0;
  const isStream = /\.(m3u8|mpd)(\?|$)/i.test(String(url || ''));
  if (size > 0 && size < 500 * 1024 && !isStream) return false;
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
  const found = existing.find(m => m.url === url);
  if (found) {
    Object.assign(found, {
      ...meta,
      size: meta.size || found.size || 0,
      contentType: meta.contentType || found.contentType,
      title: meta.title || found.title || getFileNameFromUrl(url)
    });
    saveData();
    return found;
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
      webSecurity: true,
      sandbox: false,
      partition: options.privacyMode ? 'persist:privacy' : undefined
    }
  });

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
    goPhpFallbackTried: false
  };

  globalState.tabs.set(tabId, tab);
  view.webContents.setZoomLevel(0);

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
    view.webContents.setZoomLevel(0);
    applyZoomToTab(tab, tab.zoomLevel || 0, '页面加载应用缩放');
    applyFontSizeToTab(tab);
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

  view.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    addLog('ERROR', '页面加载失败', `${validatedURL} | ${errorDescription} (${errorCode})`);
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
  const isUnknownProtocol = (url) => /^[a-z][a-z0-9+.-]*:/i.test(url) && !/^https?:/i.test(url);

  // 调试日志：记录所有导航事件，帮助追踪 bytedance 弹窗来源
  view.webContents.on('will-navigate', (event, url) => {
    if (isUnknownProtocol(url)) {
      event.preventDefault();
      addLog('BLOCK', '拦截未知协议(will-navigate)', url);
      return;
    }
    addLog('NAV', 'will-navigate', url);
  });

  view.webContents.on('did-start-navigation', (event, url, isInPlace, isMainFrame, frameProcessId, frameRoutingId) => {
    if (isUnknownProtocol(url)) {
      event.preventDefault && event.preventDefault();
      addLog('BLOCK', '拦截未知协议(did-start-navigation)', `url=${url} isMainFrame=${isMainFrame}`);
      return;
    }
    addLog('NAV', 'did-start-navigation', `url=${url} isMainFrame=${isMainFrame}`);
  });

  view.webContents.on('will-frame-navigate', (event, url, isMainFrame, frameProcessId, frameRoutingId) => {
    if (isUnknownProtocol(url)) {
      event.preventDefault();
      addLog('BLOCK', '拦截未知协议(will-frame-navigate)', `url=${url} isMainFrame=${isMainFrame}`);
      return;
    }
    addLog('NAV', 'will-frame-navigate', `url=${url} isMainFrame=${isMainFrame}`);
  });

  view.webContents.setWindowOpenHandler(({ url, referrer, disposition, features }) => {
    if (isUnknownProtocol(url)) {
      addLog('BLOCK', '拦截未知协议(setWindowOpenHandler)', `url=${url} disposition=${disposition}`);
      return { action: 'deny' };
    }
    addLog('NAV', 'setWindowOpenHandler', `url=${url} disposition=${disposition}`);
    const refUrl = (referrer && referrer.url) ? referrer.url : (tab.url || view.webContents.getURL() || '');
    createTab(url, { referrer: refUrl });
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
    showPageContextMenu(tabId);
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

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tab-created', {
      id: tabId, url: tab.url, title: tab.title, active: options.active !== false
    });
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
  const extension = getSafeExtension(originalFileName || pendingMedia.url);
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
    if (!pending || !pending.roughName) continue;
    if (webContentsId && pending.webContentsId && pending.webContentsId !== webContentsId) continue;
    if (now - (pending.startedAt || 0) > PENDING_MEDIA_FALLBACK_WINDOW_MS) continue;
    if (!best || (pending.startedAt || 0) > (best.startedAt || 0)) {
      best = { key, ...pending };
    }
  }
  if (best) {
    best.roughName = true;
    pendingMediaDownloads.get(best.key).roughName = true;
  }
  return best;
}

function findPendingMediaDownload(item, downloadUrl, webContents) {
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

  return findRecentPendingMediaDownload(webContents);
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

  const downloadId = `download-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const fileName = item.getFilename();
  const downloadUrl = item.getURL();
  const pendingMedia = findPendingMediaDownload(item, downloadUrl, webContents);
  const isMediaDownload = Boolean(pendingMedia);
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

// ==================== IPC 处理 ====================
function setupIPC() {
  // 截图区域选择完成（截图窗口传回裁剪坐标，已经是图片像素坐标）
  ipcMain.on('screenshot-region', async (event, crop) => {
    addLog('SCREENSHOT', '收到裁剪坐标', `x:${crop.x}, y:${crop.y}, w:${crop.w}, h:${crop.h}`);
    if (!screenshotPickerWindow) {
      addLog('ERROR', '截图窗口已关闭');
      return;
    }

    // 关闭选择窗口
    const win = screenshotPickerWindow;
    screenshotPickerWindow = null;
    win.close();

    try {
      if (!lastScreenshotDataUrl) {
        throw new Error('没有预截取的屏幕图片');
      }

      // 从预截取的图片中裁剪（坐标已经是图片像素坐标，直接使用）
      const nativeImage = require('electron').nativeImage;
      const fullImage = nativeImage.createFromDataURL(lastScreenshotDataUrl);
      const imgSize = fullImage.getSize();
      addLog('SCREENSHOT', '图片尺寸', `${imgSize.width}x${imgSize.height}`);

      const cropped = fullImage.crop({
        x: Math.max(0, crop.x),
        y: Math.max(0, crop.y),
        width: Math.min(crop.w, imgSize.width - crop.x),
        height: Math.min(crop.h, imgSize.height - crop.y)
      });

      clipboard.writeImage(cropped);
      addLog('SCREENSHOT', '截图已复制到剪贴板');
      lastScreenshotDataUrl = null;

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('show-toast', '截图已复制到剪贴板');
      }
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

  ipcMain.handle('create-tab', (event, url, options = {}) => createTab(url, options));
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
  ipcMain.handle('clear-media-list', () => {
    const cleared = getAllMediaUrls().length;
    globalState.mediaUrls.clear();
    let clearedDownloads = 0;
    Array.from(globalState.downloads.entries()).forEach(([id, download]) => {
      if (download.category === 'media' && download.state !== 'progressing') {
        globalState.downloads.delete(id);
        clearedDownloads++;
      }
    });
    addLog('MEDIA', '清空嗅探列表', `${cleared} 条，媒体下载记录 ${clearedDownloads} 条，不删除本地文件`);
    saveData();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('media-list-cleared', { cleared, clearedDownloads });
    }
    return { success: true, cleared, clearedDownloads };
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
    let count = 0;
    list.forEach(media => {
      if (media && media.url) {
        pendingMediaDownloads.set(media.url, { url: media.url, fileName: media.title || getFileNameFromUrl(media.url), roughName: Boolean(options.roughName), webContentsId: sender.webContents.id, startedAt: Date.now() });
        sender.webContents.downloadURL(media.url);
        count++;
      }
    });
    addLog('DOWNLOAD', '一键下载全部媒体', `${count} 个`);
    return { success: true, count };
  });
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
app.whenReady().then(() => {
  loadData();
  createMainWindow();
  setupIPC();
  createTray();
  addLog('INFO', '飞毛腿浏览器启动完成');

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
