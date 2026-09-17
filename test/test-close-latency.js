// 关闭延迟测试 v2.3.0: 动态插入带X的弹窗, 测量"插入→被自动关闭"耗时
// 断言: < 200ms (v2.2.0 的1秒轮询无法达到; v2.3.0 事件驱动应 <50ms)
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const AD_CSS = 'div.oc-modal-root { display: none !important; }';
ipcMain.on('feimaotui-get-adblock-css', (e) => { e.returnValue = AD_CSS; });
ipcMain.on('feimaotui-get-font-zoom', (e) => { e.returnValue = 1; });
ipcMain.on('feimaotui-get-modal-selectors', (e) => { e.returnValue = ['div.oc-modal-root']; });

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="page">页面内容</div>
<script>
// 站点关闭逻辑: 点 close → 移除整个弹窗并记录时刻
window.__removedAt = 0;
document.addEventListener('click', function(e) {
  if (e.target.closest && e.target.closest('.oc-close-btn')) {
    var m = document.querySelector('.oc-modal-root');
    if (m && m.parentNode) { m.parentNode.removeChild(m); window.__removedAt = Math.round(performance.now()); }
  }
}, true);
// 1.5s 后弹出弹窗(异步插入, 模拟 SPA)
setTimeout(function() {
  window.__insertedAt = Math.round(performance.now());
  var m = document.createElement('div');
  m.className = 'oc-modal-root';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99;';
  m.innerHTML = '<div style="width:500px;height:300px;background:#fff;margin:100px auto;position:relative;"><button class="oc-close-btn" style="position:absolute;right:8px;top:8px;">X</button><span>弹窗内容</span></div>';
  document.body.appendChild(m);
}, 1500);
</script></body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1000, height: 700, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  const tmp = path.join(__dirname, 'close-latency-fixture.html');
  fs.writeFileSync(tmp, html, 'utf8');
  await win.loadFile(tmp);
  await new Promise(r => setTimeout(r, 4000));
  const res = await win.webContents.executeJavaScript(`JSON.stringify({
    insertedAt: window.__insertedAt,
    removedAt: window.__removedAt,
    modalInDom: !!document.querySelector('.oc-modal-root')
  })`);
  const d = JSON.parse(res);
  const latency = d.removedAt > 0 ? (d.removedAt - d.insertedAt) : -1;
  console.log('[关闭延迟] 插入于', d.insertedAt, 'ms, 被关闭于', d.removedAt, 'ms, 延迟:', latency, 'ms | 弹窗仍在DOM:', d.modalInDom);
  fs.unlinkSync(tmp);
  const pass = latency >= 0 && latency < 200 && !d.modalInDom;
  console.log(pass ? 'CLOSE LATENCY TEST PASS (延迟 ' + latency + 'ms < 200ms)' : 'CLOSE LATENCY TEST FAIL');
  app.exit(pass ? 0 : 1);
});
