// 광고 분석: 매체 비교·일별 추이·퍼널·소재·제품별 손익과 규칙 기반 코멘트
import { num } from './util.mjs';
import { orderContribution } from './analytics.mjs';
import { calc } from '../../public/lib/margin.js';

const KEYS = ['spend', 'impressions', 'clicks', 'purchases', 'revenue', 'landing', 'views', 'carts', 'checkouts'];
const div = (a, b) => (b > 0 && isFinite(a) ? a / b : null);
const won = x => Math.round(x).toLocaleString('ko-KR') + '원';
const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';
const valid = o => o.paid !== false && !o.canceled && !/^[RC]/.test(String(o.status));

export function sum(rows) {
  const t = Object.fromEntries(KEYS.map(k => [k, 0]));
  for (const r of rows) for (const k of KEYS) t[k] += num(r[k]);
  return derive(t);
}
export function derive(t) {
  return {
    ...t,
    ctr: div(t.clicks, t.impressions), cpc: div(t.spend, t.clicks), cpm: t.impressions > 0 ? t.spend / t.impressions * 1000 : null,
    cvr: div(t.purchases, t.clicks), cpa: div(t.spend, t.purchases), roas: div(t.revenue, t.spend), aov: div(t.revenue, t.purchases)
  };
}
const group = (rows, key) => { const m = new Map(); for (const r of rows) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
/** 기간을 반으로 나눠 앞·뒤 비교 (추세) */
function halves(rows, days) {
  const mid = days[Math.floor(days.length / 2)];
  const a = sum(rows.filter(r => r.date < mid)), b = sum(rows.filter(r => r.date >= mid));
  return { first: a, second: b };
}

/* ---------- 개요: 일별 추이·매체 비교·자사몰 매출 대비 ---------- */
export function overview({ days, rows, prevRows, orders, prevOrders, platforms }) {
  const shopBy = new Map(); for (const o of orders) if (valid(o)) shopBy.set(o.date, (shopBy.get(o.date) || 0) + num(o.amount));
  const byDate = group(rows, r => r.date);
  const daily = days.map(d => {
    const t = sum(byDate.get(d) || []);
    const shop = shopBy.get(d) || 0;
    const per = Object.fromEntries(platforms.map(p => [p, sum((byDate.get(d) || []).filter(r => r.platform === p)).spend]));
    return { date: d, spend: t.spend, revenue: t.revenue, roas: t.roas, shop, mer: div(shop, t.spend), ...Object.fromEntries(platforms.map(p => ['spend_' + p, per[p]])) };
  });
  const total = sum(rows), prev = sum(prevRows);
  const shop = orders.filter(valid).reduce((s, o) => s + num(o.amount), 0);
  const prevShop = prevOrders.filter(valid).reduce((s, o) => s + num(o.amount), 0);
  const byPlatform = platforms.map(p => {
    const t = sum(rows.filter(r => r.platform === p)), pv = sum(prevRows.filter(r => r.platform === p));
    return { platform: p, ...t, share: div(t.spend, total.spend), revShare: div(t.revenue, total.revenue), prev: pv };
  }).filter(p => p.spend > 0 || p.prev.spend > 0);
  // 요일별 효율
  const wd = Array.from({ length: 7 }, (_, i) => ({ dow: i, spend: 0, revenue: 0, days: 0 }));
  for (const d of daily) { const w = wd[new Date(d.date + 'T00:00:00Z').getUTCDay()]; w.spend += d.spend; w.revenue += d.revenue; w.days += d.spend > 0 ? 1 : 0; }
  return {
    daily, total, prev, byPlatform,
    shop, prevShop, mer: div(shop, total.spend), prevMer: div(prevShop, prev.spend),
    adShare: div(total.revenue, shop), spendRate: div(total.spend, shop),
    weekday: wd.map(w => ({ ...w, roas: div(w.revenue, w.spend) }))
  };
}

/* ---------- 퍼널 ---------- */
export const STEPS = [
  ['impressions', '노출'], ['clicks', '클릭'], ['landing', '랜딩 도착'], ['views', '상품 조회'], ['carts', '장바구니'], ['checkouts', '결제 시작'], ['purchases', '구매']
];
export function funnel(t) {
  // 뒤 단계가 있는데 0이면 그 매체가 측정하지 않는 단계로 보고 건너뜀
  const steps = STEPS.map(([k, label], i) => {
    const v = num(t[k]);
    const later = STEPS.slice(i + 1).some(([k2]) => num(t[k2]) > 0);
    return { key: k, label, value: v, measured: v > 0 || !later };
  }).filter(s => s.measured);
  steps.forEach((s, i) => { s.rate = i ? div(s.value, steps[i - 1].value) : null; s.fromClick = div(s.value, t.clicks); });
  // 이탈이 가장 큰 단계 (클릭 이후, 기준 대비 비율이 가장 낮은 곳)
  const BENCH = { landing: 0.75, views: 0.8, carts: 0.12, checkouts: 0.5, purchases: 0.55 };
  let weakest = null;
  for (const s of steps) if (BENCH[s.key] && s.rate != null) { const gap = s.rate / BENCH[s.key]; if (!weakest || gap < weakest.gap) weakest = { key: s.key, label: s.label, rate: s.rate, bench: BENCH[s.key], gap }; }
  return { steps, weakest: weakest && weakest.gap < 0.85 ? weakest : null };
}
/** 매체마다 측정하는 단계가 달라(구글은 랜딩·상품 조회 없음) 단계별 전환율은 두 단계를 모두 재는 매체끼리만 계산 */
export function combinedFunnel(rows, platforms) {
  const per = platforms.map(p => funnel(sum(rows.filter(r => r.platform === p)))).filter(f => f.steps.length && f.steps[0].value > 0);
  if (!per.length) return funnel(sum(rows));
  const steps = STEPS.map(([key, label]) => {
    const has = per.map(f => { const i = f.steps.findIndex(s => s.key === key); return i < 0 ? null : { v: f.steps[i].value, prev: i ? f.steps[i - 1].value : null }; }).filter(Boolean);
    if (!has.length) return null;
    const v = has.reduce((t, x) => t + x.v, 0);
    const withPrev = has.filter(x => x.prev != null);
    const pv = withPrev.reduce((t, x) => t + x.prev, 0);
    return { key, label, value: v, measured: true, rate: withPrev.length ? div(withPrev.reduce((t, x) => t + x.v, 0), pv) : null, partial: has.length < per.length };
  }).filter(Boolean);
  const clicks = steps.find(s => s.key === 'clicks')?.value || 0;
  steps.forEach(s => { s.fromClick = div(s.value, clicks); });
  const BENCH = { landing: 0.75, views: 0.8, carts: 0.12, checkouts: 0.5, purchases: 0.55 };
  let weakest = null;
  for (const s of steps) if (BENCH[s.key] && s.rate != null) { const gap = s.rate / BENCH[s.key]; if (!weakest || gap < weakest.gap) weakest = { key: s.key, label: s.label, rate: s.rate, bench: BENCH[s.key], gap }; }
  return { steps, weakest: weakest && weakest.gap < 0.85 ? weakest : null };
}
export function funnelAnalysis(rows, prevRows, platforms) {
  return {
    total: { ...combinedFunnel(rows, platforms), prev: combinedFunnel(prevRows, platforms) },
    byPlatform: platforms.map(p => { const t = sum(rows.filter(r => r.platform === p)); return { platform: p, spend: t.spend, ...funnel(t) }; }).filter(p => p.spend > 0),
    byCampaign: [...group(rows, r => r.platform + ':' + r.campaignId)].map(([key, list]) => {
      const t = sum(list);
      return { key, platform: list[0].platform, name: list[list.length - 1].name, spend: t.spend, ctr: t.ctr, cartRate: t.carts ? div(t.carts, t.clicks) : null, checkoutRate: t.carts ? div(t.checkouts, t.carts) : null, buyRate: t.checkouts ? div(t.purchases, t.checkouts) : null, cvr: t.cvr, ...funnel(t) };
    }).filter(c => c.spend > 0).sort((a, b) => b.spend - a.spend)
  };
}

/* ---------- 코멘트 규칙 ---------- */
/**
 * e: 합계·파생 지표 + { beRoas, dailyBudget, days, trend:{first,second}, frequency, status, kind }
 * avg: 같은 매체 평균 (ctr, cvr, cpc)
 * 반환: [{ level: 'bad'|'warn'|'good'|'info', text, action? }]
 */
export function comments(e, avg = {}) {
  const out = [];
  const add = (level, text, action) => out.push({ level, text, action: action || null });
  const on = e.status !== 'off';
  const minSpend = Math.max(20000, e.beRoas && e.aov ? e.aov / e.beRoas : 30000);
  if (e.spend <= 0) { if (on) add('info', '이 기간에 지출이 없습니다. 예산·게재 상태를 확인하세요.'); return out; }

  // 1) 돈이 새는 곳
  if (e.purchases === 0 && e.spend >= minSpend) add('bad', `구매 없이 ${won(e.spend)}을 썼습니다. ${e.clicks >= 100 ? '클릭은 들어오니 상품 페이지·가격·배송비 쪽을' : '클릭부터 적으니 소재와 타겟을'} 먼저 점검하고, 개선이 없으면 끄는 것을 검토하세요.`, on ? 'pause' : null);
  if (e.beRoas && e.roas != null && e.purchases > 0) {
    const profit = e.revenue / e.beRoas - e.spend;
    if (e.roas < e.beRoas) add('bad', `ROAS ${e.roas.toFixed(2)}배로 손익분기 ${e.beRoas.toFixed(2)}배에 못 미칩니다. 이 기간 광고로 약 ${won(-profit)} 손해로 추정됩니다.`, on ? 'down' : null);
    else if (e.roas < e.beRoas * 1.2) add('warn', `손익분기(${e.beRoas.toFixed(2)}배)를 겨우 넘깁니다(ROAS ${e.roas.toFixed(2)}배). 예산을 늘리기보다 효율 개선이 먼저입니다.`);
    else {
      const capped = e.dailyBudget && e.days ? e.spend >= e.dailyBudget * e.days * 0.9 : false;
      add('good', `손익분기의 ${(e.roas / e.beRoas).toFixed(1)}배로 이익이 나는 광고입니다(추정 이익 ${won(profit)}).${capped ? ' 예산을 거의 다 쓰고 있어 20% 정도 증액을 시험해볼 만합니다.' : ''}`, capped && on ? 'up' : null);
    }
  } else if (!e.beRoas && e.kind === 'campaign' && e.spend > 0) add('info', '연결된 제품이 없어 손익 판정을 못 합니다. 광고 관리에서 제품을 연결하세요.');

  // 2) 클릭까지 (소재·타겟)
  if (e.impressions >= 3000 && e.ctr != null) {
    if (avg.ctr && e.ctr < avg.ctr * 0.6) add('warn', `클릭률 ${pct(e.ctr, 2)}로 같은 매체 평균(${pct(avg.ctr, 2)})보다 크게 낮습니다. 첫 화면(썸네일·첫 3초·헤드라인)을 바꿔보세요.`);
    else if (avg.ctr && e.ctr > avg.ctr * 1.4 && e.clicks >= 50) add('good', `클릭률 ${pct(e.ctr, 2)}로 평균보다 높습니다. 이 소재의 메시지를 다른 광고에도 활용해보세요.`);
  }
  // 3) 피로도: 빈도 높고 뒤 기간 클릭률 하락
  const tr = e.trend;
  if (tr && tr.first.impressions >= 1500 && tr.second.impressions >= 1500 && tr.first.ctr && tr.second.ctr) {
    const drop = 1 - tr.second.ctr / tr.first.ctr;
    if (drop >= 0.25) add(e.frequency >= 3 ? 'bad' : 'warn', `기간 후반 클릭률이 ${pct(drop, 0)} 떨어졌습니다(${pct(tr.first.ctr, 2)} → ${pct(tr.second.ctr, 2)}).${e.frequency ? ` 1인당 평균 ${e.frequency.toFixed(1)}회 노출돼` : ''} 소재 피로도가 의심됩니다. 새 소재로 교체하세요.`);
  } else if (e.frequency >= 4) add('warn', `1인당 평균 ${e.frequency.toFixed(1)}회 노출됐습니다. 같은 사람에게 너무 자주 보이고 있어 타겟 확장이나 소재 교체가 필요합니다.`);
  if (tr && tr.first.spend > 0 && tr.second.spend > 0 && tr.first.roas && tr.second.roas != null && tr.first.purchases >= 3) {
    const ch = tr.second.roas / tr.first.roas - 1;
    if (ch <= -0.3) add('warn', `기간 후반 ROAS가 ${pct(-ch, 0)} 낮아졌습니다(${tr.first.roas.toFixed(2)} → ${tr.second.roas.toFixed(2)}배).`);
    else if (ch >= 0.3) add('good', `기간 후반 ROAS가 ${pct(ch, 0)} 좋아졌습니다(${tr.first.roas.toFixed(2)} → ${tr.second.roas.toFixed(2)}배).`);
  }
  // 4) 클릭 이후 (상세 페이지·결제)
  if (e.clicks >= 200 && e.cvr != null && avg.cvr && e.cvr < avg.cvr * 0.5) add('warn', `클릭 대비 구매율 ${pct(e.cvr, 2)}로 평균(${pct(avg.cvr, 2)})의 절반 이하입니다. 광고 내용과 도착 페이지가 맞는지 확인하세요.`);
  if (e.carts >= 10 && e.purchases / e.carts < 0.25) add('warn', `장바구니 ${Math.round(e.carts)}건 중 구매는 ${Math.round(e.purchases)}건(${pct(e.purchases / e.carts, 0)})입니다. 배송비·최소 주문금액·결제 단계 이탈을 점검하세요.`);
  if (e.cpc != null && avg.cpc && e.cpc > avg.cpc * 1.8 && e.clicks >= 30) add('info', `클릭당 비용 ${won(e.cpc)}로 평균(${won(avg.cpc)})보다 비쌉니다. 타겟이 너무 좁거나 경쟁이 심한 구간일 수 있습니다.`);
  return out;
}
const RANK = { bad: 0, warn: 1, good: 2, info: 3 };
export const sortComments = list => [...list].sort((a, b) => RANK[a.level] - RANK[b.level]);

/* ---------- 캠페인 ---------- */
export function campaignAnalysis(summary, rows, days) {
  const byKey = group(rows, r => r.platform + ':' + r.campaignId);
  const avgBy = platformAverages(rows);
  return summary.filter(c => c.spend > 0 || c.status === 'on').map(c => {
    const list = byKey.get(c.key) || [];
    const t = sum(list);
    const trend = halves(list, days);
    const daily = days.map(d => { const x = sum(list.filter(r => r.date === d)); return { date: d, spend: x.spend, roas: x.roas }; });
    const e = { ...t, beRoas: c.beRoas, dailyBudget: c.dailyBudget, days: days.length, trend, status: c.status, kind: 'campaign' };
    return { ...c, ...t, trend, daily, comments: sortComments(comments(e, avgBy[c.platform] || {})) };
  });
}
function platformAverages(rows) {
  return Object.fromEntries([...group(rows, r => r.platform)].map(([p, list]) => [p, sum(list)]));
}

/* ---------- 소재 ---------- */
export function creativeAnalysis(crRows, info, reach, campaignList, days) {
  const beBy = new Map(campaignList.map(c => [c.key, c]));
  const avgBy = platformAverages(crRows);
  const list = [...group(crRows, r => r.platform + ':' + r.adId)].map(([key, rs]) => {
    const t = sum(rs);
    const last = rs[rs.length - 1];
    const camp = beBy.get(last.platform + ':' + last.campaignId);
    const meta = info[key] || {};
    const freq = reach[key]?.frequency || null;
    const trend = halves(rs, days);
    const ctrDaily = days.map(d => { const x = sum(rs.filter(r => r.date === d)); return x.impressions ? x.ctr : null; });
    const e = { ...t, beRoas: camp?.beRoas || null, trend, frequency: freq, status: meta.status || 'on', kind: 'creative' };
    return {
      key, platform: last.platform, adId: last.adId, name: last.name, group: last.group, campaignName: last.campaignName, campaignKey: last.platform + ':' + last.campaignId,
      status: meta.status || null, thumb: meta.thumb || null, format: meta.format || '기타', text: meta.text || '', frequency: freq,
      ...t, beRoas: camp?.beRoas || null, trend, ctrDaily, comments: sortComments(comments(e, avgBy[last.platform] || {}))
    };
  }).filter(c => c.spend > 0).sort((a, b) => b.spend - a.spend);
  const formats = [...group(list, c => c.format)].map(([format, cs]) => ({ format, count: cs.length, ...sum(cs) })).sort((a, b) => b.spend - a.spend);
  // 광고비 대비 효율 순위 (구매 3건 이상만)
  const ranked = list.filter(c => c.purchases >= 3 && c.roas != null).sort((a, b) => b.roas - a.roas);
  return { list, formats, best: ranked.slice(0, 3).map(c => c.key), worst: ranked.slice(-3).reverse().filter(c => ranked.length > 3).map(c => c.key) };
}

/* ---------- 제품별 광고 손익 ---------- */
export function productPL({ products, idx, orders, campaigns }) {
  const rowsBy = new Map(products.map(p => [p.id, { id: p.id, name: p.name, beRoas: calc(p).ok ? calc(p).beRoas : null, linkedNos: (p.cafe24ProductNos || []).length, shopRevenue: 0, units: 0, contribution: 0, contributionKnown: true, adSpend: 0, adRevenue: 0, purchases: 0, campaigns: [] }]));
  for (const o of orders) {
    if (!valid(o)) continue;
    const c = orderContribution(o, idx);
    const total = o.items.reduce((s, i) => s + num(i.price) * num(i.qty), 0) || 1;
    for (const it of o.items) {
      const h = idx.get(Number(it.productNo)); if (!h) continue;
      const r = rowsBy.get(h.p.id); if (!r) continue;
      const share = num(it.price) * num(it.qty) / total;
      r.shopRevenue += num(o.amount) * share; r.units += num(it.qty);
      if (c.contribution == null) r.contributionKnown = false; else r.contribution += c.contribution * share;
    }
  }
  let unlinked = { spend: 0, revenue: 0, count: 0 };
  for (const c of campaigns) {
    if (!c.spend) continue;
    const r = c.productId ? rowsBy.get(c.productId) : null;
    if (!r) { unlinked.spend += c.spend; unlinked.revenue += c.revenue; unlinked.count++; continue; }
    r.adSpend += c.spend; r.adRevenue += c.revenue; r.purchases += c.purchases; r.campaigns.push({ key: c.key, name: c.name, platform: c.platform, spend: c.spend, roas: c.roas });
  }
  const list = [...rowsBy.values()].map(r => {
    const profit = r.contributionKnown && r.shopRevenue > 0 ? r.contribution - r.adSpend : null;
    const roas = div(r.adRevenue, r.adSpend);
    const notes = [];
    if (!r.linkedNos) notes.push({ level: 'info', text: '카페24 상품과 연결되지 않아 자사몰 매출을 못 셉니다. 상품·재고에서 원가를 연결하세요.' });
    if (profit != null && profit < 0) notes.push({ level: 'bad', text: `광고비를 빼면 ${won(-profit)} 적자입니다. 광고비 비중(${pct(r.adSpend / r.shopRevenue, 0)})을 낮추거나 판매가·원가를 점검하세요.` });
    else if (profit != null && r.adSpend > 0 && roas != null && r.beRoas && roas >= r.beRoas * 1.3) notes.push({ level: 'good', text: `광고 효율이 손익분기의 ${(roas / r.beRoas).toFixed(1)}배로 여유가 있습니다. 예산 확대 후보입니다.` });
    else if (r.adSpend > 0 && roas != null && r.beRoas && roas < r.beRoas) notes.push({ level: 'warn', text: `연결된 광고의 ROAS ${roas.toFixed(2)}배가 손익분기(${r.beRoas.toFixed(2)}배)보다 낮습니다. ${profit != null && profit > 0 ? '제품 전체 이익은 광고 외 판매 덕분이라, 이 광고는 줄이거나 소재를 바꿔보세요.' : '광고를 줄이거나 소재를 바꿔보세요.'}` });
    if (r.adSpend > 0 && r.purchases === 0) notes.push({ level: 'bad', text: '광고비를 썼지만 매체가 잡은 구매가 없습니다.' });
    if (r.adSpend === 0 && r.shopRevenue > 0) notes.push({ level: 'info', text: '연결된 광고가 없습니다. 자연 판매만으로 나온 매출입니다.' });
    return { ...r, profit, roas, adRate: div(r.adSpend, r.shopRevenue), margin: r.contributionKnown ? div(r.contribution, r.shopRevenue) : null, notes };
  }).sort((a, b) => b.shopRevenue + b.adSpend - (a.shopRevenue + a.adSpend));
  return { list, unlinked };
}

/* ---------- 종합 코멘트 (규칙) ---------- */
export function headline(ov, camps, creatives, fun) {
  const out = [];
  const T = ov.total, P = ov.prev;
  if (T.spend > 0 && P.spend > 0 && T.roas != null && P.roas) {
    const ch = T.roas / P.roas - 1;
    out.push({ level: ch >= 0 ? 'good' : 'warn', text: `전체 ROAS ${T.roas.toFixed(2)}배로 이전 기간(${P.roas.toFixed(2)}배)보다 ${ch >= 0 ? '좋아졌습니다' : '나빠졌습니다'}(${ch >= 0 ? '+' : ''}${pct(ch, 0)}). 광고비는 ${won(T.spend)}(${T.spend >= P.spend ? '+' : ''}${pct(T.spend / P.spend - 1, 0)}).` });
  }
  if (ov.mer != null) out.push({ level: 'info', text: `자사몰 전체 매출은 광고비의 ${ov.mer.toFixed(1)}배(광고비 비중 ${pct(ov.spendRate, 1)})입니다. 매체가 보고한 광고 매출은 자사몰 매출의 ${pct(ov.adShare || 0, 0)}에 해당합니다.` });
  const plats = ov.byPlatform.filter(p => p.spend > 0 && p.roas != null);
  if (plats.length >= 2) {
    const s = [...plats].sort((a, b) => b.roas - a.roas);
    out.push({ level: 'info', text: `매체별로는 ${s.map(p => `${PLAT_NAME[p.platform] || p.platform} ${p.roas.toFixed(2)}배`).join(', ')} 순으로 효율이 좋습니다.` });
  }
  const bad = camps.filter(c => c.status === 'on' && c.comments.some(x => x.level === 'bad'));
  if (bad.length) out.push({ level: 'bad', text: `손해가 나거나 구매 없이 돈을 쓰는 켜진 캠페인이 ${bad.length}개 있습니다: ${bad.slice(0, 3).map(c => c.name).join(', ')}${bad.length > 3 ? ' 외' : ''}.` });
  const tired = creatives.list.filter(c => c.comments.some(x => /피로도|너무 자주/.test(x.text)));
  if (tired.length) out.push({ level: 'warn', text: `교체가 필요해 보이는 소재 ${tired.length}개: ${tired.slice(0, 3).map(c => c.name).join(', ')}.` });
  if (fun.total.weakest) out.push({ level: 'warn', text: `퍼널에서 가장 약한 구간은 '${fun.total.weakest.label}' 단계입니다(전환 ${pct(fun.total.weakest.rate, 0)}, 참고 기준 ${pct(fun.total.weakest.bench, 0)}).` });
  return out;
}
const PLAT_NAME = { meta: '메타', google: '구글', tiktok: '틱톡' };

/** AI 종합 코멘트에 넘길 요약 (개인정보 없음, 숫자만) */
export function aiBrief({ from, to, ov, camps, creatives, fun, pl }) {
  const r = x => (x == null ? null : Math.round(x * 100) / 100);
  return {
    기간: `${from}~${to}`,
    전체: { 광고비: Math.round(ov.total.spend), 광고매출: Math.round(ov.total.revenue), ROAS: r(ov.total.roas), 이전ROAS: r(ov.prev.roas), 자사몰매출: Math.round(ov.shop), 광고비비중: r(ov.spendRate) },
    매체: ov.byPlatform.map(p => ({ 매체: PLAT_NAME[p.platform], 광고비: Math.round(p.spend), ROAS: r(p.roas), CTR: r(p.ctr), CPA: p.cpa && Math.round(p.cpa) })),
    캠페인: camps.slice(0, 12).map(c => ({ 이름: c.name, 매체: PLAT_NAME[c.platform], 상태: c.status, 광고비: Math.round(c.spend), ROAS: r(c.roas), 손익분기ROAS: r(c.beRoas), 구매: c.purchases, CTR: r(c.ctr) })),
    소재: creatives.list.slice(0, 15).map(c => ({ 이름: c.name, 형식: c.format, 광고비: Math.round(c.spend), ROAS: r(c.roas), CTR: r(c.ctr), 빈도: r(c.frequency), 후반CTR변화: c.trend.first.ctr && c.trend.second.ctr ? r(c.trend.second.ctr / c.trend.first.ctr - 1) : null })),
    퍼널: fun.total.steps.map(s => ({ 단계: s.label, 수: Math.round(s.value), 전단계대비: r(s.rate) })),
    제품: pl.list.filter(p => p.shopRevenue || p.adSpend).map(p => ({ 제품: p.name, 자사몰매출: Math.round(p.shopRevenue), 광고비: Math.round(p.adSpend), 광고후이익: p.profit == null ? null : Math.round(p.profit), 손익분기ROAS: r(p.beRoas) }))
  };
}
