// 광고 자동 규칙: 조건 판정(순수 함수) + 실행기
import { getJSON, setJSON, listKeys, delKey } from './store.mjs';
import { kstDate, addDays, HttpError, newId, num } from './util.mjs';
import { campaignSummary } from './analytics.mjs';
import * as data from './data.mjs';

export const METRICS = {
  spend: '광고비(원)', purchases: '구매 수', revenue: '광고 매출(원)', roas: 'ROAS(배)', cpa: '구매당 비용(원)', roasVsBe: '손익분기 대비 ROAS(배수)'
};
export const OPS = ['>=', '>', '<=', '<', '=='];
export const ACTIONS = { pause: '끄기', enable: '켜기', budget_down: '예산 줄이기', budget_up: '예산 늘리기', notify: '기록만 남기기' };
export const WINDOWS = { today: 1, '3d': 3, '7d': 7 };

export const TEMPLATES = [
  { name: '오늘 3만원 넘게 썼는데 구매 0건이면 끄기', platform: 'all', campaignMatch: '', window: 'today',
    conditions: [{ metric: 'spend', op: '>=', value: 30000 }, { metric: 'purchases', op: '==', value: 0 }], action: { type: 'pause', pct: 0 }, cooldownHours: 12 },
  { name: '3일 ROAS가 손익분기 아래면 예산 20% 줄이기', platform: 'all', campaignMatch: '', window: '3d',
    conditions: [{ metric: 'spend', op: '>=', value: 50000 }, { metric: 'roasVsBe', op: '<', value: 1 }], action: { type: 'budget_down', pct: 20 }, cooldownHours: 24 },
  { name: '7일 ROAS가 손익분기 1.5배 이상이면 예산 20% 늘리기', platform: 'all', campaignMatch: '', window: '7d',
    conditions: [{ metric: 'spend', op: '>=', value: 100000 }, { metric: 'roasVsBe', op: '>=', value: 1.5 }], action: { type: 'budget_up', pct: 20 }, cooldownHours: 72 }
];

export function validateRule(r) {
  const errs = [];
  if (!r || typeof r !== 'object') throw new HttpError(400, '규칙 형식이 올바르지 않습니다.');
  if (!String(r.name || '').trim()) errs.push('규칙 이름을 입력하세요.');
  if (!['all', ...data.PLATFORMS].includes(r.platform)) errs.push('매체를 선택하세요.');
  if (!(r.window in WINDOWS)) errs.push('기간을 선택하세요.');
  if (!Array.isArray(r.conditions) || !r.conditions.length) errs.push('조건을 1개 이상 넣으세요.');
  for (const c of r.conditions || []) {
    if (!(c.metric in METRICS)) errs.push('알 수 없는 지표가 있습니다.');
    if (!OPS.includes(c.op)) errs.push('알 수 없는 비교 방식이 있습니다.');
    if (!Number.isFinite(Number(c.value))) errs.push('조건 값은 숫자여야 합니다.');
  }
  if (!r.action || !(r.action.type in ACTIONS)) errs.push('실행할 동작을 선택하세요.');
  if (r.action && ['budget_down', 'budget_up'].includes(r.action.type) && !(num(r.action.pct) > 0 && num(r.action.pct) <= 100)) errs.push('예산 변경 비율은 1~100% 사이로 입력하세요.');
  if (errs.length) throw new HttpError(400, errs.join(' '));
  return {
    name: String(r.name).trim().slice(0, 80), enabled: Boolean(r.enabled), platform: r.platform,
    campaignMatch: String(r.campaignMatch || '').slice(0, 60), window: r.window,
    conditions: r.conditions.map(c => ({ metric: c.metric, op: c.op, value: Number(c.value) })),
    action: { type: r.action.type, pct: num(r.action.pct) }, cooldownHours: Math.max(0, num(r.cooldownHours))
  };
}

