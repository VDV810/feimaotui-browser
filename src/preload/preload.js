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
// 安全方案：注入全局CSS 用 ::before content 强制所有疑似关闭按钮显示×
// + 创建一个绝对定位的 X 覆盖按钮贴在右上角（不修改原元素，避免和页面JS冲突）
(function() {
  // 安全CSS：只针对已标记 data-feimaotui-close="1" 的元素生效
  // 不扫描主窗口UI元素（避免影响浏览器自身按钮）
  // 只在检测到 splitview/drawer/modal 容器存在时才注入覆盖
  function isWxPage() {
    return /(?:weixin\.qq\.com|wx\.qq\.com|sso\.e\.qq\.com|ad\.qq\.com|e\.qq\.com)/.test(location.href);
  }
  if (!isWxPage()) return;

  // 注入安全CSS：图标字体的 ::before 全部置空，让 SVG 隐藏
  var css = [
    /* 隐藏原图标字体/文本（+, 图标字形）：让原内容不可见 */
    '[data-fmt-close-fix="1"]{',
      'font-size:0!important;',
      'color:transparent!important;',
      'position:relative!important;',
    '}',
    /* 隐藏原 SVG / 子节点 */
    '[data-fmt-close-fix="1"] > *{display:none!important}',
    /* 清掉图标字体的伪元素（避免 + 字形通过 ::before 显示） */
    '[data-fmt-close-fix="1"]::before{content:none!important}',
    '[data-fmt-close-fix="1"]::after{content:none!important}',
    /* 用 ::after 显示 ×，与图标 ::before 分离，避免 content 冲突 */
    '[data-fmt-close-fix="1"]::after{',
      'content:"\\00D7"!important;',
      'position:absolute!important;left:0!important;top:0!important;right:0!important;bottom:0!important;',
      'display:flex!important;align-items:center!important;justify-content:center!important;',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI Symbol","Microsoft YaHei",sans-serif!important;',
      'font-size:16px!important;font-weight:400!important;line-height:1!important;',
      'color:#666!important;',
    '}',
    /* 腾讯 spaui 标准 dialog 关闭按钮走原生 SVG，不被上面的规则隐藏/透明化 */
    '.spaui-dialog__close,.spaui-dialog__close-x,.spaui-dialog-close-icon{',
      'font-size:inherit!important;color:inherit!important;background:none!important;',
    '}',
    '.spaui-dialog__close[data-fmt-close-fix="1"] > i,.spaui-dialog__close[data-fmt-close-fix="1"] > svg,.spaui-dialog__close-x[data-fmt-close-fix="1"] > svg,.spaui-dialog-close-icon[data-fmt-close-fix="1"] > svg{',
      'display:inline-block!important;',
    '}',
    '.spaui-dialog__close svg,.spaui-dialog__close-x svg,.spaui-dialog-close-icon svg,.spaui-dialog__close svg path,.spaui-dialog__close-x svg path,.spaui-dialog-close-icon svg path{',
      'fill:currentColor!important;color:inherit!important;opacity:1!important;visibility:visible!important;',
    '}'
  ].join('');

  function injectCss() {
    if (!document.head) return;
    var old = document.getElementById('fmt-close-fix-css');
    if (old) old.remove();
    var s = document.createElement('style');
    s.id = 'fmt-close-fix-css';
    s.textContent = css;
    document.head.appendChild(s);
  }
  injectCss();

  // 只在网页内容里找关闭按钮，且必须命中具体选择器（避免误伤）
  // 不再用启发式扫描！避免误判把浏览器UI或页面其他按钮也标记了
  var SELECTORS = [
    '#icon-close',
    '[class*="icon-close"]',
    '[class*="IconClose"]',
    '[id*="close-btn"]',
    '[id*="closeBtn"]',
    '[class*="el-icon-close"]',
    '[class*="anticon-close"]',
    '[class*="close-btn"]',
    '[class*="closeBtn"]',
    '#splitview [class*="close"]',
    '#splitview [class*="Close"]',
    '[class*="drawer"] [class*="close"]',
    '[class*="modal"] [class*="close"]',
    '[class*="dialog"] [class*="close"]'
  ];

  function isSpauiDialogClose(el) {
    // 腾讯广告管理后台的 spaui 标准 dialog 关闭按钮是原生 SVG，工作正常；
    // 不需要用伪元素替换，否则 color:transparent 会让 fill=currentColor 的 SVG 变透明。
    var cls = (el && el.className || '').toString();
    // 关闭按钮本身，以及它内部包 SVG 的 i.spaui-dialog-close-icon
    if (/\bspaui-dialog__close(-x)?\b/.test(cls)) return true;
    if (/\bspaui-dialog-close-icon\b/.test(cls)) return true;
    // 检查是否在 spaui-dialog 容器内（普通模态框），或在 spaui 关闭按钮内部
    var p = el && el.parentElement;
    for (var k = 0; k < 8 && p && p !== document.body; k++) {
      var pcls = (p.className || '').toString();
      if (/(^|\s)spaui-dialog(\s|$)/.test(pcls)) return true;
      if (/\bspaui-dialog__close(-x)?\b/.test(pcls)) return true;
      if (/\bspaui-dialog-close-icon\b/.test(pcls)) return true;
      p = p.parentElement;
    }
    return false;
  }

  function fix() {
    for (var i = 0; i < SELECTORS.length; i++) {
      try {
        var els = document.querySelectorAll(SELECTORS[i]);
        for (var j = 0; j < els.length; j++) {
          var el = els[j];
          if (!el || el.dataset.fmtCloseFix === '1') continue;
          // 跳过腾讯 spaui 标准 dialog 关闭按钮（原生 SVG 正常，不需要替换）
          if (isSpauiDialogClose(el)) continue;
          // 排除过大元素（不是按钮）
          var rect;
          try { rect = el.getBoundingClientRect(); } catch(e) { continue; }
          if (!rect || rect.width > 60 || rect.height > 60) continue;
          el.dataset.fmtCloseFix = '1';
        }
      } catch(e) {}
    }
  }

  fix();
  // 监听新增元素（不监听characterData，避免回填触发死循环）
  var mo = new MutationObserver(function() {
    clearTimeout(window.__fmtCloseScanT);
    window.__fmtCloseScanT = setTimeout(fix, 300);
  });
  try {
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch(e) {}
  // 兜底
  setInterval(fix, 2000);
})();

  // 点击关闭逻辑
  document.addEventListener('click', function(e) {
    var t = e.target;
    while (t && t !== document) {
      if (t.dataset && t.dataset.fmtCloseFix) {
        var p = t.parentElement;
        for (var n = 0; n < 10 && p && p !== document.body; n++) {
          var id = (p.id || '').toLowerCase();
          var cls = ((p.className || '').toString()).toLowerCase();
          if (
            id.indexOf('splitview') !== -1 ||
            cls.indexOf('splitview') !== -1 ||
            cls.indexOf('drawer') !== -1 ||
            cls.indexOf('modal') !== -1 ||
            cls.indexOf('dialog') !== -1 ||
            cls.indexOf('detail-panel') !== -1
          ) {
            try {
              if (p.classList) {
                p.classList.remove('splitview-show', 'show', 'open', 'is-open', 'ant-modal-open');
              }
              p.style.display = 'none';
            } catch(e) {}
            break;
          }
          p = p.parentElement;
        }
        return;
      }
      t = t.parentElement;
    }
  }, true);

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

// ============ 微信诊断探针（仅记录，不影响功能） ============
// 用 PerformanceObserver 捕获 iframe 内 wxLogin.js 发出的所有资源请求
(function() {
  function isWxDiagUrl(u) {
    return u && (u.indexOf('weixin') !== -1 || u.indexOf('127.0.0.1') !== -1 ||
      u.indexOf('localhost') !== -1 || u.indexOf('[::1]') !== -1 || u.indexOf('wx.qq.com') !== -1);
  }
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      var po = new PerformanceObserver(function(list) {
        list.getEntries().forEach(function(entry) {
          var u = entry.name || '';
          if (isWxDiagUrl(u)) {
            console.log('[WX-DIAG] resource', (entry.initiatorType || '?'), u.substring(0, 200));
          }
        });
      });
      po.observe({ entryTypes: ['resource'] });
    } catch (e) {}
  }
  // 记录 Image 构造（wxLogin.js 可能用 new Image().src 探测本地服务）
  if (typeof window !== 'undefined' && window.Image) {
    var _OrigImage = window.Image;
    var _srcDesc = Object.getOwnPropertyDescriptor(_OrigImage.prototype, 'src');
    if (_srcDesc && _srcDesc.set) {
      window.Image = function() {
        var img = new _OrigImage();
        try {
          Object.defineProperty(img, 'src', {
            configurable: true,
            get: function() { return _srcDesc.get ? _srcDesc.get.call(this) : img.getAttribute('src'); },
            set: function(v) {
              if (isWxDiagUrl(v)) console.log('[WX-DIAG] new Image src:', String(v).substring(0, 200));
              _srcDesc.set.call(this, v);
            }
          });
        } catch (e) {}
        return img;
      };
      window.Image.prototype = _OrigImage.prototype;
    }
  }
})();

