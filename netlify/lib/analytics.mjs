// 매출·이익 분석: 카페24 주문 + 마진 제품(원가) + 광고비
import { calc, pct, num } from '../../public/lib/margin.js';

/** 카페24 상품번호 → 마진 제품 */
export function productIndex(products) {
  const idx = new Map();
  for (const p of products) {
    const r = calc(p);
    const unitCost = r.ok ? r.unitCost : null;
    for (const no of p.cafe24ProductNos || []) idx.set(Number(no), { p, unitCost });
  }
  return idx;
}

/** 주문 1건 추정 공헌이익(광고비 제외). 원가를 모르는 상품이 섞이면 null */
export function orderContribution(order, idx) {
  if (order.canceled || String(order.status).startsWith('R')) return { counted: false };
  const gross = num(order.amount);
  const hits = order.items.map(i => idx.get(Number(i.productNo)));
  if (!hits.length || hits.some(h => !h || h.unitCost == null)) return { counted: true, gross, contribution: null };
  const first = hits[0].p;
  const vat = first.taxable ? gross / 11 : 0;
  const fee = gross * pct(first.feePct);
  const cogs = order.items.reduce((s, it, k) => s + num(it.qty) * hits[k].unitCost, 0);
  const fulfil = num(first.boxCost) + num(first.icepacks) * num(first.icepackCost) + num(first.courier);
  return { counted: true, gross, contribution: gross - vat - fee - cogs - fulfil, cogs };
}

/** 날짜별 요약 */
export function dailySeries(days, orders, adRows, idx) {
  const map = new Map(days.map(d => [d, { date: d, revenue: 0, orders: 0, mappedRevenue: 0, contribution: 0, adSpend: 0, adRevenue: 0, purchases: 0 }]));
  for (const o of orders) {
    const day = map.get(o.date); if (!day) continue;
    const c = orderContribution(o, idx);
    if (!c.counted) continue;
    day.revenue += c.gross; day.orders += 1;
    if (c.contribution != null) { day.mappedRevenue += c.gross; day.contribution += c.contribution; }
  }
  for (const r of adRows) {
    const day = map.get(r.date); if (!day) continue;
    day.adSpend += num(r.spend); day.adRevenue += num(r.revenue); day.purchases += num(r.purchases);
  }
  return [...map.values()].map(d => ({
    ...d,
    coverage: d.revenue > 0 ? d.mappedRevenue / d.revenue : null,
    // 원가 연결된 매출 비율만큼 광고비를 배분해 이익을 추정
    // 원가 연결 매출이 없으면 이익을 알 수 없으므로 null
    profit: d.revenue > 0 ? (d.mappedRevenue > 0 ? d.contribution - d.adSpend * (d.mappedRevenue / d.revenue) : null) : -d.adSpend,
    roas: d.adSpend > 0 ? d.adRevenue / d.adSpend : null
  }));
}

/** 상품별 판매 요약 */
export function productTable(orders, idx) {
  const map = new Map();
  for (const o of orders) {
    if (o.canceled || String(o.status).startsWith('R')) continue;
    const itemsTotal = o.items.reduce((s, i) => s + num(i.price) * num(i.qty), 0) || 1;
    for (const it of o.items) {
      const k = Number(it.productNo);
      const row = map.get(k) || { productNo: k, name: it.name, qty: 0, revenue: 0, orders: 0, linked: null, unitCost: null, cogs: 0 };
      const share = num(it.price) * num(it.qty) / itemsTotal;
      row.qty += num(it.qty); row.revenue += num(o.amount) * share; row.orders += 1;
      const h = idx.get(k);
      if (h) { row.linked = { id: h.p.id, name: h.p.name }; row.unitCost = h.unitCost; if (h.unitCost != null) row.cogs += h.unitCost * num(it.qty); }
      map.set(k, row);
    }
  }
  return [...map.values()].map(r => ({
    ...r,
    // 부가세 제외 매출 대비 원가율 (과세 가정)
    costRate: r.unitCost != null && r.revenue > 0 ? r.cogs / (r.revenue / 1.1) : null
  })).sort((a, b) => b.revenue - a.revenue);
}

/** 캠페인별 기간 합계 + 연결 제품의 손익분기 ROAS */
export function campaignSummary(campaigns, rows, links, products) {
  const byId = new Map(products.map(p => [p.id, p]));
  const agg = new Map();
  for (const r of rows) {
    const k = r.platform + ':' + r.campaignId;
    const a = agg.get(k) || { spend: 0, revenue: 0, purchases: 0, clicks: 0, impressions: 0, name: r.name };
    a.spend += num(r.spend); a.revenue += num(r.revenue); a.purchases += num(r.purchases); a.clicks += num(r.clicks); a.impressions += num(r.impressions);
    agg.set(k, a);
  }
  const seen = new Set();
  const out = [];
  const push = (platform, id, c, a) => {
    const k = platform + ':' + id; if (seen.has(k)) return; seen.add(k);
    const pid = links[k] || null; const p = pid ? byId.get(pid) : null;
    const be = p ? calc(p).beRoas : null;
    const roas = a && a.spend > 0 ? a.revenue / a.spend : null;
    out.push({
      key: k, platform, id: String(id), name: c?.name || a?.name || id, status: c?.status || 'other', dailyBudget: c?.dailyBudget ?? null,
      spend: a?.spend || 0, revenue: a?.revenue || 0, purchases: a?.purchases || 0, clicks: a?.clicks || 0, impressions: a?.impressions || 0,
      roas, cpa: a && a.purchases > 0 ? a.spend / a.purchases : null,
      productId: p ? pid : null, productName: p ? p.name : null, beRoas: be,
      verdict: roas == null || be == null ? null : roas >= be * 1.2 ? 'good' : roas >= be ? 'warn' : 'bad'
    });
  };
  for (const c of campaigns) push(c.platform, c.id, c, agg.get(c.platform + ':' + c.id));
  for (const [k, a] of agg) { const [platform, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)]; push(platform, id, null, a); }
  return out.sort((a, b) => b.spend - a.spend);
}
