// 测试: 千川页自动设置(v2.20.0)
// 用户实测问题现场: 点中商品自选后又被点到全店托管 —— 根因是"选中态识别不出 → 无脑连点 →
// 策略升级后误击". 修复 = 候选剔除(嵌在其它tab内的)+ 闭环(误选纠正/点过即停).
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

// 复刻 preload.js v2.20.0 核心算法(host 守卫换成 __mockQcHost)
const AUTO_SETUP_SRC = `
(function qianchuanAutoSetup() {
  if (!window.__mockQcHost) return;
  var STEPS = [{ alts: ['全域投放'] }, { alts: ['推商品'] }, { alts: ['商品自选'] }];
  var stepIndex = 0, attempts = 0, forced = {}, clickCounts = {}, sigBase = {}, MAX_CLICKS_PER_STEP = 6, MAX_ATTEMPTS = 240, done = false;
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
  function rowSignature(row) {
    try {
      if (!row) return '';
      var parts = [String(row.className || ''), String(row.children.length)];
      for (var i = 0; i < row.children.length; i++) {
        var c = row.children[i];
        parts.push(String(c.className || '') + '/' + ((c.textContent || '').trim().length) + '/' + String((c.style && c.style.cssText) || '').substring(0, 80));
      }
      return parts.join('|');
    } catch (e) { return ''; }
  }
  function siblingSelected(target) {
    try {
      var row = target.parentElement;
      if (!row) return false;
      var myText = (target.textContent || '').trim();
      for (var i = 0; i < row.children.length; i++) {
        var c = row.children[i];
        var t = (c.textContent || '').trim();
        if (!t || t === myText) continue;
        if (isActive(c)) return true;
      }
    } catch (e) {}
    return false;
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
  // v2.22.0: 只认两个投放落地页路径, 并显式排除数据页(旧实现的文字回退会把数据页也当投放页)
  // 注意: 模板字面量内不能用 \/ 正则转义(会被吃掉导致语法错误), 这里用字符串前缀比较
  var EXCLUDE_PREFIX = ['/data', '/dataV2', '/report', '/tools', '/finance', '/marketing', '/school', '/community_security'];
  function onTargetPage() {
    var p = window.__mockPath || '';
    for (var i = 0; i < EXCLUDE_PREFIX.length; i++) { if (p.indexOf(EXCLUDE_PREFIX[i]) === 0) return false; }
    return p === '/uni-prom' || p.indexOf('/uni-prom/') === 0 || p === '/overall-prom' || p.indexOf('/overall-prom/') === 0;
  }
  function tabLike(el) {
    try {
      if (el.getAttribute && (el.getAttribute('role') === 'tab' || el.hasAttribute('aria-selected'))) return true;
      var cls = (el.className && typeof el.className === 'string') ? el.className : '';
      return /(^|[\\s_-])tab([\\s_-]|$)/i.test(cls);   // 只认单数 tab, 排除 objective-tabs 这类容器
    } catch (e) { return false; }
  }
  function upgradeToTab(el) {
    var cur = el, up = 0;
    while (cur && cur.nodeType === 1 && up < 4) { if (tabLike(cur)) return cur; cur = cur.parentElement; up++; }
    return el;
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
        var otherLabels = [];
        STEPS.forEach(function(s, si) { if (si === stepIndex) return; s.alts.forEach(function(a) { if (otherLabels.indexOf(a) === -1) otherLabels.push(a); }); });
        pool = pool.filter(function(t) {
          var p = t.parentElement, up = 0;
          while (p && p.nodeType === 1 && up < 3) {
            var pt = (p.textContent || '').trim();
            if (pt.length > 40) break;   // 已到页面容器层, 停止上溯
            for (var oi = 0; oi < otherLabels.length; oi++) { if (pt.indexOf(otherLabels[oi]) !== -1) return false; }
            p = p.parentElement; up++;
          }
          return true;
        });
        if (pool.length === 0) return;
        var outerMost = pool.filter(function(t) { return !pool.some(function(o) { return o !== t && o.contains(t); }); });
        var src3 = outerMost.length > 0 ? outerMost : pool;
        var candidates = [];
        src3.forEach(function(t) { var u = upgradeToTab(t); if (candidates.indexOf(u) === -1) candidates.push(u); });
        var inactive = candidates.filter(function(t) { return !isActive(t); });
        if (inactive.length === 0) {
          var row = candidates[0].parentElement, sibCount = 0, sibActive = 0;
          try {
            if (row) { for (var ci = 0; ci < row.children.length; ci++) { var ch = row.children[ci]; if ((ch.textContent || '').trim()) { sibCount++; if (isActive(ch)) sibActive++; } } }
          } catch (e) {}
          if (sibCount >= 2 && sibActive === sibCount && !forced[stepIndex]) {
            forced[stepIndex] = true;
            STRATEGIES[0].fn(candidates[0]);
            window.__qcLog.push(usedAlt + '(强制)');
            return;
          }
          stepIndex++;
          continue;
        }
        var target = (candidates.length > 1 && inactive.length < candidates.length) ? inactive[0] : candidates[0];
        var misSelected = siblingSelected(target);
        var clicks = clickCounts[stepIndex] || 0;
        var baseSig = sigBase[stepIndex];
        var curSig = rowSignature(target.parentElement);
        var changedButUnconfirmed = (typeof baseSig === 'string') && baseSig !== '' && curSig !== baseSig && !isActive(target);
        if (clicks >= MAX_CLICKS_PER_STEP || (clicks >= 1 && changedButUnconfirmed)) {
          window.__qcLog.push(usedAlt + '(停手:' + clicks + '次)');
          stepIndex++;
          continue;
        }
        if (clicks === 0) sigBase[stepIndex] = curSig;
        clickCounts[stepIndex] = clicks + 1;
        var strat = STRATEGIES[Math.min(Math.floor(clicks / 3), STRATEGIES.length - 1)];
        strat.fn(target);
        window.__qcLog.push(usedAlt + (misSelected ? '(纠正)' : '') + '[' + strat.name + ']');
        return;
      }
      done = true; stop(false);
    } catch (e) {}
  }
  var timer = null;
  function stop(timeout) { if (timer) { clearInterval(timer); timer = null; } }
  timer = setInterval(attempt, 100);
  attempt();
})();
`;

