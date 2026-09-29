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

export async function googleSetStatus(id, on) {
  const body = { operations: [{ updateMask: 'status', update: { resourceName: `customers/${env().cid}/campaigns/${id}`, status: on ? 'ENABLED' : 'PAUSED' } }] };
  return httpJson(url('campaigns:mutate'), { method: 'POST', label: '구글', headers: await headers(), body: JSON.stringify(body) });
}
export async function googleSetBudget(campaign, won) {
  if (!campaign.budgetId) throw new HttpError(400, '이 캠페인의 예산 정보를 찾지 못했습니다.');
  const body = { operations: [{ updateMask: 'amountMicros', update: { resourceName: campaign.budgetId, amountMicros: String(Math.round(won) * 1000000) } }] };
  return httpJson(url('campaignBudgets:mutate'), { method: 'POST', label: '구글', headers: await headers(), body: JSON.stringify(body) });
}
