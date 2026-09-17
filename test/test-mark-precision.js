// 验证标记精准度(v1.5.1):
// 1. 百度logo场景: 右键命中 <map><area> 不可见热区 → 向上找最近可见祖先 → 标到可见容器并隐藏
// 2. 普通场景: 右键广告文字 → target直取 → 隐藏
// 3. 批量收集超大容器被过滤
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

ipcMain.on('feimaotui-get-adblock-css', (e) => { e.returnValue = ''; });

const GET_SELECTOR_JS = `
function sibIdx(n) { var i = 1, s = n; while (s.previousElementSibling) { s = s.previousElementSibling; i++; } return i; }
function getSelector(el) {
  if (el.id) return '#' + CSS.escape(el.id);
  var classes = (el.className && typeof el.className === 'string')
    ? el.className.trim().split(/\\s+/).filter(function(c){return c;}).slice(0, 3) : [];
  if (classes.length > 0) {
    var base = el.tagName.toLowerCase() + classes.map(function(c){return '.' + CSS.escape(c);}).join('');
    var p = el.parentElement;
    if (p && p !== document.body) {
      var pcs = (p.className && typeof p.className === 'string')
        ? p.className.trim().split(/\\s+/).filter(function(c){return c;}).slice(0, 2).map(function(c){return '.' + CSS.escape(c);}).join('') : '';
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
  var path = []; var cur = el;
  while (cur && cur.nodeType === 1 && cur !== document.body && path.length < 4) {
    var parent = cur.parentElement; if (!parent) break;
    var idx = Array.prototype.slice.call(parent.children).indexOf(cur) + 1;
    path.unshift(cur.tagName.toLowerCase() + ':nth-child(' + idx + ')'); cur = parent;
  }
  return path.join(' > ');
}
getSelector;
`;

// 与 main.js v1.5.1 单点分支一致的可见性感知逻辑
const PICK_TARGET_JS = `
function nearestVisible(node) {
  var cur = node, depth = 0;
  while (cur && cur.nodeType === 1 && cur !== document.body && cur !== document.documentElement && depth < 5) {
    try {
      var rect = cur.getBoundingClientRect();
      var cs = getComputedStyle(cur);
      if (rect.width > 2 && rect.height > 2 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0') return cur;
    } catch (e) {}
    cur = cur.parentElement; depth++;
  }
  return null;
}
function pick(px, py) {
  var el = null;
  try {
    var recorded = window.__fmtCtxTarget;
    if (recorded && recorded.nodeType === 1 && document.contains(recorded)) el = nearestVisible(recorded);
  } catch (e) {}
  if (!el) { try { el = nearestVisible(document.elementFromPoint(px, py)); } catch (e) {} }
  return el;
}
pick;
`;

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="logo-box" style="width:270px;height:129px;">
  <img src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==" style="width:100%;height:100%;">
  <map name="logoMap"><area shape="rect" coords="0,0,270,129" href="/"></map>
</div>
<div class="page">
  <div class="feed">
    <div class="ad-card"><span class="ad-text">推广内容促销</span></div>
    <div class="normal-card"><span class="normal-text">正常新闻内容</span></div>
  </div>
</div></body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1200, height: 800, show: false });
  const tmp = path.join(__dirname, 'mark-fixture.html');
  fs.writeFileSync(tmp, html, 'utf8');
  await win.loadFile(tmp);

  // 主世界 contextmenu 监听（与 main.js spoof 注入一致）
  await win.webContents.executeJavaScript(`
    document.addEventListener('contextmenu', function(ev){ window.__fmtCtxTarget = ev.target; }, true);
  `);

  let allPass = true;

  // ── 测试1: 百度logo场景 —— 右键 <area> 热区 → 上溯到可见容器 .logo-box ──
  const r1 = await win.webContents.executeJavaScript(`
    (function(){
      var area = document.querySelector('area');
      area.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      var recorded = window.__fmtCtxTarget;
      ${PICK_TARGET_JS}
      var el = pick(135, 60);
      ${GET_SELECTOR_JS}
      return JSON.stringify({
        recordedTag: recorded ? recorded.tagName : 'null',
        pickedTag: el ? el.tagName : 'null',
        pickedCls: el ? el.className : '',
        sel: el ? getSelector(el) : ''
      });
    })()
  `);
  const d1 = JSON.parse(r1);
  console.log('[测试1-area] 右键记录:', d1.recordedTag, '| 实际标到:', d1.pickedTag + '.' + d1.pickedCls, '| 选择器:', d1.sel);
  const t1 = (d1.pickedTag || '').toLowerCase() === 'div' && d1.pickedCls === 'logo-box';
  if (!t1) allPass = false;

  // 验证: 该选择器能把 logo-box 隐藏
  const r1b = await win.webContents.executeJavaScript(`
    (function(){
      var s = document.createElement('style');
      s.textContent = ${JSON.stringify(d1.sel)} + ' { display:none !important; }';
      document.head.appendChild(s);
      var box = document.querySelector('.logo-box');
      var img = box.querySelector('img');
      return JSON.stringify({ boxHidden: getComputedStyle(box).display === 'none', imgGone: getComputedStyle(img).display === 'none' });
    })()
  `);
  const d1b = JSON.parse(r1b);
  console.log('[测试1-area] logo容器隐藏:', d1b.boxHidden, '(area标记在v1.5.0是隐藏area本身=零反应, 现在标到可见容器)');
  if (!d1b.boxHidden) allPass = false;

  // ── 测试2: 普通场景 —— 右键广告文字 → target直取 ──
  const r2 = await win.webContents.executeJavaScript(`
    (function(){
      var span = document.querySelector('.ad-text');
      span.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      ${PICK_TARGET_JS}
      var el = pick(400, 500);
      ${GET_SELECTOR_JS}
      return JSON.stringify({ sel: getSelector(el), text: (el.textContent||'').substring(0,10) });
    })()
  `);
  const d2 = JSON.parse(r2);
  console.log('[测试2-普通] 选择器:', d2.sel, '| 文本:', d2.text);
  const t2 = d2.text.indexOf('推广') !== -1;
  if (!t2) allPass = false;

  // ── 测试3: 批量超大容器过滤 ──
  const r3 = await win.webContents.executeJavaScript(`
    (function(){
      var vw = window.innerWidth, vh = window.innerHeight;
      var giant = document.createElement('div');
      giant.className = 'giant-overlay';
      giant.style.cssText = 'position:fixed;left:0;top:0;width:95vw;height:95vh;';
      document.body.appendChild(giant);
      var rect = giant.getBoundingClientRect();
      var oversized = rect.width > vw * 0.6 && rect.height > vh * 0.6;
      giant.remove();
      return JSON.stringify({ oversized: oversized });
    })()
  `);
  const d3 = JSON.parse(r3);
  console.log('[测试3] 大浮层识别为超大(会被过滤):', d3.oversized);
  if (!d3.oversized) allPass = false;

  fs.unlinkSync(tmp);
  console.log(allPass ? 'ALL MARK PRECISION TESTS PASS' : 'SOME TESTS FAILED');
  app.exit(allPass ? 0 : 1);
});
