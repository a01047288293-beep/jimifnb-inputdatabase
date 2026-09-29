// 데이터 계층: 실제 연동/데모 전환, 캐시, 설정, 변경 이력
import { getJSON, setJSON, delKey, listKeys } from './store.mjs';
import { kstDate, addDays, dateRange, HttpError, newId } from './util.mjs';
import * as C from './cafe24.mjs';
import * as M from './meta.mjs';
import * as G from './google.mjs';
import * as T from './tiktok.mjs';
import * as D from './demo.mjs';

export const PLATFORMS = ['meta', 'google', 'tiktok'];
export const PLATFORM_LABEL = { meta: '메타', google: '구글', tiktok: '틱톡' };
const demoOn = () => (process.env.DEMO_MODE || 'on').toLowerCase() !== 'off';

/* ---------- 연동 상태 ---------- */
export async function mode(source) {
  if (source === 'cafe24') return (await C.cafe24Connected()) ? 'live' : demoOn() ? 'demo' : 'off';
  const ok = { meta: M.metaConfigured, google: G.googleConfigured, tiktok: T.tiktokConfigured }[source]();
  return ok ? 'live' : demoOn() ? 'demo' : 'off';
}
export async function modes() {
  const out = {};
  for (const s of ['cafe24', ...PLATFORMS]) out[s] = await mode(s);
  out.cafe24Keys = C.cafe24KeysSet();
  return out;
}

/* ---------- 설정 ---------- */
export const DEFAULT_SETTINGS = {
  rulesDryRun: true, maxActionsPerDay: 20, minBudget: 10000, maxBudgetChangePct: 50,
  csWriter: '지미에프앤비', campaignLinks: {}, defaultFeePct: 3.5
};
export async function getSettings() { return { ...DEFAULT_SETTINGS, ...((await getJSON('settings')) || {}) }; }
export async function putSettings(patch, who) {
  const cur = await getSettings();
  const next = { ...cur };
  const allowed = ['rulesDryRun', 'maxActionsPerDay', 'minBudget', 'maxBudgetChangePct', 'csWriter', 'defaultFeePct'];
  for (const k of allowed) if (k in patch) next[k] = patch[k];
  next.rulesDryRun = Boolean(next.rulesDryRun);
  for (const k of ['maxActionsPerDay', 'minBudget', 'maxBudgetChangePct', 'defaultFeePct']) {
    const n = Number(next[k]); if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `설정값이 올바르지 않습니다: ${k}`); next[k] = n;
  }
  next.maxBudgetChangePct = Math.min(next.maxBudgetChangePct, 100);
  next.csWriter = String(next.csWriter || '').slice(0, 30) || DEFAULT_SETTINGS.csWriter;
  await setJSON('settings', next);
  if (who) await addLog({ who, kind: '설정', target: '시스템 설정', detail: allowed.filter(k => k in patch && JSON.stringify(cur[k]) !== JSON.stringify(next[k])).map(k => `${k}: ${cur[k]} → ${next[k]}`).join(', ') || '변경 없음' });
  return next;
}
export async function setCampaignLink(platform, id, productId, who) {
  const s = await getSettings();
  const links = { ...(s.campaignLinks || {}) };
  if (productId) links[`${platform}:${id}`] = productId; else delete links[`${platform}:${id}`];
  await setJSON('settings', { ...s, campaignLinks: links });
  if (who) await addLog({ who, kind: '광고 연결', target: `${PLATFORM_LABEL[platform]} ${id}`, detail: productId ? `제품 ${productId} 연결` : '연결 해제' });
  return links;
}

/* ---------- 변경 이력 (월별 묶음) ---------- */
export async function addLog(entry) {
  const at = new Date().toISOString();
  const key = 'log/' + kstDate().slice(0, 7);
  const list = (await getJSON(key)) || [];
  list.push({ at, ...entry });
  if (list.length > 5000) list.splice(0, list.length - 5000);
  await setJSON(key, list);
}
export async function listLogs(limit = 200) {
  const keys = (await listKeys('log/')).sort().reverse().slice(0, 3);
  const out = [];
  for (const k of keys) { const l = (await getJSON(k)) || []; out.push(...l); }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}

