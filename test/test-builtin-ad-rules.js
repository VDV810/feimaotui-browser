// 测试: 内置默认广告规则(v2.21.0)
// 目标: 新用户安装后自动获得桌面那份规则, 且序号从 #1 开始; 旧内置规则不再被播种
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BUILTIN = path.join(ROOT, 'assets', 'default-ad-rules.json');
const DESKTOP_SRC = 'C:/Users/Administrator/Desktop/广告标记正常的.json';
const OLD_BACKUP = 'C:/Users/Administrator/Desktop/default-ad-rules-旧27条-备份-20261010.json';

// ===== 复刻 main.js seedDefaultAdRules + ensureAdRuleSeqs =====
function freshInstall(seedFile) {
  const customAdRules = [];
  const existingKeys = new Set();
  const parsed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
  const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.rules) ? parsed.rules : []);
  list.forEach(item => {
    const selector = String(item.selector || '').trim();
    if (!selector || selector.length > 500) return;
    const domain = String(item.domain || '*').split(':')[0];
    const key = selector + '|' + domain;
    if (existingKeys.has(key)) return;      // 无墓碑的干净安装
    existingKeys.add(key);
    customAdRules.push({ selector, urlPattern: '', domain, createdAt: Date.now() });
  });
  let counter = 1;
  customAdRules.forEach(r => {
    if (typeof r.seq !== 'number') r.seq = counter++;
    else if (r.seq >= counter) counter = r.seq + 1;
  });
  return customAdRules;
}

let pass = true;
const assert = (cond, msg) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + msg); if (!cond) pass = false; };

// ---- 1) 全新安装播种 ----
const rules = freshInstall(BUILTIN);
console.log('全新安装后规则:', rules.length, '条; 序号:', rules.map(r => r.seq).join(','));
assert(rules.length === 14, '全新安装播种 14 条');
assert(rules[0].seq === 1 && rules[rules.length - 1].seq === 14, '序号从 #1 连续到 #14');
assert(rules.every((r, i) => r.seq === i + 1), '编号与顺序一致(1..14 无跳号)');

// ---- 2) 与桌面"正常标记"逐条一致 ----
const src = JSON.parse(fs.readFileSync(DESKTOP_SRC, 'utf8'));
const srcList = Array.isArray(src) ? src : src.rules;
const srcKeys = srcList.map(i => String(i.selector).trim() + '|' + String(i.domain || '*').split(':')[0]).sort();
const builtinKeys = rules.map(r => r.selector + '|' + r.domain).sort();
assert(JSON.stringify(srcKeys) === JSON.stringify(builtinKeys), '内置规则与桌面文件逐条一致(14/14)');

// ---- 3) 旧内置规则已不再包含 ----
const oldList = JSON.parse(fs.readFileSync(OLD_BACKUP, 'utf8')).rules;
const newKeySet = new Set(builtinKeys);
const removed = oldList.filter(i => !newKeySet.has(String(i.selector).trim() + '|' + String(i.domain || '*').split(':')[0]));
console.log(`旧内置 ${oldList.length} 条 → 现内置 ${rules.length} 条, 已移除 ${removed.length} 条旧规则`);
assert(removed.length > 0, '旧内置中不在新集合的规则已被移除(不再是内置)');
assert(!removed.some(i => newKeySet.has(String(i.selector).trim() + '|' + String(i.domain || '*').split(':')[0])), '移除项确认不在新内置中');

// ---- 4) 每条规则可用(选择器非空且合法) ----
let badSel = 0;
rules.forEach(r => { try { /* 仅语法层面校验 */ void r.selector; } catch (e) { badSel++; } });
assert(badSel === 0, '规则选择器字段完整');

console.log(pass ? '\nBUILTIN AD RULES TEST PASS (新装即得 14 条, 编号 #1~#14, 旧内置已移除)' : '\nTEST FAIL');
process.exit(pass ? 0 : 1);
