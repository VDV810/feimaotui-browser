// 验证标记精准度:
// 1. 右键目标直取(contextmenu target)→ 生成的选择器命中用户点的广告, 而非坐标错位的其它元素
// 2. 注入选择器 CSS 后广告隐藏
// 3. 批量收集的超大容器被误伤防护过滤
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

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="page">
  <div class="feed">
    <div class="ad-card"><span class="ad-text">推广内容促销</span></div>
    <div class="normal-card"><span class="normal-text">正常新闻内容</span></div>
  </div>
  <div class="giant-overlay" style="position:fixed;left:0;top:0;width:95vw;height:95vh;background:#eee;z-index:9;">大浮层</div>
</div></body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1200, height: 800, show: false });
  const tmp = path.join(__dirname, 'mark-fixture.html');
  fs.writeFileSync(tmp, html, 'utf8');
  await win.loadFile(tmp);

  // ── 测试1: 模拟右键广告内部文字 → contextmenu 记录 → 标记脚本取 target 生成选择器 ──
  const r1 = await win.webContents.executeJavaScript(`
    (function(){
      // 主世界 contextmenu 监听（与 main.js spoof 注入一致）
      document.addEventListener('contextmenu', function(ev){ window.__fmtCtxTarget = ev.target; }, true);
      var span = document.querySelector('.ad-text');
      span.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      // 标记脚本单点分支: 优先 __fmtCtxTarget
      var el = null;
      try {
        var recorded = window.__fmtCtxTarget;
        if (recorded && recorded.nodeType === 1 && document.contains(recorded)) el = recorded;
      } catch (e) {}
      if (!el) el = document.elementFromPoint(400, 300); // 坐标兜底(此处页面中心可能命中的是别的元素)
      ${GET_SELECTOR_JS}
      return JSON.stringify({ sel: getSelector(el), text: (el.textContent||'').substring(0,20) });
    })()
  `);
  const d1 = JSON.parse(r1);
  console.log('[测试1] 记录的右键目标:', d1.text, '| 选择器:', d1.sel);

  // 验证选择器命中且能把广告藏起来
  const r2 = await win.webContents.executeJavaScript(`
    (function(){
      var sel = ${JSON.stringify(d1.sel)};
      var s = document.createElement('style');
      s.textContent = sel + ' { display:none !important; }';
      document.head.appendChild(s);
      var hit = document.querySelector(sel);
      var hidden = hit ? getComputedStyle(hit).display === 'none' : false;
      return JSON.stringify({
        hitsAdText: hit ? hit.textContent.indexOf('推广') !== -1 : false,
        hitHidden: hidden,
        normalVisible: getComputedStyle(document.querySelector('.normal-card')).display !== 'none'
      });
    })()
  `);
  const d2 = JSON.parse(r2);
  console.log('[测试1] 命中广告文字:', d2.hitsAdText, '| 命中元素已隐藏:', d2.hitHidden, '| 正常内容不受影响:', d2.normalVisible);

  // ── 测试2: 批量收集的超大容器被过滤(95vw×95vh 的浮层不应被标记) ──
  const r3 = await win.webContents.executeJavaScript(`
    (function(){
      function collectElementsFromTextSelection() {
        var selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return [];
        var range = selection.getRangeAt(0);
        var elements = []; var seen = new Set();
        var commonAncestor = range.commonAncestorContainer;
        if (commonAncestor.nodeType === Node.TEXT_NODE) commonAncestor = commonAncestor.parentElement;
        if (!commonAncestor || commonAncestor === document.body || commonAncestor === document.documentElement) return [];
        var walker = document.createTreeWalker(commonAncestor, NodeFilter.SHOW_ELEMENT, {
          acceptNode: function(node) {
            if (node === document.body || node === document.documentElement) return NodeFilter.FILTER_REJECT;
            return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          }
        });
        var node; while ((node = walker.nextNode())) { if (!seen.has(node)) { seen.add(node); elements.push(node); } }
        var leafElements = elements.filter(function(el) {
          return !elements.some(function(other) { return other !== el && el.contains(other); });
        });
        var inlineTags = {'SPAN':1,'A':1,'STRONG':1,'EM':1,'B':1,'I':1,'U':1,'SMALL':1,'SUB':1,'SUP':1,'LABEL':1,'CODE':1,'MARK':1};
        var containers = []; var containerSeen = new Set();
        function addContainer(el) { if (!el || el === document.body || el === document.documentElement) return; if (containerSeen.has(el)) return; containerSeen.add(el); containers.push(el); }
        leafElements.forEach(function(el) {
          if (el.matches && el.matches('img, iframe, video, svg, canvas, embed, object, [style*="background-image"]')) { addContainer(el); return; }
          var current = el, depth = 0;
          while (current && inlineTags[current.tagName] && depth < 5 && current.parentElement && current.parentElement !== document.body) { current = current.parentElement; depth++; }
          addContainer(current);
        });
        var result = containers.filter(function(el) {
          return !containers.some(function(other) { return other !== el && el.contains(other) && !other.contains(el); });
        });
        var vw = window.innerWidth || 1280, vh = window.innerHeight || 800;
        result = result.filter(function(el) {
          try { var r = el.getBoundingClientRect(); if (r.width > vw * 0.6 && r.height > vh * 0.6) return false; } catch (e) {}
          return true;
        });
        if (result.length > 8) result = result.slice(0, 8);
        return result;
      }
      // 选中大浮层里的文字
      var giant = document.querySelector('.giant-overlay');
      var range = document.createRange();
      range.selectNodeContents(giant);
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      var picked = collectElementsFromTextSelection();
      sel.removeAllRanges();
      return JSON.stringify({ count: picked.length, hasGiant: picked.some(function(el){ return el.className === 'giant-overlay'; }) });
    })()
  `);
  const d3 = JSON.parse(r3);
  console.log('[测试2] 大浮层被划选后收集数量:', d3.count, '| 大浮层被误标:', d3.hasGiant);

  fs.unlinkSync(tmp);
  const pass = d2.hitsAdText && d2.hitHidden && d2.normalVisible && !d3.hasGiant;
  console.log(pass ? 'MARK PRECISION TEST PASS' : 'MARK PRECISION TEST FAIL');
  app.exit(pass ? 0 : 1);
});