function metricValue(c, metric) {
  switch (metric) {
    case 'spend': return c.spend;
    case 'purchases': return c.purchases;
    case 'revenue': return c.revenue;
    case 'roas': return c.roas;
    case 'cpa': return c.cpa;
    case 'roasVsBe': return c.roas != null && c.beRoas ? c.roas / c.beRoas : null;
    default: return null;
  }
}
function compare(v, op, x) {
  if (v == null || !Number.isFinite(v)) return false;
  switch (op) { case '>=': return v >= x; case '>': return v > x; case '<=': return v <= x; case '<': return v < x; case '==': return Math.abs(v - x) < 1e-9; default: return false; }
}

/** 순수 판정: 캠페인 요약 목록에서 규칙에 걸리는 캠페인과 사유 */
export function matchRule(rule, summaries) {
  const out = [];
  for (const c of summaries) {
    if (rule.platform !== 'all' && c.platform !== rule.platform) continue;
    if (rule.campaignMatch && !String(c.name).includes(rule.campaignMatch)) continue;
    // 켜진 캠페인에만 끄기·예산 동작, 꺼진 캠페인에만 켜기
    if (rule.action.type === 'enable' ? c.status !== 'off' : ['pause', 'budget_down', 'budget_up'].includes(rule.action.type) && c.status !== 'on') continue;
    const reasons = []; let ok = true; let skipped = null;
    for (const cond of rule.conditions) {
      const v = metricValue(c, cond.metric);
      if (cond.metric === 'roasVsBe' && !c.beRoas) { ok = false; skipped = '제품이 연결되지 않아 손익분기 ROAS를 모름'; break; }
      if (!compare(v, cond.op, cond.value)) { ok = false; break; }
      reasons.push(`${METRICS[cond.metric]} ${fmt(v)} ${cond.op} ${fmt(cond.value)}`);
    }
    if (ok) out.push({ campaign: c, reason: reasons.join(', ') });
    else if (skipped) out.push({ campaign: c, skipped });
  }
  return out;
}
function fmt(v) { return v == null ? '-' : Math.abs(v) >= 100 ? Math.round(v).toLocaleString('ko-KR') : Math.round(v * 100) / 100; }

export function newBudget(cur, action, settings) {
  const pctChange = Math.min(num(action.pct), num(settings.maxBudgetChangePct) || 50) / 100;
  const raw = action.type === 'budget_up' ? cur * (1 + pctChange) : cur * (1 - pctChange);
  return Math.max(num(settings.minBudget), Math.round(raw / 100) * 100);
}

/* ---------- 저장 ---------- */
export async function listRules() {
  const out = [];
  for (const k of await listKeys('rules/')) { const r = await getJSON(k); if (r) out.push({ ...r, id: k.slice(6) }); }
  return out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}
export async function saveRule(id, body, who) {
  const clean = validateRule(body);
  const rid = id || newId('r');
  const prev = id ? await getJSON('rules/' + id) : null;
  if (id && !prev) throw new HttpError(404, '규칙을 찾지 못했습니다.');
  const rec = { ...clean, createdAt: prev?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), lastRun: prev?.lastRun || null };
  await setJSON('rules/' + rid, rec);
  await data.addLog({ who, kind: id ? '규칙 수정' : '규칙 추가', target: rec.name, detail: rec.enabled ? '사용 중' : '꺼짐' });
  return { ...rec, id: rid };
}
export async function deleteRule(id, who) {
  const r = await getJSON('rules/' + id);
  await delKey('rules/' + id);
  await data.addLog({ who, kind: '규칙 삭제', target: r?.name || id, detail: '' });
}

/** 규칙 기간별 캠페인 요약 */
async function summariesFor(window, cache) {
  if (cache[window]) return cache[window];
  const today = kstDate();
  const from = addDays(today, -(WINDOWS[window] - 1));
  const ads = await data.allAds(from, today);
  const s = await data.getSettings();
  const products = await data.listProducts();
  cache[window] = { list: campaignSummary(ads.campaigns, ads.rows, s.campaignLinks || {}, products), errors: ads.errors };
  return cache[window];
}

