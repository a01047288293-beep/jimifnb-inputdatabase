// 실제 연동 어댑터 테스트: 외부 API 응답을 흉내 내어 요청 형식과 변환을 확인
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.LOCAL_STORE_DIR = mkdtempSync(path.join(tmpdir(), 'jimi-live-'));
Object.assign(process.env, {
  ADMIN_PASSWORD: 'test-password-1', SESSION_SECRET: 'test-secret-0123456789',
  CAFE24_MALL_ID: 'jimifnb0901', CAFE24_CLIENT_ID: 'cid', CAFE24_CLIENT_SECRET: 'csecret',
  META_ACCESS_TOKEN: 'mtok', META_AD_ACCOUNT_ID: 'act_123',
  GOOGLE_ADS_DEVELOPER_TOKEN: 'dev', GOOGLE_ADS_CLIENT_ID: 'gid', GOOGLE_ADS_CLIENT_SECRET: 'gsec', GOOGLE_ADS_REFRESH_TOKEN: 'gref', GOOGLE_ADS_CUSTOMER_ID: '123-456-7890',
  TIKTOK_ACCESS_TOKEN: 'ttok', TIKTOK_ADVERTISER_ID: '777', ANTHROPIC_API_KEY: 'sk-test'
});

const calls = [];
const handlers = [];
const on = (match, fn) => handlers.push({ match, fn });
globalThis.fetch = async (url, opt = {}) => {
  url = String(url);
  calls.push({ url, opt });
  const h = handlers.find(x => (typeof x.match === 'string' ? url.includes(x.match) : x.match.test(url)));
  if (!h) return new Response(JSON.stringify({ error: { message: 'no mock ' + url } }), { status: 404 });
  const r = await h.fn(url, opt);
  return new Response(JSON.stringify(r.body ?? r), { status: r.status || 200 });
};

const C = await import('../netlify/lib/cafe24.mjs');
const M = await import('../netlify/lib/meta.mjs');
const G = await import('../netlify/lib/google.mjs');
const T = await import('../netlify/lib/tiktok.mjs');
const data = await import('../netlify/lib/data.mjs');
const { draftReply } = await import('../netlify/lib/ai.mjs');
const { runSync } = await import('../netlify/lib/sync.mjs');

test('카페24: 인증 코드 교환, 토큰 저장, 만료 전 갱신', async () => {
  let n = 0;
  on('/oauth/token', (url, opt) => {
    n++;
    assert.equal(opt.headers.Authorization, 'Basic ' + Buffer.from('cid:csecret').toString('base64'));
    const p = new URLSearchParams(opt.body);
    assert.ok(['authorization_code', 'refresh_token'].includes(p.get('grant_type')));
    const soon = p.get('grant_type') === 'authorization_code';
    return { access_token: 'at' + n, refresh_token: 'rt' + n, expires_at: new Date(Date.now() + (soon ? 10 : 120) * 60000).toISOString(), refresh_token_expires_at: new Date(Date.now() + 14 * 86400000).toISOString() };
  });
  assert.equal(await data.mode('cafe24'), 'demo', '키만 있고 연결 전에는 데모');
  const u = new URL(C.authorizeUrl('https://x.netlify.app/api/cafe24/callback', 'st'));
  assert.equal(u.host, 'jimifnb0901.cafe24api.com'); assert.equal(u.searchParams.get('client_id'), 'cid');
  await C.exchangeCode('code1', 'https://x/cb');
  assert.equal(await data.mode('cafe24'), 'live');
  const t = await C.ensureToken(); // 10분 남음 → 갱신
  assert.equal(t.access_token, 'at2');
  const t2 = await C.ensureToken(); // 120분 남음 → 그대로
  assert.equal(t2.access_token, 'at2');
});

