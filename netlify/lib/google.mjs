// 구글 Ads API (REST)
import { httpJson, HttpError, num } from './util.mjs';

function env() {
  return {
    dev: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
    clientId: process.env.GOOGLE_ADS_CLIENT_ID || '',
    secret: process.env.GOOGLE_ADS_CLIENT_SECRET || '',
    refresh: process.env.GOOGLE_ADS_REFRESH_TOKEN || '',
    cid: String(process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, ''),
    login: String(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/-/g, ''),
    v: process.env.GOOGLE_ADS_API_VERSION || 'v25'
  };
}
export function googleConfigured() { const e = env(); return Boolean(e.dev && e.clientId && e.secret && e.refresh && e.cid); }

let cached = { token: null, exp: 0 };
async function accessToken() {
  if (cached.token && cached.exp > Date.now() + 60000) return cached.token;
  const e = env();
  const d = await httpJson('https://oauth2.googleapis.com/token', {
    method: 'POST', label: '구글 인증', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: e.clientId, client_secret: e.secret, refresh_token: e.refresh }).toString()
  });
  cached = { token: d.access_token, exp: Date.now() + num(d.expires_in || 3600) * 1000 };
  return cached.token;
}
async function headers() {
  const e = env();
  const h = { Authorization: `Bearer ${await accessToken()}`, 'developer-token': e.dev, 'Content-Type': 'application/json' };
  if (e.login) h['login-customer-id'] = e.login;
  return h;
}
const url = path => `https://googleads.googleapis.com/${env().v}/customers/${env().cid}/${path}`;

async function search(query) {
  const out = []; let pageToken; let guard = 0;
  do {
    const body = { query }; if (pageToken) body.pageToken = pageToken;
    const d = await httpJson(url('googleAds:search'), { method: 'POST', label: '구글', headers: await headers(), body: JSON.stringify(body) });
    out.push(...(d?.results || []));
    pageToken = d?.nextPageToken;
  } while (pageToken && guard++ < 50);
  return out;
}

export async function googleCampaigns() {
  const rows = await search("SELECT campaign.id, campaign.name, campaign.status, campaign.campaign_budget, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED'");
  return rows.map(r => ({
    platform: 'google', id: String(r.campaign?.id), name: r.campaign?.name,
    status: r.campaign?.status === 'ENABLED' ? 'on' : r.campaign?.status === 'PAUSED' ? 'off' : 'other',
    dailyBudget: r.campaignBudget?.amountMicros != null ? Math.round(num(r.campaignBudget.amountMicros) / 1e6) : null,
    budgetId: r.campaign?.campaignBudget || null
  }));
}

export async function googleRows(from, to) {
  const rows = await search(`SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}'`);
  return rows.map(r => ({
    date: r.segments?.date, platform: 'google', campaignId: String(r.campaign?.id), name: r.campaign?.name,
    spend: Math.round(num(r.metrics?.costMicros) / 1e6), impressions: num(r.metrics?.impressions), clicks: num(r.metrics?.clicks),
    purchases: num(r.metrics?.conversions), revenue: num(r.metrics?.conversionsValue)
  }));
}

