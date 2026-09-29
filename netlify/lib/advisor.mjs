// AI 참모: 운영실 데이터를 보고 매출·광고비 의사결정을 돕는 대화형 도우미
// - 한 번의 요청 = AI 호출 1번 (도구가 필요하면 결과를 붙여 돌려주고, 화면이 다음 단계를 이어서 요청)
// - 광고 켜기/끄기·예산 변경은 직접 실행하지 않고 "제안"만 만든다. 실행은 사람이 버튼으로.
import { httpJson, HttpError, kstDate, addDays, isYmd, dateRange, num, newId } from './util.mjs';
import { getJSON, setJSON } from './store.mjs';
import * as data from './data.mjs';
import { adAnalysis, salesReport, snapshot } from './reports.mjs';

export function advisorConfigured() { return Boolean(process.env.ANTHROPIC_API_KEY); }
const MODEL = () => process.env.ANTHROPIC_ADVISOR_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const PLAT = { meta: '메타', google: '구글', tiktok: '틱톡' };
const r2 = x => (x == null || !isFinite(x) ? null : Math.round(x * 100) / 100);
const w = x => (x == null || !isFinite(x) ? null : Math.round(x));

export const TOOLS = [
  {
    name: 'get_sales_report',
    description: '자사몰(카페24) 기간 매출 보고서: 매출·주문·객단가, 일별 매출, 요일 평균, 결제수단·유입경로, 상품 순위, 이전 같은 길이 기간과 비교. 기간은 최대 92일.',
    input_schema: { type: 'object', properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['from', 'to'] }
  },
  {
    name: 'get_ad_report',
    description: '광고 보고서(메타·구글): 기간 광고비·ROAS·CPA, 매체별 비교, 캠페인별 성과와 손익분기 판정·코멘트, 소재 문제, 퍼널, 제품별 광고 후 이익, 이전 기간 비교. 기간은 최대 92일.',
    input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] }
  },
  {
    name: 'get_campaign_detail',
    description: '캠페인 하나의 일별 광고비·ROAS·구매 추이와 소속 소재별 성과. key는 스냅샷의 캠페인 key(예: meta:123).',
    input_schema: { type: 'object', properties: { key: { type: 'string' }, days: { type: 'integer', description: '최근 며칠 (기본 14, 최대 60)' } }, required: ['key'] }
  },
  {
    name: 'propose_action',
    description: '광고 조치 제안을 만든다(실행 아님). 대표가 화면에서 확인 후 실행 버튼을 눌러야 적용된다. pause=끄기, resume=켜기, budget=일 예산 변경(new_budget 원). 근거가 되는 숫자를 reason에 짧게.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['pause', 'resume', 'budget'] },
        key: { type: 'string', description: '캠페인 key (예: meta:123)' },
        new_budget: { type: 'integer', description: 'type=budget 일 때 새 일 예산(원)' },
        reason: { type: 'string', description: '한두 문장 근거' }
      },
      required: ['type', 'key', 'reason']
    }
  }
];

function period(input, max = 92) {
  const today = kstDate();
  let to = isYmd(input?.to) ? input.to : today;
  if (to > today) to = today;
  let from = isYmd(input?.from) ? input.from : addDays(to, -13);
  if (from > to) [from, to] = [to, from];
  if (dateRange(from, to).length > max) from = addDays(to, -(max - 1));
  return { from, to };
}

async function findCampaign(key) {
  const [platform, id] = [String(key).slice(0, String(key).indexOf(':')), String(key).slice(String(key).indexOf(':') + 1)];
  if (!data.PLATFORMS.includes(platform) || !id) throw new HttpError(400, `캠페인 key 형식이 올바르지 않습니다: ${key}`);
  const list = await data.campaigns(platform);
  const c = list.find(x => x.id === id);
  if (!c) throw new HttpError(404, `캠페인을 찾지 못했습니다: ${key}`);
  return c;
}