// ============ 微信快捷登录兼容（所有帧含iframe均生效） ============
// wxLogin.js 在 open.weixin.qq.com 的 iframe 中运行，需要在这里修复
(function() {
  // 1. 修复 permissions.query（必须在实际查询之前就patch掉）
  if (typeof navigator !== 'undefined' && navigator.permissions && navigator.permissions.query) {
    var _origQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = function(permissionDesc) {
      var name = (permissionDesc && permissionDesc.name) || '';
      // 记录微信探测了哪个权限
      if (name.indexOf('network') !== -1 || name.indexOf('weixin') !== -1) {
        console.log('[WX-DIAG] permissions.query:', name);
      }
      // 让微信脚本认为私网访问权限已授予
      if (name === 'local-network-access' || name === 'private-network-access') {
        return Promise.resolve({
          state: 'granted',
          onchange: null,
          addEventListener: function() {},
          removeEventListener: function() {},
          addListener: function() {},
          removeListener: function() {},
          dispatchEvent: function() { return true; }
        });
      }
      return _origQuery(permissionDesc);
    };
  }

  // 2. 给微信相关iframe添加 allow 属性
  function fixWxIframe(iframe) {
    if (!iframe || !iframe.getAttribute) return;
    var src = iframe.getAttribute('src') || '';
    if (src.indexOf('weixin.qq.com') === -1 && src.indexOf('wx.qq.com') === -1) return;
    var allow = iframe.getAttribute('allow') || '';
    if (allow.indexOf('private-network-access') === -1) {
      iframe.setAttribute('allow',
        allow + ';private-network-access *;local-network-access *'
      );
    }
  }

  // 立即处理已有iframe
  document.querySelectorAll('iframe').forEach(fixWxIframe);

  // 监听新iframe
  new MutationObserver(function(ms) {
    ms.forEach(function(m) {
      m.addedNodes.forEach(function(n) {
        if (n.tagName === 'IFRAME') fixWxIframe(n);
        if (n.querySelectorAll) n.querySelectorAll('iframe').forEach(fixWxIframe);
      });
    });
  }).observe(document.documentElement || document, { childList: true, subtree: true });

  // 3+4. （已移除隔离世界的 XHR/fetch 补丁——它们不影响主世界）
  // 正确方案见下方：contextBridge.exposeInMainWorld 之后注入主世界脚本

  console.log('[WX-PRELOAD] 微信兼容层已加载, location=', location.href);
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
  exportLogs: () => ipcRenderer.invoke('export-logs'),
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

  // 扩展管理
  listLoadedExtensions: () => ipcRenderer.invoke('extension-list-loaded'),
  removeExtension: (extId) => ipcRenderer.invoke('extension-remove', extId),
  reloadExtension: (extId) => ipcRenderer.invoke('extension-reload', extId),
  installLocalExtension: () => ipcRenderer.invoke('extension-install-local'),
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
  getTranslationEngines: () => ipcRenderer.invoke('get-translation-engines'),
  setTranslationEngine: (engineId) => ipcRenderer.invoke('set-translation-engine', engineId),
  openImmersiveSettings: () => ipcRenderer.invoke('open-immersive-settings'),
  openImmersiveLogin: () => ipcRenderer.invoke('open-immersive-login'),
  onTranslationEngineChanged: (callback) => {
    const listener = (_event, engineId) => callback(engineId);
    ipcRenderer.on('translation-engine-changed', listener);
    return () => ipcRenderer.removeListener('translation-engine-changed', listener);
  },

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
  // 剪贴板（主进程代写，避免renderer权限不足）
  clipboardWrite: (text) => ipcRenderer.invoke('clipboard-write', text),

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
  // 微信代理
  wxProxy: (options) => ipcRenderer.invoke('wx-proxy', options),
  onWxProxyResponse: (callback) => ipcRenderer.on('wx-proxy-response', (event, data) => callback(data)),
  onWxEdgeStarting: (callback) => ipcRenderer.on('wx-edge-starting', (event, data) => callback(data)),
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

  // 展开书签弹层（独立原生子窗口，网页不下移）
  showOverflowPopup: (bookmarks, buttonRect) => ipcRenderer.invoke('show-overflow-popup', { bookmarks, buttonRect }),
  hideOverflowPopup: () => ipcRenderer.invoke('hide-overflow-popup'),

  // 通用主进程→renderer 事件监听（用于子窗口弹层通信等场景）
  receive: (channel, callback) => ipcRenderer.on(channel, (_event, data) => callback(data)),

  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});

