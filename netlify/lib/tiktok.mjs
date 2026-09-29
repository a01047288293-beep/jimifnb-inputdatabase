// 틱톡 마케팅 API (v1.3)
import { httpJson, HttpError, num } from './util.mjs';

function env() {
  return { token: process.env.TIKTOK_ACCESS_TOKEN || '', adv: process.env.TIKTOK_ADVERTISER_ID || '' };
}
export function tiktokConfigured() { const e = env(); return Boolean(e.token && e.adv); }
const BASE = 'https://business-api.tiktok.com/open_api/v1.3/';

async function tt(path, { method = 'GET', query, body } = {}) {
  const u = BASE + path + (query ? '?' + new URLSearchParams(query) : '');
  const d = await httpJson(u, { method, label: '틱톡', headers: { 'Access-Token': env().token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!d || d.code !== 0) throw new HttpError(502, `틱톡 오류: ${d?.message || '알 수 없는 응답'}`, d);
  return d.data || {};
}

export async function tiktokCampaigns() {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const d = await tt('campaign/get/', { query: { advertiser_id: env().adv, page: String(page), page_size: '100', fields: JSON.stringify(['campaign_id', 'campaign_name', 'operation_status', 'budget', 'budget_mode']) } });
    for (const c of d.list || []) out.push({
      platform: 'tiktok', id: String(c.campaign_id), name: c.campaign_name,
      status: c.operation_status === 'ENABLE' ? 'on' : c.operation_status === 'DISABLE' ? 'off' : 'other',
      dailyBudget: c.budget_mode === 'BUDGET_MODE_DAY' ? num(c.budget) : null, budgetId: null
    });
    if (!d.page_info || page >= num(d.page_info.total_page)) break;
  }
  return out;
}

export async function tiktokRows(from, to) {
  const purchaseMetric = process.env.TIKTOK_PURCHASE_METRIC || 'complete_payment';
  const valueMetric = process.env.TIKTOK_VALUE_METRIC || 'total_complete_payment_rate';
  const out = [];
  const names = new Map((await tiktokCampaigns()).map(c => [c.id, c.name]));
  for (let page = 1; page <= 20; page++) {
    const d = await tt('report/integrated/get/', {
      query: {
        advertiser_id: env().adv, report_type: 'BASIC', data_level: 'AUCTION_CAMPAIGN',
        dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
        metrics: JSON.stringify(['spend', 'impressions', 'clicks', purchaseMetric, valueMetric]),
        start_date: from, end_date: to, page: String(page), page_size: '1000'
      }
    });
    for (const r of d.list || []) {
      const id = String(r.dimensions?.campaign_id);
      out.push({
        date: String(r.dimensions?.stat_time_day || '').slice(0, 10), platform: 'tiktok', campaignId: id, name: names.get(id) || id,
        spend: num(r.metrics?.spend), impressions: num(r.metrics?.impressions), clicks: num(r.metrics?.clicks),
        purchases: num(r.metrics?.[purchaseMetric]), revenue: num(r.metrics?.[valueMetric])
      });
    }
    if (!d.page_info || page >= num(d.page_info.total_page)) break;
  }
  return out;
}

export async function tiktokSetStatus(id, on) {
  return tt('campaign/status/update/', { method: 'POST', body: { advertiser_id: env().adv, campaign_ids: [String(id)], operation_status: on ? 'ENABLE' : 'DISABLE' } });
}
export async function tiktokSetBudget(campaign, won) {
  if (campaign.dailyBudget == null) throw new HttpError(400, '일 예산 캠페인이 아니어서 예산을 바꿀 수 없습니다.');
  return tt('campaign/update/', { method: 'POST', body: { advertiser_id: env().adv, campaign_id: String(campaign.id), budget: Math.round(won) } });
}
