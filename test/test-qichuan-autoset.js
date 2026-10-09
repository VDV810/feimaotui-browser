// 测试: 千川页自动设置(v2.19.0)
// 核心回归: v2.16.0 把点击目标改成"最内层叶子"后, 千川的商品自选 tab 点不到
// (该组件只在"点击目标即自身"时响应, 点内部 span 不认); v2.14.0 点外层是可用的。
// v2.19.0 = 可见性过滤 + 外层优先 + 策略阶梯(外层→叶子→完整鼠标事件)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

// 复刻 preload.js v2.19.0 核心算法(host 守卫换成 __mockQcHost)
const AUTO_SETUP_SRC = `
(function qianchuanAutoSetup() {
  if (!window.__mockQcHost) return;
  var STEPS = [
    { alts: ['全域投放'] },
    { alts: ['推商品'] },
    { alts: ['商品自选'] }
  ];
  var stepIndex = 0, attempts = 0, forced = {}, stepTries = {}, MAX_ATTEMPTS = 240, done = false;
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
  function isVisible(el) {
    try {
      var r = el.getBoundingClientRect();
      if (r.width <= 2 || r.height <= 2) return false;
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      return true;
    } catch (e) { return true; }
  }
  function clickOuter(el) { try { el.click(); } catch (e) {} }
  function clickLeaf(el) {
    try {
      var leaf = el;
      while (leaf.firstElementChild && (leaf.firstElementChild.textContent || '').trim() === (leaf.textContent || '').trim()) leaf = leaf.firstElementChild;
      leaf.click();
    } catch (e) { clickOuter(el); }
  }
  function clickMouseSequence(el) {
    try {
      var r = el.getBoundingClientRect();
      var opts = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
      ['mousedown', 'mouseup', 'click'].forEach(function(t) { try { el.dispatchEvent(new MouseEvent(t, opts)); } catch (e) {} });
    } catch (e) { clickOuter(el); }
  }
  var STRATEGIES = [
    { name: '外层元素', fn: clickOuter },
    { name: '最内层叶子', fn: clickLeaf },
    { name: '完整鼠标事件', fn: clickMouseSequence }
  ];
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
        var visible = tabs.filter(isVisible);
        var pool = visible.length > 0 ? visible : tabs;
        var outerMost = pool.filter(function(t) { return !pool.some(function(o) { return o !== t && o.contains(t); }); });
        var candidates = outerMost.length > 0 ? outerMost : pool;
        var inactive = candidates.filter(function(t) { return !isActive(t); });
        if (inactive.length === 0) {
          var row = candidates[0].parentElement, sibCount = 0, sibActive = 0;
          try {
            if (row) { for (var ci = 0; ci < row.children.length; ci++) { var ch = row.children[ci]; if ((ch.textContent || '').trim()) { sibCount++; if (isActive(ch)) sibActive++; } } }
          } catch (e) {}
          if (sibCount >= 2 && sibActive === sibCount && !forced[stepIndex]) {
            forced[stepIndex] = true;
            STRATEGIES[0].fn(candidates[0]);
            window.__qcLog.push(usedAlt + '(强制/' + STRATEGIES[0].name + ')');
            return;
          }
          stepIndex++;
          continue;
        }
        var target = (candidates.length > 1 && inactive.length < candidates.length) ? inactive[0] : candidates[0];
        var tries = stepTries[stepIndex] || 0;
        stepTries[stepIndex] = tries + 1;
        var strat = STRATEGIES[Math.min(Math.floor(tries / 4), STRATEGIES.length - 1)];
        strat.fn(target);
        window.__qcLog.push(usedAlt + '[' + strat.name + ']');
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

// 基础页: 可选严格守卫(target===currentTarget 才响应) / 隐藏副本 / 处理器在内层span
function buildPage(opts) {
  const o = opts || {};
  let selfHandler;
  if (o.innerSpanOnly) {
    // 处理器只挂在内层 span 上(外层点击无效) → 需要策略阶梯升级到"叶子"
    selfHandler = [
      "var inner = self.querySelector('span');",
      "inner.addEventListener('click', function(e) { if (e.target === this) { window.__clickCount.self++; activate(self); } });"
    ].join('\n  ');
  } else if (o.strictTargetGuard) {
    selfHandler = `self.addEventListener('click', function(e) { if (e.target === e.currentTarget) { window.__clickCount.self++; activate(self); } else { window.__rejectedByGuard++; } });`;
  } else {
    selfHandler = `self.addEventListener('click', function() { window.__clickCount.self++; activate(self); });`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
${o.hiddenDup ? '<div style="display:none"><span>商品自选</span></div>' : ''}
${o.hiddenDupZero ? '<div class="ghost"></div>' : ''}
<header>
  <div class="nav-item active" data-key="nav-qy"><span>全域投放</span></div>
</header>
<div class="objective-tabs">
  <div class="obj-tab"><span>推直播间</span></div>
  <div class="obj-tab active" data-key="push"><span>推商品</span></div>
</div>
<div class="sub-tabs">
  <div class="sub-tab" data-key="self"><span>商品自选</span></div>
  <div class="sub-tab active"><span>全店托管</span></div>
</div>
<script>
  window.__qcLog = []; window.__clickCount = { nav: 0, push: 0, self: 0 }; window.__rejectedByGuard = 0;
  function activate(el) { Array.prototype.forEach.call(el.parentElement.children, function(c){ c.classList.remove('active'); }); el.classList.add('active'); }
  var self = document.querySelector('[data-key="self"]');
  ${selfHandler}
</script>
</body></html>`;
}

