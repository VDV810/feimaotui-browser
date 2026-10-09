// 测试: 千川页自动设置(v2.18.0)
// 复刻 preload.js qianchuanAutoSetup 核心逻辑(host/pathname 守卫换成可注入 mock)验证:
// ① 乘方落地页 → 全域投放 → SPA换内容 → 推商品 → 商品自选
// ② uni-prom 直开、推商品已激活 → 只补商品自选
// ③ 已全部到位 → 零点击
// ④ 非目标页(数据页) → 零点击不劫持
// ⑤ overall-prom 直开 → 自动点导航全域投放
// ⑥ 处理器只在内层 span 上 → 叶子点击(冒泡)仍命中
// ⑦ 祖先共享 active 类名(全行容器 active)导致误判 → 强制点击修正(v2.18.0)
// ⑧ 子tab延迟渲染(3s后才出现商品自选) → 长窗口等待后仍点到(v2.18.0)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

// 复刻 preload.js v2.18.0 核心算法(host 守卫换成 __mockQcHost)
const AUTO_SETUP_SRC = `
(function qianchuanAutoSetup() {
  if (!window.__mockQcHost) return;
  var STEPS = [
    { alts: ['全域投放'] },
    { alts: ['推商品'] },
    { alts: ['商品自选'] }
  ];
  var stepIndex = 0, attempts = 0, forced = {}, MAX_ATTEMPTS = 240, done = false;
  function activeMatch(cls) {
    if (!cls) return false;
    return /(^|[\\s_-])(active|selected|checked)([\\s_-]|$)/i.test(cls);
  }
  function isActive(el) {
    var chain = [el, el.parentElement];
    for (var i = 0; i < chain.length; i++) {
      var cur = chain[i];
      if (!cur || cur.nodeType !== 1) continue;
      try {
        if (cur.getAttribute && (cur.getAttribute('aria-selected') === 'true' || cur.getAttribute('aria-current'))) return true;
        var cls = (cur.className && typeof cur.className === 'string') ? cur.className : '';
        if (activeMatch(cls)) return true;
      } catch (e) {}
    }
    return false;
  }
  function findTabsByText(text) {
    var out = [];
    try {
      var all = document.querySelectorAll('a, span, div, li, button, [role="tab"], [role="menuitem"]');
      for (var i = 0; i < all.length; i++) { if ((all[i].textContent || '').trim() === text) out.push(all[i]); }
    } catch (e) {}
    return out;
  }
  function onTargetPage() {
    var p = window.__mockPath || '';
    if (p.indexOf('/uni-prom') === 0 || p.indexOf('/overall-prom') === 0) return true;
    try { return (document.body && document.body.textContent || '').indexOf('千川乘方') !== -1; }
    catch (e) { return false; }
  }
  function attempt() {
    if (done) return;
    attempts++;
    if (attempts > MAX_ATTEMPTS) { stop(true); return; }
    try {
      if (!onTargetPage()) return;
      while (stepIndex < STEPS.length) {
        var tabs = null, usedAlt = '';
        for (var ai = 0; ai < STEPS[stepIndex].alts.length; ai++) {
          var found = findTabsByText(STEPS[stepIndex].alts[ai]);
          if (found.length > 0) { tabs = found; usedAlt = STEPS[stepIndex].alts[ai]; break; }
        }
        if (!tabs) return;
        var leaves = tabs.filter(function(t) {
          return !tabs.some(function(o) { return o !== t && t.contains(o); });
        });
        if (leaves.length === 0) leaves = tabs;
        var inactive = leaves.filter(function(t) { return !isActive(t); });
        if (inactive.length === 0) {
          var row = leaves[0].parentElement;
          var sibCount = 0, sibActive = 0;
          try {
            if (row) {
              for (var ci = 0; ci < row.children.length; ci++) {
                var ch = row.children[ci];
                if ((ch.textContent || '').trim()) { sibCount++; if (isActive(ch)) sibActive++; }
              }
            }
          } catch (e) {}
          if (sibCount >= 2 && sibActive === sibCount && !forced[stepIndex]) {
            forced[stepIndex] = true;
            leaves[0].click();
            window.__qcLog.push(usedAlt + '(强制)');
            return;
          }
          stepIndex++;
          continue;
        }
        var target = (leaves.length > 1 && inactive.length < leaves.length) ? inactive[0] : leaves[0];
        target.click();
        window.__qcLog.push(usedAlt);
        return;
      }
      done = true; stop(false);
    } catch (e) {}
  }
  var timer = null;
  function stop(timeout) { if (timer) { clearInterval(timer); timer = null; } }
  timer = setInterval(attempt, 100); // 测试加速
  attempt();
})();
`;

