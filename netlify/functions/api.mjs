// 모든 /api/* 요청을 처리하는 단일 함수
import { json, HttpError, kstDate, addDays, isYmd, dateRange, num } from '../lib/util.mjs';
import { login, logoutCookie, requireSession, sessionOf, signState, verifyState } from '../lib/auth.mjs';
import * as data from '../lib/data.mjs';
import * as C from '../lib/cafe24.mjs';
import * as G from '../lib/google.mjs';
import * as R from '../lib/rules.mjs';
import * as AL from '../lib/autolink.mjs';
import * as A from '../lib/analytics.mjs';
import * as I from '../lib/insights.mjs';
import { runSync } from '../lib/sync.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { draftReply, aiConfigured, adCommentary } from '../lib/ai.mjs';
import * as AD from '../lib/adinsights.mjs';
import { adAnalysis } from '../lib/reports.mjs';
import * as ADV from '../lib/advisor.mjs';
import { blankProduct, calc } from '../../public/lib/margin.js';
import { DEMO_PRODUCTS } from '../lib/demo.mjs';

const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, ...opts });

async function body(req) {
  const text = await req.text();
  if (text.length > 300000) throw new HttpError(413, '요청이 너무 큽니다.');
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new HttpError(400, '요청 형식(JSON)이 올바르지 않습니다.'); }
}
function range(url, maxDays, defDays) {
  const today = kstDate();
  let to = isYmd(url.searchParams.get('to')) ? url.searchParams.get('to') : today;
  if (to > today) to = today;
  let from = isYmd(url.searchParams.get('from')) ? url.searchParams.get('from') : addDays(to, -(defDays - 1));
  if (from > today) from = today;
  if (from > to) throw new HttpError(400, '시작일이 종료일보다 늦습니다.');
  if (dateRange(from, to).length > maxDays) throw new HttpError(400, `조회 기간은 최대 ${maxDays}일입니다.`);
  return { from, to, today };
}
const who = s => s?.name || '관리자';

/* ---------- 인증 ---------- */
route('POST', '/api/login', async (req) => {
  const r = await login(req, await body(req));
  return json({ ok: true, name: r.name }, 200, { 'set-cookie': r.cookie });
}, { public: true });
route('POST', '/api/logout', async (req) => json({ ok: true }, 200, { 'set-cookie': logoutCookie(req) }), { public: true });
route('GET', '/api/me', async (req) => {
  const s = sessionOf(req);
  return json({ loggedIn: Boolean(s), name: s?.name || null, shop: { url: C.SHOP_URL(), mallId: C.MALL_ID() } });
}, { public: true });

/* ---------- 상태·설정 ---------- */
route('GET', '/api/status', async () => {
  const [modes, settings, sync, cafe24Token, cafe24Connect, googleConnect, products] = await Promise.all([data.modes(), data.getSettings(), getJSON('status/sync'), C.tokenInfo(), getJSON('status/cafe24-connect'), getJSON('status/google-connect'), data.listProducts()]);
  return json({
    modes, settings, sync, products: products.map(p => ({ id: p.id, name: p.name })), cafe24Token, cafe24Connect, cafe24RedirectUri: process.env.CAFE24_REDIRECT_URI || null, googleConnect, googleRedirectUri: process.env.GOOGLE_ADS_REDIRECT_URI || null,
    ai: aiConfigured(), today: kstDate(), shop: { url: C.SHOP_URL(), mallId: C.MALL_ID() }
  });
});
route('PUT', '/api/settings', async (req, s) => json(await data.putSettings(await body(req), who(s))));
route('POST', '/api/sync', async () => json(await runSync('manual')));
route('GET', '/api/log', async (req, s, url) => json(await data.listLogs(Math.min(500, num(url.searchParams.get('limit')) || 200))));