// 乘方落地页(带 SPA 换内容)
function buildChengfangPage() {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="brand">千川乘方</div>
<header>
  <div class="nav-item active" data-key="chengfang"><span>乘方</span></div>
  <div class="nav-item" data-key="nav-qy"><span>全域投放</span></div>
</header>
<div class="objective-tabs"><div class="obj-tab active"><span>直播</span></div></div>
<div class="sub-tabs"><div class="sub-tab active"><span>全店托管</span></div></div>
<script>
  window.__qcLog = []; window.__clickCount = { nav: 0, push: 0, self: 0 };
  function activate(el) { Array.prototype.forEach.call(el.parentElement.children, function(c){ c.classList.remove('active'); }); el.classList.add('active'); }
  var navQy = document.querySelector('[data-key="nav-qy"]');
  navQy.addEventListener('click', function() {
    window.__clickCount.nav++; activate(navQy);
    setTimeout(function() {
      document.querySelector('.objective-tabs').innerHTML =
        '<div class="obj-tab active"><span>推直播间</span></div><div class="obj-tab" data-key="push"><span>推商品</span></div>';
      document.querySelector('.sub-tabs').innerHTML =
        '<div class="sub-tab" data-key="self"><span>商品自选</span></div><div class="sub-tab active"><span>全店托管</span></div>';
      var push = document.querySelector('[data-key="push"]');
      push.addEventListener('click', function() { window.__clickCount.push++; activate(push); });
      var self = document.querySelector('[data-key="self"]');
      self.addEventListener('click', function(e) { if (e.target === e.currentTarget) { window.__clickCount.self++; activate(self); } });
    }, 400);
  });
</script>
</body></html>`;
}

function buildSubStateOnly() {
  // 子tab未渲染(延迟) + 推商品已激活
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<header><div class="nav-item active"><span>全域投放</span></div></header>
<div class="objective-tabs">
  <div class="obj-tab"><span>推直播间</span></div>
  <div class="obj-tab active" data-key="push"><span>推商品</span></div>
</div>
<div id="subArea"></div>
<script>
  window.__qcLog = []; window.__clickCount = { nav: 0, push: 0, self: 0 };
  function activate(el) { Array.prototype.forEach.call(el.parentElement.children, function(c){ c.classList.remove('active'); }); el.classList.add('active'); }
  setTimeout(function() {
    document.getElementById('subArea').innerHTML =
      '<div class="sub-tabs"><div class="sub-tab" data-key="self"><span>商品自选</span></div>' +
      '<div class="sub-tab active"><span>全店托管</span></div></div>';
    var self = document.querySelector('[data-key="self"]');
    self.addEventListener('click', function() { window.__clickCount.self++; activate(self); });
    window.__subRendered = true;
  }, 2500);
</script>
</body></html>`;
}