/** 도구 실행. 반환값은 AI에게 JSON으로 전달 */
export async function runTool(name, input, ctx = {}) {
  if (name === 'get_sales_report') { const { from, to } = period(input); return salesReport(from, to); }
  if (name === 'get_ad_report') {
    const { from, to } = period(input);
    const r = await adAnalysis(from, to);
    return {
      기간: `${from}~${to}`, 이전기간: `${r.prevFrom}~${r.prevTo}`, 오류: r.errors.map(e => `${PLAT[e.platform] || e.platform}: ${e.message}`),
      전체: { 광고비: w(r.ov.total.spend), 광고매출: w(r.ov.total.revenue), ROAS: r2(r.ov.total.roas), 이전ROAS: r2(r.ov.prev.roas), 이전광고비: w(r.ov.prev.spend), CPA: w(r.ov.total.cpa), 이전CPA: w(r.ov.prev.cpa), 자사몰매출: w(r.ov.shop), 이전자사몰매출: w(r.ov.prevShop), 광고비비중: r2(r.ov.spendRate) },
      매체별: r.ov.byPlatform.map(p => ({ 매체: PLAT[p.platform], 광고비: w(p.spend), 이전광고비: w(p.prev.spend), ROAS: r2(p.roas), 이전ROAS: r2(p.prev.roas), CPA: w(p.cpa), CTR퍼센트: r2(p.ctr && p.ctr * 100), CPC: w(p.cpc) })),
      요일별ROAS: r.ov.weekday.map(x => ({ 요일: '일월화수목금토'[x.dow], ROAS: r2(x.roas), 광고비: w(x.spend) })),
      캠페인: r.camps.map(c => ({ key: c.key, 이름: c.name, 상태: c.status, 일예산: c.dailyBudget, 광고비: w(c.spend), ROAS: r2(c.roas), 손익분기ROAS: r2(c.beRoas), 구매: w(c.purchases), CPA: w(c.cpa), 코멘트: c.comments.map(x => x.text) })),
      소재: r.creatives.list.slice(0, 20).map(c => ({ 이름: c.name, 캠페인: c.campaignName, 형식: c.format, 광고비: w(c.spend), ROAS: r2(c.roas), CTR퍼센트: r2(c.ctr && c.ctr * 100), 빈도: r2(c.frequency), 코멘트: c.comments.slice(0, 2).map(x => x.text) })),
      형식별: r.creatives.formats.map(f => ({ 형식: f.format, 광고비: w(f.spend), ROAS: r2(f.roas) })),
      퍼널: r.fun.total.steps.map(s => ({ 단계: s.label, 수: w(s.value), 전단계대비: r2(s.rate) })),
      제품손익: r.pl.list.map(p => ({ 제품: p.name, 자사몰매출: w(p.shopRevenue), 광고비: w(p.adSpend), 광고후이익: w(p.profit), 손익분기ROAS: r2(p.beRoas) })),
      제품미연결광고비: w(r.pl.unlinked.spend)
    };
  }
  if (name === 'get_campaign_detail') {
    const days = Math.max(3, Math.min(60, num(input?.days) || 14));
    const to = kstDate(), from = addDays(to, -(days - 1));
    const r = await adAnalysis(from, to);
    const c = r.camps.find(x => x.key === input?.key);
    if (!c) return { 오류: `기간 안에 해당 캠페인 성과가 없습니다: ${input?.key}` };
    return {
      key: c.key, 이름: c.name, 매체: PLAT[c.platform], 상태: c.status, 일예산: c.dailyBudget, 손익분기ROAS: r2(c.beRoas), 연결제품: c.productName,
      일별: c.daily.map(d => ({ 날짜: d.date, 광고비: w(d.spend), ROAS: r2(d.roas) })),
      소재: r.creatives.list.filter(x => x.campaignKey === c.key).map(x => ({ 이름: x.name, 형식: x.format, 광고비: w(x.spend), ROAS: r2(x.roas), CTR퍼센트: r2(x.ctr && x.ctr * 100), 빈도: r2(x.frequency), 코멘트: x.comments.map(y => y.text) })),
      코멘트: c.comments.map(x => x.text)
    };
  }
  if (name === 'propose_action') {
    const type = input?.type;
    if (!['pause', 'resume', 'budget'].includes(type)) return { 오류: 'type 은 pause/resume/budget 중 하나' };
    const c = await findCampaign(input.key);
    const s = await data.getSettings();
    const p = { id: newId(), at: Date.now(), by: ctx.who || '관리자', type, platform: c.platform, campaignId: c.id, key: `${c.platform}:${c.id}`, name: c.name, status: c.status, currentBudget: c.dailyBudget, reason: String(input.reason || '').slice(0, 400), state: 'open' };
    if (type === 'budget') {
      const nb = Math.round(num(input.new_budget) / 100) * 100;
      if (c.dailyBudget == null) return { 오류: '이 캠페인은 캠페인 단위 일 예산이 없어(광고세트 예산) 예산 제안을 만들 수 없습니다. 끄기/켜기만 가능합니다.' };
      if (!(nb >= s.minBudget)) return { 오류: `일 예산은 최소 ${s.minBudget}원 이상이어야 합니다.` };
      const pct = Math.abs(nb - c.dailyBudget) / (c.dailyBudget || 1) * 100;
      if (pct > s.maxBudgetChangePct) return { 오류: `한 번에 ${s.maxBudgetChangePct}% 넘게 바꿀 수 없습니다(요청 ${Math.round(pct)}%). 범위 안으로 다시 제안하세요.` };
      p.newBudget = nb;
    }
    if (type === 'pause' && c.status === 'off') return { 오류: '이미 꺼진 캠페인입니다.' };
    if (type === 'resume' && c.status === 'on') return { 오류: '이미 켜진 캠페인입니다.' };
    await setJSON(`advisor/proposals/${p.id}`, p);
    return { 제안_생성됨: true, 제안: publicProposal(p), 안내: '화면에 실행 버튼이 있는 카드로 표시됩니다. 대표가 누르기 전에는 적용되지 않습니다.' };
  }
  throw new HttpError(400, `알 수 없는 도구: ${name}`);
}
export const publicProposal = p => ({ id: p.id, type: p.type, platform: p.platform, key: p.key, name: p.name, currentBudget: p.currentBudget, newBudget: p.newBudget ?? null, reason: p.reason, state: p.state, at: p.at, doneAt: p.doneAt || null, doneBy: p.doneBy || null });

