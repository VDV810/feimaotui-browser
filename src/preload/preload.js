const { contextBridge, ipcRenderer } = require('electron');

// 清除 Electron 痕迹，避免网页通过 JS 检测浏览器类型后禁用功能
// 必须在页面任何脚本运行前执行
const _realUA = navigator.userAgent;
const _spoofedUA = _realUA.replace(/Electron\/[\d.]+\s?/g, '').replace(/Feimaotui-Browser\/[\d.]+\s?/g, '');
Object.defineProperty(navigator, 'userAgent', {
  get: () => _spoofedUA || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
});
Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' });
Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
Object.defineProperty(navigator, 'webdriver', { get: () => false });
Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

// 删除 Electron/Node 痕迹
try {
  if (window.process && window.process.versions) {
    delete window.process.versions.electron;
    delete window.process.versions.node;
    delete window.process.versions.chrome;
  }
  // 尝试删除 process 对象本身（部分场景下可删除）
  try { delete window.process; } catch(e) {}
} catch(e) {}

// 伪装 window.chrome 对象，让网页认为自己是 Chrome
if (!window.chrome) {
  window.chrome = {
    runtime: { connect: function(){}, sendMessage: function(){} },
    loadTimes: function() { return { commitLoadTime: Date.now()/1000, connectionInfo: 'http/1.1', finishDocumentLoadTime: Date.now()/1000, finishLoadTime: Date.now()/1000, firstPaintAfterLoadTime: 0, firstPaintTime: Date.now()/1000, navigationType: 'Other', npnNegotiatedProtocol: 'unknown', wasAlternateProtocolAvailable: false, wasFetchedViaSpdy: true, wasNpnNegotiated: true }; },
    csi: function() { return { onloadT: Date.now(), pageT: 300, startE: Date.now()-300, tran: 15 }; },
    app: { isInstalled: false, InstallState: { INSTALLED: 'installed', DISABLED: 'disabled', NOT_INSTALLED: 'not_installed' }, RunningState: { RUNNING: 'running', CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run' } },
    storage: {}
  };
}

// ============ 腾讯广告 splitview 关闭按钮修复 ============
// 策略：CSS 干掉图标字体 ::before → JS 设 textContent='×' 用系统字体显示
(function() {
  var FIX_CSS = [
    '#icon-close::before{content:none!important}',
    '#icon-close::after{content:none!important}',
    '.spaui-icon,.spaui-icon::before,.spaui-icon::after{display:inline-block!important;min-width:14px!important;min-height:14px!important;line-height:1!important;-webkit-font-smoothing:antialiased!important}',
    '.spaui-icon svg{display:inline-block!important;min-width:14px!important;min-height:14px!important;overflow:visible!important}'
  ].join('');

  function tick() {
    // CSS注入
    if (document.head) {
      var old = document.getElementById('feimaotui-fix-css');
      if (old) old.remove();
      var style = document.createElement('style');
      style.id = 'feimaotui-fix-css';
      style.textContent = FIX_CSS;
      document.head.appendChild(style);
    }

    // JS直接改DOM：设textContent为×，用系统字体
    var el = document.getElementById('icon-close');
    if (el) {
      el.textContent = '×';
      el.style.cssText = 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Microsoft YaHei",sans-serif!important;font-size:16px!important;font-weight:700!important;color:#666!important;cursor:pointer!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;width:16px!important;height:16px!important;line-height:1!important;opacity:1!important;visibility:visible!important;';
    }
  }
  setInterval(tick, 100);
  tick();

  document.addEventListener('click', function(e) {
    var target = e.target;
    while (target && target !== document) {
      if (target.id === 'icon-close') {
        var panel = document.getElementById('splitview');
        if (panel) { panel.classList.remove('splitview-show'); panel.style.display = 'none'; }
        return;
      }
      target = target.parentElement;
    }
  }, true);
})();

// 监听文件拖入浏览器窗口 → 自动导入书签
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
}, false);

document.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  const files = e.dataTransfer && e.dataTransfer.files;
  if (!files || files.length === 0) return;
  const file = files[0];
  const filePath = file.path || (file.name && file.name.startsWith('/') ? file.name : '');
  if (!filePath) return;
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.json') || lower.endsWith('.html') || lower.endsWith('.htm')) {
    ipcRenderer.send('file-dropped', filePath);
  }
}, false);

// BrowserView 内部网页的 Ctrl+滚轮不会可靠传到外层 renderer，
// 所以必须在页面 preload 里直接捕获，再交给主进程统一缩放。
window.addEventListener('wheel', (event) => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  event.stopPropagation();
  ipcRenderer.send('browser-ctrl-wheel', {
    deltaY: event.deltaY,
    wheelDeltaY: event.wheelDeltaY || 0
  });
}, { capture: true, passive: false });