/* ---------- 홈 ---------- */
route('GET', '/api/home', async () => {
  const today = kstDate(); const from = addDays(today, -13);
  const days = dateRange(from, today);
  const errors = [];
  const safe = async (label, fn, fb) => { try { return await fn(); } catch (e) { errors.push(`${label}: ${e.message}`); return fb; } };
  // 이번 달 누적과 지난달 같은 날짜까지 비교
  const monthStart = today.slice(0, 8) + '01';
  const dayOfMonth = Number(today.slice(8));
  const pmEndRaw = addDays(monthStart, -1);
  const pmStart = pmEndRaw.slice(0, 8) + '01';
  const pmEnd = [addDays(pmStart, dayOfMonth - 1), pmEndRaw].sort()[0];
  // 필요한 데이터를 한꺼번에 동시에 받음
  const [settings, products, orders, prevMonth, ads, active, cs, inv] = await Promise.all([
    data.getSettings(), data.listProducts(),
    safe('주문', () => data.ordersForStats([from, monthStart].sort()[0], today), []),
    safe('지난달 주문', () => data.ordersForStats(pmStart, pmEnd), []),
    data.allAds(from, today),
    safe('처리할 주문', () => data.activeOrders(), { orders: [] }),
    safe('문의', () => data.articles(addDays(today, -29), today), []),
    safe('재고', () => data.inventory(), [])
  ]);
  const idx = A.productIndex(products);
  for (const e of ads.errors) errors.push(`${data.PLATFORM_LABEL[e.platform]}: ${e.message}`);
  const series = A.dailySeries(days, orders, ads.rows, idx);
  // 어제 같은 시각까지의 매출 (오늘은 하루가 끝나지 않았으므로 공정하게 비교)
  const nowK = new Date(Date.now() + 9 * 3600000);
  const nowMin = nowK.getUTCHours() * 60 + nowK.getUTCMinutes();
  const yday = addDays(today, -1);
  const ySame = I.summary(orders.filter(o => o.date === yday && (() => { const [, h] = I.kstParts(o); const m = Number(String(o.time).slice(14, 16)) || 0; return h * 60 + m <= nowMin; })()));
  // 카페24 '오늘의 할 일'과 같은 기준: 주문일과 관계없이 지금 그 상태인 주문 수
  const recent = active.orders;
  const statusCounts = countStatus(recent);
  const pendingShip = statusCounts.ready;
  const unpaid = statusCounts.unpaid;
  const delayed = I.fulfillmentInsights(recent, { slaHours: settings.shipSlaHours }).delayed.length;
  const week = dateRange(addDays(today, -6), today);
  const weekOrders = orders.filter(o => o.date >= week[0]);
  const pi = I.productInsights(weekOrders, [], inv, week, idx);
  const camp = A.campaignSummary(ads.campaigns, ads.rows.filter(r => r.date >= week[0]), settings.campaignLinks || {}, products);
  const tail = await Promise.all([data.listLogs(8), getJSON('status/sync'), data.modes()]);
  return json({
    today, series, ySame, pendingShip, unpaid, delayed, statusCounts, slaHours: settings.shipSlaHours,
    unansweredCs: cs.filter(a => !a.answered).length, stockAlerts: pi.alerts,
    badAds: camp.filter(c => c.verdict === 'bad' && c.status === 'on').length,
    mtd: I.summary(orders.filter(o => o.date >= monthStart)), prevMtd: I.summary(prevMonth), monthLabel: `${Number(today.slice(5, 7))}월`,
    topProducts: pi.products.slice(0, 5).map(p => ({ productNo: p.productNo, name: p.name, qty: p.qty, revenue: p.revenue, spark: p.spark })),
    productsCount: products.length, logs: tail[0], sync: tail[1],
    modes: tail[2], errors, shop: { url: C.SHOP_URL(), mallId: C.MALL_ID() }
  });
});

