// 여러 화면과 AI 참모가 함께 쓰는 보고서 계산
import { kstDate, addDays, dateRange } from './util.mjs';
import * as data from './data.mjs';
import * as A from './analytics.mjs';
import * as AD from './adinsights.mjs';
import * as I from './insights.mjs';

/** 광고 분석: 개요·캠페인·소재·퍼널·제품 손익 + 코멘트 */
export async function adAnalysis(from, to) {
  const days = dateRange(from, [to, kstDate()].sort()[0]);
  const n = dateRange(from, to).length;
  const pFrom = addDays(from, -n), pTo = addDays(from, -1);
  const settings = await data.getSettings();
  const products = await data.listProducts();
  const idx = A.productIndex(products);
  // 매체 성과·이전 기간·소재·주문을 한꺼번에 동시에 받음
  let orderError = null;
  const [ads, prevAds, cr, [orders, prevOrders]] = await Promise.all([
    data.allAds(from, to),
    data.allAds(pFrom, pTo, { rowsOnly: true }).catch(() => ({ rows: [] })),
    data.allCreatives(from, to),
    Promise.all([data.ordersForStats(from, to), data.ordersForStats(pFrom, pTo)]).catch(e => { orderError = e.message; return [[], []]; })
  ]);
  const errors = [...ads.errors, ...cr.errors.filter(e => !ads.errors.some(x => x.platform === e.platform))];
  if (orderError) errors.push({ platform: 'cafe24', message: orderError });
  const platforms = data.PLATFORMS.filter(p => ads.modes[p] !== 'off');
  const summary = A.campaignSummary(ads.campaigns, ads.rows, settings.campaignLinks || {}, products);
  const ov = AD.overview({ days, rows: ads.rows, prevRows: prevAds.rows, orders, prevOrders, platforms });
  const camps = AD.campaignAnalysis(summary, ads.rows, days);
  const creatives = AD.creativeAnalysis(cr.rows, cr.info, cr.reach, summary, days);
  const fun = AD.funnelAnalysis(ads.rows, prevAds.rows, platforms);
  const pl = AD.productPL({ products, idx, orders, campaigns: summary });
  return { from, to, prevFrom: pFrom, prevTo: pTo, days, platforms, modes: ads.modes, errors, ov, camps, creatives, fun, pl, headline: AD.headline(ov, camps, creatives, fun) };
}

const r2 = x => (x == null || !isFinite(x) ? null : Math.round(x * 100) / 100);
const w = x => (x == null || !isFinite(x) ? null : Math.round(x));
const PLAT = { meta: '메타', google: '구글', tiktok: '틱톡' };

/** 기간 매출 보고 (AI 참모용 요약: 고객 개인정보 없음) */
export async function salesReport(from, to) {
  const n = dateRange(from, to).length;
  const pFrom = addDays(from, -n), pTo = addDays(from, -1);
  const days = dateRange(from, [to, kstDate()].sort()[0]);
  const [orders, prev, products] = await Promise.all([data.ordersForStats(from, to), data.ordersForStats(pFrom, pTo), data.listProducts()]);
  const idx = A.productIndex(products);
  const S = I.summary(orders), P = I.summary(prev);
  const si = I.salesInsights(orders, prev, null, days);
  const pi = I.productInsights(orders, prev, [], days, idx);
  return {
    기간: `${from}~${to}`, 이전기간: `${pFrom}~${pTo}`,
    매출: w(S.revenue), 이전매출: w(P.revenue), 주문: S.orders, 이전주문: P.orders, 객단가: w(S.aov), 구매자: S.buyers,
    일별: si.daily.map(d => ({ 날짜: d.date, 매출: w(d.revenue), 주문: d.orders })),
    요일평균매출: si.weekday.map(x => ({ 요일: x.name, 평균: w(x.avgRevenue) })),
    결제수단: (si.payments || []).slice(0, 5).map(x => ({ 이름: x.name, 매출: w(x.revenue) })),
    유입경로: (si.channels || []).slice(0, 5).map(x => ({ 이름: x.name, 매출: w(x.revenue) })),
    상품순위: pi.products.slice(0, 10).map(p => ({ 상품: p.name, 매출: w(p.revenue), 수량: p.qty, 이전대비: r2(p.growth) })),
    취소반품: si.canceled
  };
}