/** 전환 액션 종류별(장바구니·결제 시작·페이지뷰) 일별 수. 설정 안 된 계정은 0 */
async function googleSteps(from, to) {
  const rows = await search(`SELECT campaign.id, segments.date, segments.conversion_action_category, metrics.all_conversions FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}'`);
  const map = {};
  const KEY = { ADD_TO_CART: 'carts', BEGIN_CHECKOUT: 'checkouts', PAGE_VIEW: 'views' };
  for (const r of rows) {
    const k = KEY[r.segments?.conversionActionCategory]; if (!k) continue;
    const id = `${r.campaign?.id}|${r.segments?.date}`;
    map[id] = map[id] || {}; map[id][k] = (map[id][k] || 0) + num(r.metrics?.allConversions);
  }
  return map;
}
export async function googleRowsFull(from, to) {
  const rows = await googleRows(from, to);
  let steps = {};
  try { steps = await googleSteps(from, to); } catch { steps = {}; }
  return rows.map(r => ({ landing: 0, views: 0, carts: 0, checkouts: 0, ...r, ...(steps[`${r.campaignId}|${r.date}`] || {}) }));
}
const adName = ad => ad?.name || ad?.responsiveSearchAd?.headlines?.[0]?.text || ad?.responsiveDisplayAd?.headlines?.[0]?.text || ({ RESPONSIVE_SEARCH_AD: '반응형 검색광고', RESPONSIVE_DISPLAY_AD: '반응형 디스플레이', VIDEO_AD: '동영상 광고' }[ad?.type] || ad?.type || '광고');
/** 광고(소재) 단위 일별 성과: 일반 캠페인은 광고, 실적 최대화(P-MAX)는 애셋 그룹 */
export async function googleAdRows(from, to) {
  const m = r => ({ spend: Math.round(num(r.metrics?.costMicros) / 1e6), impressions: num(r.metrics?.impressions), clicks: num(r.metrics?.clicks), purchases: num(r.metrics?.conversions), revenue: num(r.metrics?.conversionsValue), landing: 0, views: 0, carts: 0, checkouts: 0 });
  const MET = 'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value';
  const ads = await search(`SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.status, ad_group.name, campaign.id, campaign.name, segments.date, ${MET} FROM ad_group_ad WHERE segments.date BETWEEN '${from}' AND '${to}'`);
  const out = ads.map(r => ({ date: r.segments?.date, platform: 'google', adId: String(r.adGroupAd?.ad?.id), name: adName(r.adGroupAd?.ad), group: r.adGroup?.name || '', campaignId: String(r.campaign?.id), campaignName: r.campaign?.name, ...m(r) }));
  try {
    const groups = await search(`SELECT asset_group.id, asset_group.name, campaign.id, campaign.name, segments.date, ${MET} FROM asset_group WHERE segments.date BETWEEN '${from}' AND '${to}'`);
    for (const r of groups) out.push({ date: r.segments?.date, platform: 'google', adId: 'ag' + r.assetGroup?.id, name: r.assetGroup?.name || '애셋 그룹', group: 'P-MAX 애셋 그룹', campaignId: String(r.campaign?.id), campaignName: r.campaign?.name, ...m(r) });
  } catch { /* P-MAX 없는 계정 */ }
  return out;
}
export async function googleAdCreatives() {
  const rows = await search("SELECT ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.status FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED'");
  return Object.fromEntries(rows.map(r => [String(r.adGroupAd?.ad?.id), {
    status: r.adGroupAd?.status === 'ENABLED' ? 'on' : r.adGroupAd?.status === 'PAUSED' ? 'off' : 'other', thumb: null,
    format: /VIDEO/.test(r.adGroupAd?.ad?.type || '') ? '영상' : /SEARCH|TEXT/.test(r.adGroupAd?.ad?.type || '') ? '검색 문구' : '이미지', text: ''
  }]));
}

export async function googleSetStatus(id, on) {
  const body = { operations: [{ updateMask: 'status', update: { resourceName: `customers/${env().cid}/campaigns/${id}`, status: on ? 'ENABLED' : 'PAUSED' } }] };
  return httpJson(url('campaigns:mutate'), { method: 'POST', label: '구글', headers: await headers(), body: JSON.stringify(body) });
}
export async function googleSetBudget(campaign, won) {
  if (!campaign.budgetId) throw new HttpError(400, '이 캠페인의 예산 정보를 찾지 못했습니다.');
  const body = { operations: [{ updateMask: 'amountMicros', update: { resourceName: campaign.budgetId, amountMicros: String(Math.round(won) * 1000000) } }] };
  return httpJson(url('campaignBudgets:mutate'), { method: 'POST', label: '구글', headers: await headers(), body: JSON.stringify(body) });
}