/* ---------- 주문 ---------- */
route('GET', '/api/orders', async (req, s, url) => {
  const { from, to } = range(url, 92, 7);
  const basis = url.searchParams.get('basis') === 'pay' ? 'pay' : 'order';
  const orders = await data.ordersLive(from, to, basis);
  const key = o => (basis === 'order' ? o.orderedAt || o.time : o.time);
  return json({ from, to, basis, orders: orders.map(o => ({ ...o, statusLabel: C.statusLabel(o.status) })).sort((a, b) => (key(a) < key(b) ? 1 : -1)), mode: await data.mode('cafe24') });
});
/** 지금 처리할 상태인 주문 전부 (입금전·배송준비중·배송대기·배송중·클레임 접수). 기간과 무관 */
route('GET', '/api/orders/active', async (req, s, url) => {
  const r = await data.activeOrders(url.searchParams.get('fresh') === '1');
  const orders = r.orders.map(o => ({ ...o, statusLabel: C.statusLabel(o.status) })).sort((a, b) => ((a.orderedAt || a.time) < (b.orderedAt || b.time) ? 1 : -1));
  return json({ orders, counts: countStatus(r.orders), at: r.at, mode: await data.mode('cafe24') });
});
route('GET', '/api/orders/:id', async (req, s, url, p) => {
  const o = await data.orderDetail(decodeURIComponent(p.id));
  return json({ ...o, statusLabel: C.statusLabel(o.status), items: o.items.map(i => ({ ...i, statusLabel: C.statusLabel(i.status) })) });
});
function countStatus(list) {
  const c = { unpaid: 0, ready: 0, prep: 0, waiting: 0, hold: 0, shipping: 0, cancelReq: 0, returnReq: 0, exchangeReq: 0 };
  for (const o of list) {
    const st = String(o.status);
    if (st === 'N00') c.unpaid++;
    else if (st === 'N10' || st === 'N20' || st === 'N22') { c.ready++; if (st === 'N10') c.prep++; if (st === 'N22') c.hold++; }
    else if (st === 'N21') c.waiting++;
    else if (st === 'N30') c.shipping++;
    else if (st[0] === 'C') c.cancelReq++;
    else if (st[0] === 'R') c.returnReq++;
    else if (st[0] === 'E') c.exchangeReq++;
  }
  return c;
}
/** 카페24 대시보드와 숫자 대조: 같은 기간을 주문일·결제일 두 기준으로 받아 차이 항목별로 나눔 */
route('GET', '/api/reconcile', async (req, s, url) => {
  const { from, to, today } = range(url, 31, 7);
  let refundError = null;
  const [byOrder, byPay, refunds] = await Promise.all([
    data.ordersLive(from, to, 'order'), data.ordersLive(from, to, 'pay'),
    data.refunds(from, to).catch(e => { refundError = e.message; return []; })
  ]);
  const days = dateRange(from, [to, today].sort()[0]);
  const isClaim = o => o.canceled || /^[CR]/.test(String(o.status));
  const rows = days.map(d => {
    const od = byOrder.filter(o => (o.orderDate || o.date) === d);
    const pd = byPay.filter(o => o.date === d);
    const valid = pd.filter(o => !isClaim(o));
    const rd = refunds.filter(r => r.date === d);
    const sum = (arr, f) => arr.reduce((t, o) => t + num(f(o)), 0);
    return {
      date: d,
      orderCount: od.length, orderTotal: sum(od, o => o.orderAmount ?? o.amount),
      orderAmount: sum(od.filter(o => !isClaim(o)), o => o.orderAmount ?? o.amount),
      unpaidCount: od.filter(o => !o.paid && !isClaim(o)).length, unpaidAmount: sum(od.filter(o => !o.paid && !isClaim(o)), o => o.orderAmount ?? o.amount),
      claimCount: od.filter(isClaim).length, claimAmount: sum(od.filter(isClaim), o => o.orderAmount ?? o.amount),
      payCount: pd.length, payAmount: sum(pd, o => o.amount), payCredits: sum(pd, o => num(o.points) + num(o.credits)),
      refundCount: new Set(rd.map(r => r.orderId || r.code)).size, refundAmount: sum(rd, r => r.amount),
      oursCount: valid.length, ours: sum(valid, o => o.amount),
      discount: sum(valid, o => Math.max(0, num(o.orderAmount ?? o.amount) - num(o.amount))),
      crossDay: pd.filter(o => o.orderDate && o.orderDate !== o.date).length
    };
  });
  const tot = k => rows.reduce((t, r) => t + r[k], 0);
  for (const r of rows) r.net = r.payAmount - r.refundAmount;
  const keys = ['orderCount', 'orderTotal', 'orderAmount', 'unpaidCount', 'unpaidAmount', 'claimCount', 'claimAmount', 'payCount', 'payAmount', 'payCredits', 'refundCount', 'refundAmount', 'net', 'oursCount', 'ours', 'discount', 'crossDay'];
  return json({ from, to, rows, total: Object.fromEntries(keys.map(k => [k, tot(k)])), refundError, refundSample: refunds[0]?.numeric || null, sync: (await getJSON('status/sync'))?.at || null, mode: await data.mode('cafe24') });
});
route('GET', '/api/carriers', async () => json(await data.carriers()));
route('POST', '/api/orders/:id/shipment', async (req, s, url, p) => {
  const b = await body(req);
  const tracking = String(b.trackingNo || '').replace(/[^0-9A-Za-z-]/g, '');
  if (!tracking || tracking.length < 6) throw new HttpError(400, '송장번호를 확인하세요 (6자 이상 숫자).');
  if (!b.carrierCode) throw new HttpError(400, '택배사를 선택하세요.');
  await data.ship(decodeURIComponent(p.id), Array.isArray(b.itemCodes) ? b.itemCodes : [], String(b.carrierCode), tracking, who(s));
  return json({ ok: true });
});