// 乘方落地页: 点导航"全域投放"后 400ms 原地 SPA 换成 uni-prom 内容
function buildChengfangPage() {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="brand">千川乘方</div>
<header>
  <div class="nav-item active" data-key="chengfang"><span>乘方</span></div>
  <div class="nav-item" data-key="nav-qy"><span>全域投放</span></div>
  <div class="nav-item"><span>品牌投放</span></div>
</header>
<div class="objective-tabs">
  <div class="obj-tab active"><span>直播</span></div>
  <div class="obj-tab"><span>商品</span></div>
</div>
<div class="sub-tabs">
  <div class="sub-tab" data-key="self"><span>商品自选</span></div>
  <div class="sub-tab active"><span>全店托管</span></div>
</div>
<script>
  window.__qcLog = []; window.__clickCount = { nav: 0, push: 0, self: 0 };
  function activate(el) { Array.prototype.forEach.call(el.parentElement.children, function(c){ c.classList.remove('active'); }); el.classList.add('active'); }
  var navQy = document.querySelector('[data-key="nav-qy"]');
  navQy.addEventListener('click', function() {
    window.__clickCount.nav++;
    activate(navQy);
    setTimeout(function() {
      document.querySelector('.objective-tabs').innerHTML =
        '<div class="obj-tab active"><span>推直播间</span></div>' +
        '<div class="obj-tab" data-key="push"><span>推商品</span></div>';
      document.querySelector('.sub-tabs').innerHTML =
        '<div class="sub-tab" data-key="self"><span>商品自选</span></div>' +
        '<div class="sub-tab active"><span>全店托管</span></div>';
      var push = document.querySelector('[data-key="push"]');
      push.addEventListener('click', function() { window.__clickCount.push++; activate(push); });
      var self = document.querySelector('[data-key="self"]');
      self.addEventListener('click', function() { window.__clickCount.self++; activate(self); });
    }, 400);
  });
</script>
</body></html>`;
}

// uni-prom 页面: pushActive/selfActive 控制初始激活; subDelayMs>0 时子tab延迟渲染
// rowActiveCls=true 时给整行容器加 active 类(模拟"祖先共享 active 类名"误判陷阱)
function buildUniPromPage(pushActive, selfActive, subDelayMs, rowActiveCls) {
  const subHtml = subDelayMs > 0 ? '' : `<div class="sub-tabs ${rowActiveCls ? 'active' : ''}">
  <div class="sub-tab ${selfActive ? 'active' : ''}" data-key="self"><span>商品自选</span></div>
  <div class="sub-tab ${selfActive ? '' : 'active'}"><span>全店托管</span></div>
</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<header>
  <div class="nav-item"><span>首页</span></div>
  <div class="nav-item active" data-key="nav-qy"><span>全域投放</span></div>
</header>
<div class="type-tabs">
  <div class="type-tab active"><span>全域投放</span></div>
  <div class="type-tab"><span>标准投放</span></div>
</div>
<div class="objective-tabs">
  <div class="obj-tab ${pushActive ? '' : 'active'}"><span>推直播间</span></div>
  <div class="obj-tab ${pushActive ? 'active' : ''}" data-key="push"><span>推商品</span></div>
</div>
<div id="subArea">${subHtml}</div>
<script>
  window.__qcLog = []; window.__clickCount = { nav: 0, push: 0, self: 0 };
  function activate(el) { Array.prototype.forEach.call(el.parentElement.children, function(c){ c.classList.remove('active'); }); el.classList.add('active'); }
  var push = document.querySelector('[data-key="push"]');
  push.addEventListener('click', function() { window.__clickCount.push++; activate(push); });
  function bindSelf() {
    var self = document.querySelector('[data-key="self"]');
    if (self && !self.__bound) { self.__bound = true; self.addEventListener('click', function() { window.__clickCount.self++; activate(self); }); }
  }
  bindSelf();
  var delay = ${subDelayMs};
  if (delay > 0) {
    setTimeout(function() {
      document.getElementById('subArea').innerHTML =
        '<div class="sub-tabs"><div class="sub-tab" data-key="self"><span>商品自选</span></div>' +
        '<div class="sub-tab active"><span>全店托管</span></div></div>';
      bindSelf();
      window.__subRendered = true;
    }, delay);
  }
</script>
</body></html>`;
}

// v2.16.0 回归: click 处理器只挂在内层 <span> 上
function buildInnerHandlerPage() {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="brand">千川乘方</div>
<header>
  <div class="nav-item active" data-key="chengfang"><span>乘方</span></div>
  <div class="nav-item" data-key="nav-outer"><span id="nav-inner">全域投放</span></div>
</header>
<div class="objective-tabs">
  <div class="obj-tab active"><span>直播</span></div>
</div>
<div class="sub-tabs">
  <div class="sub-tab active"><span>全店托管</span></div>
</div>
<script>
  window.__qcLog = []; window.__clickCount = { nav: 0, push: 0, self: 0 };
  window.__outerClicked = 0;
  document.querySelector('[data-key="nav-outer"]').addEventListener('click', function() { window.__outerClicked++; });
  document.getElementById('nav-inner').addEventListener('click', function(e) {
    if (e.target === this) {
      window.__clickCount.nav++;
      var outer = this.parentElement;
      Array.prototype.forEach.call(outer.parentElement.children, function(c){ c.classList.remove('active'); });
      outer.classList.add('active');
    }
  });
</script>
</body></html>`;
}