function buildDataPage() {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<header><div class="nav-item active"><span>数据</span></div><div class="nav-item"><span>全域投放</span></div></header>
<div class="panel"><span>商品</span></div>
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
    console.log(`>>> ${name}`);
    try {
      fs.writeFileSync(tmp, html);
      await win.loadFile(tmp);
      await win.webContents.executeJavaScript(`window.__mockQcHost = true; window.__mockPath = ${JSON.stringify(mockPath)};`);
      await win.webContents.executeJavaScript(AUTO_SETUP_SRC);
      await new Promise(r => setTimeout(r, waitMs));
    } catch (e) {
      console.log(`[异常] ${name}: ${e.message}`);
      return { log: ['<exception>'], clicks: { nav: -1, push: -1, self: -1 } };
    }
    const d = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify({ log: window.__qcLog, clicks: window.__clickCount })`));
    console.log('  记录:', JSON.stringify(d.log), '| 点击数:', JSON.stringify(d.clicks));
    return d;
  }

  // 1: 乘方落地页全自动(严格守卫, 即 v2.14.0 能成功、v2.16.0 失败的真实结构)
  const d1 = await run('乘方落地页(严格守卫)', buildChengfangPage(), '/chengfang', 4000);
  const s1 = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify({
    nav: !!document.querySelector('[data-key="nav-qy"]').classList.contains('active'),
    push: !!document.querySelector('[data-key="push"]') , self: !!document.querySelector('[data-key="self"]')
  })`));
  assert(d1.clicks.nav === 1 && d1.clicks.push === 1 && d1.clicks.self === 1, '场景1: 三层全部点到(含严格守卫的商品自选)');
  assert(s1.nav, '场景1: 导航全域投放已激活');

  // 2: uni-prom 直开, 只差商品自选 + 严格守卫
  const d2 = await run('商品自选(严格守卫)', buildPage({ strictTargetGuard: true }), '/uni-prom', 2500);
  assert(d2.clicks.self === 1, '场景2: 严格守卫下商品自选被点到(外层策略生效)');
  assert(d2.log[0].indexOf('外层元素') !== -1, '场景2: 首次即用"外层元素"策略');

  // 3: 隐藏副本(display:none 的同名元素在前) → 必须点可见的那个
  const d3 = await run('隐藏同名副本', buildPage({ hiddenDup: true }), '/uni-prom', 2500);
  const s3 = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify({
    selfActive: document.querySelector('[data-key="self"]').classList.contains('active')
  })`));
  assert(d3.clicks.self === 1 && s3.selfActive, '场景3: 跳过隐藏副本, 点到可见的商品自选');

  // 4: 已全部到位 → 零点击
  const d4 = await run('已到位零点击', buildPage({ selfActivePre: true })
    .replace('<div class="sub-tab" data-key="self">', '<div class="sub-tab active" data-key="self">')
    .replace('<div class="sub-tab active"><span>全店托管</span></div>', '<div class="sub-tab"><span>全店托管</span></div>'), '/uni-prom', 1500);
  assert(d4.log.length === 0, '场景4: 已到位零点击');

  // 5: 非目标页 → 零点击
  const d5 = await run('非目标页不劫持', buildDataPage(), '/data', 2000);
  assert(d5.log.length === 0, '场景5: 数据页零点击');

  // 6: 子tab延迟渲染 → 最终仍点到
  const d6 = await run('子tab延迟渲染', buildSubStateOnly(), '/uni-prom', 5000);
  const s6 = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify({
    rendered: !!window.__subRendered, selfActive: !!document.querySelector('[data-key="self"]') && document.querySelector('[data-key="self"]').classList.contains('active')
  })`));
  assert(s6.rendered && d6.clicks.self === 1 && s6.selfActive, '场景6: 延迟渲染后仍点到商品自选');

  // 7: 处理器只在内层 span(外层点不动) → 阶梯升级到"叶子"策略后成功
  const d7 = await run('处理器仅在内层span', buildPage({ innerSpanOnly: true }), '/uni-prom', 3500);
  assert(d7.clicks && d7.clicks.self === 1, '场景7: 外层策略失败后升级到叶子策略并点到');
  assert(d7.log.some(l => l.indexOf('叶子') !== -1), '场景7: 日志显示确实升级到了"最内层叶子"策略');

  fs.unlinkSync(tmp);
  console.log(pass ? '\nQIANCHUAN AUTO SETUP v2.19.0 TEST PASS' : '\nTEST FAIL');
  app.exit(pass ? 0 : 1);
});