test('카페24: 주문 페이지 넘김·변환, 게시판 답변 여부, 송장 등록 형식', async () => {
  const mk = i => ({ order_id: `20260929-${String(i).padStart(7, '0')}`, payment_date: '2026-09-29T10:00:00+09:00', payment_amount: '34900.00', canceled: 'F', buyer_name: '김민웅', order_status: 'N20',
    items: [{ order_item_code: `it${i}`, product_no: 101, product_name: '불고기', quantity: 1, product_price: '34900.00', order_status: 'N20' }] });
  on('/admin/orders?', url => {
    const q = new URL(url).searchParams;
    assert.equal(q.get('date_type'), 'pay_date'); assert.equal(q.get('embed'), 'items');
    const off = Number(q.get('offset'));
    return { orders: off === 0 ? Array.from({ length: 100 }, (_, i) => mk(i)) : [mk(100), mk(101)] };
  });
  const orders = await C.fetchOrders('2026-09-29', '2026-09-29');
  assert.equal(orders.length, 102);
  assert.deepEqual({ id: orders[0].id, date: orders[0].date, amount: orders[0].amount, buyer: orders[0].buyer, status: orders[0].status, qty: orders[0].items[0].qty },
    { id: '20260929-0000000', date: '2026-09-29', amount: 34900, buyer: '김*웅', status: 'N20', qty: 1 });
  const lastCall = calls.filter(c => c.url.includes('/admin/orders?')).at(-1);
  assert.equal(lastCall.opt.headers['X-Cafe24-Api-Version'], '2026-09-01');
  assert.match(lastCall.opt.headers.Authorization, /^Bearer at/);

  on('/admin/boards/4/articles', () => ({ articles: [
    { article_no: 10, title: '배송 문의', content: '<p>언제 오나요</p>', writer: '박지우', created_date: '2026-09-28T10:00:00+09:00' },
    { article_no: 11, title: 'RE: 배송 문의', parent_article_no: 10, content: '답변', writer: '지미' },
    { article_no: 12, title: '보관', content: '냉동?', writer: '최하준', reply_status: 'N' },
    { article_no: 13, title: '포장', content: '카드?', writer: '정서아', reply_status: 'T' }] }));
  on(/\/admin\/boards\?/, () => ({ boards: [{ board_no: 4, board_name: '상품 Q&A' }, { board_no: 1, board_name: '공지사항' }] }));
  const arts = await C.fetchArticles('2026-09-01', '2026-09-29');
  assert.deepEqual(arts.map(a => [a.articleNo, a.answered]), [[10, true], [12, false], [13, true]]);
  assert.equal(arts[0].content, '언제 오나요'); assert.equal(arts[0].writer, '박*우');

  let shipBody = null;
  on('/shipments', (url, opt) => { shipBody = JSON.parse(opt.body); assert.equal(opt.method, 'POST'); return { shipments: [{}] }; });
  await C.createShipment('20260929-0000001', ['it1'], '0006', '612345678901');
  assert.deepEqual(shipBody, { shop_no: 1, request: { tracking_no: '612345678901', shipping_company_code: '0006', status: 'shipping', order_item_code: ['it1'] } });

  let replyBody = null;
  handlers.unshift({ match: /\/admin\/boards\/4\/articles$/, fn: (url, opt) => { replyBody = JSON.parse(opt.body); return { articles: [{}] }; } });
  await C.replyArticle(4, 12, '보관', '냉동 6개월입니다.', '지미에프앤비');
  assert.equal(replyBody.requests[0].parent_article_no, 12); assert.equal(replyBody.requests[0].title, 'RE: 보관');
});

test('카페24: 오류 응답과 만료 처리', async () => {
  handlers.unshift({ match: '/admin/carriers', fn: () => ({ status: 403, body: { error: { code: 403, message: 'Access denied' } } }) });
  await assert.rejects(() => C.fetchCarriers(), /카페24 오류\(403\): Access denied/);
});

