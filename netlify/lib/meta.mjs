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

// 퍼널 단계별 action_type 후보 (앞에 있는 것 우선, 하나만 사용해 중복 방지)
const STEP_TYPES = {
  landing: ['landing_page_view', 'omni_landing_page_view'],
  view: ['omni_view_content', 'view_content', 'offsite_conversion.fb_pixel_view_content'],
  cart: ['omni_add_to_cart', 'add_to_cart', 'offsite_conversion.fb_pixel_add_to_cart'],
  checkout: ['omni_initiated_checkout', 'initiate_checkout', 'offsite_conversion.fb_pixel_initiate_checkout']
};
function step(list, types) {
  const arr = Array.isArray(list) ? list : [];
  for (const t of types) { const f = arr.find(a => a.action_type === t); if (f) return num(f.value); }
  return 0;
}
const funnel = r => ({ landing: step(r.actions, STEP_TYPES.landing), views: step(r.actions, STEP_TYPES.view), carts: step(r.actions, STEP_TYPES.cart), checkouts: step(r.actions, STEP_TYPES.checkout) });

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
    purchases: pick(r.actions), revenue: pick(r.action_values), ...funnel(r)
  }));
}

const AD_FIELDS = 'ad_id,ad_name,adset_name,campaign_id,campaign_name,spend,impressions,clicks,actions,action_values';
/** 광고(소재) 단위 일별 성과 */
export async function metaAdRows(from, to) {
  const e = env();
  const q = new URLSearchParams({ level: 'ad', fields: AD_FIELDS, time_range: JSON.stringify({ since: from, until: to }), time_increment: '1', limit: '500', access_token: e.token });
  const list = await getAll(`${base()}/act_${e.acct}/insights?${q}`);
  return list.map(r => ({
    date: r.date_start, platform: 'meta', adId: String(r.ad_id), name: r.ad_name, group: r.adset_name || '', campaignId: String(r.campaign_id), campaignName: r.campaign_name,
    spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks), purchases: pick(r.actions), revenue: pick(r.action_values), ...funnel(r)
  }));
}
/** 기간 전체의 도달·빈도 (날짜별로 더할 수 없는 값이라 따로 받음) */
export async function metaAdReach(from, to) {
  const e = env();
  const q = new URLSearchParams({ level: 'ad', fields: 'ad_id,reach,frequency', time_range: JSON.stringify({ since: from, until: to }), limit: '500', access_token: e.token });
  const list = await getAll(`${base()}/act_${e.acct}/insights?${q}`);
  return Object.fromEntries(list.map(r => [String(r.ad_id), { reach: num(r.reach), frequency: num(r.frequency) }]));
}
/** 소재 정보: 썸네일·형식·문구 */
export async function metaAdCreatives() {
  const e = env();
  const q = new URLSearchParams({ fields: 'id,name,effective_status,creative{thumbnail_url,image_url,object_type,title,body,video_id}', limit: '200', access_token: e.token });
  const list = await getAll(`${base()}/act_${e.acct}/ads?${q}`);
  return Object.fromEntries(list.map(a => [String(a.id), {
    status: a.effective_status === 'ACTIVE' ? 'on' : a.effective_status === 'PAUSED' || a.effective_status === 'CAMPAIGN_PAUSED' || a.effective_status === 'ADSET_PAUSED' ? 'off' : 'other',
    thumb: a.creative?.thumbnail_url || a.creative?.image_url || null,
    format: a.creative?.video_id || /VIDEO/i.test(a.creative?.object_type || '') ? '영상' : '이미지',
    text: [a.creative?.title, a.creative?.body].filter(Boolean).join(' · ').slice(0, 140)
  }]));
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
