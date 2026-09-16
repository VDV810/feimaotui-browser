// 验证: 标记广告规则 CSS 在 preload 阶段注入后, 页面首个脚本运行前广告已 display:none
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// 模拟主进程的规则下发
ipcMain.on('feimaotui-get-adblock-css', (event) => {
  event.returnValue = '.ad-box { display: none !important; visibility: hidden !important; }';
});

const html = `<!doctype html><html><head><meta charset="utf-8"><script>
// 页面首个脚本：此时 body 里第一个 div 刚出现在解析器中
window.__results = {};
function check(id, el) {
  const cs = getComputedStyle(el);
  window.__results[id] = { display: cs.display, visible: cs.visibility };
}
document.addEventListener('DOMContentLoaded', () => {
  check('adbox', document.querySelector('.ad-box'));
  check('normal', document.querySelector('.normal'));
});
</script></head><body>
<div class="ad-box">AD</div>
<div class="normal">内容</div>
</body></html>`;

app.whenReady().then(async () => {
  const tmp = path.join(__dirname, 'adtest-fixture.html');
  fs.writeFileSync(tmp, html, 'utf8');
  const win = new BrowserWindow({
    width: 800, height: 600, show: false,
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload', 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  await win.loadFile(tmp);
  await new Promise(r => setTimeout(r, 1500));
  const res = await win.webContents.executeJavaScript('JSON.stringify(window.__results)');
  console.log('[RESULT]', res);
  const r = JSON.parse(res);
  const adHidden = r.adbox && r.adbox.display === 'none' && r.adbox.visible === 'hidden';
  const normalOk = r.normal && r.normal.display !== 'none';
  console.log(adHidden && normalOk ? 'AD-RULES EARLY INJECT TEST PASS' : 'TEST FAIL');
  fs.unlinkSync(tmp);
  app.exit(adHidden && normalOk ? 0 : 1);
});
