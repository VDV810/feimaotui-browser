// 验证 v1.9.0 弹窗组件根升级:
// 千川式弹窗(遮罩背景在根元素 + modal__body + 卡片): 右键卡片内文字 → 自动升级到弹窗根
// → 隐藏弹窗根 = 卡片+灰色遮罩一起消失(此前只藏卡片, 遮罩残留整页灰)
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

ipcMain.on('feimaotui-get-adblock-css', (e) => { e.returnValue = ''; });
ipcMain.on('feimaotui-get-font-zoom', (e) => { e.returnValue = 1; });

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
  return el.tagName.toLowerCase();
}
getSelector;
`;

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="page"><span class="plain-text">正常页面内容</span></div>
<div class="global-fade-mask" style="position:fixed;left:0;top:0;width:100vw;height:100vh;background:rgba(0,0,0,0.45);z-index:98;"></div>
<div class="ocean-vmok-plugin-oc-modal" style="position:fixed;left:0;top:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);z-index:99;">
<script>
// 站点自己的关闭逻辑: 点 oc-close → 移除整个弹窗(含遮罩)
document.querySelector('.oc-close').addEventListener('click', function() {
  var m = document.querySelector('.ocean-vmok-plugin-oc-modal');
  if (m && m.parentNode) m.parentNode.removeChild(m);
});
</script>
</body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1200, height: 800, show: false });
  const tmp = path.join(__dirname, 'modal-fixture.html');
  fs.writeFileSync(tmp, html, 'utf8');
  await win.loadFile(tmp);

  await win.webContents.executeJavaScript(`
    document.addEventListener('contextmenu', function(ev){ window.__fmtCtxTarget = ev.target; }, true);
  `);

  // 右键弹窗卡片内文字
  const r = await win.webContents.executeJavaScript(`
    (function(){
      var span = document.querySelector('.ad-text');
      span.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      // nearestVisible(与 main.js 一致)
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
      // upgradeToModalRoot(与 main.js v1.9.0 一致)
      function upgradeToModalRoot(el) {
        try {
          var cur = el, best = null, up = 0;
          while (cur && cur.nodeType === 1 && cur !== document.body && cur !== document.documentElement && up < 6) {
            var cls = (cur.className && typeof cur.className === 'string') ? cur.className : '';
            if (/(modal|dialog|popup|drawer|mask|overlay|layer)/i.test(cls)) best = cur;
            cur = cur.parentElement; up++;
          }
          if (best) return best;
        } catch (e) {}
        return el;
      }
      ${GET_SELECTOR_JS}
      // findModalOverlays(与 main.js v2.4.0 一致)
      function findModalOverlays(rootEl) {
        var out = [];
        var vw = window.innerWidth || 1280, vh = window.innerHeight || 800;
        function isOverlay(el) {
          try {
            if (!el || el === document.body || el === document.documentElement) return false;
            if (rootEl && (el === rootEl || rootEl.contains(el) || el.contains(rootEl))) return false;
            var cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') return false;
            if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
            var rect = el.getBoundingClientRect();
            if (rect.width < vw * 0.8 || rect.height < vh * 0.8) return false;
            var m = (cs.backgroundColor || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
            if (m) {
              var a = (m[4] === undefined) ? 1 : parseFloat(m[4]);
              if (a > 0.05 && a < 0.98) return true;
            }
            if (cs.backdropFilter && cs.backdropFilter !== 'none') return true;
            return false;
          } catch (e) { return false; }
        }
        var candidates = [];
        Array.prototype.slice.call(document.body.children).forEach(function(el) { candidates.push(el); });
        var p = rootEl ? rootEl.parentElement : null, depth = 0;
        while (p && p !== document.body && depth < 4) {
          candidates.push(p);
          Array.prototype.slice.call(p.children).forEach(function(el) { candidates.push(el); });
          p = p.parentElement; depth++;
        }
        candidates.forEach(function(el) {
          if (out.indexOf(el) === -1 && isOverlay(el)) out.push(el);
        });
        return out;
      }
      var el = nearestVisible(window.__fmtCtxTarget);
      var before = el.className;
      el = upgradeToModalRoot(el);
      var overlays = findModalOverlays(el);
      var sel = getSelector(el);
      // v2.4.0: 遮罩扫描结果也生成选择器, 全部注入(模拟 buildAdblockCss)
      var overlaySels = overlays.map(function(ov) { return getSelector(ov); });
      var s = document.createElement('style');
      s.textContent = [sel].concat(overlaySels).map(function(x){ return x + ' { display:none !important; }'; }).join('\n');
      document.head.appendChild(s);
      var card = document.querySelector('.new-comer-report-custom-body');
      var root = document.querySelector('.ocean-vmok-plugin-oc-modal');
      var maskEl = document.querySelector('.global-fade-mask');
      var plain = document.querySelector('.plain-text');
      var cardRect = card.getBoundingClientRect();
      // display 不继承, 祖先隐藏后后代 computedStyle 仍为 block;
      // "不可见"的正确判据是渲染尺寸为零(不参与布局)
      return JSON.stringify({
        beforeCls: before, afterCls: el.className, sel: sel,
        overlaySels: overlaySels,
        cardGone: cardRect.width === 0 && cardRect.height === 0,
        maskRootHidden: getComputedStyle(root).display === 'none',
        fadeMaskHidden: maskEl ? getComputedStyle(maskEl).display === 'none' : 'no-mask-el',
        plainOk: getComputedStyle(plain).display !== 'none'
      });
    })()
  `);
  const d = JSON.parse(r);
  console.log('[升级前]', d.beforeCls);
  console.log('[升级后]', d.afterCls, '| 选择器:', d.sel);
  console.log('[结果] 卡片已不渲染(零尺寸):', d.cardGone, '| 遮罩根隐藏:', d.maskRootHidden, '| 独立遮罩兄弟被扫出并隐藏:', d.fadeMaskHidden, '| 普通页面不受影响:', d.plainOk);

  // ── 测试2: v2.2.0 自动关闭 —— 模拟"刷新后结构漂移": 精确选择器失效, 宽松选择器命中卡片
  //    → 向上定位弹窗根 → 点站点X → 整个弹窗(含遮罩)被站点移除 ──
  await new Promise(rr => setTimeout(rr, 300));
  const r2 = await win.webContents.executeJavaScript(`
    (function(){
      // 在弹窗前插一个新兄弟, 模拟刷新后 nth 漂移 → 精确选择器(:nth-child(2))失效
      var ph = document.createElement('div');
      ph.className = 'new-sibling-after-refresh';
      document.body.insertBefore(ph, document.querySelector('.ocean-vmok-plugin-oc-modal'));
      var preciseSel = ${JSON.stringify(d.sel)};
      var looseSel = 'div.new-comer-report-custom-body'; // 宽松版(主进程 looseSelectorOf 生成)
      var preciseHits = document.querySelectorAll(preciseSel).length;
      var looseHits = document.querySelectorAll(looseSel).length;
      // 复刻 preload autoCloseMarkedModals v2.2.0 轮询核心
      var MODAL_RE = /(modal|dialog|popup|drawer|mask|overlay|layer)/i;
      var clicked = 0;
      document.querySelectorAll(looseSel).forEach(function(card) {
        var root = card, up = 0, best = null;
        while (root && root.nodeType === 1 && root !== document.body && up < 6) {
          var cls = (root.className && typeof root.className === 'string') ? root.className : '';
          if (MODAL_RE.test(cls)) best = root;
          root = root.parentElement; up++;
        }
        var target = best || card;
        if (target.__fmtCloseTried) return;
        target.__fmtCloseTried = true;
        var btn = target.querySelector('[class*="close" i], [aria-label*="close" i], [aria-label*="关闭"]');
        if (btn) { try { btn.click(); clicked++; } catch (e) {} }
        else { try { target.style.setProperty('display', 'none', 'important'); } catch (e) {} }
      });
      return JSON.stringify({
        preciseHits: preciseHits, looseHits: looseHits, clicked: clicked,
        modalInDom: !!document.querySelector('.ocean-vmok-plugin-oc-modal')
      });
    })()
  `);
  const d2 = JSON.parse(r2);
  console.log('[测试2] 精确选择器命中(漂移后):', d2.preciseHits, '| 宽松选择器命中:', d2.looseHits);
  console.log('[测试2] 自动点击X:', d2.clicked, '| 站点已移除整个弹窗(含遮罩):', !d2.modalInDom);
  fs.unlinkSync(tmp);
  const pass = d.cardGone && d.maskRootHidden && d.plainOk && /modal/i.test(d.afterCls)
    && d2.preciseHits === 0 && d2.looseHits === 1 && d2.clicked === 1 && !d2.modalInDom;
  console.log(pass ? 'MODAL ROOT + AUTO CLOSE TESTS PASS (标卡片=弹窗连遮罩消失, 且自动点X由站点清理)' : 'TEST FAIL');
  app.exit(pass ? 0 : 1);
});