// 严格守卫页: tab 只在"点击目标即自身"时响应(v2.14.0 能成功、v2.16.0 崩掉的结构)
function buildStrictGuardPage(opts) {
  const o = opts || {};
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
${o.hiddenDup ? '<div style="display:none"><span>商品自选</span></div>' : ''}
<header><div class="nav-item active"><span>全域投放</span></div></header>
<div class="objective-tabs">
  <div class="obj-tab"><span>推直播间</span></div>
  <div class="obj-tab active" data-key="push"><span>推商品</span></div>
</div>
<div class="sub-tabs">
  <div class="sub-tab" data-key="self"><span>商品自选</span></div>
  <div class="sub-tab active"><span>全店托管</span></div>
</div>
<script>
  window.__qcLog = []; window.__clickCount = { nav: 0, push: 0, self: 0, other: 0 };
  function activate(el) { Array.prototype.forEach.call(el.parentElement.children, function(c){ c.classList.remove('active'); }); el.classList.add('active'); }
  var self = document.querySelector('[data-key="self"]');
  self.addEventListener('click', function(e) { if (e.target === e.currentTarget) { window.__clickCount.self++; activate(self); } });
</script>
</body></html>`;
}

// 用户问题现场页: 选中态用内联样式表示(类名识别不出) + 连点第二次会切到隔壁"全店托管"
function buildInlineStyleTogglePage() {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<header><div class="nav-item active"><span>全域投放</span></div></header>
<div class="objective-tabs">
  <div class="obj-tab"><span>推直播间</span></div>
  <div class="obj-tab active" data-key="push"><span>推商品</span></div>
</div>
<div class="sub-tabs">
  <div class="sub-tab" data-key="self"><span>商品自选</span></div>
  <div class="sub-tab" data-key="other"><span>全店托管</span></div>
</div>
<script>
  window.__qcLog = []; window.__clickCount = { nav: 0, push: 0, self: 0, other: 0 };
  var selfTab = document.querySelector('[data-key="self"]');
  var otherTab = document.querySelector('[data-key="other"]');
  var selected = 'other';   // 初始: 全店托管选中(内联样式表示, 无 class)
  function paint() {
    selfTab.style.cssText = selected === 'self' ? 'color:rgb(22,119,255);border-bottom:2px solid rgb(22,119,255)' : 'color:rgb(100,100,100)';
    otherTab.style.cssText = selected === 'other' ? 'color:rgb(22,119,255);border-bottom:2px solid rgb(22,119,255)' : 'color:rgb(100,100,100)';
  }
  paint();
  // 真实站点行为: 点击商品自选=选中它; 若已经在选中状态下再点一次(用户实测的连点), 状态跳去全店托管
  function clickSelf() {
    window.__clickCount.self++;
    if (selected === 'self') { selected = 'other'; } else { selected = 'self'; }
    paint();
  }
  selfTab.addEventListener('click', function(e) { if (e.target === e.currentTarget) clickSelf(); });
  otherTab.addEventListener('click', function() { window.__clickCount.other++; selected = 'other'; paint(); });
  window.__getSelected = function() { return selected; };
</script>
</body></html>`;
}