/** 제안 실행 (사람이 버튼을 눌렀을 때만) */
export async function runProposal(id, who) {
  const p = await getJSON(`advisor/proposals/${id}`);
  if (!p) throw new HttpError(404, '제안을 찾지 못했습니다.');
  if (p.state !== 'open') throw new HttpError(409, '이미 처리된 제안입니다.');
  if (Date.now() - p.at > 24 * 3600000) throw new HttpError(409, '24시간이 지난 제안입니다. 최신 숫자로 다시 물어보세요.');
  const why = `AI 참모 제안: ${p.reason}`;
  if (p.type === 'budget') await data.setCampaignBudget(p.platform, p.campaignId, p.newBudget, who, why);
  else await data.setCampaignStatus(p.platform, p.campaignId, p.type === 'resume', who, why);
  Object.assign(p, { state: 'done', doneAt: Date.now(), doneBy: who });
  await setJSON(`advisor/proposals/${id}`, p);
  return publicProposal(p);
}
export async function dismissProposal(id, who) {
  const p = await getJSON(`advisor/proposals/${id}`);
  if (!p) throw new HttpError(404, '제안을 찾지 못했습니다.');
  if (p.state === 'open') { Object.assign(p, { state: 'dismissed', doneAt: Date.now(), doneBy: who }); await setJSON(`advisor/proposals/${id}`, p); }
  return publicProposal(p);
}

async function cachedSnapshot(force = false) {
  const hit = await getJSON('cache/advisor-snapshot');
  if (!force && hit && Date.now() - hit.at < 5 * 60000) return hit.snap;
  const snap = await snapshot();
  await setJSON('cache/advisor-snapshot', { at: Date.now(), snap });
  return snap;
}

function systemPrompt(snap) {
  return [
    '당신은 한우 가공식품 제조·판매 회사 (주)지미에프앤비의 "AI 참모"입니다. 대표 김민웅에게 매출과 광고비 의사결정을 돕습니다.',
    '자사몰은 카페24(www.jimifnb0901.com), 광고는 메타·구글입니다. 금액 단위는 원, ROAS는 배수입니다.',
    '',
    '원칙',
    '- 숫자는 아래 스냅샷이나 도구 결과에 있는 것만 씁니다. 모르면 도구로 조회하고, 그래도 없으면 없다고 말합니다. 추측한 숫자를 만들지 않습니다.',
    '- 판단 기준은 손익분기 ROAS(연결 제품의 원가 기준)입니다. 손익분기 ROAS가 없는 캠페인은 "제품 미연결이라 손익 판정 불가"라고 분명히 말하고, 평균 대비 상대 효율로만 봅니다.',
    '- 매체가 보고하는 광고 매출은 기여 기간 때문에 겹치거나 부풀 수 있습니다. 전체 판단은 "자사몰 매출 ÷ 광고비"와 함께 봅니다.',
    '- 데이터 양이 적으면(구매 3건 미만, 3일 미만) 결론을 유보하고 얼마나 더 지켜봐야 하는지 말합니다.',
    '- 광고를 끄거나 예산을 바꾸자고 할 때는 propose_action 도구로 제안 카드를 만듭니다. 직접 실행되지 않으며 대표가 버튼을 눌러야 적용된다고 알려줍니다. 한 번에 최대 3개까지만 제안합니다.',
    `- 예산 변경은 한 번에 ${snap.안전장치?.한번에최대예산변경퍼센트 ?? 50}% 이내, 최소 일 예산 ${snap.안전장치?.최소일예산 ?? 10000}원 이상으로 제안합니다. 보통 증액·감액은 20% 안팎으로 단계적으로 권합니다.`,
    '- 연결 상태가 "데모"인 매체의 숫자는 연습용이라고 밝힙니다.',
    '',
    '답변 형식',
    '- 한국어, 존댓말, 짧게. 첫 줄에 결론 한 문장. 이어서 근거 숫자 2~4개, 그다음 할 일.',
    '- 표 대신 짧은 목록(- 로 시작)을 씁니다. 굵게는 **로 핵심만.',
    '- 전문 용어는 처음 나올 때 쉬운 말로 풀어줍니다(예: CPA = 구매 1건당 광고비).',
    '',
    `현재 상황 스냅샷 (${snap.오늘} 기준, 5분 이내 최신):`,
    JSON.stringify(snap)
  ].join('\n');
}

