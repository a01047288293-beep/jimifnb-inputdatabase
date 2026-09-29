// 운영 분석 (순수 함수): 매출·상품·고객·출고
import { num } from './util.mjs';

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const valid = o => o.paid !== false && !o.canceled && !/^[RC]/.test(String(o.status));
const H = 3600000;

/** 결제 시각의 한국시간 [요일, 시] */
export function kstParts(o) {
  const t = String(o.time || '');
  if (/\+09:?00$/.test(t) || /^\d{4}-\d{2}-\d{2}[ T]\d{2}/.test(t) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(t)) {
    const d = new Date(t.slice(0, 10) + 'T00:00:00Z').getUTCDay();
    return [d, Number(t.slice(11, 13)) || 0];
  }
  const ms = Date.parse(t);
  if (!Number.isFinite(ms)) return [new Date(o.date + 'T00:00:00Z').getUTCDay(), 0];
  const k = new Date(ms + 9 * H);
  return [k.getUTCDay(), k.getUTCHours()];
}
function units(o) { return o.items.reduce((s, i) => s + num(i.qty), 0); }

export function summary(orders) {
  const v = orders.filter(valid);
  const revenue = v.reduce((s, o) => s + num(o.amount), 0);
  const members = new Set(v.filter(o => o.member).map(o => o.member)).size;
  return {
    revenue, orders: v.length, aov: v.length ? revenue / v.length : null, units: v.reduce((s, o) => s + units(o), 0),
    buyers: members + v.filter(o => !o.member).length
  };
}
function groupShare(list, keyFn, total) {
  const m = new Map();
  for (const o of list) {
    const k = keyFn(o) || '기타';
    const g = m.get(k) || { name: k, orders: 0, revenue: 0 };
    g.orders += 1; g.revenue += num(o.amount); m.set(k, g);
  }
  return [...m.values()].map(g => ({ ...g, share: total ? g.revenue / total : 0 })).sort((a, b) => b.revenue - a.revenue);
}

/* ---------- 매출 ---------- */
export function salesInsights(orders, prevOrders, lyOrders, days) {
  const v = orders.filter(valid);
  const cur = summary(orders);
  const daily = new Map(days.map(d => [d, { date: d, revenue: 0, orders: 0 }]));
  const weekday = WEEKDAYS.map((n, i) => ({ day: i, name: n, revenue: 0, orders: 0, days: 0 }));
  for (const d of days) weekday[new Date(d + 'T00:00:00Z').getUTCDay()].days += 1;
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, revenue: 0, orders: 0 }));
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const o of v) {
    const dd = daily.get(o.date); if (dd) { dd.revenue += num(o.amount); dd.orders += 1; }
    const [wd, h] = kstParts(o);
    weekday[wd].revenue += num(o.amount); weekday[wd].orders += 1;
    hours[h].revenue += num(o.amount); hours[h].orders += 1;
    heat[wd][h] += 1;
  }
  return {
    summary: cur,
    prev: prevOrders ? summary(prevOrders) : null,
    lastYear: lyOrders && lyOrders.length ? summary(lyOrders) : null,
    daily: [...daily.values()].map(d => ({ ...d, aov: d.orders ? d.revenue / d.orders : null })),
    // 요일 평균: 기간 안에 그 요일이 몇 번 있었는지로 나눔
    weekday: weekday.map(w => ({ ...w, avgRevenue: w.days ? w.revenue / w.days : 0 })),
    hours, heat,
    payments: groupShare(v, o => o.payment, cur.revenue),
    channels: groupShare(v, o => o.channel, cur.revenue),
    canceled: orders.filter(o => !valid(o)).length
  };
}