// 同名文本嵌在隔壁 tab 内部(点它会冒泡到隔壁 tab 处理器)
function buildNestedInOtherTabPage() {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<header><div class="nav-item active"><span>全域投放</span></div></header>
<div class="objective-tabs">
  <div class="obj-tab"><span>推直播间</span></div>
  <div class="obj-tab active" data-key="push"><span>推商品</span></div>
</div>
<div class="sub-tabs">
  <div class="sub-tab" data-key="self"><span>商品自选</span></div>
  <div class="sub-tab" data-key="other">
    <span>全店托管</span>
    <div class="tooltip"><span>商品自选</span></div>
  </div>
</div>
<script>
  window.__qcLog = []; window.__clickCount = { nav: 0, push: 0, self: 0, other: 0 };
  var selfTab = document.querySelector('[data-key="self"]');
  var otherTab = document.querySelector('[data-key="other"]');
  selfTab.addEventListener('click', function() { window.__clickCount.self++; selfTab.classList.add('active'); });
  // 隔壁 tab 的处理器在祖先上: 任何内部节点(含那个假的"商品自选"tooltip)被点都会冒泡到这里
  otherTab.addEventListener('click', function() { window.__clickCount.other++; });
</script>
</body></html>`;
}

function buildDataPage() {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<header><div class="nav-item active"><span>数据</span></div><div class="nav-item"><span>全域投放</span></div></header>
<div class="panel"><span>商品</span></div>
<script>window.__qcLog = []; window.__clickCount = { nav: 0, push: 0, self: 0, other: 0 };</script>
</body></html>`;
}

function buildDelayedSubPage() {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<header><div class="nav-item active"><span>全域投放</span></div></header>
<div class="objective-tabs">
  <div class="obj-tab"><span>推直播间</span></div>
  <div class="obj-tab active" data-key="push"><span>推商品</span></div>
</div>
<div id="subArea"></div>
<script>
  window.__qcLog = []; window.__clickCount = { nav: 0, push: 0, self: 0, other: 0 };
  setTimeout(function() {
    document.getElementById('subArea').innerHTML =
      '<div class="sub-tabs"><div class="sub-tab" data-key="self"><span>商品自选</span></div>' +
      '<div class="sub-tab active"><span>全店托管</span></div></div>';
    var self = document.querySelector('[data-key="self"]');
    self.addEventListener('click', function() { window.__clickCount.self++; self.classList.add('active'); });
    window.__subRendered = true;
  }, 2000);
</script>
</body></html>`;
}

function buildInnerSpanOnlyPage() {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<header><div class="nav-item active"><span>全域投放</span></div></header>
<div class="objective-tabs">
  <div class="obj-tab"><span>推直播间</span></div>
  <div class="obj-tab active" data-key="push"><span>推商品</span></div>
</div>
<div class="sub-tabs">
  <div class="sub-tab" data-key="self"><span>商品自选</span></div>
  <div class="sub-tab active"><span>全店托管</span></div>
</div>
<script>
  window.__qcLog = []; window.__clickCount = { nav: 0, push: 0, self: 0, other: 0 };
  var selfTab = document.querySelector('[data-key="self"]');
  // 处理器只在内层 span 上(外层点击无效)
  var inner = selfTab.querySelector('span');
  inner.addEventListener('click', function(e) { if (e.target === this) { window.__clickCount.self++; selfTab.classList.add('active'); } });
</script>
</body></html>`;
}