// 非目标页(数据页)
function buildDataPage() {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<header><div class="nav-item active" data-key="data"><span>数据</span></div><div class="nav-item"><span>全域投放</span></div></header>
<div class="panel"><span>商品</span><span>直播分析</span></div>
<script>window.__qcLog = []; window.__clickCount = { nav: 0, push: 0, self: 0 };</script>
</body></html>`;
}

app.whenReady().then(async () => {
  setTimeout(() => { console.log('WATCHDOG TIMEOUT (90s)'); app.exit(2); }, 90000).unref();
  let pass = true;
  const assert = (cond, msg) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + msg); if (!cond) pass = false; };
  const win = new BrowserWindow({ width: 1000, height: 700, show: false });
  const tmp = path.join(app.getPath('temp'), 'fmt-qc-auto.html');

  async function run(name, html, mockPath, waitMs) {
    console.log(`>>> 开始场景: ${name}`);
    try {
      fs.writeFileSync(tmp, html);
      await win.loadFile(tmp);
      await win.webContents.executeJavaScript(`window.__mockQcHost = true; window.__mockPath = ${JSON.stringify(mockPath)};`);
      await win.webContents.executeJavaScript(AUTO_SETUP_SRC);
      await new Promise(r => setTimeout(r, waitMs));
    } catch (e) {
      console.log(`[场景异常] ${name}: ${e.message}`);
      return { log: ['<exception>'], clicks: { nav: -1, push: -1, self: -1 } };
    }
    const d = JSON.parse(await win.webContents.executeJavaScript(
      `JSON.stringify({ log: window.__qcLog, clicks: window.__clickCount })`
    ));
    console.log('点击序列:', JSON.stringify(d.log), '| 点击数:', JSON.stringify(d.clicks));
    return d;
  }

  // 场景1: 乘方落地页全自动
  const d1 = await run('乘方落地页全自动', buildChengfangPage(), '/chengfang', 4000);
  assert(JSON.stringify(d1.log) === JSON.stringify(['全域投放', '推商品', '商品自选']), '场景1: 顺序正确');
  const s1 = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify({
    nav: !!document.querySelector('[data-key="nav-qy"].active'),
    push: (function(){ var p=document.querySelector('[data-key="push"]'); return !!p && p.classList.contains('active'); })(),
    self: (function(){ var s=document.querySelector('[data-key="self"]'); return !!s && s.classList.contains('active'); })()
  })`));
  assert(s1.nav && s1.push && s1.self, '场景1: 三层全部到位');

  // 场景2: 只补商品自选
  const d2 = await run('uni-prom直开只补子tab', buildUniPromPage(true, false, 0, false), '/uni-prom', 2500);
  assert(d2.log.length === 1 && d2.log[0] === '商品自选' && d2.clicks.self === 1, '场景2: 仅自动点击商品自选');

  // 场景3: 已到位 → 零点击
  const d3 = await run('已到位零点击', buildUniPromPage(true, true, 0, false), '/uni-prom', 2000);
  assert(d3.log.length === 0, '场景3: 全部到位零点击');

  // 场景4: 非目标页零点击
  const d4 = await run('非目标页不劫持', buildDataPage(), '/data', 2500);
  assert(d4.log.length === 0 && d4.clicks.nav === 0, '场景4: 数据页零点击');

  // 场景5: overall-prom 直开
  const overallHtml = buildChengfangPage().replace('<div class="brand">千川乘方</div>', '');
  const d5 = await run('overall-prom直开', overallHtml, '/overall-prom', 2500);
  assert(d5.log.length >= 1 && d5.log[0] === '全域投放' && d5.clicks.nav === 1, '场景5: overall-prom 自动点导航');

  // 场景6: 内层 span 处理器
  const d6 = await run('内层span处理器', buildInnerHandlerPage(), '/overall-prom', 2500);
  assert(d6.clicks.nav === 1, '场景6: 处理器在内层 span 时仍点到');
  assert(await win.webContents.executeJavaScript('window.__outerClicked') === 1, '场景6: 事件由内层冒泡, 未直接点外层');

  // 场景7(v2.18.0): 整行容器带 active 类名 → 商品自选被误判为已激活 → 强制点击修正
  const d7 = await run('祖先共享active误判', buildUniPromPage(true, false, 0, true), '/uni-prom', 3000);
  const s7 = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify({
    self: (function(){ var s=document.querySelector('[data-key="self"]'); return !!s && s.classList.contains('active'); })(),
    hostActive: document.querySelector('.sub-tabs') ? document.querySelector('.sub-tabs').classList.contains('active') : false
  })`));
  console.log('  强制点击记录:', JSON.stringify(d7.log), '| 商品自选已激活:', s7.self);
  assert(d7.clicks.self === 1 && s7.self, '场景7: 误判场景下仍强制点到 商品自选');

  // 场景8(v2.18.0): 子tab 3秒后才渲染 → 长窗口等待后仍能点到
  const d8 = await run('子tab延迟渲染', buildUniPromPage(true, false, 3000, false), '/uni-prom', 6000);
  const s8 = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify({
    rendered: !!window.__subRendered,
    self: (function(){ var s=document.querySelector('[data-key="self"]'); return !!s && s.classList.contains('active'); })()
  })`));
  console.log('  子tab已渲染:', s8.rendered, '| 商品自选已激活:', s8.self, '| 点击:', JSON.stringify(d8.clicks));
  assert(s8.rendered && d8.clicks.self === 1 && s8.self, '场景8: 延迟渲染的子tab最终仍被点到');

  fs.unlinkSync(tmp);
  console.log(pass ? '\nQC AUTO SETUP v2.18.0 TEST PASS (八场景全部通过)' : '\nTEST FAIL');
  app.exit(pass ? 0 : 1);
});