/* ---------- CS ---------- */
route('GET', '/api/cs', async (req, s, url) => {
  const { from, to } = range(url, 92, 30);
  const list = await data.articles(from, to);
  return json({ from, to, articles: list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), ai: aiConfigured(), mode: await data.mode('cafe24') });
});
route('POST', '/api/cs/reply', async (req, s) => {
  const b = await body(req);
  const content = String(b.content || '').trim();
  if (content.length < 5) throw new HttpError(400, '답변 내용을 5자 이상 입력하세요.');
  if (content.length > 5000) throw new HttpError(400, '답변은 5,000자 이내로 입력하세요.');
  await data.reply(num(b.boardNo), num(b.articleNo), String(b.title || '문의'), content, who(s));
  return json({ ok: true });
});
route('POST', '/api/cs/draft', async (req) => {
  const b = await body(req);
  const settings = await data.getSettings();
  const shop = await data.shopProducts().catch(() => []);
  const prod = shop.find(x => x.productNo === num(b.productNo));
  const text = await draftReply({ title: String(b.title || ''), content: String(b.content || '').slice(0, 3000), productName: prod?.name, writerName: settings.csWriter });
  return json({ draft: text });
});

/* ---------- 매출 ---------- */
route('GET', '/api/sales', async (req, s, url) => {
  const { from, to } = range(url, 92, 30);
  const [products, orders, ads, modes] = await Promise.all([data.listProducts(), data.ordersForStats(from, to), data.allAds(from, to), data.modes()]);
  const idx = A.productIndex(products);
  const days = dateRange(from, [to, kstDate()].sort()[0]);
  return json({ from, to, series: A.dailySeries(days, orders, ads.rows, idx), products: A.productTable(orders, idx), errors: ads.errors, modes });
});

