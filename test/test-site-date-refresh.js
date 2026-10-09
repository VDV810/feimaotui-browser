// 测试: 站点日期参数刷新(v2.17.0) —— 腾讯广告 start_date/end_date + 千川 dr
// 复刻 main.js refreshAdqqDateParam / refreshQianchuanDateParam 逻辑逐字验证
const { app } = require('electron');

function fmtToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// ===== 复刻 refreshAdqqDateParam =====
function refreshAdqqDateParam(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)ad\.qq\.com$/i.test(u.hostname)) return url;
    if (!/^\/atlas\//i.test(u.pathname)) return url;
    const today = fmtToday();
    const s = u.searchParams.get('start_date');
    const e = u.searchParams.get('end_date');
    if (s === today && e === today) return url;
    u.searchParams.set('start_date', today);
    u.searchParams.set('end_date', today);
    return u.toString();
  } catch (e) { return url; }
}

// ===== 复刻 refreshQianchuanDateParam =====
function refreshQianchuanDateParam(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'qianchuan.jinritemai.com') return url;
    const dr = u.searchParams.get('dr');
    if (!dr || !/^\d{4}-\d{2}-\d{2},\d{4}-\d{2}-\d{2}$/.test(dr)) return url;
    const today = fmtToday();
    if (dr === `${today},${today}`) return url;
    u.searchParams.set('dr', `${today},${today}`);
    return u.toString();
  } catch (e) { return url; }
}

function refreshSiteDateParams(url) {
  return refreshAdqqDateParam(refreshQianchuanDateParam(url));
}

app.whenReady().then(() => {
  let pass = true;
  const assert = (cond, msg) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + msg); if (!cond) pass = false; };
  const T = fmtToday();

  // 用户真实书签 URL(不含日期)
  const bookmark = 'https://ad.qq.com/atlas/75215572/admanage/index?type=smart_delivery_display&tab=adgroup&query=%7B%22operation_status%22%3A%5B%22CALCULATE_STATUS_EXCLUDE_DEL%22%5D%7D';
  const r1 = refreshSiteDateParams(bookmark);
  const u1 = new URL(r1);
  assert(u1.searchParams.get('start_date') === T && u1.searchParams.get('end_date') === T,
    `书签(无日期) → 自动补今天 ${T}`);
  assert(u1.searchParams.get('type') === 'smart_delivery_display' && u1.searchParams.get('tab') === 'adgroup'
    && u1.searchParams.get('query') !== null,
    '书签其他参数完整保留(type/tab/query 未丢失)');

  // 已有旧日期 → 替换为今天
  const oldDate = 'https://ad.qq.com/atlas/75215572/admanage/index?start_date=2026-09-08&end_date=2026-10-05';
  const u2 = new URL(refreshSiteDateParams(oldDate));
  assert(u2.searchParams.get('start_date') === T && u2.searchParams.get('end_date') === T,
    '已有旧日期(2026-09-08~2026-10-05) → 替换为今天');

  // 已是今天 → 原样返回(幂等, 不产生无意义改写)
  const todayUrl = `https://ad.qq.com/atlas/75215572/admanage/index?start_date=${T}&end_date=${T}`;
  assert(refreshSiteDateParams(todayUrl) === todayUrl, '已是今天 → 原样返回(幂等)');

  // 非腾讯广告域名 → 不动
  const other = 'https://www.example.com/atlas/1/admanage/index';
  assert(refreshSiteDateParams(other) === other, '非 ad.qq.com 域名 → 不修改');

  // 腾讯广告非后台路径 → 不动
  const otherPath = 'https://ad.qq.com/help/center?start_date=2020-01-01';
  assert(refreshSiteDateParams(otherPath) === otherPath, '非 /atlas/ 后台路径 → 不修改');

  // 千川回归: dr 仍能刷新
  const qc = 'https://qianchuan.jinritemai.com/uni-prom?aavid=1&dr=2026-09-01,2026-09-30';
  const u3 = new URL(refreshSiteDateParams(qc));
  assert(u3.searchParams.get('dr') === `${T},${T}`, '千川 dr 旧区间 → 刷新为今天(回归正常)');

  // 千川已是今天 → 原样
  const qc2 = `https://qianchuan.jinritemai.com/uni-prom?dr=${T},${T}`;
  assert(refreshSiteDateParams(qc2) === qc2, '千川已是今天 → 原样返回');

  console.log(pass ? '\nSITE DATE REFRESH TEST PASS (腾讯广告自动今天 + 千川回归)' : '\nTEST FAIL');
  app.exit(pass ? 0 : 1);
});
