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
<div class="ocean-vmok-plugin-oc-modal" style="position:fixed;left:0;top:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);z-index:99;">
  <div class="tools-vmok-plugin-modal__body ocean-vmok-plugin-oc-modal-body" style="width:600px;height:400px;background:#fff;margin:100px auto;">
    <div class="new-comer-report-custom-body" style="height:300px;">
      <span class="ad-text">暂未起量,继续优化释放潜力,加油!</span>
    </div>
  </div>
</div>
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
      var el = nearestVisible(window.__fmtCtxTarget);
      var before = el.className;
      el = upgradeToModalRoot(el);
      var sel = getSelector(el);
      // 注入选择器, 验证: 卡片+遮罩背景一起消失, 普通页面不受影响
      var s = document.createElement('style');
      s.textContent = sel + ' { display:none !important; }';
      document.head.appendChild(s);
      var card = document.querySelector('.new-comer-report-custom-body');
      var root = document.querySelector('.ocean-vmok-plugin-oc-modal');
      var plain = document.querySelector('.plain-text');
      var cardRect = card.getBoundingClientRect();
      // display 不继承, 祖先隐藏后后代 computedStyle 仍为 block;
      // "不可见"的正确判据是渲染尺寸为零(不参与布局)
      return JSON.stringify({
        beforeCls: before, afterCls: el.className, sel: sel,
        cardGone: cardRect.width === 0 && cardRect.height === 0,
        maskRootHidden: getComputedStyle(root).display === 'none',
        plainOk: getComputedStyle(plain).display !== 'none'
      });
    })()
  `);
  const d = JSON.parse(r);
  console.log('[升级前]', d.beforeCls);
  console.log('[升级后]', d.afterCls, '| 选择器:', d.sel);
  console.log('[结果] 卡片已不渲染(零尺寸):', d.cardGone, '| 遮罩根隐藏:', d.maskRootHidden, '| 普通页面不受影响:', d.plainOk);
  fs.unlinkSync(tmp);
  const pass = d.cardGone && d.maskRootHidden && d.plainOk && /modal/i.test(d.afterCls);
  console.log(pass ? 'MODAL ROOT UPGRADE TEST PASS (标卡片=整个弹窗连遮罩消失)' : 'TEST FAIL');
  app.exit(pass ? 0 : 1);
});