/* ---------- 운영 분석 ---------- */
function periods(from, to) {
  const n = dateRange(from, to).length;
  const pTo = addDays(from, -1), pFrom = addDays(pTo, -(n - 1));
  const lyFrom = String(Number(from.slice(0, 4)) - 1) + from.slice(4), lyTo = String(Number(to.slice(0, 4)) - 1) + to.slice(4);
  return { n, pFrom, pTo, lyFrom: isYmd(lyFrom) ? lyFrom : addDays(from, -365), lyTo: isYmd(lyTo) ? lyTo : addDays(to, -365) };
}
route('GET', '/api/insights/sales', async (req, s, url) => {
  const { from, to } = range(url, 184, 30);
  const P = periods(from, to);
  // 작년 같은 기간은 이미 모아 둔 기록이 있을 때만 (외부 호출 없음)
  const [orders, prev, ly, products, ads, m] = await Promise.all([
    data.ordersForStats(from, to), data.ordersForStats(P.pFrom, P.pTo), data.ordersForStats(P.lyFrom, P.lyTo, { maxFetch: 0 }),
    data.listProducts(), data.allAds(from, to), data.mode('cafe24')
  ]);
  const lyComplete = (ly.missingDays || 0) === 0 && m !== 'demo';
  const days = dateRange(from, [to, kstDate()].sort()[0]);
  const out = I.salesInsights(orders, prev, lyComplete ? ly : null, days);
  out.prevDaily = I.salesInsights(prev, null, null, dateRange(P.pFrom, P.pTo)).daily;
  out.profit = A.dailySeries(days, orders, ads.rows, A.productIndex(products));
  return json({ from, to, prevFrom: P.pFrom, prevTo: P.pTo, ...out, missingDays: orders.missingDays || 0, mode: await data.mode('cafe24'), adErrors: ads.errors });
});
route('GET', '/api/insights/products', async (req, s, url) => {
  const { from, to } = range(url, 184, 30);
  const P = periods(from, to);
  let invError = null;
  const [orders, prev, inv, products] = await Promise.all([
    data.ordersForStats(from, to), data.ordersForStats(P.pFrom, P.pTo),
    data.inventory().catch(e => { invError = e.message; return []; }), data.listProducts()
  ]);
  const days = dateRange(from, [to, kstDate()].sort()[0]);
  const idx = A.productIndex(products);
  return json({ from, to, days, ...I.productInsights(orders, prev, inv, days, idx), invError, mode: await data.mode('cafe24') });
});
route('GET', '/api/insights/customers', async (req, s, url) => {
  const { from, to, today } = range(url, 184, 90);
  // 1년 기록은 이미 모아 둔 것만 사용 (외부 호출 없이 빠르게, 비어 있는 날은 자동 수집이 채움)
  const orders = await data.ordersForStats(from, to);
  const [hist, coverage] = await Promise.all([data.ordersForStats(addDays(today, -364), today, { maxFetch: 0 }), data.historyCoverage(365)]);
  const seen = new Set(hist.map(o => o.id));
  const history = [...hist, ...orders.filter(o => !seen.has(o.id))];
  return json({ from, to, ...I.customerInsights(orders, history, from), coverage, mode: await data.mode('cafe24') });
});
route('GET', '/api/insights/fulfillment', async (req, s, url) => {
  const { from, to, today } = range(url, 92, 30);
  // 지연 주문은 현재 상태가 중요해 '지금 처리할 주문'으로
  const [settings, orders, act] = await Promise.all([data.getSettings(), data.ordersForStats(from, to), data.activeOrders().catch(() => ({ orders: [] }))]);
  const live = act.orders;
  const days = dateRange(from, [to, today].sort()[0]);
  const f = I.fulfillmentInsights(orders, { slaHours: settings.shipSlaHours, days });
  f.delayed = I.fulfillmentInsights(live, { slaHours: settings.shipSlaHours }).delayed;
  return json({ from, to, ...f, mode: await data.mode('cafe24') });
});

/* ---------- 제품(마진) ---------- */
route('GET', '/api/products', async () => json(await data.listProducts()));
route('POST', '/api/products', async (req, s) => {
  const b = await body(req);
  return json(await data.saveProduct(null, { ...blankProduct(), ...b }, who(s)), 201);
});
route('PUT', '/api/products/:id', async (req, s, url, p) => {
  if (!(await data.productExists(p.id))) throw new HttpError(404, '제품을 찾지 못했습니다.');
  return json(await data.saveProduct(p.id, await body(req), who(s)));
});
route('DELETE', '/api/products/:id', async (req, s, url, p) => { await data.deleteProduct(p.id, who(s)); return json({ ok: true }); });
route('GET', '/api/shop-products', async () => json(await data.shopProducts()));
route('POST', '/api/products/examples', async (req, s) => {
  if ((await data.mode('cafe24')) !== 'demo') throw new HttpError(400, '예시 제품은 데모 모드에서만 추가할 수 있습니다.');
  const made = [];
  for (const ex of EXAMPLES) made.push(await data.saveProduct(null, { ...blankProduct(), ...ex }, who(s)));
  // 데모 광고 캠페인도 예시 제품과 연결해 손익분기 판정을 바로 볼 수 있게 함
  const byNo = no => made.find(p => p.cafe24ProductNos.includes(no))?.id;
  for (const [platform, id, no] of [['meta', 'm-1001', 101], ['meta', 'm-1002', 102], ['google', 'g-2001', 101], ['tiktok', 't-3001', 103]]) {
    await data.setCampaignLink(platform, id, byNo(no), null);
  }
  return json(made, 201);
});

