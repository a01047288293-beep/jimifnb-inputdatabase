// API 통합 테스트 (데모 모드, 파일 저장소)
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.LOCAL_STORE_DIR = mkdtempSync(path.join(tmpdir(), 'jimi-api-'));
process.env.ADMIN_PASSWORD = 'test-password-1';
process.env.SESSION_SECRET = 'test-secret-0123456789';
for (const k of Object.keys(process.env)) if (/^(CAFE24|META|GOOGLE_ADS|TIKTOK|ANTHROPIC)_/.test(k)) delete process.env[k];
const { default: api } = await import('../netlify/functions/api.mjs');

let cookie = '';
async function call(method, p, body, { auth = true, csrf = true, ip = '1.1.1.1' } = {}) {
  const headers = { 'x-forwarded-for': ip };
  if (auth && cookie) headers.cookie = cookie;
  if (csrf) headers['x-jimi'] = '1';
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await api(new Request('http://localhost' + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* 본문 없음 */ }
  return { status: res.status, json, headers: res.headers };
}

test('로그인: 잘못된 비밀번호, 잠금, 정상 로그인, 로그인 없이 차단', async () => {
  assert.equal((await call('GET', '/api/home', undefined, { auth: false })).status, 401);
  assert.equal((await call('POST', '/api/login', { password: 'nope' }, { ip: '9.9.9.9' })).status, 401);
  for (let i = 0; i < 4; i++) await call('POST', '/api/login', { password: 'nope' }, { ip: '9.9.9.9' });
  const locked = await call('POST', '/api/login', { password: 'test-password-1' }, { ip: '9.9.9.9' });
  assert.equal(locked.status, 429, '5번 틀리면 잠금');
  const ok = await call('POST', '/api/login', { password: 'test-password-1', name: '김민웅' });
  assert.equal(ok.status, 200);
  cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await call('GET', '/api/me')).json.name, '김민웅');
  const forged = await api(new Request('http://localhost/api/home', { headers: { cookie: cookie.slice(0, -3) + 'abc' } }));
  assert.equal(forged.status, 401, '위조 쿠키 거부');
});

test('쓰기 요청은 전용 헤더 없으면 거부', async () => {
  assert.equal((await call('PUT', '/api/settings', { csWriter: 'x' }, { csrf: false })).status, 403);
});

test('홈·주문·CS·매출 (데모)', async () => {
  const s = await call('GET', '/api/status');
  assert.equal(s.json.modes.cafe24, 'demo');
  const h = await call('GET', '/api/home');
  assert.equal(h.status, 200); assert.equal(h.json.series.length, 14); assert.deepEqual(h.json.errors, []);
  const o = await call('GET', '/api/orders?from=2026-09-01&to=2026-09-29');
  assert.equal(o.status, 200); assert.ok(o.json.orders.length > 50); assert.ok(o.json.orders[0].statusLabel);
  assert.equal((await call('GET', '/api/orders?from=2026-01-01&to=2026-09-29')).status, 400, '31일 초과 거부');
  assert.equal((await call('GET', '/api/orders?from=2026-09-29&to=2026-09-01')).status, 400);
  const ready = o.json.orders.find(x => ['N10', 'N20'].includes(x.status));
  const carriers = await call('GET', '/api/carriers');
  assert.equal((await call('POST', `/api/orders/${ready.id}/shipment`, { carrierCode: carriers.json[0].code, trackingNo: '12' })).status, 400, '짧은 송장번호 거부');
  assert.equal((await call('POST', `/api/orders/${ready.id}/shipment`, { carrierCode: carriers.json[0].code, trackingNo: '6123-4567-8901', itemCodes: [] })).status, 200);
  const cs = await call('GET', '/api/cs');
  const open = cs.json.articles.find(a => !a.answered);
  assert.equal((await call('POST', '/api/cs/reply', { boardNo: open.boardNo, articleNo: open.articleNo, content: '짧' })).status, 400);
  assert.equal((await call('POST', '/api/cs/reply', { boardNo: open.boardNo, articleNo: open.articleNo, title: open.title, content: '안녕하세요, 내일 출고됩니다.' })).status, 200);
  const cs2 = await call('GET', '/api/cs');
  assert.equal(cs2.json.articles.find(a => a.articleNo === open.articleNo).answered, true);
  assert.equal((await call('POST', '/api/cs/draft', { title: 'a', content: 'b' })).status, 409, 'AI 키 없으면 안내');
  const sales = await call('GET', '/api/sales?from=2026-09-01&to=2026-09-29');
  assert.equal(sales.status, 200); assert.equal(sales.json.series.length, 29);
});

test('제품: 예시 생성·수정·삭제, 매출과 광고 판정 연결', async () => {
  const ex = await call('POST', '/api/products/examples');
  assert.equal(ex.status, 201); assert.equal(ex.json.length, 3);
  const list = (await call('GET', '/api/products')).json;
  assert.equal(list.length, 3);
  const p = list.find(x => x.cafe24ProductNos.includes(101));
  const put = await call('PUT', `/api/products/${p.id}`, { ...p, price: 36900 });
  assert.equal(put.json.price, 36900);
  assert.equal((await call('PUT', '/api/products/none', { name: 'x' })).status, 404);
  const sales = await call('GET', '/api/sales?from=2026-09-01&to=2026-09-29');
  assert.ok(sales.json.products.find(x => x.productNo === 101).linked);
  const ads = await call('GET', '/api/ads?from=2026-09-23&to=2026-09-29');
  const linked = ads.json.campaigns.find(c => c.key === 'meta:m-1001');
  assert.equal(linked.productId, p.id); assert.ok(linked.beRoas > 0); assert.ok(['good', 'warn', 'bad'].includes(linked.verdict));
  const created = await call('POST', '/api/products', { name: '신제품 테스트' });
  assert.equal(created.status, 201);
  assert.equal((await call('DELETE', `/api/products/${created.json.id}`)).status, 200);
  assert.equal((await call('GET', '/api/products')).json.length, 3);
});