test('메타: 캠페인·인사이트 변환, 구매 중복 방지, 상태·예산 변경', async () => {
  on('/act_123/campaigns', url => {
    const u = new URL(url); assert.equal(u.searchParams.get('access_token'), 'mtok'); assert.match(u.pathname, /^\/v26\.0\//);
    return { data: [{ id: '1', name: 'A', status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '50000' }, { id: '2', name: 'B', status: 'PAUSED', effective_status: 'PAUSED' }, { id: '3', name: 'C', status: 'ACTIVE', effective_status: 'DELETED' }] };
  });
  let page = 0;
  on('/act_123/insights', url => {
    const u = new URL(url);
    if (page++ === 0) {
      assert.equal(u.searchParams.get('level'), 'campaign'); assert.equal(u.searchParams.get('time_increment'), '1');
      assert.deepEqual(JSON.parse(u.searchParams.get('time_range')), { since: '2026-09-20', until: '2026-09-21' });
      return { data: [{ campaign_id: '1', campaign_name: 'A', date_start: '2026-09-20', spend: '12345.67', impressions: '1000', clicks: '30',
        actions: [{ action_type: 'purchase', value: '3' }, { action_type: 'omni_purchase', value: '3' }, { action_type: 'offsite_conversion.fb_pixel_purchase', value: '3' }],
        action_values: [{ action_type: 'purchase', value: '104700' }, { action_type: 'omni_purchase', value: '104700' }] }], paging: { next: 'https://graph.facebook.com/v26.0/act_123/insights?after=x' } };
    }
    return { data: [{ campaign_id: '1', campaign_name: 'A', date_start: '2026-09-21', spend: '100', impressions: '1', clicks: '0' }] };
  });
  const camps = await M.metaCampaigns();
  assert.deepEqual(camps.map(c => [c.id, c.status, c.dailyBudget]), [['1', 'on', 50000], ['2', 'off', null]]);
  const rows = await M.metaRows('2026-09-20', '2026-09-21');
  assert.equal(rows.length, 2); assert.equal(rows[0].purchases, 3, '중복 집계하지 않음'); assert.equal(rows[0].revenue, 104700); assert.equal(rows[1].purchases, 0);
  let posted = null;
  on(/graph\.facebook\.com\/v26\.0\/1$/, (url, opt) => { posted = new URLSearchParams(opt.body); return { success: true }; });
  await M.metaSetStatus('1', false); assert.equal(posted.get('status'), 'PAUSED');
  await M.metaSetBudget({ id: '1', dailyBudget: 50000 }, 40000); assert.equal(posted.get('daily_budget'), '40000');
  await assert.rejects(() => M.metaSetBudget({ id: '2', dailyBudget: null }, 40000), /광고세트/);
});

test('구글: 토큰 갱신, 검색 페이지, 마이크로 단위 변환, 상태·예산 변경', async () => {
  on('oauth2.googleapis.com/token', (url, opt) => { assert.equal(new URLSearchParams(opt.body).get('grant_type'), 'refresh_token'); return { access_token: 'gat', expires_in: 3599 }; });
  let n = 0;
  on('googleAds:search', (url, opt) => {
    assert.match(url, /\/v25\/customers\/1234567890\//);
    assert.equal(opt.headers['developer-token'], 'dev'); assert.equal(opt.headers.Authorization, 'Bearer gat');
    const q = JSON.parse(opt.body);
    if (q.query.includes('segments.date')) {
      assert.match(q.query, /BETWEEN '2026-09-20' AND '2026-09-21'/);
      if (!q.pageToken) return { results: [{ campaign: { id: '55', name: 'G' }, segments: { date: '2026-09-20' }, metrics: { costMicros: '12345000000', impressions: '10', clicks: '2', conversions: 1.5, conversionsValue: 50000 } }], nextPageToken: 'p2' };
      return { results: [{ campaign: { id: '55', name: 'G' }, segments: { date: '2026-09-21' }, metrics: { costMicros: '0' } }] };
    }
    n++;
    return { results: [{ campaign: { id: '55', name: 'G', status: 'ENABLED', campaignBudget: 'customers/1234567890/campaignBudgets/9' }, campaignBudget: { amountMicros: '40000000000' } }] };
  });
  const camps = await G.googleCampaigns();
  assert.deepEqual(camps[0], { platform: 'google', id: '55', name: 'G', status: 'on', dailyBudget: 40000, budgetId: 'customers/1234567890/campaignBudgets/9' });
  const rows = await G.googleRows('2026-09-20', '2026-09-21');
  assert.equal(rows.length, 2); assert.equal(rows[0].spend, 12345); assert.equal(rows[0].purchases, 1.5);
  let body = null;
  on('campaigns:mutate', (url, opt) => { body = JSON.parse(opt.body); return { results: [{}] }; });
  on('campaignBudgets:mutate', (url, opt) => { body = JSON.parse(opt.body); return { results: [{}] }; });
  await G.googleSetStatus('55', false);
  assert.deepEqual(body.operations[0], { updateMask: 'status', update: { resourceName: 'customers/1234567890/campaigns/55', status: 'PAUSED' } });
  await G.googleSetBudget(camps[0], 50000);
  assert.equal(body.operations[0].update.amountMicros, '50000000000');
  assert.equal(calls.filter(c => c.url.includes('oauth2.googleapis.com')).length, 1, '토큰 재사용');
  void n;
});

test('틱톡: 오류 코드 처리, 리포트 변환, 상태 변경 형식', async () => {
  on('campaign/get/', url => {
    assert.equal(new URL(url).searchParams.get('advertiser_id'), '777');
    return { code: 0, message: 'OK', data: { list: [{ campaign_id: 88, campaign_name: '숏폼', operation_status: 'ENABLE', budget: 20000, budget_mode: 'BUDGET_MODE_DAY' }], page_info: { page: 1, total_page: 1 } } };
  });
  on('report/integrated/get/', url => {
    const q = new URL(url).searchParams;
    assert.deepEqual(JSON.parse(q.get('dimensions')), ['campaign_id', 'stat_time_day']);
    return { code: 0, data: { list: [{ dimensions: { campaign_id: '88', stat_time_day: '2026-09-20 00:00:00' }, metrics: { spend: '15000.00', impressions: '900', clicks: '40', complete_payment: '2', total_complete_payment_rate: '79800' } }], page_info: { page: 1, total_page: 1 } } };
  });
  const camps = await T.tiktokCampaigns();
  assert.deepEqual([camps[0].id, camps[0].status, camps[0].dailyBudget], ['88', 'on', 20000]);
  const rows = await T.tiktokRows('2026-09-20', '2026-09-20');
  assert.deepEqual({ date: rows[0].date, name: rows[0].name, spend: rows[0].spend, purchases: rows[0].purchases, revenue: rows[0].revenue }, { date: '2026-09-20', name: '숏폼', spend: 15000, purchases: 2, revenue: 79800 });
  let body = null;
  on('campaign/status/update/', (url, opt) => { body = JSON.parse(opt.body); assert.equal(opt.headers['Access-Token'], 'ttok'); return { code: 0, data: {} }; });
  await T.tiktokSetStatus('88', false);
  assert.deepEqual(body, { advertiser_id: '777', campaign_ids: ['88'], operation_status: 'DISABLE' });
  handlers.unshift({ match: 'campaign/update/', fn: () => ({ code: 40002, message: 'budget too low' }) });
  await assert.rejects(() => T.tiktokSetBudget(camps[0], 100), /틱톡 오류: budget too low/);
});

test('실제 모드 전체 흐름: 캐시·한 매체 실패해도 나머지 표시·동기화', async () => {
  const all = await data.allAds('2026-09-20', '2026-09-21');
  assert.deepEqual(all.modes, { meta: 'live', google: 'live', tiktok: 'live' });
  assert.ok(all.rows.length >= 4);
  // 지난 날짜는 캐시에서 읽어 외부 호출이 늘지 않아야 함
  const before = calls.length;
  await data.adRows('meta', '2026-09-20', '2026-09-21');
  assert.equal(calls.length, before, '지난 날짜는 저장본 사용');
  handlers.unshift({ match: 'googleAds:search', fn: () => ({ status: 500, body: { error: { message: 'internal' } } }) });
  const partial = await data.allAds('2026-09-22', '2026-09-22');
  assert.equal(partial.errors.length, 1); assert.equal(partial.errors[0].platform, 'google');
  handlers.shift();
  const r = await runSync('test');
  assert.ok(r.steps.find(s => s.name === '카페24 연결 유지').ok);
});

test('AI 답변 초안 요청 형식', async () => {
  on('api.anthropic.com/v1/messages', (url, opt) => {
    assert.equal(opt.headers['x-api-key'], 'sk-test'); assert.equal(opt.headers['anthropic-version'], '2023-06-01');
    const b = JSON.parse(opt.body); assert.equal(b.messages[0].role, 'user'); assert.match(b.system, /지어내지 말고/);
    return { content: [{ type: 'text', text: '안녕하세요, 지미에프앤비입니다.' }] };
  });
  assert.equal(await draftReply({ title: '배송', content: '언제 와요?' }), '안녕하세요, 지미에프앤비입니다.');
});