/* ---------- 광고 ---------- */
route('GET', '/api/ads', async (req, s, url) => {
  const { from, to } = range(url, 92, 7);
  const [ads, settings, products] = await Promise.all([data.allAds(from, to), data.getSettings(), data.listProducts()]);
  const list = A.campaignSummary(ads.campaigns, ads.rows, settings.campaignLinks || {}, products, settings.campaignLinkSrc || {});
  return json({ from, to, campaigns: list, errors: ads.errors, modes: ads.modes, platformStates: await data.platformStates(), autoLink: settings.autoLink || {}, products: products.map(p => ({ id: p.id, name: p.name, beRoas: calc(p).beRoas })) });
});
/** 제품 자동 연결: 미리보기(GET) / 적용(POST). 광고 링크 상품번호 → 이름 키워드 → 기본 제품 */
route('GET', '/api/ads/autolink', async () => json(await AL.previewAutoLink()));
route('POST', '/api/ads/autolink', async (req, s) => {
  const r = await AL.runAutoLink({ who: who(s), force: true });
  return json({ ...r, howLabel: AL.HOW_LABEL });
});
/** 광고 분석: 개요·캠페인·소재·퍼널·제품 손익 + 코멘트 */
route('GET', '/api/ads/analysis', async (req, s, url) => {
  const { from, to } = range(url, 92, 14);
  const r = await adAnalysis(from, to);
  const ai = await getJSON(`cache/adai/${from}_${to}`);
  return json({ ...r, platformStates: await data.platformStates(), ai: aiConfigured(), aiComment: ai && Date.now() - ai.at < 6 * 3600000 ? ai : null });
});
route('POST', '/api/ads/ai-comment', async (req, s) => {
  const b = await body(req);
  const u = new URL('http://x/?from=' + encodeURIComponent(b.from || '') + '&to=' + encodeURIComponent(b.to || ''));
  const { from, to } = range(u, 92, 14);
  const r = await adAnalysis(from, to);
  const text = await adCommentary(AD.aiBrief({ from, to, ...r }));
  const out = { at: Date.now(), text, by: who(s) };
  await setJSON(`cache/adai/${from}_${to}`, out);
  return json(out);
});
/* ---------- AI 참모 ---------- */
route('GET', '/api/advisor', async (req, s) => json({ configured: ADV.advisorConfigured(), ...(await ADV.loadThread(who(s))), modes: await data.modes() }));
route('POST', '/api/advisor/step', async (req, s) => {
  const b = await body(req);
  const r = await ADV.step(b.messages, { who: who(s) });
  const ids = [...(Array.isArray(b.proposalIds) ? b.proposalIds.map(String) : []), ...r.proposals.map(p => p.id)];
  await ADV.saveThread(who(s), r.messages, ids);
  return json(r);
});
route('POST', '/api/advisor/reset', async (req, s) => { await ADV.clearThread(who(s)); return json({ ok: true }); });
route('POST', '/api/advisor/proposals/:id/run', async (req, s, url, p) => json(await ADV.runProposal(p.id, who(s))));
route('POST', '/api/advisor/proposals/:id/dismiss', async (req, s, url, p) => json(await ADV.dismissProposal(p.id, who(s))));

route('POST', '/api/ads/status', async (req, s) => {
  const b = await body(req);
  await data.setCampaignStatus(String(b.platform), String(b.id), Boolean(b.on), who(s), '직접 변경');
  return json({ ok: true });
});
route('POST', '/api/ads/budget', async (req, s) => {
  const b = await body(req);
  await data.setCampaignBudget(String(b.platform), String(b.id), num(b.budget), who(s), '직접 변경');
  return json({ ok: true });
});
route('POST', '/api/ads/link', async (req, s) => {
  const b = await body(req);
  if (!data.PLATFORMS.includes(b.platform)) throw new HttpError(400, '알 수 없는 매체입니다.');
  return json(await data.setCampaignLink(b.platform, String(b.id), b.productId ? String(b.productId) : null, who(s)));
});

/* ---------- 자동 규칙 ---------- */
route('GET', '/api/rules', async () => json({ rules: await R.listRules(), templates: R.TEMPLATES, metrics: R.METRICS, ops: R.OPS, actions: R.ACTIONS, windows: Object.keys(R.WINDOWS) }));
route('POST', '/api/rules', async (req, s) => json(await R.saveRule(null, await body(req), who(s)), 201));
route('PUT', '/api/rules/:id', async (req, s, url, p) => json(await R.saveRule(p.id, await body(req), who(s))));
route('DELETE', '/api/rules/:id', async (req, s, url, p) => { await R.deleteRule(p.id, who(s)); return json({ ok: true }); });
route('POST', '/api/rules/preview', async (req) => json(await R.previewRule(await body(req))));
route('POST', '/api/rules/run', async (req, s) => json(await R.runRules({ who: who(s) + ' (수동 실행)' })));

