// 캠페인 → 제품 자동 연결: 광고가 보내는 상품 페이지 주소 → 캠페인 이름 키워드 → 기본 제품 순서로 찾아 연결
import * as data from './data.mjs';

const PLAT = data.PLATFORM_LABEL;
export const HOW_LABEL = { url: '광고 링크의 상품번호', keyword: '캠페인 이름 키워드', single: '제품이 하나뿐', default: '기본 제품', manual: '직접 연결' };

/** 광고 랜딩 주소에서 카페24 상품번호를 뽑음: /product/이름/123/…, product_no=123, /surl/P/123 */
export function productNosFromUrls(urls) {
  const out = new Set();
  for (const u of urls || []) {
    const s = String(u || '');
    let m;
    const re = /\/product\/[^/?#]*\/(\d+)(?:[/?#]|$)|[?&]product_no=(\d+)|\/surl\/P\/(\d+)/gi;
    while ((m = re.exec(s))) out.add(Number(m[1] || m[2] || m[3]));
  }
  return [...out];
}

const normText = s => String(s || '').toLowerCase().replace(/[\s\[\]()_\-·,./]+/g, '');
/** 제품의 광고 키워드: 직접 적은 키워드(쉼표 구분) + 제품명(2글자 이상) */
export function productKeywords(p) {
  const ks = String(p.adKeywords || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  if (p.name && String(p.name).trim().length >= 2) ks.push(String(p.name).trim());
  return [...new Set(ks)];
}

/**
 * 연결 계획. campaigns: 캠페인 목록, products: 제품 목록, links: 현재 연결, urls: {platform:{campaignId:[url]}}
 * 반환: { plan:[{key,platform,id,name,productId,productName,how,detail}], unresolved:[{key,...,reason}] }
 */
export function planAutoLinks({ campaigns, products, links = {}, urls = {}, settings = {} }) {
  const plan = [], unresolved = [];
  const byNo = new Map();
  for (const p of products) for (const n of p.cafe24ProductNos || []) byNo.set(Number(n), p);
  const kw = products.flatMap(p => productKeywords(p).map(k => ({ k: normText(k), p, raw: k }))).filter(x => x.k.length >= 2);
  const auto = settings.autoLink || {};
  const def = auto.defaultProductId ? products.find(p => p.id === auto.defaultProductId) : null;
  const single = products.length === 1 ? products[0] : null;
  for (const c of campaigns) {
    const key = `${c.platform}:${c.id}`;
    if (links[key]) continue;
    const base = { key, platform: c.platform, id: String(c.id), name: c.name };
    // 1) 광고 링크의 상품번호
    const nos = productNosFromUrls(urls[c.platform]?.[String(c.id)] || []);
    const hitP = [...new Set(nos.map(n => byNo.get(n)).filter(Boolean))];
    if (hitP.length === 1) { plan.push({ ...base, productId: hitP[0].id, productName: hitP[0].name, how: 'url', detail: `#${nos.filter(n => byNo.get(n) === hitP[0]).join(', #')}` }); continue; }
    if (hitP.length > 1) { unresolved.push({ ...base, reason: `광고가 제품 ${hitP.length}개(${hitP.map(p => p.name).join(', ')})의 상품으로 보내 하나로 정할 수 없음` }); continue; }
    // 2) 캠페인 이름 키워드 (가장 긴 키워드 우선, 같은 길이로 다른 제품이 겹치면 보류)
    const nm = normText(c.name);
    const hits = kw.filter(x => nm.includes(x.k)).sort((a, b) => b.k.length - a.k.length);
    if (hits.length) {
      const top = hits.filter(x => x.k.length === hits[0].k.length);
      const ps = [...new Set(top.map(x => x.p))];
      if (ps.length === 1) { plan.push({ ...base, productId: ps[0].id, productName: ps[0].name, how: 'keyword', detail: `'${hits[0].raw}'` }); continue; }
      unresolved.push({ ...base, reason: `이름이 제품 ${ps.map(p => p.name).join(', ')} 키워드와 모두 맞음` }); continue;
    }
    // 3) 제품이 하나뿐이면 그 제품, 아니면 기본 제품
    if (single) { plan.push({ ...base, productId: single.id, productName: single.name, how: 'single', detail: '' }); continue; }
    if (def) { plan.push({ ...base, productId: def.id, productName: def.name, how: 'default', detail: '' }); continue; }
    unresolved.push({ ...base, reason: nos.length ? `광고 링크 상품번호 #${nos.join(', #')}가 어느 제품에도 연결되어 있지 않음` : '광고 링크·이름으로 제품을 찾지 못함 (기본 제품을 정하면 연결됨)' });
  }
  return { plan, unresolved };
}

/** 현재 상태로 계획만 세움 (적용 안 함) */
export async function previewAutoLink() {
  const [settings, products, camps] = await Promise.all([data.getSettings({ fresh: true }), data.listProducts(), Promise.all(data.PLATFORMS.map(p => data.campaigns(p).catch(() => [])))]);
  const campaigns = camps.flat();
  const urls = {};
  await Promise.all(data.PLATFORMS.map(async p => { if (campaigns.some(c => c.platform === p)) urls[p] = await data.campaignUrls(p).catch(() => ({})); }));
  const r = planAutoLinks({ campaigns, products, links: settings.campaignLinks || {}, urls, settings });
  return { ...r, enabled: settings.autoLink?.enabled !== false, defaultProductId: settings.autoLink?.defaultProductId || null, linked: campaigns.filter(c => settings.campaignLinks?.[`${c.platform}:${c.id}`]).length, total: campaigns.length };
}

/** 계획을 실제로 저장. who: 기록에 남길 이름 */
export async function runAutoLink({ who = '자동 연결', force = false } = {}) {
  const r = await previewAutoLink();
  if (!force && !r.enabled) return { ...r, applied: [], skipped: '자동 연결이 꺼져 있음' };
  if (!r.plan.length) return { ...r, applied: [] };
  const links = {}; const src = {};
  for (const p of r.plan) { links[p.key] = p.productId; src[p.key] = { how: p.how, at: new Date().toISOString() }; }
  await data.setCampaignLinks(links, src);
  await data.addLog({ who, kind: '광고 연결', target: `캠페인 ${r.plan.length}개`, detail: r.plan.map(p => `${PLAT[p.platform]} ${p.name} → ${p.productName} (${HOW_LABEL[p.how]})`).join(' / ').slice(0, 1500) });
  return { ...r, applied: r.plan, linked: r.linked + r.plan.length };
}
