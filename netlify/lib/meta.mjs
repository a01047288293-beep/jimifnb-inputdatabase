// 메타(페이스북·인스타그램) 마케팅 API
import { httpJson, HttpError, num, addDays } from './util.mjs';

function env() {
  const acct = String(process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');
  return { token: String(process.env.META_ACCESS_TOKEN || '').trim(), acct: acct.trim(), v: process.env.META_API_VERSION || 'v26.0' };
}
export function metaConfigured() { const e = env(); return Boolean(e.token && e.acct); }
const base = () => `https://graph.facebook.com/${env().v}`;

async function get(url) { return httpJson(url, { label: '메타' }); }
// 메타는 한 번에 요청하는 양이 많으면 "Please reduce the amount of data" 로 거절함 → 페이지 크기와 기간을 줄여 다시 요청
const tooMuch = e => /reduce the amount of data|too much data|error_subcode.?1504/i.test(String(e?.message || ''));
async function getAll(url) {
  const out = []; let next = url; let guard = 0;
  while (next && guard++ < 60) {
    let d;
    try { d = await get(next); }
    catch (e) {
      const lim = Number(new URL(next).searchParams.get('limit') || 0);
      if (tooMuch(e) && lim > 25) { const u = new URL(next); u.searchParams.set('limit', String(Math.max(25, Math.floor(lim / 4)))); next = u.toString(); continue; }
      throw e;
    }
    out.push(...(d?.data || [])); next = d?.paging?.next || null;
  }
  return out;
}
/** 인사이트를 기간 단위로 나눠 받음. 그래도 많다고 하면 기간을 반으로 쪼개 다시 시도 */
async function insights(params, from, to, chunkDays) {
  const e = env();
  const one = async (a, b) => {
    const q = new URLSearchParams({ ...params, time_range: JSON.stringify({ since: a, until: b }), access_token: e.token });
    try { return await getAll(`${base()}/act_${e.acct}/insights?${q}`); }
    catch (err) {
      if (!tooMuch(err) || a === b) throw err;
      const days = Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
      const mid = addDays(a, Math.floor(days / 2));
      return [...await one(a, mid), ...await one(addDays(mid, 1), b)];
    }
  };
  const out = [];
  for (let a = from; a <= to; a = addDays(a, chunkDays)) out.push(...await one(a, [addDays(a, chunkDays - 1), to].sort()[0]));
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
  void e;
  const list = await insights({ level: 'campaign', fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions,action_values', time_increment: '1', limit: '200' }, from, to, 7);
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
  void e;
  // 지출이 있었던 광고만, 3일씩 나눠서
  const list = await insights({ level: 'ad', fields: AD_FIELDS, time_increment: '1', limit: '100', filtering: JSON.stringify([{ field: 'spend', operator: 'GREATER_THAN', value: 0 }]) }, from, to, 3);
  return list.map(r => ({
    date: r.date_start, platform: 'meta', adId: String(r.ad_id), name: r.ad_name, group: r.adset_name || '', campaignId: String(r.campaign_id), campaignName: r.campaign_name,
    spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks), purchases: pick(r.actions), revenue: pick(r.action_values), ...funnel(r)
  }));
}
/** 기간 전체의 도달·빈도 (날짜별로 더할 수 없는 값이라 따로 받음) */
export async function metaAdReach(from, to) {
  const e = env();
  const q = new URLSearchParams({ level: 'ad', fields: 'ad_id,reach,frequency', time_range: JSON.stringify({ since: from, until: to }), limit: '100', filtering: JSON.stringify([{ field: 'spend', operator: 'GREATER_THAN', value: 0 }]), access_token: e.token });
  let list;
  // 빈도는 참고용이라, 메타가 거절하면 빈 값으로 두고 나머지 분석은 계속
  try { list = await getAll(`${base()}/act_${e.acct}/insights?${q}`); } catch (err) { if (tooMuch(err)) return {}; throw err; }
  return Object.fromEntries(list.map(r => [String(r.ad_id), { reach: num(r.reach), frequency: num(r.frequency) }]));
}
/** 소재 정보: 썸네일·형식·문구 */
export async function metaAdCreatives() {
  const e = env();
  const q = new URLSearchParams({ fields: 'id,name,effective_status,creative{thumbnail_url,image_url,object_type,title,body,video_id}', limit: '50',
    filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'WITH_ISSUES'] }]), access_token: e.token });
  let list;
  try { list = await getAll(`${base()}/act_${e.acct}/ads?${q}`); } catch (err) { if (tooMuch(err)) return {}; throw err; }
  return Object.fromEntries(list.map(a => [String(a.id), {
    status: a.effective_status === 'ACTIVE' ? 'on' : a.effective_status === 'PAUSED' || a.effective_status === 'CAMPAIGN_PAUSED' || a.effective_status === 'ADSET_PAUSED' ? 'off' : 'other',
    thumb: a.creative?.thumbnail_url || a.creative?.image_url || null,
    format: a.creative?.video_id || /VIDEO/i.test(a.creative?.object_type || '') ? '영상' : '이미지',
    text: [a.creative?.title, a.creative?.body].filter(Boolean).join(' · ').slice(0, 140)
  }]));
}

/** 캠페인별 광고 랜딩 주소 (제품 자동 연결용): {campaignId: [url]} */
export async function metaCampaignUrls() {
  const e = env();
  const q = new URLSearchParams({ fields: 'campaign_id,creative{link_url,object_story_spec,asset_feed_spec}', limit: '50',
    filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'WITH_ISSUES'] }]), access_token: e.token });
  let list;
  try { list = await getAll(`${base()}/act_${e.acct}/ads?${q}`); } catch (err) { if (tooMuch(err)) return {}; throw err; }
  const out = {};
  const walk = (v, acc) => { // 소재 구조 어디에 있어도 http 주소를 모두 모음
    if (!v) return; if (typeof v === 'string') { if (/^https?:\/\//i.test(v)) acc.add(v); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x, acc); return; }
    if (typeof v === 'object') for (const x of Object.values(v)) walk(x, acc);
  };
  for (const a of list) {
    const cid = String(a.campaign_id || ''); if (!cid) continue;
    const acc = new Set(out[cid] || []); walk(a.creative, acc); out[cid] = [...acc].slice(0, 40);
  }
  return out;
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