/** AI 참모가 대화 시작 때 받는 현재 상황 요약 (5분 캐시) */
export async function snapshot() {
  const today = kstDate();
  const from14 = addDays(today, -13), from30 = addDays(today, -29);
  const [ad, orders30, active, settings] = await Promise.all([
    adAnalysis(from14, today),
    data.ordersForStats(from30, today).catch(() => []),
    data.activeOrders().catch(() => ({ orders: [] })),
    data.getSettings()
  ]);
  const byDay = d => I.summary(orders30.filter(o => o.date === d));
  const range = (a, b) => I.summary(orders30.filter(o => o.date >= a && o.date <= b));
  const st = { 입금전: 0, 배송준비중: 0, 배송대기: 0, 배송중: 0, 클레임접수: 0 };
  for (const o of active.orders) {
    const c = String(o.status);
    if (c === 'N00') st.입금전++; else if (['N10', 'N20', 'N22'].includes(c)) st.배송준비중++; else if (c === 'N21') st.배송대기++; else if (c === 'N30') st.배송중++; else st.클레임접수++;
  }
  const s = x => ({ 매출: w(x.revenue), 주문: x.orders, 객단가: w(x.aov) });
  return {
    오늘: today,
    매출: { 오늘: s(byDay(today)), 어제: s(byDay(addDays(today, -1))), 최근7일: s(range(addDays(today, -6), today)), 그전7일: s(range(addDays(today, -13), addDays(today, -7))), 최근30일: s(range(from30, today)) },
    주문상태: st,
    광고_최근14일: {
      연결: Object.fromEntries(Object.entries(ad.modes).map(([k, v]) => [PLAT[k], v === 'live' ? '실제' : v === 'demo' ? '데모' : '미연결'])),
      오류: ad.errors.map(e => `${PLAT[e.platform] || e.platform}: ${e.message}`),
      광고비: w(ad.ov.total.spend), 광고매출: w(ad.ov.total.revenue), ROAS: r2(ad.ov.total.roas), 이전ROAS: r2(ad.ov.prev.roas), 이전광고비: w(ad.ov.prev.spend),
      구매: w(ad.ov.total.purchases), CPA: w(ad.ov.total.cpa), 자사몰매출: w(ad.ov.shop), 광고비비중: r2(ad.ov.spendRate), 자사몰매출_광고비배수: r2(ad.ov.mer),
      매체별: ad.ov.byPlatform.map(p => ({ 매체: PLAT[p.platform], 광고비: w(p.spend), ROAS: r2(p.roas), CTR: r2(p.ctr && p.ctr * 100), CPA: w(p.cpa), 구매: w(p.purchases) })),
      요약코멘트: ad.headline.map(h => h.text)
    },
    캠페인: ad.camps.map(c => ({
      key: c.key, 매체: PLAT[c.platform], 이름: c.name, 상태: c.status === 'on' ? '켜짐' : c.status === 'off' ? '꺼짐' : '기타',
      일예산: c.dailyBudget, 광고비: w(c.spend), 광고매출: w(c.revenue), ROAS: r2(c.roas), 손익분기ROAS: r2(c.beRoas), 연결제품: c.productName || null,
      구매: w(c.purchases), CPA: w(c.cpa), CTR퍼센트: r2(c.ctr && c.ctr * 100), 후반ROAS변화: c.trend.first.roas && c.trend.second.roas != null ? r2(c.trend.second.roas / c.trend.first.roas - 1) : null,
      코멘트: c.comments.map(x => `[${x.level}] ${x.text}`)
    })),
    소재_문제상위: ad.creatives.list.filter(c => c.comments.some(x => x.level !== 'good')).slice(0, 8).map(c => ({ 매체: PLAT[c.platform], 이름: c.name, 캠페인: c.campaignName, 형식: c.format, 광고비: w(c.spend), ROAS: r2(c.roas), 빈도: r2(c.frequency), 코멘트: c.comments.slice(0, 2).map(x => x.text) })),
    소재_효율상위: ad.creatives.list.filter(c => ad.creatives.best.includes(c.key)).map(c => ({ 매체: PLAT[c.platform], 이름: c.name, ROAS: r2(c.roas), 광고비: w(c.spend) })),
    퍼널: ad.fun.total.steps.map(x => ({ 단계: x.label, 수: w(x.value), 전단계대비: r2(x.rate) })),
    제품손익_최근14일: ad.pl.list.filter(p => p.shopRevenue || p.adSpend).map(p => ({ 제품: p.name, 자사몰매출: w(p.shopRevenue), 공헌이익률: r2(p.margin), 광고비: w(p.adSpend), 광고후이익: w(p.profit), 광고ROAS: r2(p.roas), 손익분기ROAS: r2(p.beRoas) })),
    제품미연결_광고비: w(ad.pl.unlinked.spend),
    안전장치: { 최소일예산: settings.minBudget, 한번에최대예산변경퍼센트: settings.maxBudgetChangePct }
  };
}
