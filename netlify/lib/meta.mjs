// 메타(페이스북·인스타그램) 마케팅 API
import { httpJson, HttpError, num } from './util.mjs';

function env() {
  const acct = String(process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');
  return { token: process.env.META_ACCESS_TOKEN || '', acct, v: process.env.META_API_VERSION || 'v26.0' };
}
export function metaConfigured() { const e = env(); return Boolean(e.token && e.acct); }
const base = () => `https://graph.facebook.com/${env().v}`;

async function get(url) { return httpJson(url, { label: '메타' }); }
async function getAll(url) {
  const out = []; let next = url; let guard = 0;
  while (next && guard++ < 30) { const d = await get(next); out.push(...(d?.data || [])); next = d?.paging?.next || null; }
  return out;
}

// 같은 구매가 여러 action_type 으로 중복 집계되므로 우선순위대로 하나만 사용
const PURCHASE_TYPES = () => (process.env.META_PURCHASE_ACTION ? [process.env.META_PURCHASE_ACTION] : ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase']);
function pick(list) {
  const arr = Array.isArray(list) ? list : [];
  for (const t of PURCHASE_TYPES()) { const f = arr.find(a => a.action_type === t); if (f) return num(f.value); }
  return 0;
}

export async function metaCampaigns() {
  const e = env();
  const q = new URLSearchParams({ fields: 'id,name,status,effective_status,daily_budget,lifetime_budget', limit: '200', access_token: e.token });
  const list = await getAll(`${base()}/act_${e.acct}/campaigns?${q}`);
  return list.filter(c => !['DELETED', 'ARCHIVED'].includes(c.effective_status)).map(c => ({
    platform: 'meta', id: String(c.id), name: c.name,
    status: c.status === 'ACTIVE' ? 'on' : c.status === 'PAUSED' ? 'off' : 'other',
    dailyBudget: c.daily_budget ? num(c.daily_budget) : null, // 원화는 원 단위
    budgetId: null
  }));
}

export async function metaRows(from, to) {
  const e = env();
  const q = new URLSearchParams({
    level: 'campaign', fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions,action_values',
    time_range: JSON.stringify({ since: from, until: to }), time_increment: '1', limit: '500', access_token: e.token
  });
  const list = await getAll(`${base()}/act_${e.acct}/insights?${q}`);
  return list.map(r => ({
    date: r.date_start, platform: 'meta', campaignId: String(r.campaign_id), name: r.campaign_name,
    spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks),
    purchases: pick(r.actions), revenue: pick(r.action_values)
  }));
}

async function post(id, params) {
  const body = new URLSearchParams({ ...params, access_token: env().token }).toString();
  return httpJson(`${base()}/${id}`, { method: 'POST', label: '메타', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
}
export async function metaSetStatus(id, on) { return post(id, { status: on ? 'ACTIVE' : 'PAUSED' }); }
export async function metaSetBudget(campaign, won) {
  if (campaign.dailyBudget == null) throw new HttpError(400, '이 캠페인은 광고세트에서 예산을 정합니다. 캠페인 예산은 바꿀 수 없고 ON/OFF만 가능합니다.');
  return post(campaign.id, { daily_budget: String(Math.round(won)) });
}
