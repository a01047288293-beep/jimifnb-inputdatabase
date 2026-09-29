// 모든 /api/* 요청을 처리하는 단일 함수
import { json, HttpError, kstDate, addDays, isYmd, dateRange, num } from '../lib/util.mjs';
import { login, logoutCookie, requireSession, sessionOf, signState, verifyState } from '../lib/auth.mjs';
import * as data from '../lib/data.mjs';
import * as C from '../lib/cafe24.mjs';
import * as R from '../lib/rules.mjs';
import * as A from '../lib/analytics.mjs';
import { runSync } from '../lib/sync.mjs';
import { getJSON } from '../lib/store.mjs';
import { draftReply, aiConfigured } from '../lib/ai.mjs';
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
  const to = isYmd(url.searchParams.get('to')) ? url.searchParams.get('to') : today;
  const from = isYmd(url.searchParams.get('from')) ? url.searchParams.get('from') : addDays(to, -(defDays - 1));
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
  return json({ loggedIn: Boolean(s), name: s?.name || null });
}, { public: true });

/* ---------- 상태·설정 ---------- */
route('GET', '/api/status', async () => json({
  modes: await data.modes(), settings: await data.getSettings(), sync: await getJSON('status/sync'),
  cafe24Token: await C.tokenInfo(), ai: aiConfigured(), today: kstDate()
}));
route('PUT', '/api/settings', async (req, s) => json(await data.putSettings(await body(req), who(s))));
route('POST', '/api/sync', async () => json(await runSync('manual')));
route('GET', '/api/log', async (req, s, url) => json(await data.listLogs(Math.min(500, num(url.searchParams.get('limit')) || 200))));

/* ---------- 홈 ---------- */
route('GET', '/api/home', async () => {
  const today = kstDate(); const from = addDays(today, -13);
  const days = dateRange(from, today);
  const errors = [];
  const safe = async (label, fn, fb) => { try { return await fn(); } catch (e) { errors.push(`${label}: ${e.message}`); return fb; } };
  const products = await data.listProducts();
  const idx = A.productIndex(products);
  const orders = await safe('주문', () => data.ordersForStats(from, today), []);
  const ads = await data.allAds(from, today);
  for (const e of ads.errors) errors.push(`${data.PLATFORM_LABEL[e.platform]}: ${e.message}`);
  const series = A.dailySeries(days, orders, ads.rows, idx);
  const recent = await safe('출고 대기', () => data.ordersLive(addDays(today, -6), today), []);
  const pendingShip = recent.filter(o => ['N10', 'N20', 'N21', 'N22'].includes(o.status)).length;
  const unpaid = recent.filter(o => o.status === 'N00').length;
  const cs = await safe('문의', () => data.articles(addDays(today, -29), today), []);
  return json({
    today, series, pendingShip, unpaid, unansweredCs: cs.filter(a => !a.answered).length,
    productsCount: products.length, logs: (await data.listLogs(8)), sync: await getJSON('status/sync'),
    modes: await data.modes(), errors
  });
});

/* ---------- 주문 ---------- */
route('GET', '/api/orders', async (req, s, url) => {
  const { from, to } = range(url, 31, 7);
  const orders = await data.ordersLive(from, to);
  return json({ from, to, orders: orders.map(o => ({ ...o, statusLabel: C.statusLabel(o.status) })).sort((a, b) => (a.time < b.time ? 1 : -1)), mode: await data.mode('cafe24') });
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
  const products = await data.listProducts();
  const idx = A.productIndex(products);
  const orders = await data.ordersForStats(from, to);
  const ads = await data.allAds(from, to);
  const days = dateRange(from, [to, kstDate()].sort()[0]);
  return json({ from, to, series: A.dailySeries(days, orders, ads.rows, idx), products: A.productTable(orders, idx), errors: ads.errors, modes: await data.modes() });
});

/* ---------- 제품(마진) ---------- */
route('GET', '/api/products', async () => json(await data.listProducts()));
route('POST', '/api/products', async (req, s) => {
  const b = await body(req);
  return json(await data.saveProduct(null, { ...blankProduct(), ...b }, who(s)), 201);
});
route('PUT', '/api/products/:id', async (req, s, url, p) => {
  const prev = (await data.listProducts()).find(x => x.id === p.id);
  if (!prev) throw new HttpError(404, '제품을 찾지 못했습니다.');
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
  const ads = await data.allAds(from, to);
  const settings = await data.getSettings();
  const products = await data.listProducts();
  const list = A.campaignSummary(ads.campaigns, ads.rows, settings.campaignLinks || {}, products);
  return json({ from, to, campaigns: list, errors: ads.errors, modes: ads.modes, products: products.map(p => ({ id: p.id, name: p.name, beRoas: calc(p).beRoas })) });
});
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
  return new Response(null, { status: 302, headers: { location: C.authorizeUrl(origin + '/api/cafe24/callback', state) } });
});
route('GET', '/api/cafe24/callback', async (req, s, url) => {
  const origin = url.origin;
  const back = (q) => new Response(null, { status: 302, headers: { location: `${origin}/#/settings?cafe24=${q}` } });
  const st = verifyState(url.searchParams.get('state'));
  if (!st || st.k !== 'cafe24') return back('state');
  const code = url.searchParams.get('code');
  if (!code) return back('denied');
  try { await C.exchangeCode(code, origin + '/api/cafe24/callback'); await data.addLog({ who: '관리자', kind: '연동', target: '카페24', detail: '연결 완료' }); return back('ok'); }
  catch (e) { console.error(e); return back('fail'); }
}, { public: true });

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