/* ---------- 캐시: 지난 날짜는 저장본, 최근 2일은 짧게만 저장 ---------- */
async function cachedDaily(prefix, from, to, fetchRange) {
  const today = kstDate();
  const days = dateRange(from, [to, today].sort()[0]);
  const result = {};
  const missing = [];
  for (const d of days) {
    const recent = d >= addDays(today, -1);
    const hit = await getJSON(`${prefix}/${d}`);
    if (hit && (!recent || Date.now() - hit.at < 10 * 60000)) result[d] = hit.rows;
    else missing.push(d);
  }
  if (missing.length) {
    const a = missing[0], b = missing[missing.length - 1];
    const rows = await fetchRange(a, b);
    const byDay = {};
    for (const d of dateRange(a, b)) byDay[d] = [];
    for (const r of rows) if (byDay[r.date]) byDay[r.date].push(r);
    for (const d of Object.keys(byDay)) {
      if (!missing.includes(d) && result[d]) continue;
      result[d] = byDay[d];
      await setJSON(`${prefix}/${d}`, { at: Date.now(), rows: byDay[d] });
    }
  }
  return days.flatMap(d => result[d] || []);
}

/* ---------- 주문 ---------- */
export async function ordersForStats(from, to) {
  const m = await mode('cafe24');
  if (m === 'off') return [];
  if (m === 'demo') return D.demoOrders(from, to);
  return cachedDaily('cache/orders', from, to, C.fetchOrders);
}
export async function ordersLive(from, to) {
  const m = await mode('cafe24');
  if (m === 'off') return [];
  if (m === 'demo') return D.demoOrders(from, to);
  return C.fetchOrders(from, to);
}
export async function carriers() {
  return (await mode('cafe24')) === 'live' ? C.fetchCarriers() : D.demoCarriers();
}
export async function ship(orderId, itemCodes, carrierCode, trackingNo, who) {
  const m = await mode('cafe24');
  if (m === 'off') throw new HttpError(409, '카페24가 연결되지 않았습니다.');
  if (m === 'live') await C.createShipment(orderId, itemCodes, carrierCode, trackingNo);
  else await D.demoShip(orderId, carrierCode, trackingNo);
  await addLog({ who, kind: '송장 등록', target: `주문 ${orderId}`, detail: `${carrierCode} ${trackingNo}${m === 'demo' ? ' (데모)' : ''}` });
}
export async function shopProducts() {
  const m = await mode('cafe24');
  if (m === 'live') return C.fetchProducts();
  return m === 'demo' ? D.DEMO_PRODUCTS : [];
}

/* ---------- CS ---------- */
export async function articles(from, to) {
  const m = await mode('cafe24');
  if (m === 'off') return [];
  if (m === 'demo') return D.demoArticles(from, to);
  const key = 'cache/cs';
  const hit = await getJSON(key);
  if (hit && hit.from === from && hit.to === to && Date.now() - hit.at < 3 * 60000) return hit.rows;
  const rows = await C.fetchArticles(from, to);
  await setJSON(key, { at: Date.now(), from, to, rows });
  return rows;
}
export async function reply(boardNo, articleNo, title, content, who) {
  const m = await mode('cafe24');
  const s = await getSettings();
  if (m === 'off') throw new HttpError(409, '카페24가 연결되지 않았습니다.');
  if (m === 'live') { await C.replyArticle(boardNo, articleNo, title, content, s.csWriter); await delKey('cache/cs'); }
  else await D.demoReply(articleNo, content);
  await addLog({ who, kind: 'CS 답변', target: `게시판 ${boardNo} 글 ${articleNo}`, detail: content.slice(0, 80) + (m === 'demo' ? ' (데모)' : '') });
}

