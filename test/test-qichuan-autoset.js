// 测试: 千川页自动设置(v2.14.0)
// 复刻 preload.js qianchuanAutoSetup 核心逻辑(仅 host/pathname 守卫换成可注入的 mock)验证:
// ① 乘方落地页(含"千川乘方")→ 点导航全域投放 → SPA 换成 uni-prom 内容 → 推商品 → 商品自选
// ② uni-prom 直开全灭 → 依次点到位
// ③ 已全部到位 → 零点击
// ④ 非目标页(数据页, 无"千川乘方") → 零点击不劫持
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

// 复刻 preload.js v2.14.0 核心算法(host 守卫换成 __mockQcHost)
const AUTO_SETUP_SRC = `
(function qianchuanAutoSetup() {
  if (!window.__mockQcHost) return;
  var STEPS = [
    { alts: ['全域投放'] },
    { alts: ['推商品'] },
    { alts: ['商品自选'] }
  ];
  var stepIndex = 0, attempts = 0, MAX_ATTEMPTS = 60, done = false;
  function isActive(el) {
    var cur = el, up = 0;
    while (cur && cur.nodeType === 1 && up < 5) {
      try {
        if (cur.getAttribute && (cur.getAttribute('aria-selected') === 'true' || cur.getAttribute('aria-current'))) return true;
        var cls = (cur.className && typeof cur.className === 'string') ? cur.className : '';
        if (/(^|\\s)(active|selected|checked)(\\s|$)/i.test(cls)) return true;
      } catch (e) {}
      cur = cur.parentElement; up++;
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
    // 注意: 此函数在模板字面量内, 路径匹配不用正则(\/ 转义会被模板字面量吃掉变语法错误)
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
        // 与 preload 一致: 只取叶子元素再点击(冒泡命中任意层级处理器)
        var leaves = tabs.filter(function(t) {
          return !tabs.some(function(o) { return o !== t && t.contains(o); });
        });
        if (leaves.length === 0) leaves = tabs;
        var inactive = leaves.filter(function(t) { return !isActive(t); });
        if (inactive.length === 0) { stepIndex++; continue; }
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

// 乘方落地页: 点导航"全域投放"后 400ms 原地 SPA 换成 uni-prom 内容(推直播间|推商品 + 子tab)
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
    // 模拟 SPA 换内容: 乘方概览 → 全域投放 uni-prom 列表(400ms 后渲染)
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

// uni-prom 直开页: pushActive/selfActive 分别控制 推商品/商品自选 初始是否激活
function buildUniPromPage(pushActive, selfActive) {
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
<div class="sub-tabs">
  <div class="sub-tab ${selfActive ? 'active' : ''}" data-key="self"><span>商品自选</span></div>
  <div class="sub-tab ${selfActive ? '' : 'active'}"><span>全店托管</span></div>
</div>
<script>
  window.__qcLog = []; window.__clickCount = { nav: 0, push: 0, self: 0 };
  function activate(el) { Array.prototype.forEach.call(el.parentElement.children, function(c){ c.classList.remove('active'); }); el.classList.add('active'); }
  var push = document.querySelector('[data-key="push"]');
  push.addEventListener('click', function() { window.__clickCount.push++; activate(push); });
  var self = document.querySelector('[data-key="self"]');
  self.addEventListener('click', function() { window.__clickCount.self++; activate(self); });
</script>
</body></html>`;
}

// v2.16.0 回归: click 处理器只挂在内层 <span> 上(模拟 React 把 onClick 挂在内层节点),
// 若点外层容器则完全不触发 —— 叶子点击(冒泡)必须能命中
function buildInnerHandlerPage() {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="brand">千川乘方</div>
<header>
  <div class="nav-item active" data-key="chengfang"><span>乘方</span></div>
  <div class="nav-item" data-key="nav-outer"><span id="nav-inner">全域投放</span></div>
</header>
<div class="objective-tabs">
  <div class="obj-tab active"><span>直播</span></div>
  <div class="obj-tab"><span>商品</span></div>
</div>
<div class="sub-tabs">
  <div class="sub-tab active"><span>全店托管</span></div>
  <div class="sub-tab"><span>商品自选</span></div>
</div>
<script>
  window.__qcLog = []; window.__clickCount = { nav: 0, push: 0, self: 0 };
  window.__outerClicked = 0;
  document.querySelector('[data-key="nav-outer"]').addEventListener('click', function() {
    // 外层收到点击(不应由自动化触发, 因为处理器实际在内层; 由内层冒泡上来时会有 inner 标记)
    window.__outerClicked++;
  });
  // 处理器只挂在内层 span 上(点击后切激活态, 模拟真实 tab 行为)
  document.getElementById('nav-inner').addEventListener('click', function(e) {
    if (e.target === this) {
      window.__clickCount.nav++; window.__qcLog.push('全域投放');
      var outer = this.parentElement;
      Array.prototype.forEach.call(outer.parentElement.children, function(c){ c.classList.remove('active'); });
      outer.classList.add('active');
    }
  });
</script>
</body></html>`;
}

// 非目标页(数据页): 无"千川乘方", 有自己的"商品"字样干扰项
function buildDataPage() {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<header><div class="nav-item active" data-key="data"><span>数据</span></div><div class="nav-item"><span>全域投放</span></div></header>
<div class="panel"><span>商品</span><span>直播分析</span></div>
<script>window.__qcLog = []; window.__clickCount = { nav: 0, push: 0, self: 0 };</script>
</body></html>`;
}