/* ---------- 카페24 연결 ---------- */
route('GET', '/api/cafe24/connect', async (req) => {
  if (!C.cafe24KeysSet()) throw new HttpError(400, 'CAFE24_MALL_ID, CAFE24_CLIENT_ID, CAFE24_CLIENT_SECRET 환경변수를 먼저 등록하세요.');
  const origin = new URL(req.url).origin;
  const state = signState({ k: 'cafe24' });
  return new Response(null, { status: 302, headers: { location: C.authorizeUrl(C.redirectUriFor(origin), state) } });
});
route('GET', '/api/cafe24/callback', async (req, s, url) => {
  const origin = url.origin;
  const back = (q) => new Response(null, { status: 302, headers: { location: `${origin}/#/settings?cafe24=${q}` } });
  const redirectUri = C.redirectUriFor(origin);
  const fail = async (q, message) => {
    await setJSON('status/cafe24-connect', { at: new Date().toISOString(), ok: false, message: String(message || '').slice(0, 400), redirectUri });
    return back(q);
  };
  // 카페24가 오류를 붙여 돌려보낸 경우 (권한 거부, 주소 불일치 등)
  const st = verifyState(url.searchParams.get('state'));
  if (!st || st.k !== 'cafe24') return back('state'); // 확인값이 틀리면 아무것도 저장하지 않음 (외부에서 임의로 상태를 덮어쓰지 못하게)
  if (url.searchParams.get('error')) return fail('fail', `카페24 응답: ${url.searchParams.get('error')} ${url.searchParams.get('error_description') || ''}`);
  const code = url.searchParams.get('code');
  if (!code) return fail('denied', '카페24에서 인증 코드를 받지 못했습니다.');
  try {
    await C.exchangeCode(code, redirectUri);
    data.forgetMode('cafe24');
    await setJSON('status/cafe24-connect', { at: new Date().toISOString(), ok: true, message: '', redirectUri });
    await data.addLog({ who: '관리자', kind: '연동', target: '카페24', detail: '연결 완료' });
    return back('ok');
  } catch (e) { console.error(e); return fail('fail', e.message); }
}, { public: true });

/* ---------- 구글 연결 (갱신 토큰을 운영실이 직접 받아 저장) ---------- */
route('GET', '/api/google/connect', async (req) => {
  if (!G.googleKeysSet()) throw new HttpError(400, 'GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_CUSTOMER_ID 환경변수를 먼저 등록하세요.');
  const origin = new URL(req.url).origin;
  return new Response(null, { status: 302, headers: { location: G.googleAuthorizeUrl(G.googleRedirectUri(origin), signState({ k: 'google' })) } });
});
route('GET', '/api/google/callback', async (req, s, url) => {
  const origin = url.origin;
  const redirectUri = G.googleRedirectUri(origin);
  const back = q => new Response(null, { status: 302, headers: { location: `${origin}/#/settings?google=${q}` } });
  const fail = async (q, message) => { await setJSON('status/google-connect', { at: new Date().toISOString(), ok: false, message: String(message || '').slice(0, 400), redirectUri }); return back(q); };
  const st = verifyState(url.searchParams.get('state'));
  if (!st || st.k !== 'google') return back('state');
  if (url.searchParams.get('error')) return fail('fail', `구글 응답: ${url.searchParams.get('error')}`);
  const code = url.searchParams.get('code');
  if (!code) return fail('denied', '구글에서 인증 코드를 받지 못했습니다.');
  try {
    await G.googleExchange(code, redirectUri);
    data.forgetMode('google');
    await setJSON('status/google-connect', { at: new Date().toISOString(), ok: true, message: '', redirectUri });
    await data.addLog({ who: '관리자', kind: '연동', target: '구글 Ads', detail: '연결 완료' });
    return back('ok');
  } catch (e) { console.error(e); return fail('fail', e.message); }
}, { public: true });
/** 광고 매체 연결 확인: 캠페인 목록을 실제로 받아봄 */
route('POST', '/api/ads/test', async (req) => {
  const b = await body(req);
  const p = String(b.platform || '');
  if (!data.PLATFORMS.includes(p)) throw new HttpError(400, '알 수 없는 매체입니다.');
  if ((await data.mode(p)) !== 'live') throw new HttpError(409, '아직 키가 모두 등록되지 않았습니다.');
  const list = await data.campaigns(p, { fresh: true });
  return json({ ok: true, count: list.length, on: list.filter(c => c.status === 'on').length, names: list.slice(0, 5).map(c => c.name) });
});