// ====== 微信登录主世界拦截说明 ======
// ⚠️ 禁止在 preload 中往 DOM 注入 script 标签！
// 原因：preload 在页面解析期间执行，此时往 document.head 追加 script 会同步执行，
// 干扰浏览器 HTML 解析器导致 DOM 状态异常（v1.3.26~1.3.27 反复出现 createTreeWalker 报错、全页空白）。
// 正确做法：在主进程 did-finish-load 后通过 webContents.executeJavaScript() 注入（见 main.js injectWxCompatibilityScript），
// 此时页面已完全解析完毕，注入安全无副作用。

// ============ Edge/Chrome 扩展商店："获取"按钮 → 安装到飞毛腿内核 ============
// 拦截扩展商店详情页的"获取/安装/添加"按钮点击，转交给主进程下载并 loadExtension，
// 而不是走商店自身的 ms-appinstaller 流程（Electron 不支持）。翻译等能力由此类扩展接管。
(function() {
  var isStoreDetail = /microsoftedge\.microsoft\.com\/(.*\/)?detail\//i.test(location.href)
    || /chrome\.google\.com\/webstore\/detail\//i.test(location.href);
  if (!isStoreDetail) return;

  function isInstallTarget(el) {
    if (!el || !el.getAttribute) return false;
    var tag = (el.tagName || '').toLowerCase();
    if (tag !== 'button' && tag !== 'a' && el.getAttribute('role') !== 'button') return false;
    var txt = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim();
    return /(获取|安装|添加|Get|Install|Add to|Add\b|添加到)/i.test(txt);
  }

  document.addEventListener('click', function(e) {
    try {
      var el = e.target;
      while (el && el !== document) {
        if (isInstallTarget(el)) {
          e.preventDefault();
          e.stopPropagation();
          if (e.stopImmediatePropagation) e.stopImmediatePropagation();
          ipcRenderer.send('extension-store-install', { url: location.href });
          return;
        }
        el = el.parentElement;
      }
    } catch (err) {}
  }, true);
})();
