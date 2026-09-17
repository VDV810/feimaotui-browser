// 闪现检测器 v2: 真实 preload + 规则流
// 场景A: 300ms 后动态插入广告 → 必须从未露出
// 场景B: 2.5s 时模拟站点脚本删除注入的 style → 3s 防丢轮询必须重挂, 广告依然不可见
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

ipcMain.on('feimaotui-get-adblock-css', (e) => {
  e.returnValue = '.ad-card { display: none !important; visibility: hidden !important; height: 0 !important; overflow: hidden !important; }';
});
ipcMain.on('feimaotui-get-font-zoom', (e) => { e.returnValue = 1; });

const html = `<!doctype html><html><head><meta charset="utf-8">
<script>
window.__flashLog = [];
(function loop() {
  try {
    var ad = document.querySelector('.ad-card');
    if (ad) {
      var cs = getComputedStyle(ad);
      window.__flashLog.push({ t: Math.round(performance.now()), d: cs.display, v: cs.visibility });
    } else {
      window.__flashLog.push({ t: Math.round(performance.now()), none: true });
    }
  } catch (e) {}
  requestAnimationFrame(loop);
})();
setTimeout(function() {
  var d = document.createElement('div');
  d.className = 'ad-card';
  d.innerHTML = '推广内容';
  document.body.appendChild(d);
}, 300);
// 场景B: 模拟站点脚本清除未知 style
setTimeout(function() {
  var s = document.getElementById('feimaotui-ad-rules');
  if (s && s.parentNode) s.parentNode.removeChild(s);
}, 2500);
</script></head><body><div class="page">页面内容</div></body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1000, height: 700, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  const tmp = path.join(__dirname, 'flash-fixture.html');
  fs.writeFileSync(tmp, html, 'utf8');
  await win.loadFile(tmp);
  await new Promise(r => setTimeout(r, 6000));
  const res = await win.webContents.executeJavaScript(`(function(){
    var log = window.__flashLog;
    var adFrames = log.filter(x => x.d !== undefined);
    var visibleFrames = adFrames.filter(x => x.d !== 'none' && x.v !== 'hidden');
    var s = document.getElementById('feimaotui-ad-rules');
    return JSON.stringify({
      styleAliveAtEnd: !!s && !!s.textContent,
      adObservedFrames: adFrames.length,
      visibleFrames: visibleFrames.length,
      firstVisible: visibleFrames.length ? visibleFrames[0] : null
    });
  })()`);
  console.log('[闪现检测]', res);
  fs.unlinkSync(tmp);
  const d = JSON.parse(res);
  const pass = d.styleAliveAtEnd && d.adObservedFrames > 100 && d.visibleFrames === 0;
  console.log(pass ? 'FLASH TEST v2 PASS (style被删后自动重挂, 广告全程零露出)' : 'FLASH TEST v2 FAIL');
  app.exit(pass ? 0 : 1);
});