const EXAMPLES = [
  { name: '[예시] 한우 불고기 양념육 500g', stage: 'review', category: '양념육', cafe24ProductNos: [101],
    ingredients: [{ name: '한우 앞다리(정육)', unit: 'kg', unitPrice: 32000, qty: 10 }, { name: '불고기 양념 소스', unit: 'kg', unitPrice: 6000, qty: 3 }, { name: '양파', unit: 'kg', unitPrice: 2500, qty: 1.5 }, { name: '대파', unit: 'kg', unitPrice: 4000, qty: 0.5 }],
    yieldPct: 92, packWeightG: 500, packaging: [{ name: '진공 포장재', cost: 180 }, { name: '라벨', cost: 40 }, { name: '트레이', cost: 120 }],
    workers: 2, hours: 4, wage: 12000, overhead: 30000, price: DEMO_PRODUCTS[0].price, packsPerOrder: 2, boxCost: 1800, icepacks: 2, icepackCost: 350, courier: 3500, feePct: 3.5, returnPct: 2, adPct: 15, targetMargin: 15 },
  { name: '[예시] 한우 육포 100g', stage: 'launch', category: '육포', cafe24ProductNos: [102],
    ingredients: [{ name: '한우 우둔', unit: 'kg', unitPrice: 38000, qty: 20 }, { name: '육포 양념', unit: 'kg', unitPrice: 9000, qty: 2.4 }],
    yieldPct: 42, packWeightG: 100, packaging: [{ name: '지퍼 파우치', cost: 150 }, { name: '라벨', cost: 40 }],
    workers: 2, hours: 8, wage: 12000, overhead: 45000, price: DEMO_PRODUCTS[1].price, packsPerOrder: 2, boxCost: 900, icepacks: 0, icepackCost: 0, courier: 3200, feePct: 3.5, returnPct: 1, adPct: 15, targetMargin: 15 },
  { name: '[예시] 수제 떡갈비 6팩', stage: 'costing', category: '떡갈비', cafe24ProductNos: [103],
    ingredients: [{ name: '한우 목심 다짐육', unit: 'kg', unitPrice: 24000, qty: 30 }, { name: '돼지 앞다리 다짐육', unit: 'kg', unitPrice: 9000, qty: 15 }, { name: '부재료·양념', unit: 'kg', unitPrice: 5000, qty: 7.5 }],
    yieldPct: 88, packWeightG: 720, packaging: [{ name: '진공 포장재 6장', cost: 540 }, { name: '종이 상자', cost: 600 }, { name: '라벨', cost: 40 }],
    workers: 2, hours: 6, wage: 12000, overhead: 40000, price: DEMO_PRODUCTS[2].price, packsPerOrder: 1, boxCost: 1800, icepacks: 2, icepackCost: 350, courier: 3500, feePct: 3.5, returnPct: 2, adPct: 20, targetMargin: 15 }
];

export default async (req) => {
  const url = new URL(req.url);
  const r = routes.find(x => x.method === req.method && x.re.test(url.pathname));
  try {
    if (!r) throw new HttpError(404, '없는 주소입니다.');
    let s = null;
    if (!r.public) {
      s = requireSession(req);
      // 교차 사이트 요청 차단: 쓰기 요청은 자체 헤더 필수
      if (req.method !== 'GET' && req.headers.get('x-jimi') !== '1') throw new HttpError(403, '허용되지 않은 요청입니다.');
    }
    const params = url.pathname.match(r.re).groups || {};
    return await r.handler(req, s, url, params);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status >= 500) console.error(e);
    return json({ error: e instanceof HttpError ? e.message : '서버 오류가 발생했습니다. 잠시 후 다시 시도하세요.' }, status);
  }
};

export const config = { path: '/api/*' };