// v2.22.0 回归A: 数据页(/data/bidding/site-promotion) —— 页面同样含"千川乘方"字样,
// 且同样有 全域投放/推商品/商品自选 这些元素, 但绝不能动手(旧实现会劫持回投放页)
function buildDataHijackPage() {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="brand">千川乘方</div>
<header>
  <div class="nav-item"><span>全域投放</span></div>
  <div class="nav-item active"><span>数据</span></div>
</header>
<div class="objective-tabs">
  <div class="obj-tab active"><span>推直播间</span></div>
  <div class="obj-tab" data-key="push"><span>推商品</span></div>
</div>
<div class="sub-tabs">
  <div class="sub-tab" data-key="self"><span>商品自选</span></div>
  <div class="sub-tab active"><span>全店托管</span></div>
</div>
<script>
  window.__qcLog = []; window.__clickCount = { nav: 0, push: 0, self: 0, other: 0 };
  document.querySelectorAll('.nav-item, .obj-tab, .sub-tab').forEach(function(el) {
    el.addEventListener('click', function() { window.__clickCount.nav = (window.__clickCount.nav || 0) + 1; });
  });
</script>
</body></html>`;
}

// v2.22.0 回归B: 精确文本命中的是内层包裹元素(oc-space-item), 真正可点的是祖先 .ovui-tabs__tab[role=tab]
function buildNestedWrapperTabPage() {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<header><div class="nav-item active"><span>全域投放</span></div></header>
<div class="objective-tabs">
  <div class="obj-tab"><span>推直播间</span></div>
  <div class="obj-tab active" data-key="push"><span>推商品</span></div>
</div>
<div class="ovui-tabs__nav-list">
  <div class="ovui-tabs__tab" data-key="self" role="tab" aria-selected="false">
    <div class="oc-space-item"><span>商品自选</span></div>
  </div>
  <div class="ovui-tabs__tab" data-key="other" role="tab" aria-selected="true">
    <div class="oc-space-item"><span>全店托管</span></div>
  </div>
</div>
<script>
  window.__qcLog = []; window.__clickCount = { nav: 0, push: 0, self: 0, other: 0 };
  window.__innerWrapperClicked = 0;
  document.querySelectorAll('.oc-space-item').forEach(function(w) {
    w.addEventListener('click', function() { window.__innerWrapperClicked++; });
  });
  // 只有 tab 元素(role=tab)上的处理器才真正切换选中态
  document.querySelectorAll('.ovui-tabs__tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      var isSelf = tab.dataset.key === 'self';
      window.__clickCount[isSelf ? 'self' : 'other']++;
      document.querySelectorAll('.ovui-tabs__tab').forEach(function(t) { t.setAttribute('aria-selected', 'false'); });
      tab.setAttribute('aria-selected', 'true');
    });
  });
</script>
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
      return { log: ['<exception>'], clicks: { nav: -1, push: -1, self: -1, other: -1 } };
    }
    const d = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify({ log: window.__qcLog, clicks: window.__clickCount })`));
    console.log('  记录:', JSON.stringify(d.log), '| 点击数:', JSON.stringify(d.clicks));
    return d;
  }

  // 1: 严格守卫(千川真实结构) → 点到商品自选(初始隔壁全店托管选中, 首击标记为"纠正"属正常)
  const d1 = await run('严格守卫tab', buildStrictGuardPage(), '/uni-prom', 2500);
  assert(d1.clicks.self === 1 && d1.log.length >= 1 && d1.log[0].indexOf('商品自选') !== -1,
    '场景1: 一次点到商品自选(策略:' + d1.log[0] + ')');

  // 2: 隐藏同名副本 → 跳过
  const d2 = await run('隐藏同名副本', buildStrictGuardPage({ hiddenDup: true }), '/uni-prom', 2500);
  assert(d2.clicks.self === 1, '场景2: 跳过隐藏副本点到可见商品自选');

  // 3(核心回归): 选中态用内联样式(类名识别不出) + 连点会跳去隔壁 → 必须点到商品自选且不被跳走
  const d3 = await run('内联样式选中态(用户问题现场)', buildInlineStyleTogglePage(), '/uni-prom', 4000);
  const sel3 = await win.webContents.executeJavaScript('window.__getSelected()');
  console.log('  当前选中:', sel3, '| 商品自选点击次数:', d3.clicks.self, '| 全店托管被点:', d3.clicks.other);
  assert(sel3 === 'self', '场景3: 最终选中 商品自选(没有被连点带去全店托管)');
  assert(d3.clicks.self === 1, '场景3: 商品自选只被点一次(点过即停, 不再无脑连点)');
  assert(d3.clicks.other === 0, '场景3: 全店托管一次都没被点到');

  // 4(核心回归): 同名文本嵌在隔壁 tab 内部 → 该候选被剔除, 不误选隔壁
  const d4 = await run('候选嵌在隔壁tab内', buildNestedInOtherTabPage(), '/uni-prom', 3000);
  assert(d4.clicks.other === 0, '场景4: 未点到嵌在隔壁tab内的同名节点(候选剔除生效)');
  assert(d4.clicks.self >= 1, '场景4: 点的是真正的商品自选tab');

  // 5: 处理器仅在内层 span → 阶梯升级
  const d5 = await run('处理器仅在内层span', buildInnerSpanOnlyPage(), '/uni-prom', 3500);
  assert(d5.clicks.self >= 1, '场景5: 阶梯升级后点到商品自选');
  assert(d5.log.some(l => l.indexOf('叶子') !== -1), '场景5: 日志显示升级到了叶子策略');

  // 6: 子tab延迟渲染
  const d6 = await run('子tab延迟渲染', buildDelayedSubPage(), '/uni-prom', 5000);
  const r6 = await win.webContents.executeJavaScript('!!window.__subRendered');
  assert(r6 && d6.clicks.self >= 1, '场景6: 延迟渲染后仍点到商品自选');

  // 7: 非目标页零点击
  const d7 = await run('非目标页不劫持', buildDataPage(), '/data', 2000);
  assert(d7.log.length === 0, '场景7: 数据页零点击');

  // 8(v2.22.0 回归): 数据页 /data/bidding/site-promotion 含"千川乘方"+同名tab, 仍必须零点击
  const d8 = await run('数据页不劫持(含千川乘方字样)', buildDataHijackPage(), '/data/bidding/site-promotion', 3000);
  console.log('  页面点击总数:', JSON.stringify(d8.clicks));
  assert(d8.log.length === 0, '场景8: 数据页零点击(不再回退文字判定, 不劫持)');
  assert((d8.clicks.nav || 0) === 0 && (d8.clicks.push || 0) === 0 && (d8.clicks.self || 0) === 0, '场景8: 全域投放/推商品/商品自选 均未被点');

  // 9(v2.22.0 回归): 精确文本命中的是内层包裹元素 → 必须点真正的 tab 祖先
  const d9 = await run('内层包裹元素升级到tab', buildNestedWrapperTabPage(), '/uni-prom', 3000);
  const s9 = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify({
    selfSelected: document.querySelector('[data-key="self"]').getAttribute('aria-selected'),
    innerWrapperClicks: window.__innerWrapperClicked
  })`));
  console.log('  点击数:', JSON.stringify(d9.clicks), '| 商品自选tab aria-selected:', s9.selfSelected, '| 内层包裹被点次数:', s9.innerWrapperClicks);
  assert(d9.clicks.self === 1 && s9.selfSelected === 'true', '场景9: 点的是 tab 祖先, 一次即生效');
  assert(d9.clicks.other === 0, '场景9: 没有误点隔壁 tab');

  fs.unlinkSync(tmp);
  console.log(pass ? '\nQIANCHUAN AUTO SETUP v2.22.0 TEST PASS' : '\nTEST FAIL');
  app.exit(pass ? 0 : 1);
});