/** 미리보기(실행 안 함) */
export async function previewRule(body) {
  const rule = validateRule({ ...body, name: body.name || '미리보기' });
  const { list, errors } = await summariesFor(rule.window, {});
  return { matches: matchRule(rule, list).map(m => ({ key: m.campaign.key, platform: m.campaign.platform, name: m.campaign.name, reason: m.reason || null, skipped: m.skipped || null })), errors };
}

/** 사용 중인 규칙 실행. force=true 면 모의 실행 설정과 무관하게 모의 실행만 */
export async function runRules({ who = '자동 규칙', dryRunOverride = null } = {}) {
  const settings = await data.getSettings();
  const dryRun = dryRunOverride == null ? settings.rulesDryRun : dryRunOverride;
  const rules = (await listRules()).filter(r => r.enabled);
  const today = kstDate();
  const countKey = 'rulecount/' + today;
  const counter = (await getJSON(countKey)) || { n: 0 };
  const stateKey = 'rulestate';
  const state = (await getJSON(stateKey)) || {};
  const cache = {};
  const report = { dryRun, ran: 0, actions: [], errors: [] };
  const actedThisRun = new Set();
  for (const rule of rules) {
    let sums;
    try { sums = await summariesFor(rule.window, cache); } catch (e) { report.errors.push(`${rule.name}: ${e.message}`); continue; }
    for (const err of sums.errors) report.errors.push(`${data.PLATFORM_LABEL[err.platform]}: ${err.message}`);
    report.ran++;
    for (const m of matchRule(rule, sums.list)) {
      if (m.skipped) continue;
      const c = m.campaign;
      if (actedThisRun.has(c.key)) continue;
      const sk = (dryRun ? 'dry|' : '') + rule.id + '|' + c.key;
      if (state[sk] && Date.now() - state[sk] < rule.cooldownHours * 3600000) continue;
      if (!dryRun && counter.n >= settings.maxActionsPerDay) { report.errors.push(`하루 최대 실행 횟수(${settings.maxActionsPerDay}회)에 도달해 나머지는 건너뜀`); break; }
      const act = { rule: rule.name, platform: c.platform, campaign: c.name, action: ACTIONS[rule.action.type], reason: m.reason, done: false };
      try {
        if (!dryRun) {
          if (rule.action.type === 'pause') await data.setCampaignStatus(c.platform, c.id, false, who, `[${rule.name}] ${m.reason}`);
          else if (rule.action.type === 'enable') await data.setCampaignStatus(c.platform, c.id, true, who, `[${rule.name}] ${m.reason}`);
          else if (rule.action.type === 'budget_down' || rule.action.type === 'budget_up') {
            if (c.dailyBudget == null) throw new HttpError(400, '캠페인 예산이 없어 건너뜀');
            const nb = newBudget(c.dailyBudget, rule.action, settings);
            if (nb === c.dailyBudget) throw new HttpError(400, '최소 예산에 도달해 변경 없음');
            await data.setCampaignBudget(c.platform, c.id, nb, who, `[${rule.name}] ${m.reason}`);
            act.action += ` (${c.dailyBudget.toLocaleString('ko-KR')}원 → ${nb.toLocaleString('ko-KR')}원)`;
          } else await data.addLog({ who, kind: '규칙 알림', target: `${data.PLATFORM_LABEL[c.platform]} ${c.name}`, detail: `[${rule.name}] ${m.reason}` });
          counter.n += 1;
          state[sk] = Date.now();
          act.done = true;
        } else {
          await data.addLog({ who, kind: '모의 실행', target: `${data.PLATFORM_LABEL[c.platform]} ${c.name}`, detail: `[${rule.name}] ${ACTIONS[rule.action.type]} 조건 충족: ${m.reason}` });
          state[sk] = Date.now();
        }
      } catch (e) { act.error = e.message; report.errors.push(`${c.name}: ${e.message}`); }
      actedThisRun.add(c.key);
      report.actions.push(act);
    }
    const stored = await getJSON('rules/' + rule.id);
    if (stored) await setJSON('rules/' + rule.id, { ...stored, lastRun: new Date().toISOString() });
  }
  await setJSON(countKey, counter);
  await setJSON(stateKey, state);
  return report;
}