test('광고: 켜기/끄기·예산·최소 예산·연결', async () => {
  assert.equal((await call('POST', '/api/ads/status', { platform: 'meta', id: 'm-1002', on: false })).status, 200);
  let ads = await call('GET', '/api/ads?from=2026-09-29&to=2026-09-29');
  assert.equal(ads.json.campaigns.find(c => c.key === 'meta:m-1002').status, 'off');
  assert.equal((await call('POST', '/api/ads/budget', { platform: 'meta', id: 'm-1001', budget: 5000 })).status, 400, '최소 예산 미만 거부');
  assert.equal((await call('POST', '/api/ads/budget', { platform: 'meta', id: 'm-1001', budget: 60000 })).status, 200);
  ads = await call('GET', '/api/ads?from=2026-09-29&to=2026-09-29');
  assert.equal(ads.json.campaigns.find(c => c.key === 'meta:m-1001').dailyBudget, 60000);
  assert.equal((await call('POST', '/api/ads/status', { platform: 'naver', id: 'x', on: true })).status, 400);
  assert.equal((await call('POST', '/api/ads/link', { platform: 'google', id: 'g-2002', productId: null })).status, 200);
  assert.equal((await call('POST', '/api/ads/status', { platform: 'meta', id: 'm-1002', on: true })).status, 200);
});

test('자동 규칙: 저장·미리보기·모의 실행·실제 실행·대기 시간', async () => {
  const bad = await call('POST', '/api/rules', { name: '' });
  assert.equal(bad.status, 400);
  const rule = { name: '테스트: 손익분기 미달 끄기', enabled: true, platform: 'all', campaignMatch: '', window: '7d', conditions: [{ metric: 'roasVsBe', op: '<', value: 1 }], action: { type: 'pause', pct: 0 }, cooldownHours: 12 };
  const saved = await call('POST', '/api/rules', rule);
  assert.equal(saved.status, 201);
  const pv = await call('POST', '/api/rules/preview', rule);
  const hits = pv.json.matches.filter(m => !m.skipped);
  assert.ok(hits.length >= 1, '손익분기 미달 캠페인이 있어야 함 (틱톡 데모)');
  const dry = await call('POST', '/api/rules/run');
  assert.equal(dry.json.dryRun, true);
  assert.equal(dry.json.actions.length, hits.length);
  let ads = await call('GET', '/api/ads?from=2026-09-29&to=2026-09-29');
  for (const h of hits) assert.equal(ads.json.campaigns.find(c => c.key === h.key).status, 'on', '모의 실행은 끄지 않음');
  await call('PUT', '/api/settings', { rulesDryRun: false });
  const real = await call('POST', '/api/rules/run');
  assert.equal(real.json.dryRun, false);
  assert.ok(real.json.actions.every(a => a.done), JSON.stringify(real.json));
  ads = await call('GET', '/api/ads?from=2026-09-29&to=2026-09-29');
  for (const h of hits) assert.equal(ads.json.campaigns.find(c => c.key === h.key).status, 'off', '실제 실행은 끔');
  const again = await call('POST', '/api/rules/run');
  assert.equal(again.json.actions.length, 0, '이미 꺼진 캠페인은 대상 아님');
  const log = await call('GET', '/api/log');
  assert.ok(log.json.some(l => l.kind === '광고 끄기' && l.who.includes('수동 실행')));
  assert.ok(log.json.some(l => l.kind === '모의 실행'));
  const rid = saved.json.id;
  assert.equal((await call('PUT', `/api/rules/${rid}`, { ...rule, enabled: false })).json.enabled, false);
  assert.equal((await call('DELETE', `/api/rules/${rid}`)).status, 200);
  assert.equal((await call('GET', '/api/rules')).json.rules.length, 0);
});

test('설정 검증과 수동 수집', async () => {
  assert.equal((await call('PUT', '/api/settings', { minBudget: -5 })).status, 400);
  const st = await call('PUT', '/api/settings', { csWriter: '지미에프앤비 CS', maxBudgetChangePct: 300 });
  assert.equal(st.json.maxBudgetChangePct, 100);
  const sync = await call('POST', '/api/sync');
  assert.equal(sync.status, 200); assert.deepEqual(sync.json.errors, []);
  assert.ok((await call('GET', '/api/status')).json.sync.at);
});

test('카페24 연결: 키 없으면 안내, 잘못된 state 거부', async () => {
  assert.equal((await call('GET', '/api/cafe24/connect')).status, 400);
  const cb = await api(new Request('http://localhost/api/cafe24/callback?code=x&state=bad'));
  assert.equal(cb.status, 302); assert.match(cb.headers.get('location'), /cafe24=state/);
  assert.equal((await call('GET', '/api/없는주소')).status, 404);
  assert.equal((await call('POST', '/api/logout')).status, 200);
});