/* ---------- 상품·재고 ---------- */
function productRows(orders) {
  const m = new Map();
  for (const o of orders.filter(valid)) {
    const itemsTotal = o.items.reduce((s, i) => s + num(i.price) * num(i.qty), 0) || 1;
    for (const it of o.items) {
      const k = Number(it.productNo);
      const r = m.get(k) || { productNo: k, name: it.name, qty: 0, revenue: 0, orders: 0, byDay: {}, options: {} };
      const rev = num(o.amount) * num(it.price) * num(it.qty) / itemsTotal;
      r.qty += num(it.qty); r.revenue += rev; r.orders += 1;
      r.byDay[o.date] = (r.byDay[o.date] || 0) + num(it.qty);
      const ok = it.option || '기본';
      const op = r.options[ok] || { option: ok, qty: 0, revenue: 0 };
      op.qty += num(it.qty); op.revenue += rev; r.options[ok] = op;
      m.set(k, r);
    }
  }
  return m;
}
export function productInsights(orders, prevOrders, inventory, days, costIdx) {
  const cur = productRows(orders), prev = productRows(prevOrders || []);
  const total = [...cur.values()].reduce((s, r) => s + r.revenue, 0);
  const prevRank = new Map([...prev.values()].sort((a, b) => b.revenue - a.revenue).map((r, i) => [r.productNo, i + 1]));
  const rows = [...cur.values()].sort((a, b) => b.revenue - a.revenue).map((r, i) => {
    const p = prev.get(r.productNo);
    const cost = costIdx?.get(r.productNo);
    return {
      productNo: r.productNo, name: r.name, qty: r.qty, revenue: r.revenue, orders: r.orders, share: total ? r.revenue / total : 0,
      rank: i + 1, prevRank: prevRank.get(r.productNo) || null,
      prevQty: p ? p.qty : 0, growth: p && p.revenue ? r.revenue / p.revenue - 1 : null,
      spark: days.map(d => r.byDay[d] || 0),
      options: Object.values(r.options).sort((a, b) => b.qty - a.qty),
      linked: cost ? { id: cost.p.id, name: cost.p.name } : null, unitCost: cost ? cost.unitCost : null,
      costRate: cost && cost.unitCost != null && r.revenue > 0 ? cost.unitCost * r.qty / (r.revenue / 1.1) : null
    };
  });
  // 재고: 최근 14일(기간 끝 기준) 하루 평균 판매로 며칠 버티는지
  const recentDays = new Set(days.slice(-14));
  // 주문의 옵션 표기("맛=매운맛, 중량=500g")와 재고의 옵션 표기("매운맛 / 500g")가 달라서 같은 모양으로 맞춘 뒤 비교. 품목코드가 있으면 그것을 우선
  const normOpt = s => String(s || '').split(/[,/|]/).map(x => x.replace(/^[^=]*=/, '').trim()).filter(Boolean).join('/');
  const sold = new Map();
  for (const o of orders.filter(valid)) if (recentDays.has(o.date)) for (const it of o.items) {
    const q = num(it.qty);
    if (it.variant) sold.set('v|' + it.variant, (sold.get('v|' + it.variant) || 0) + q);
    const k = it.productNo + '|' + normOpt(it.option);
    sold.set(k, (sold.get(k) || 0) + q);
    sold.set(it.productNo + '|*', (sold.get(it.productNo + '|*') || 0) + q);
  }
  const span = Math.max(1, recentDays.size);
  const stock = (inventory || []).map(v => {
    const byVariant = v.variant ? sold.get('v|' + v.variant) : undefined;
    const byOption = sold.get(v.productNo + '|' + normOpt(v.option));
    const perDay = (byVariant ?? byOption ?? (v.option ? 0 : sold.get(v.productNo + '|*') || 0)) / span;
    const cover = v.quantity != null && perDay > 0 ? v.quantity / perDay : null;
    const soldAny = (sold.get(v.productNo + '|*') || 0) > 0;
    let level = 'ok', note = '';
    if (v.soldOut || (v.tracked && v.quantity === 0)) { level = soldAny ? 'critical' : 'warn'; note = soldAny ? '최근 팔리던 품목 품절' : '품절'; }
    else if (v.tracked && v.quantity != null && v.quantity <= v.safety) { level = 'warn'; note = `안전재고 ${v.safety}개 이하`; }
    else if (cover != null && cover < 7) { level = 'warn'; note = `약 ${Math.max(1, Math.floor(cover))}일분 남음`; }
    return { ...v, perDay, cover, level, note };
  }).sort((a, b) => ({ critical: 0, warn: 1, ok: 2 }[a.level] - { critical: 0, warn: 1, ok: 2 }[b.level]) || (a.cover ?? 1e9) - (b.cover ?? 1e9));
  return { products: rows, total, stock, alerts: stock.filter(s => s.level !== 'ok').length };
}

