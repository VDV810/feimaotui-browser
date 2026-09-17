// 验证: 新版标记选择器(手机版v2.4.53策略)在 SPA 结构漂移后仍能命中广告
// 场景: 千川式 React 页面 —— 标记时生成选择器 → 模拟"刷新后外层结构漂移"(nth变化) → 验证仍命中
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

// 与 main.js executeJavaScript 里完全一致的 getSelector（此处为页面侧源码形态）
const GET_SELECTOR_JS = `
function sibIdx(n) {
  var i = 1, s = n;
  while (s.previousElementSibling) { s = s.previousElementSibling; i++; }
  return i;
}
function getSelector(el) {
  if (el.id) return '#' + CSS.escape(el.id);
  var classes = (el.className && typeof el.className === 'string')
    ? el.className.trim().split(/\\s+/).filter(function(c){return c;}).slice(0, 3)
    : [];
  if (classes.length > 0) {
    var base = el.tagName.toLowerCase() + classes.map(function(c){return '.' + CSS.escape(c);}).join('');
    var p = el.parentElement;
    if (p && p !== document.body) {
      var pcs = (p.className && typeof p.className === 'string')
        ? p.className.trim().split(/\\s+/).filter(function(c){return c;}).slice(0, 2).map(function(c){return '.' + CSS.escape(c);}).join('')
        : '';
      return p.tagName.toLowerCase() + pcs + ':nth-child(' + sibIdx(p) + ') > ' + base + ':nth-child(' + sibIdx(el) + ')';
    }
    return base + ':nth-child(' + sibIdx(el) + ')';
  }
  var stableAttrs = [];
  for (var i = 0; i < el.attributes.length; i++) {
    var a = el.attributes[i];
    if (a.name.indexOf('data-') === 0 || a.name === 'role' || a.name === 'aria-label') {
      stableAttrs.push('[' + a.name + '="' + a.value.replace(/"/g, String.fromCharCode(92) + '"') + '"]');
    }
  }
  if (stableAttrs.length > 0) return el.tagName.toLowerCase() + stableAttrs.slice(0, 3).join('');
  var path = [];
  var cur = el;
  while (cur && cur.nodeType === 1 && cur !== document.body && path.length < 4) {
    var parent = cur.parentElement;
    if (!parent) break;
    var idx = Array.prototype.slice.call(parent.children).indexOf(cur) + 1;
    path.unshift(cur.tagName.toLowerCase() + ':nth-child(' + idx + ')');
    cur = parent;
  }
  return path.join(' > ');
}
getSelector;
`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1000, height: 700, show: false });

  // ── 场景1: 标记时的页面(旧版布局: 广告在 body 下第2个 div) ──
  const pageV1 = `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <div class="header-bar">头部</div>
    <div class="page-wrap"><div class="app-content-main"><div class="ad-slot-wrapper"><div class="inner">广告位</div></div></div></div>
  </body></html>`;
  // ── 场景2: "刷新后"的页面(React 重渲染: 外层多包一层、兄弟节点数量变化 → 所有 nth-of-type 漂移) ──
  const pageV2 = `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <div class="topbar">新顶栏</div>
    <div class="sidebar">侧栏</div>
    <div class="page-wrap"><div class="app-content-main"><div class="ad-slot-wrapper"><div class="inner">广告位</div></div></div></div>
  </body></html>`;

  const f1 = path.join(__dirname, 'sel-v1.html');
  const f2 = path.join(__dirname, 'sel-v2.html');
  fs.writeFileSync(f1, pageV1, 'utf8');
  fs.writeFileSync(f2, pageV2, 'utf8');

  await win.loadFile(f1);
  // 在 v1 页面对广告元素生成选择器（新旧两种算法都跑）
  const r = await win.webContents.executeJavaScript(`
    (function(){
      var ad = document.querySelector('.ad-slot-wrapper');
      ${GET_SELECTOR_JS}
      var newSel = getSelector(ad);
      // 旧算法: 一路到 body 的 nth-of-type 完整路径
      var oldSel = (function(element){
        var path = [];
        var current = element;
        while (current && current !== document.body) {
          var selector = current.tagName.toLowerCase();
          if (current.className && typeof current.className === 'string') {
            var classes = current.className.trim().split(/\\s+/).filter(c => c);
            if (classes.length > 0) selector += '.' + classes.map(c => CSS.escape(c)).join('.');
          }
          var parent = current.parentElement;
          if (parent) {
            var siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
            if (siblings.length > 1) selector += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
          }
          path.unshift(selector);
          current = parent;
        }
        return path.join(' > ');
      })(ad);
      return { newSel: newSel, oldSel: oldSel };
    })()
  `);
  console.log('[v1] 新选择器:', r.newSel);
  console.log('[v1] 旧选择器:', r.oldSel);

  // ── 切到 v2 页面(结构漂移后)，分别验证两种选择器是否还能命中广告 ──
  await win.loadFile(f2);
  const r2 = await win.webContents.executeJavaScript(`
    (function(){
      function hits(sel) {
        try { var els = document.querySelectorAll(sel); for (var i=0;i<els.length;i++){ if (els[i].textContent.indexOf('广告位') !== -1) return true; } } catch(e) {}
        return false;
      }
      return { newHits: hits(${JSON.stringify(r.newSel)}), oldHits: hits(${JSON.stringify(r.oldSel)}) };
    })()
  `);
  console.log('[v2 漂移后] 新选择器命中:', r2.newHits, '| 旧选择器命中:', r2.oldHits);

  fs.unlinkSync(f1); fs.unlinkSync(f2);
  const pass = r2.newHits === true;
  console.log(pass ? 'SELECTOR ROBUST TEST PASS (新策略漂移后仍命中)' : 'SELECTOR ROBUST TEST FAIL');
  app.exit(pass ? 0 : 1);
});
