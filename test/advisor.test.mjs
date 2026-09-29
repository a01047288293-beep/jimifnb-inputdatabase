// AI 참모 테스트 (데모 데이터 + AI 응답 흉내)
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.LOCAL_STORE_DIR = mkdtempSync(path.join(tmpdir(), 'jimi-adv-'));
process.env.ADMIN_PASSWORD = 'test-password-1';
process.env.SESSION_SECRET = 'test-secret-0123456789';
for (const k of Object.keys(process.env)) if (/^(CAFE24|META|GOOGLE_ADS|TIKTOK|ANTHROPIC)_/.test(k)) delete process.env[k];

const sent = [];
let script = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt) => {
  if (String(url).startsWith('https://api.anthropic.com/')) {
    const body = JSON.parse(opt.body); sent.push(body);
    const next = script.shift();
    return new Response(JSON.stringify(typeof next === 'function' ? next(body) : next), { status: 200 });
  }
  return realFetch(url, opt);
};
const { default: api } = await import('../netlify/functions/api.mjs');
const ADV = await import('../netlify/lib/advisor.mjs');

let cookie = '';
async function call(method, p, body) {
  const headers = { 'x-forwarded-for': '9.9.9.9', 'x-jimi': '1' };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await api(new Request('http://localhost' + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, headers: res.headers };
}

test('AI 참모: 키 없으면 안내, 로그인 필요', async () => {
  assert.equal((await call('GET', '/api/advisor')).status, 401);
  const r = await call('POST', '/api/login', { name: '김민웅', password: 'test-password-1' });
  cookie = r.headers.get('set-cookie').split(';')[0];
  const a = await call('GET', '/api/advisor');
  assert.equal(a.json.configured, false);
  assert.equal((await call('POST', '/api/advisor/step', { messages: [{ role: 'user', content: '안녕' }] })).status, 409);
});

test('AI 참모: 스냅샷을 보고 도구로 조회하고, 제안은 사람이 실행', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  const snapCheck = body => {
    const sys = body.system[0].text;
    assert.match(sys, /스냅샷/); assert.match(sys, /캠페인/); assert.ok(!/010-|받는 분|주소/.test(sys), '개인정보 없음');
    assert.ok(body.tools.some(t => t.name === 'propose_action'));
    return { stop_reason: 'tool_use', content: [
      { type: 'text', text: '광고 보고서를 확인하겠습니다.' },
      { type: 'tool_use', id: 't1', name: 'get_ad_report', input: { from: '2026-09-16', to: '2026-09-29' } },
      { type: 'tool_use', id: 't2', name: 'propose_action', input: { type: 'pause', key: 'tiktok:t-3001', reason: 'ROAS 0.7배로 손익분기 미달' } },
      { type: 'tool_use', id: 't3', name: 'propose_action', input: { type: 'budget', key: 'meta:m-1001', new_budget: 200000, reason: '과도한 증액' } }
    ] };
  };
  script = [snapCheck, body => {
    const last = body.messages[body.messages.length - 1];
    const results = last.content;
    assert.equal(results.length, 3);
    assert.match(results[0].content, /캠페인/);
    assert.match(results[1].content, /제안_생성됨/);
    assert.ok(results[2].is_error || /넘게 바꿀 수 없습니다/.test(results[2].content), '예산 한도 초과는 거절');
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: '**틱톡 떡갈비 캠페인을 끄는 것을 권합니다.**\n- ROAS 0.7배' }] };
  }];
  let msgs = [{ role: 'user', content: '광고비 어디를 줄일까?' }];
  const s1 = await call('POST', '/api/advisor/step', { messages: msgs });
  assert.equal(s1.status, 200); assert.equal(s1.json.done, false);
  assert.deepEqual(s1.json.activity, ['get_ad_report', 'propose_action', 'propose_action']);
  assert.equal(s1.json.proposals.length, 1);
  const prop = s1.json.proposals[0];
  assert.equal(prop.type, 'pause'); assert.equal(prop.state, 'open');
  const s2 = await call('POST', '/api/advisor/step', { messages: s1.json.messages, proposalIds: [prop.id] });
  assert.equal(s2.json.done, true); assert.match(s2.json.text, /틱톡/);
  // 저장된 대화 불러오기
  const g = await call('GET', '/api/advisor');
  assert.equal(g.json.messages.length, 4); assert.equal(g.json.proposals[0].id, prop.id);
  // 사람이 실행 → 데모 캠페인 꺼짐, 이력 기록
  const run = await call('POST', `/api/advisor/proposals/${prop.id}/run`);
  assert.equal(run.status, 200); assert.equal(run.json.state, 'done');
  const ads = await call('GET', '/api/ads?from=2026-09-23&to=2026-09-29');
  assert.equal(ads.json.campaigns.find(c => c.key === 'tiktok:t-3001').status, 'off');
  assert.equal((await call('POST', `/api/advisor/proposals/${prop.id}/run`)).status, 409, '두 번 실행 불가');
  const log = await call('GET', '/api/log');
  assert.ok(log.json.some(l => /AI 참모 제안/.test(l.detail)));
});

test('AI 참모: 잘린 대화는 질문부터 시작, 새 대화', async () => {
  const msgs = [{ role: 'user', content: 'q1' }, { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'x', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: '{}' }] }, { role: 'assistant', content: 'a' }, { role: 'user', content: 'q2' }];
  assert.deepEqual(ADV.trimSafe(msgs, 4).map(m => m.content), ['a', 'q2'].slice(1), '도구 결과로 시작하지 않음');
  assert.equal(ADV.trimSafe(msgs, 5)[0].content, 'q1');
  assert.equal((await call('POST', '/api/advisor/reset')).status, 200);
  assert.equal((await call('GET', '/api/advisor')).json.messages.length, 0);
});