/* ---------- 광고 ---------- */
const LIVE = {
  meta: { campaigns: M.metaCampaigns, rows: M.metaRows, status: M.metaSetStatus, budget: M.metaSetBudget },
  google: { campaigns: G.googleCampaigns, rows: G.googleRows, status: G.googleSetStatus, budget: G.googleSetBudget },
  tiktok: { campaigns: T.tiktokCampaigns, rows: T.tiktokRows, status: T.tiktokSetStatus, budget: T.tiktokSetBudget }
};
export async function campaigns(platform) {
  const m = await mode(platform);
  if (m === 'off') return [];
  return m === 'demo' ? D.demoCampaigns(platform) : LIVE[platform].campaigns();
}
export async function adRows(platform, from, to) {
  const m = await mode(platform);
  if (m === 'off') return [];
  if (m === 'demo') return D.demoAdRows(platform, from, to);
  return cachedDaily(`cache/ads/${platform}`, from, to, LIVE[platform].rows);
}
/** 모든 매체: 실패한 매체는 errors 에 담고 나머지는 계속 */
export async function allAds(from, to) {
  const out = { campaigns: [], rows: [], errors: [], modes: {} };
  for (const p of PLATFORMS) {
    out.modes[p] = await mode(p);
    if (out.modes[p] === 'off') continue;
    try { out.campaigns.push(...await campaigns(p)); out.rows.push(...await adRows(p, from, to)); }
    catch (e) { out.errors.push({ platform: p, message: e.message }); }
  }
  return out;
}
export async function setCampaignStatus(platform, id, on, who, why) {
  if (!PLATFORMS.includes(platform)) throw new HttpError(400, '알 수 없는 매체입니다.');
  const m = await mode(platform);
  if (m === 'off') throw new HttpError(409, '연결되지 않은 매체입니다.');
  if (m === 'live') await LIVE[platform].status(id, on); else await D.demoSetStatus(platform, id, on);
  let name = id;
  try { name = (await campaigns(platform)).find(c => c.id === String(id))?.name || id; } catch { /* 이름 조회 실패 시 번호로 기록 */ }
  await addLog({ who, kind: on ? '광고 켜기' : '광고 끄기', target: `${PLATFORM_LABEL[platform]} ${name}`, detail: (why || '') + (m === 'demo' ? ' (데모)' : '') });
}
export async function setCampaignBudget(platform, id, won, who, why) {
  const s = await getSettings();
  if (!(won >= s.minBudget)) throw new HttpError(400, `일 예산은 최소 ${s.minBudget.toLocaleString('ko-KR')}원 이상이어야 합니다.`);
  const list = await campaigns(platform);
  const c = list.find(x => x.id === String(id));
  if (!c) throw new HttpError(404, '캠페인을 찾지 못했습니다.');
  const m = await mode(platform);
  if (m === 'live') await LIVE[platform].budget(c, won); else await D.demoSetBudget(platform, id, won);
  await addLog({ who, kind: '예산 변경', target: `${PLATFORM_LABEL[platform]} ${c.name}`, detail: `${(c.dailyBudget ?? 0).toLocaleString('ko-KR')}원 → ${Math.round(won).toLocaleString('ko-KR')}원 ${why || ''}${m === 'demo' ? ' (데모)' : ''}`.trim() });
  return c;
}

/* ---------- 제품(마진) ---------- */
export async function listProducts() {
  const keys = await listKeys('products/');
  const out = [];
  for (const k of keys) { const p = await getJSON(k); if (p) out.push({ ...p, id: k.slice(9) }); }
  return out;
}
export async function saveProduct(id, data, who) {
  const pid = id || newId('p');
  const clean = { ...data }; delete clean.id;
  clean.updatedAt = new Date().toISOString();
  const s = JSON.stringify(clean);
  if (s.length > 200000) throw new HttpError(400, '제품 데이터가 너무 큽니다.');
  await setJSON('products/' + pid, clean);
  if (who && !id) await addLog({ who, kind: '제품 추가', target: clean.name || pid, detail: '' });
  return { ...clean, id: pid };
}
export async function deleteProduct(id, who) {
  const p = await getJSON('products/' + id);
  await delKey('products/' + id);
  if (who) await addLog({ who, kind: '제품 삭제', target: p?.name || id, detail: '' });
}
