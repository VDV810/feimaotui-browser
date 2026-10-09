// 测试: 千川 uni-prom 页自动设置(v2.13.0)
// 复刻 preload.js qianchuanAutoSetup 核心逻辑逐字注入, 在模拟千川三层 tab 结构的页面上验证:
// ① 全灭状态: 三层依次自动点击到位  ② 顶部导航已激活但投放类型行未激活(一活一灭): 只补点灭的
// ③ 已全部到位: 零点击(不干扰用户)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

// 复刻 preload.js qianchuanAutoSetup 的核心算法(仅去掉 location 守卫, 其余逐字一致)
const AUTO_SETUP_SRC = `
(function qianchuanAutoSetup() {
  var STEPS = ['全域投放', '推商品', '商品自选'];
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
  function attempt() {
    if (done) return;
    attempts++;
    if (attempts > MAX_ATTEMPTS) { stop(true); return; }
    try {
      while (stepIndex < STEPS.length) {
        var tabs = findTabsByText(STEPS[stepIndex]);
        if (tabs.length === 0) return;
        var inactive = tabs.filter(function(t) { return !isActive(t); });
        if (inactive.length === 0) { stepIndex++; continue; }
        var target = (tabs.length > 1 && inactive.length < tabs.length) ? inactive[0] : tabs[0];
        target.click();
        window.__qcLog.push(STEPS[stepIndex]);
        return;
      }
      done = true; stop(false);
    } catch (e) {}
  }
  var timer = null;
  function stop(timeout) { if (timer) { clearInterval(timer); timer = null; } }
  timer = setInterval(attempt, 100); // 测试加速: 100ms/次
  attempt();
})();
`;

function buildMockPage(initial) {
  // initial: { navQy: bool, typeQy: bool, push: bool, selfSel: bool } 各 tab 是否激活
  // 推商品 tab 点击后 300ms 才渲染出 商品自选 子tab(模拟 React 两段式渲染)
  const tab = (cls, text, key) => `<div class="${cls}" data-key="${key || text}"><span>${text}</span></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<header>
  <div class="nav-item"><span>首页</span></div>
  <div class="nav-item ${initial.navQy ? 'active' : ''}" data-key="nav-qy"><span>全域投放</span></div>
  <div class="nav-item"><span>品牌投放</span></div>
</header>
<div class="type-tabs">
  <div class="type-tab ${initial.typeQy ? 'active' : ''}" data-key="type-qy"><span>全域投放</span></div>
  <div class="type-tab ${initial.typeQy ? '' : 'active'}"><span>标准投放</span></div>
</div>
<div class="objective-tabs">
  <div class="obj-tab ${initial.push ? '' : 'active'}"><span>推直播间</span></div>
  <div class="obj-tab ${initial.push ? 'active' : ''}" data-key="push"><span>推商品</span></div>
</div>
<div id="subArea"></div>
<script>
  window.__qcLog = [];
  window.__clickCount = { nav: 0, type: 0, push: 0, self: 0 };
  function activate(el, group) {
    Array.prototype.forEach.call(el.parentElement.children, function(c) { c.classList.remove('active'); });
    el.classList.add('active');
  }
  // 三层 tab 的点击行为(模拟千川: 切目标后延迟渲染子tab)
  document.querySelectorAll('.nav-item[data-key="nav-qy"], .type-tab[data-key="type-qy"]').forEach(function(el) {
    el.addEventListener('click', function() {
      activate(el);
      if (el.dataset.key === 'nav-qy') window.__clickCount.nav++;
      else window.__clickCount.type++;
    });
  });
  var pushTab = document.querySelector('[data-key="push"]');
  pushTab.addEventListener('click', function() {
    window.__clickCount.push++;
    activate(pushTab);
    setTimeout(function() {
      document.getElementById('subArea').innerHTML =
        '<div class="sub-tabs">' +
        '<div class="sub-tab" data-key="self"><span>商品自选</span></div>' +
        '<div class="sub-tab active"><span>全店托管</span></div>' +
        '</div>';
      var selfTab = document.querySelector('[data-key="self"]');
      selfTab.addEventListener('click', function() { window.__clickCount.self++; activate(selfTab); });
    }, 300);
  });
  // 初始即激活推商品的场景: 直接渲染子tab
  if (${initial.push ? 'true' : 'false'}) {
    document.getElementById('subArea').innerHTML =
      '<div class="sub-tabs">' +
      '<div class="sub-tab ${initial.selfSel ? 'active' : ''}" data-key="self"><span>商品自选</span></div>' +
      '<div class="sub-tab ${initial.selfSel ? '' : 'active'}"><span>全店托管</span></div>' +
      '</div>';
    var selfTab0 = document.querySelector('[data-key="self"]');
    selfTab0.addEventListener('click', function() { window.__clickCount.self++; activate(selfTab0); });
  }
</script>
</body></html>`;
}

