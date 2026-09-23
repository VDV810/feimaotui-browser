// 测试: 已删除标记规则墓碑(v2.12.0) —— 删除内置默认规则后重启, 不再被播种复活。
// 复刻 main.js 的 seedDefaultAdRules + tombstoneAdRules 逻辑逐字验证全链路:
// 播种 → 用户删除(记墓碑) → 模拟重启(重载墓碑+再播种) → 被删规则必须保持删除状态。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

app.whenReady().then(async () => {
  const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'fmt-tombstone-'));
  let pass = true;
  const assert = (cond, msg) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + msg); if (!cond) pass = false; };

  // ===== 内置默认规则文件(模拟 assets/default-ad-rules.json) =====
  const seedRules = [
    { selector: 'div.notice-container', domain: 'qianchuan.jinriritemai.com' },
    { selector: '#headlinePoster', domain: 'video.sina.com.cn' }
  ];

  // ===== 复刻 main.js 逻辑 =====
  const tombstoneFile = path.join(dataPath, 'custom-ad-rules-tombstones.json');
  let customAdRules = [];
  let tombstones = new Set();
  const loadTombstones = () => {
    tombstones = fs.existsSync(tombstoneFile) ? new Set(JSON.parse(fs.readFileSync(tombstoneFile, 'utf8'))) : new Set();
  };
  const saveTombstones = () => fs.writeFileSync(tombstoneFile, JSON.stringify([...tombstones]));
  const tombstoneAdRules = (rules) => (rules || []).forEach(r => {
    if (r && r.selector) tombstones.add(r.selector + '|' + String(r.domain || '*').split(':')[0]);
  });
  // 逐字复刻 seedDefaultAdRules(含 v2.12.0 墓碑跳过)
  function seedDefaultAdRules() {
    const existingKeys = new Set(customAdRules.map(r => r.selector + '|' + r.domain));
    let added = 0;
    seedRules.forEach(item => {
      const selector = String(item.selector || '').trim();
      if (!selector) return;
      const domain = String(item.domain || '*').split(':')[0];
      const key = selector + '|' + domain;
      if (existingKeys.has(key) || tombstones.has(key)) return;
      existingKeys.add(key);
      customAdRules.push({ selector, domain, createdAt: Date.now() });
      added++;
    });
    return added;
  }

  // ── 第1次启动: 新人, 2条默认规则全部种入 ──
  const a1 = seedDefaultAdRules();
  assert(a1 === 2 && customAdRules.length === 2, `第1次启动播种 ${a1} 条(期望2)`);

  // ── 用户删除第1条(千川 notice-container) → 记墓碑 ──
  const removed = customAdRules.splice(0, 1);
  tombstoneAdRules(removed);
  saveTombstones();
  assert(tombstones.has('div.notice-container|qianchuan.jinriritemai.com'), '删除后墓碑已记录该键');

  // ── 模拟重启: 全新状态, 重载墓碑, 再播种 ──
  customAdRules = [];
  loadTombstones();
  const a2 = seedDefaultAdRules();
  assert(customAdRules.length === 1 && customAdRules[0].selector === '#headlinePoster',
    `重启后再播种: 仅剩 ${customAdRules.length} 条(${customAdRules.map(r => r.selector).join(',')}) — 被删规则未复活`);
  assert(a2 === 1, `重启播种只加了 ${a2} 条(期望1, 被删规则被墓碑跳过)`);

  // ── 对照: 未删除的另一条规则重启后仍在(播种功能本身不坏) ──
  const a3 = seedDefaultAdRules();
  assert(a3 === 0 && customAdRules.length === 1, '再次启动幂等: 不重复加、不复活已删规则');

  // ── 撤销恢复仍可用: 墓碑不阻止手动恢复 ──
  customAdRules.push(removed[0]);
  loadTombstones();
  const a4 = seedDefaultAdRules();
  assert(customAdRules.length === 2 && a4 === 0, '手动恢复的规则重启后保留(墓碑不误伤恢复的规则)');

  fs.rmSync(dataPath, { recursive: true, force: true });
  console.log(pass ? 'TOMBSTONE TEST PASS (删除的内置规则重启不复活, 播种/恢复功能正常)' : 'TEST FAIL');
  app.exit(pass ? 0 : 1);
});