app.whenReady().then(async () => {
  // 看门狗: 任何环节卡死都强退, 不让测试挂死
  setTimeout(() => { console.log('WATCHDOG TIMEOUT (25s)'); app.exit(2); }, 25000).unref();
  let pass = true;
  const assert = (cond, msg) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + msg); if (!cond) pass = false; };
  const win = new BrowserWindow({ width: 1000, height: 700, show: false });
  const tmp = path.join(app.getPath('temp'), 'fmt-qc-auto.html');

  async function run(name, html, mockPath, waitMs) {
    console.log(`>>> 开始场景: ${name}`);
    win.webContents.removeAllListeners('console-message');
    win.webContents.on('console-message', (e, level, message) => {
      if (level >= 2) console.log(`  [渲染console] ${String(message).substring(0, 200)}`);
    });
    try {
      fs.writeFileSync(tmp, html);
      await win.loadFile(tmp);
    } catch (e) {
      console.log(`[场景异常] ${name} loadFile: ${e.message}`);
      return { log: ['<exception>'], clicks: { nav: -1, push: -1, self: -1 } };
    }
    try {
      await win.webContents.executeJavaScript(`window.__mockQcHost = true; window.__mockPath = ${JSON.stringify(mockPath)};`);
    } catch (e) {
      console.log(`[场景异常] ${name} mockvars注入: ${e.message}`);
      return { log: ['<exception>'], clicks: { nav: -1, push: -1, self: -1 } };
    }
    try {
      await win.webContents.executeJavaScript(AUTO_SETUP_SRC);
    } catch (e) {
      console.log(`[场景异常] ${name} 模块注入: ${e.message}`);
      return { log: ['<exception>'], clicks: { nav: -1, push: -1, self: -1 } };
    }
    await new Promise(r => setTimeout(r, waitMs));
    const d = JSON.parse(await win.webContents.executeJavaScript(
      `JSON.stringify({ log: window.__qcLog, clicks: window.__clickCount })`
    ));
    console.log(`\n===== ${name} =====`);
    console.log('点击序列:', JSON.stringify(d.log), '| 点击数:', JSON.stringify(d.clicks));
    return d;
  }

  // 场景1(v2.14.0 核心): 乘方落地页 → 全域投放 → SPA 换内容 → 推商品 → 商品自选
  const d1 = await run('乘方落地页全自动', buildChengfangPage(), '/chengfang', 4000);
  assert(JSON.stringify(d1.log) === JSON.stringify(['全域投放', '推商品', '商品自选']),
    '场景1: 乘方页→全域投放→推商品→商品自选 顺序正确');
  const state1 = JSON.parse(await win.webContents.executeJavaScript(`
    JSON.stringify({
      nav: !!document.querySelector('[data-key="nav-qy"].active'),
      push: (function(){ var p = document.querySelector('[data-key="push"]'); return !!p && p.classList.contains('active'); })(),
      self: (function(){ var s = document.querySelector('[data-key="self"]'); return !!s && s.classList.contains('active'); })()
    })
  `));
  console.log('终态: 导航全域投放=' + state1.nav + ' 推商品=' + state1.push + ' 商品自选=' + state1.self);
  assert(state1.nav && state1.push && state1.self, '场景1: 三层全部到位');

  // 场景2: uni-prom 直开, 推商品已激活、商品自选灭 → 只补商品自选
  const d2 = await run('uni-prom直开只补子tab', buildUniPromPage(true, false), '/uni-prom', 2500);
  assert(d2.log.length === 1 && d2.log[0] === '商品自选' && d2.clicks.self === 1, '场景2: 仅自动点击商品自选');

  // 场景3: 已全部到位 → 零点击
  const d3 = await run('已到位零点击', buildUniPromPage(true, true), '/uni-prom', 2000);
  assert(d3.log.length === 0, '场景3: 全部到位零点击');

  // 场景4: 非目标页(数据页, 无"千川乘方") → 零点击不劫持(虽有同名"全域投放"和"商品")
  const d4 = await run('非目标页不劫持', buildDataPage(), '/data', 2500);
  assert(d4.log.length === 0 && d4.clicks.nav === 0, '场景4: 数据页零点击, 不会被劫持跳走');

  // 场景5(v2.15.0): 工作台点账户落地的 overall-prom 页(即使无"千川乘方"字样) → 点导航全域投放
  const overallHtml = buildChengfangPage().replace('<div class="brand">千川乘方</div>', '');
  const d5 = await run('overall-prom直开', overallHtml, '/overall-prom', 2500);
  assert(d5.log.length >= 1 && d5.log[0] === '全域投放' && d5.clicks.nav === 1, '场景5: overall-prom 页自动点击导航全域投放');

  // 场景6(v2.16.0 回归): click 处理器只在内层 span 上 → 叶子点击(冒泡)必须命中
  const d6 = await run('内层span处理器', buildInnerHandlerPage(), '/overall-prom', 2500);
  assert(d6.clicks.nav === 1, '场景6: 处理器挂在内层 span 时仍能点到(叶子+冒泡)');
  const outerHits = await win.webContents.executeJavaScript('window.__outerClicked');
  console.log('外层容器收到的点击次数(应为1, 由内层冒泡而来):', outerHits);
  assert(outerHits === 1, '场景6: 事件由内层冒泡至外层, 未直接点外层容器');

  fs.unlinkSync(tmp);
  console.log(pass ? '\nQC AUTO SETUP v2.14.0 TEST PASS (四场景全部通过)' : '\nTEST FAIL');
  app.exit(pass ? 0 : 1);
});