app.whenReady().then(async () => {
  let pass = true;
  const assert = (cond, msg) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + msg); if (!cond) pass = false; };
  const win = new BrowserWindow({ width: 1000, height: 700, show: false });
  const tmp = path.join(app.getPath('temp'), 'fmt-qc-auto.html');

  async function runScenario(name, initial, waitMs) {
    fs.writeFileSync(tmp, buildMockPage(initial));
    await win.loadFile(tmp);
    await win.webContents.executeJavaScript(AUTO_SETUP_SRC);
    await new Promise(r => setTimeout(r, waitMs));
    const d = JSON.parse(await win.webContents.executeJavaScript(`
      JSON.stringify({
        log: window.__qcLog,
        clicks: window.__clickCount,
        navQy: !!document.querySelector('.nav-item[data-key="nav-qy"].active'),
        typeQy: !!document.querySelector('.type-tab[data-key="type-qy"].active'),
        push: !!document.querySelector('[data-key="push"].active'),
        self: (function(){ var s = document.querySelector('[data-key="self"]'); return !!s && s.classList.contains('active'); })()
      })
    `));
    console.log(`\n===== 场景: ${name} =====`);
    console.log('点击序列:', JSON.stringify(d.log), '| 点击数:', JSON.stringify(d.clicks));
    console.log(`终态: 顶部导航全域投放=${d.navQy} 类型行全域投放=${d.typeQy} 推商品=${d.push} 商品自选=${d.self}`);
    return d;
  }

  // 场景1: 全灭(首次打开, 默认停在别处) → 三层应全部自动点击到位
  const d1 = await runScenario('全灭→自动点到位', { navQy: false, typeQy: false, push: false, selfSel: false }, 3500);
  assert(d1.navQy && d1.typeQy && d1.push && d1.self, '场景1: 三层全部自动设置到位');
  // 两个"全域投放"(导航+类型行)都灭 → 各补一次, 然后推商品、商品自选(共4次, 顺序正确)
  assert(JSON.stringify(d1.log) === JSON.stringify(['全域投放', '全域投放', '推商品', '商品自选']),
    '场景1: 点击顺序正确(两处全域投放补齐→推商品→商品自选)');

  // 场景2: 顶部导航已激活但投放类型行停在标准投放(一活一灭) → 只补点类型行
  const d2 = await runScenario('一活一灭→只补灭的', { navQy: true, typeQy: false, push: false, selfSel: false }, 3500);
  assert(d2.typeQy && d2.push && d2.self, '场景2: 类型行补点后三层全部到位');
  assert(d2.clicks.nav === 0, '场景2: 已激活的顶部导航没有被重复点击');

  // 场景3: 已全部到位(用户自己已设好/上次保留状态) → 零点击
  const d3 = await runScenario('已到位→零点击', { navQy: true, typeQy: true, push: true, selfSel: true }, 2000);
  const total3 = d3.clicks.nav + d3.clicks.type + d3.clicks.push + d3.clicks.self;
  assert(total3 === 0, '场景3: 全部到位时零点击, 不干扰用户');

  fs.unlinkSync(tmp);
  console.log(pass ? '\nQC AUTO SETUP TEST PASS (三场景全部通过)' : '\nTEST FAIL');
  app.exit(pass ? 0 : 1);
});