window.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.key === '0') {
    event.preventDefault();
    event.stopPropagation();
    ipcRenderer.send('browser-reset-zoom');
  }
}, { capture: true });

// 深度媒体嗅探：很多后台素材库使用 blob/MSE 或接口返回视频，URL 不一定带 .mp4。
// 这里监听页面 video/source 元素的播放与元数据加载，把可下载 src/currentSrc 上报给主进程。
const reportedMediaSources = new Map();

function isUsefulVideoTitle(text) {
  const value = String(text || '').replace(/\s+/g, '').trim();
  if (value.length < 2 || value.length > 80) return false;
  if (/https?:\/\//i.test(value) || /\.(mp4|m3u8|webm|mov)(\?|$)/i.test(value)) return false;
  if (/^(播放|暂停|下载|删除|编辑|复制|分享|素材库|视频|预览)$/i.test(value)) return false;
  return /[\u4e00-\u9fa5a-zA-Z]/.test(value);
}

function getVisibleTextCandidates(root) {
  if (!root) return [];
  const candidates = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = root;
  while (node) {
    const style = window.getComputedStyle(node);
    if (style.display !== 'none' && style.visibility !== 'hidden') {
      const text = (node.innerText || node.textContent || '').trim();
      text.split(/\n+/).forEach(line => {
        const value = line.trim();
        if (isUsefulVideoTitle(value)) candidates.push(value);
      });
    }
    node = walker.nextNode();
  }
  return candidates;
}

function extractVideoTitleFromElement(video) {
  const roots = [];
  let current = video;
  for (let i = 0; i < 7 && current; i++) {
    roots.push(current);
    current = current.parentElement;
  }
  const candidates = roots.flatMap(getVisibleTextCandidates);
  const unique = Array.from(new Set(candidates));
  unique.sort((a, b) => {
    const score = (text) => {
      const compact = text.replace(/\s+/g, '');
      let value = 0;
      if (/[月日]/.test(compact)) value += 8;
      if (/素材|剪辑|混剪|口播|成片/.test(compact)) value += 8;
      if (/[a-zA-Z]/.test(compact)) value += 2;
      if (/\d/.test(compact)) value += 2;
      return value + Math.min(compact.length, 40) / 10;
    };
    return score(b) - score(a);
  });
  return unique[0] || '';
}

function collectVideoSources(video) {
  const sources = [];
  const title = extractVideoTitleFromElement(video) || document.title || '';
  const add = (url, type = '') => {
    if (!url || url.startsWith('blob:') || url.startsWith('data:')) return;
    const previousTitle = reportedMediaSources.get(url);
    if (previousTitle && previousTitle === title) return;
    reportedMediaSources.set(url, title);
    sources.push({ url, type, title });
  };
  add(video.currentSrc || video.src || '', video.type || '');
  video.querySelectorAll('source').forEach(source => add(source.src || '', source.type || ''));
  return sources;
}

function reportVideoElement(video) {
  try {
    const sources = collectVideoSources(video);
    if (sources.length > 0) {
      ipcRenderer.send('media-element-detected', { sources });
    }
  } catch (e) {}
}

function bindVideoElement(video) {
  if (!video || video.dataset.feimaotuiMediaBound === '1') return;
  video.dataset.feimaotuiMediaBound = '1';
  ['loadedmetadata', 'play', 'playing', 'canplay'].forEach(eventName => {
    video.addEventListener(eventName, () => reportVideoElement(video), true);
  });
  reportVideoElement(video);
}

function scanVideoElements() {
  document.querySelectorAll('video').forEach(bindVideoElement);
}

window.addEventListener('DOMContentLoaded', scanVideoElements, { once: true });
window.addEventListener('load', scanVideoElements, { once: true });
setInterval(scanVideoElements, 2000);

new MutationObserver(scanVideoElements).observe(document.documentElement || document, {
  childList: true,
  subtree: true
});

// ============ 批量标记广告：支持两种选择方式 ============
// 1. 拖拽选择文本/内容（最自然的方式，像复制文本一样选中区域）
// 2. Alt+点击多选元素（精确选择单个元素）
(function() {
  var selectedElements = new Set();
  
  // 清除所有选中状态
  function clearAllSelection() {
    selectedElements.forEach(function(el) {
      el.removeAttribute('data-feimaotui-selected');
      el.style.outline = '';
      el.style.outlineOffset = '';
    });
    selectedElements.clear();
  }
  
  // 切换元素选中状态
  function toggleElementSelection(el) {
    if (!el || el === document.body || el === document.documentElement) return;
    if (selectedElements.has(el)) {
      selectedElements.delete(el);
      el.removeAttribute('data-feimaotui-selected');
      el.style.outline = '';
      el.style.outlineOffset = '';
    } else {
      selectedElements.add(el);
      el.setAttribute('data-feimaotui-selected', 'true');
      el.style.outline = '2px solid #ff4d4f';
      el.style.outlineOffset = '2px';
    }
  }
  
  // 从文本选择中收集元素（只收集最内层的相关元素，避免隐藏大块内容）
  function collectElementsFromSelection() {
    var selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return [];
    
    var range = selection.getRangeAt(0);
    var elements = [];
    var seen = new Set();
    
    // 获取范围的公共祖先
    var commonAncestor = range.commonAncestorContainer;
    if (commonAncestor.nodeType === Node.TEXT_NODE) {
      commonAncestor = commonAncestor.parentElement;
    }
    if (!commonAncestor || commonAncestor === document.body || commonAncestor === document.documentElement) return [];
    
    // 收集所有与范围相交的元素
    var walker = document.createTreeWalker(
      commonAncestor,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: function(node) {
          if (node === document.body || node === document.documentElement) return NodeFilter.FILTER_REJECT;
          return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      }
    );
    
    var node;
    while ((node = walker.nextNode())) {
      if (!seen.has(node)) {
        seen.add(node);
        elements.push(node);
      }
    }
    
    // 过滤掉是其他元素祖先的元素（只保留最内层的叶子元素）
    var leafElements = elements.filter(function(el) {
      return !elements.some(function(other) {
        return other !== el && el.contains(other);
      });
    });
    
    // 对于每个叶子元素，尝试向上找到合适的块级容器
    // 内联元素(span/a/strong/em等)会向上找到其父级块元素
    var inlineTags = {'SPAN':1,'A':1,'STRONG':1,'EM':1,'B':1,'I':1,'U':1,'SMALL':1,'SUB':1,'SUP':1,'LABEL':1,'CODE':1,'MARK':1};
    var containerElements = [];
    var containerSeen = new Set();
    
    function addContainer(el) {
      if (!el || el === document.body || el === document.documentElement) return;
      if (containerSeen.has(el)) return;
      containerSeen.add(el);
      containerElements.push(el);
    }
    
    leafElements.forEach(function(el) {
      // 如果是媒体元素，直接加入
      if (el.matches && el.matches('img, iframe, video, svg, canvas, embed, object, [style*="background-image"]')) {
        addContainer(el);
        return;
      }
      // 如果是内联元素，向上查找块级容器
      var current = el;
      var depth = 0;
      while (current && inlineTags[current.tagName] && depth < 5 && current.parentElement && current.parentElement !== document.body) {
        current = current.parentElement;
        depth++;
      }
      addContainer(current);
    });
    
    // 再次过滤：只保留最内层容器（如果A包含B，保留B）
    // 媒体元素始终保留
    var result = containerElements.filter(function(el) {
      return !containerElements.some(function(other) {
        if (other === el) return false;
        // 如果other被el包含，那el是祖先，应该跳过el保留other
        return el.contains(other) && !other.contains(el);
      });
    });
    
    // 限制最多收集的元素数量，避免误隐藏太多内容
    var MAX_ELEMENTS = 15;
    if (result.length > MAX_ELEMENTS) {
      result = result.slice(0, MAX_ELEMENTS);
    }
    
    return result;
  }
  
  // Alt+点击元素时切换选中状态（不干扰Ctrl+点击的浏览器默认行为如打开新标签）
  document.addEventListener('click', function(e) {
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      toggleElementSelection(e.target);
    }
  }, true);
  
  // 右键菜单弹出时，收集文本选择中的元素
  document.addEventListener('contextmenu', function(e) {
    // 从文本选择中收集元素并标记
    var selectionElements = collectElementsFromSelection();
    selectionElements.forEach(function(el) {
      if (!selectedElements.has(el)) {
        selectedElements.add(el);
        el.setAttribute('data-feimaotui-selected', 'true');
        el.style.outline = '2px solid #ff4d4f';
        el.style.outlineOffset = '2px';
      }
    });
  }, true);
  
  // ESC键清除所有选中状态
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && selectedElements.size > 0) {
      clearAllSelection();
      window.getSelection().removeAllRanges();
    }
  });
})();

