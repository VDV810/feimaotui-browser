// 闪现检测 v3: 复刻千川式"两段式异步插入 + 渐入动画"弹窗场景
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// buildAdblockCss() 的输出格式: 精确版 + 宽松版(去nth) 双份
const DECL = ' { display: none !important; visibility: hidden !important; height: 0 !important; overflow: hidden !important; }';
const AD_CSS = [
  'div.tools-vmok-plugin-modal__body.ocean-vmok-plugin-oc-modal-body:nth-child(2) > div.aweme-auto-pull-modal-wrapper:nth-child(1)' + DECL,
  'div.tools-vmok-plugin-modal__body.ocean-vmok-plugin-oc-modal-body > div.aweme-auto-pull-modal-wrapper' + DECL,
  'div.aweme-auto-pull-modal-content:nth-child(1) > div.aweme-auto-pull-modal-right:nth-child(2)' + DECL,
  'div.aweme-auto-pull-modal-content > div.aweme-auto-pull-modal-right' + DECL
].join('\n');

ipcMain.on('feimaotui-get-adblock-css', (e) => { e.returnValue = AD_CSS; });
ipcMain.on('feimaotui-get-font-zoom', (e) => { e.returnValue = 1; });

const html = `<!doctype html><html><head><meta charset="utf-8">
<style>
@keyframes fadein { from { opacity: 0; transform: scale(.8); } to { opacity: 1; transform: scale(1); } }
</style>
<script>
window.__flashLog = [];
(function loop() {
  try {
    var els = document.querySelectorAll('.aweme-auto-pull-modal-content, .aweme-auto-pull-modal-right, .tools-vmok-plugin-modal__body');
    for (var i = 0; i < els.length; i++) {
      var cs = getComputedStyle(els[i]);
      var r = els[i].getBoundingClientRect();
      // 视觉可见 = 未隐藏 且 实际渲染尺寸 > 2px（零尺寸空壳肉眼不可见不算闪现）
      if (cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 2 && r.height > 2) {
        window.__flashLog.push({ t: Math.round(performance.now()), cls: els[i].className.substring(0, 40), w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
  } catch (e) {}
  requestAnimationFrame(loop);
})();
// 千川式: 1s 后外层 modal 插入, 再 400ms 后内层 content/right 两段插入(带渐入动画)
setTimeout(function() {
  var m = document.createElement('div');
  m.className = 'tools-vmok-plugin-modal__body ocean-vmok-plugin-oc-modal-body';
  document.body.appendChild(m);
  setTimeout(function() {
    var c = document.createElement('div');
    c.className = 'aweme-auto-pull-modal-content';
    m.appendChild(c);
    var right = document.createElement('div');
    right.className = 'aweme-auto-pull-modal-right';
    right.style.animation = 'fadein 0.4s';
    c.appendChild(right);
  }, 400);
}, 1000);
</script></head><body><div class="page">千川页面模拟</div></body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1000, height: 700, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  const tmp = path.join(__dirname, 'flash-modal-fixture.html');
  fs.writeFileSync(tmp, html, 'utf8');
  await win.loadFile(tmp);
  await new Promise(r => setTimeout(r, 5000));
  const res = await win.webContents.executeJavaScript(`JSON.stringify({
    log: window.__flashLog.slice(0, 6),
    count: window.__flashLog.length,
    styleMounted: !!document.getElementById('feimaotui-ad-rules')
  })`);
  console.log('[闪现检测v3]', res);
  fs.unlinkSync(tmp);
  const d = JSON.parse(res);
  const pass = d.count === 0;
  console.log(pass ? 'FLASH MODAL TEST PASS (两段式+动画弹窗全程零露出)' : 'FLASH MODAL TEST FAIL (闪现帧数: ' + d.count + ')');
  app.exit(pass ? 0 : 1);
});