/* ---------- 고객 ---------- */
export function customerInsights(periodOrders, historyOrders, from) {
  const v = periodOrders.filter(valid);
  const hist = historyOrders.filter(valid);
  const byMember = new Map();
  for (const o of hist) if (o.member) {
    const m = byMember.get(o.member) || { key: o.member, orders: 0, revenue: 0, first: o.date, last: o.date, buyer: o.buyer, dates: [], regions: {} };
    m.orders += 1; m.revenue += num(o.amount);
    if (o.date < m.first) m.first = o.date;
    if (o.date >= m.last) { m.last = o.date; m.buyer = o.buyer; }
    m.dates.push(o.date); m.regions[o.region] = (m.regions[o.region] || 0) + 1;
    byMember.set(o.member, m);
  }
  let newC = 0, retC = 0, newRev = 0, retRev = 0, guest = 0, guestRev = 0;
  const seen = new Set();
  for (const o of [...v].sort((a, b) => (a.time < b.time ? -1 : 1))) {
    if (!o.member) { guest += 1; guestRev += num(o.amount); continue; }
    let isNew = o.firstOrder;
    if (isNew == null) { const m = byMember.get(o.member); isNew = m ? m.first >= from && !seen.has(o.member) : true; }
    seen.add(o.member);
    if (isNew) { newC += 1; newRev += num(o.amount); } else { retC += 1; retRev += num(o.amount); }
  }
  const periodMembers = new Set(v.filter(o => o.member).map(o => o.member));
  const repeaters = [...periodMembers].filter(k => (byMember.get(k)?.orders || 0) >= 2).length;
  const intervals = [];
  for (const m of byMember.values()) if (m.orders >= 2) {
    const ds = [...new Set(m.dates)].sort();
    for (let i = 1; i < ds.length; i++) intervals.push((Date.parse(ds[i]) - Date.parse(ds[i - 1])) / 86400000);
  }
  intervals.sort((a, b) => a - b);
  const total = v.reduce((s, o) => s + num(o.amount), 0);
  const regions = groupShare(v, o => o.region, total);
  const top = [...byMember.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 20).map(m => ({
    buyer: m.buyer, orders: m.orders, revenue: m.revenue, first: m.first, last: m.last,
    region: Object.entries(m.regions).sort((a, b) => b[1] - a[1])[0]?.[0] || '미상',
    avgGap: m.orders >= 2 ? (Date.parse(m.last) - Date.parse(m.first)) / 86400000 / (m.orders - 1) : null
  }));
  // 구매 횟수 분포 (365일)
  const freq = [1, 2, 3, 4, 5].map(n => ({ label: n === 5 ? '5회 이상' : `${n}회`, members: [...byMember.values()].filter(m => n === 5 ? m.orders >= 5 : m.orders === n).length }));
  return {
    orders: v.length, members: periodMembers.size,
    newOrders: newC, returningOrders: retC, newRevenue: newRev, returningRevenue: retRev, guestOrders: guest, guestRevenue: guestRev,
    repeatRate: periodMembers.size ? repeaters / periodMembers.size : null,
    medianGap: intervals.length ? intervals[Math.floor(intervals.length / 2)] : null,
    regions, top, freq, historyMembers: byMember.size
  };
}

/* ---------- 주문·출고 ---------- */
function pctl(arr, p) { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
export function fulfillmentInsights(orders, { now = Date.now(), slaHours = 48, days = [] } = {}) {
  const leads = [], deliver = [];
  const daily = new Map(days.map(d => [d, []]));
  for (const o of orders) {
    const paid = Date.parse(o.time);
    const shipped = o.items.map(i => Date.parse(i.shippedAt)).filter(Number.isFinite).sort((a, b) => a - b)[0];
    const delivered = o.items.map(i => Date.parse(i.deliveredAt)).filter(Number.isFinite).sort((a, b) => a - b)[0];
    if (Number.isFinite(paid) && Number.isFinite(shipped) && shipped >= paid) {
      const h = (shipped - paid) / H; leads.push(h); daily.get(o.date)?.push(h);
      if (Number.isFinite(delivered) && delivered >= shipped) deliver.push((delivered - shipped) / H);
    }
  }
  const delayed = orders.filter(o => ['N10', 'N20', 'N22'].includes(o.status) && Number.isFinite(Date.parse(o.time)) && now - Date.parse(o.time) > slaHours * H)
    .map(o => ({ id: o.id, time: o.time, hours: (now - Date.parse(o.time)) / H, status: o.status, product: o.items[0]?.name || '', more: o.items.length - 1, buyer: o.buyer }))
    .sort((a, b) => b.hours - a.hours);
  const claimsOf = t => orders.filter(o => String(o.status).startsWith(t) || (t === 'C' && o.canceled));
  const claimList = [['C', '취소'], ['R', '반품'], ['E', '교환']].map(([t, name]) => ({ type: t, name, count: claimsOf(t).length }));
  const total = orders.length;
  const reasons = new Map(), byProduct = new Map();
  for (const o of orders) if (o.canceled || /^[CRE]/.test(String(o.status))) {
    const r = o.claimReason || '사유 미기재'; reasons.set(r, (reasons.get(r) || 0) + 1);
    const p = o.items[0]?.name || '상품'; byProduct.set(p, (byProduct.get(p) || 0) + 1);
  }
  return {
    shippedCount: leads.length,
    leadMedian: pctl(leads, 0.5), leadP90: pctl(leads, 0.9),
    within24: leads.length ? leads.filter(h => h <= 24).length / leads.length : null,
    within48: leads.length ? leads.filter(h => h <= 48).length / leads.length : null,
    deliverMedian: pctl(deliver, 0.5),
    dailyLead: [...daily.entries()].map(([date, hs]) => ({ date, median: pctl(hs, 0.5), count: hs.length })),
    delayed, slaHours,
    claims: claimList.map(c => ({ ...c, rate: total ? c.count / total : 0 })), totalOrders: total,
    reasons: [...reasons.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    claimProducts: [...byProduct.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8)
  };
}