/**
 * 대화 한 단계 진행.
 * messages: Anthropic 형식 대화 (user/assistant, content 배열 가능)
 * 반환: { messages, done, text?, activity: [도구 이름], proposals: [...] }
 */
export async function step(messages, { who } = {}) {
  if (!advisorConfigured()) throw new HttpError(409, 'AI 참모를 쓰려면 Netlify에 ANTHROPIC_API_KEY 환경변수를 등록하세요.');
  if (!Array.isArray(messages) || !messages.length) throw new HttpError(400, '질문이 비어 있습니다.');
  const msgs = trimSafe(messages, 40);
  if (!msgs.length) throw new HttpError(400, '질문이 비어 있습니다.');
  const snap = await cachedSnapshot();
  const d = await httpJson('https://api.anthropic.com/v1/messages', {
    method: 'POST', label: 'AI', timeoutMs: 45000,
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL(), max_tokens: 1500,
      system: [{ type: 'text', text: systemPrompt(snap), cache_control: { type: 'ephemeral' } }],
      tools: TOOLS, messages: msgs
    })
  });
  const content = d?.content || [];
  const out = [...msgs, { role: 'assistant', content }];
  const uses = content.filter(b => b.type === 'tool_use');
  const text = content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  if (d?.stop_reason !== 'tool_use' || !uses.length) return { messages: out, done: true, text, activity: [], proposals: [] };
  const results = [], proposals = [];
  for (const u of uses) {
    let res, isError = false;
    try { res = await runTool(u.name, u.input || {}, { who }); if (res?.제안) proposals.push(res.제안); }
    catch (e) { res = { 오류: e.message }; isError = true; }
    let str = JSON.stringify(res);
    if (str.length > 60000) str = str.slice(0, 60000) + '…(생략)';
    results.push({ type: 'tool_result', tool_use_id: u.id, content: str, ...(isError ? { is_error: true } : {}) });
  }
  out.push({ role: 'user', content: results });
  return { messages: out, done: false, text, activity: uses.map(u => u.name), proposals };
}

/** 앞부분을 잘라도 대화가 '사람의 질문'으로 시작하도록 (도구 결과 중간에서 잘리면 AI가 거부함) */
const isQuestion = m => m?.role === 'user' && (typeof m.content === 'string' || (Array.isArray(m.content) && !m.content.some(b => b.type === 'tool_result')));
export function trimSafe(messages, max) {
  let msgs = messages.slice(-max);
  const i = msgs.findIndex(isQuestion);
  return i < 0 ? [] : msgs.slice(i);
}

/** 대화 저장·불러오기 (사람별 최근 대화 1개) */
const threadKey = who => `advisor/thread/${encodeURIComponent(String(who || '관리자')).slice(0, 80)}`;
export async function loadThread(who) {
  const t = await getJSON(threadKey(who));
  if (!t) return { messages: [], proposals: [] };
  const proposals = await Promise.all((t.proposalIds || []).map(async id => { const p = await getJSON(`advisor/proposals/${id}`); return p ? publicProposal(p) : null; }));
  return { messages: t.messages || [], proposals: proposals.filter(Boolean), at: t.at };
}
export async function clearThread(who) { await setJSON(threadKey(who), { at: Date.now(), messages: [], proposalIds: [] }); }
export async function saveThread(who, messages, proposalIds) {
  let msgs = Array.isArray(messages) ? trimSafe(messages, 60) : [];
  while (JSON.stringify(msgs).length > 400000 && msgs.length > 2) msgs = trimSafe(msgs.slice(1), 60);
  await setJSON(threadKey(who), { at: Date.now(), messages: msgs, proposalIds: (proposalIds || []).slice(-30) });
}