contextBridge.exposeInMainWorld('electronAPI', {
  // 标签页管理
  createTab: (url, options) => ipcRenderer.invoke('create-tab', url, options),
  closeTab: (tabId) => ipcRenderer.invoke('close-tab', tabId),
  activateTab: (tabId) => ipcRenderer.invoke('activate-tab', tabId),
  getTabs: () => ipcRenderer.invoke('get-tabs'),
  getActiveTab: () => ipcRenderer.invoke('get-active-tab'),
  reorderTabs: (tabIds) => ipcRenderer.invoke('reorder-tabs', tabIds),

  // 导航控制
  navigateTo: (tabId, url) => ipcRenderer.invoke('navigate-to', tabId, url),
  goBack: (tabId) => ipcRenderer.invoke('go-back', tabId),
  goForward: (tabId) => ipcRenderer.invoke('go-forward', tabId),
  reload: (tabId) => ipcRenderer.invoke('reload', tabId),
  stopLoading: (tabId) => ipcRenderer.invoke('stop-loading', tabId),

  // 书签管理
  addBookmark: (bookmark) => ipcRenderer.invoke('add-bookmark', bookmark),
  removeBookmark: (bookmarkId) => ipcRenderer.invoke('remove-bookmark', bookmarkId),
  getBookmarks: () => ipcRenderer.invoke('get-bookmarks'),
  updateBookmarkOrder: (bookmarks) => ipcRenderer.invoke('update-bookmark-order', bookmarks),
  exportBookmarks: () => ipcRenderer.invoke('export-bookmarks'),
  importBookmarks: () => ipcRenderer.invoke('import-bookmarks'),
  importBookmarksFromFile: (filePath) => ipcRenderer.invoke('import-bookmarks-from-file', filePath),

  // 历史记录
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),

  // 下载管理
  getDownloads: () => ipcRenderer.invoke('get-downloads'),
  clearDownloadRecords: () => ipcRenderer.invoke('clear-download-records'),
  openDownload: (filePath) => ipcRenderer.invoke('open-download', filePath),
  showDownloadInFolder: (filePath) => ipcRenderer.invoke('show-download-in-folder', filePath),
  shareDownload: (filePath, target) => ipcRenderer.invoke('share-download', filePath, target),
  deleteDownload: (downloadId, filePath) => ipcRenderer.invoke('delete-download', downloadId, filePath),
  removeDownloadRecord: (downloadId) => ipcRenderer.invoke('remove-download-record', downloadId),
  redownload: (download) => ipcRenderer.invoke('redownload', download),

  // 视频嗅探
  getMediaUrls: (tabId) => ipcRenderer.invoke('get-media-urls', tabId),
  getAllMediaUrls: () => ipcRenderer.invoke('get-all-media-urls'),
  deleteMediaUrl: (tabId, url) => ipcRenderer.invoke('delete-media-url', tabId, url),
  clearMediaList: (options) => ipcRenderer.invoke('clear-media-list', options || {}),
  downloadMedia: (url, fileName, options) => ipcRenderer.invoke('download-media', url, fileName, options),
  downloadMediaList: (mediaList, options) => ipcRenderer.invoke('download-media-list', mediaList, options),
  startAutoSniffScroll: (webContentsId, options) => ipcRenderer.invoke('start-auto-sniff-scroll', webContentsId, options),
  pauseAutoSniff: () => ipcRenderer.invoke('pause-auto-sniff'),
  resumeAutoSniff: () => ipcRenderer.invoke('resume-auto-sniff'),
  getAutoSniffState: () => ipcRenderer.invoke('get-auto-sniff-state'),
  pauseDownload: (downloadId) => ipcRenderer.invoke('pause-download', downloadId),
  resumeDownload: (downloadId) => ipcRenderer.invoke('resume-download', downloadId),
  pauseAllDownloads: () => ipcRenderer.invoke('pause-all-downloads'),
  resumeAllDownloads: () => ipcRenderer.invoke('resume-all-downloads'),
  getAllDownloadPauseState: () => ipcRenderer.invoke('get-all-download-pause-state'),

  // 翻译功能
  translateText: (text, targetLang) => ipcRenderer.invoke('translate-text', text, targetLang),
  translatePage: (tabId, targetLang) => ipcRenderer.invoke('translate-page', tabId, targetLang),

  // 设置
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings) => ipcRenderer.invoke('update-settings', settings),
  selectDownloadPath: () => ipcRenderer.invoke('select-download-path'),

  // 自定义广告规则
  getCustomAdRules: () => ipcRenderer.invoke('get-custom-ad-rules'),
  deleteCustomAdRule: (index) => ipcRenderer.invoke('delete-custom-ad-rule', index),
  clearCustomAdRules: () => ipcRenderer.invoke('clear-custom-ad-rules'),

  // 日志功能
  getLogs: () => ipcRenderer.invoke('get-logs'),
  clearLogs: () => ipcRenderer.invoke('clear-logs'),
  setLogAutoClear: (enabled) => ipcRenderer.invoke('set-log-auto-clear', enabled),

  // 原生层遮挡处理
  setPanelOpen: (open) => ipcRenderer.invoke('set-panel-open', open),
  showBookmarkMenu: (bookmarkId) => ipcRenderer.invoke('show-bookmark-menu', bookmarkId),
  showBookmarkOverflowMenu: (bookmarkIds, btnRect) => ipcRenderer.invoke('show-bookmark-overflow-menu', bookmarkIds, btnRect),
  showDownloadContextMenu: (downloadData) => ipcRenderer.invoke('show-download-context-menu', downloadData),
  showAddressBarMenu: (data) => ipcRenderer.invoke('show-address-bar-menu', data),

  // 页面缩放
  setZoomLevel: (tabId, level) => ipcRenderer.invoke('set-zoom-level', tabId, level),
  getZoomLevel: (tabId) => ipcRenderer.invoke('get-zoom-level', tabId),
  resetZoomLevel: (tabId) => ipcRenderer.invoke('reset-zoom-level', tabId),

  // 截图和打印
  capturePage: (tabId) => ipcRenderer.invoke('capture-page', tabId),
  printPage: (tabId) => ipcRenderer.invoke('print-page', tabId),

  // 深色模式（网页内容）
  setDarkModeForPages: (enabled) => ipcRenderer.send('set-dark-mode-pages', enabled),

  // 其他
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getVersions: () => ipcRenderer.invoke('get-versions'),

  // 事件监听
  onTabCreated: (callback) => ipcRenderer.on('tab-created', (event, data) => callback(data)),
  onTabClosed: (callback) => ipcRenderer.on('tab-closed', (event, data) => callback(data)),
  onTabActivated: (callback) => ipcRenderer.on('tab-activated', (event, data) => callback(data)),
  onTabUpdated: (callback) => ipcRenderer.on('tab-updated', (event, data) => callback(data)),
  onMediaDetected: (callback) => ipcRenderer.on('media-detected', (event, data) => callback(data)),
  onMediaListCleared: (callback) => ipcRenderer.on('media-list-cleared', (event, data) => callback(data)),
  onMediaDownloadStarted: (callback) => ipcRenderer.on('media-download-started', (event, data) => callback(data)),
  onMediaDownloadProgress: (callback) => ipcRenderer.on('media-download-progress', (event, data) => callback(data)),
  onMediaDownloadCompleted: (callback) => ipcRenderer.on('media-download-completed', (event, data) => callback(data)),
  onDownloadStarted: (callback) => ipcRenderer.on('download-started', (event, data) => callback(data)),
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (event, data) => callback(data)),
  onDownloadCompleted: (callback) => ipcRenderer.on('download-completed', (event, data) => callback(data)),
  onDownloadDeleted: (callback) => ipcRenderer.on('download-deleted', (event, data) => callback(data)),
  onDownloadRecordsCleared: (callback) => ipcRenderer.on('download-records-cleared', (event, data) => callback(data)),
  onBookmarksChanged: (callback) => ipcRenderer.on('bookmarks-changed', () => callback()),
  onBookmarksImported: (callback) => ipcRenderer.on('bookmarks-imported', (event, data) => callback(data)),
  onBrowserViewClicked: (callback) => ipcRenderer.on('browser-view-clicked', (event, data) => callback(data)),
  onDownloadContextAction: (callback) => ipcRenderer.on('download-context-action', (event, data) => callback(data)),
  onAddressBarAction: (callback) => ipcRenderer.on('address-bar-action', (event, data) => callback(data)),

  // 自动嗅探事件
  onAutoSniffScrollBottom: (callback) => ipcRenderer.on('auto-sniff-scroll-bottom', () => callback()),
  onAutoSniffPageNext: (callback) => ipcRenderer.on('auto-sniff-page-next', () => callback()),
  onAutoSniffCountUpdate: (callback) => ipcRenderer.on('auto-sniff-count-update', (event, count) => callback(count)),
  onAutoSniffPaused: (callback) => ipcRenderer.on('auto-sniff-paused', () => callback()),
  onAutoSniffResumed: (callback) => ipcRenderer.on('auto-sniff-resumed', () => callback()),

  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});
