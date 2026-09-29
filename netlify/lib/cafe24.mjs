// 카페24 Admin API 연동 (OAuth 2.0, 토큰 자동 갱신)
import { getJSON, setJSON } from './store.mjs';
import { httpJson, HttpError, maskName, num, addDays } from './util.mjs';

const TOKEN_KEY = 'tokens/cafe24';
export const CAFE24_SCOPES = ['mall.read_order', 'mall.write_order', 'mall.read_community', 'mall.write_community', 'mall.read_product', 'mall.read_store'];

export const STATUS_LABEL = {
  N00: '입금전', N10: '상품준비중', N20: '배송준비중', N21: '배송대기', N22: '배송보류', N30: '배송중', N40: '배송완료', N50: '구매확정',
  C00: '취소신청', C10: '취소접수', C34: '취소처리중', C36: '취소처리중', C40: '취소완료', C47: '입금전취소', C48: '입금전취소', C49: '입금전취소',
  R00: '반품신청', R10: '반품접수', R12: '반품보류', R13: '반품접수', R30: '반품처리중', R34: '반품처리중', R36: '반품처리중', R40: '반품완료',
  E00: '교환신청', E10: '교환접수', E12: '교환보류', E13: '교환접수', E20: '교환준비', E30: '교환처리중', E32: '교환처리중', E34: '교환처리중', E36: '교환처리중', E40: '교환완료'
};
export function statusLabel(code) {
  if (!code) return '확인 필요';
  return STATUS_LABEL[code] || ({ N: '처리중', C: '취소', R: '반품', E: '교환' }[code[0]] || code);
}

function env() {
  return {
    // 지미에프앤비 자사몰(www.jimifnb0901.com)의 카페24 몰 ID. 다른 몰에 쓸 때만 환경변수로 바꿈
    mall: process.env.CAFE24_MALL_ID || 'jimifnb0901',
    clientId: process.env.CAFE24_CLIENT_ID || '',
    secret: process.env.CAFE24_CLIENT_SECRET || '',
    version: process.env.CAFE24_API_VERSION || '2026-09-01',
    shopNo: Number(process.env.CAFE24_SHOP_NO || 1)
  };
}
export const SHOP_URL = () => (process.env.SHOP_URL || 'https://www.jimifnb0901.com').replace(/\/$/, '');
export const MALL_ID = () => env().mall;
export function cafe24KeysSet() { const e = env(); return Boolean(e.mall && e.clientId && e.secret); }
export async function cafe24Connected() { return cafe24KeysSet() && Boolean(await getJSON(TOKEN_KEY)); }

export function authorizeUrl(redirectUri, state) {
  const e = env();
  const q = new URLSearchParams({ response_type: 'code', client_id: e.clientId, state, redirect_uri: redirectUri, scope: CAFE24_SCOPES.join(',') });
  return `https://${e.mall}.cafe24api.com/api/v2/oauth/authorize?${q}`;
}

async function tokenRequest(params) {
  const e = env();
  const basic = Buffer.from(`${e.clientId}:${e.secret}`).toString('base64');
  const data = await httpJson(`https://${e.mall}.cafe24api.com/api/v2/oauth/token`, {
    method: 'POST', label: '카페24 인증',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  });
  const tok = {
    access_token: data.access_token,
    expires_at: data.expires_at ? Date.parse(data.expires_at) : Date.now() + 7000 * 1000,
    refresh_token: data.refresh_token,
    refresh_token_expires_at: data.refresh_token_expires_at ? Date.parse(data.refresh_token_expires_at) : Date.now() + 13 * 86400000,
    scopes: data.scopes || null,
    saved_at: Date.now()
  };
  if (!tok.access_token || !tok.refresh_token) throw new HttpError(502, '카페24 인증 응답에 토큰이 없습니다.');
  await setJSON(TOKEN_KEY, tok);
  return tok;
}
export async function exchangeCode(code, redirectUri) {
  return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
}
/** 만료 30분 전이면 갱신. force=true 면 무조건 갱신(리프레시 토큰 유효기간 연장용) */
export async function ensureToken(force = false) {
  const tok = await getJSON(TOKEN_KEY);
  if (!tok) throw new HttpError(409, '카페24가 아직 연결되지 않았습니다. 설정에서 연결하세요.');
  if (tok.refresh_token_expires_at && tok.refresh_token_expires_at < Date.now()) {
    throw new HttpError(409, '카페24 연결이 만료되었습니다. 설정에서 다시 연결하세요.');
  }
  if (force || tok.expires_at - Date.now() < 30 * 60000) {
    return tokenRequest({ grant_type: 'refresh_token', refresh_token: tok.refresh_token });
  }
  return tok;
}
export async function tokenInfo() {
  const tok = await getJSON(TOKEN_KEY);
  if (!tok) return null;
  return { expiresAt: tok.expires_at, refreshExpiresAt: tok.refresh_token_expires_at, savedAt: tok.saved_at };
}

async function call(path, { method = 'GET', query, body } = {}) {
  const e = env();
  const tok = await ensureToken();
  const url = `https://${e.mall}.cafe24api.com/api/v2/admin/${path}` + (query ? '?' + new URLSearchParams(query) : '');
  return httpJson(url, {
    method, label: '카페24',
    headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json', 'X-Cafe24-Api-Version': e.version },
    body: body ? JSON.stringify(body) : undefined
  });
}

/* ---------- 주문 ---------- */
function normalizeOrder(o) {
  const items = (o.items || []).map(it => ({
    itemCode: it.order_item_code, productNo: num(it.product_no), name: it.product_name || '', option: it.option_value || '',
    qty: num(it.quantity) || 1, price: num(it.product_price), status: it.order_status || ''
  }));
  const status = o.order_status || items[0]?.status || '';
  const amount = num(o.payment_amount) || num(o.actual_order_amount?.payment_amount) || num(o.actual_order_amount?.total_amount_due)
    || items.reduce((s, i) => s + i.price * i.qty, 0);
  const pay = o.payment_date || o.order_date || '';
  return {
    id: o.order_id, date: String(pay).slice(0, 10), time: pay, status,
    amount, shippingFee: num(o.shipping_fee ?? o.actual_order_amount?.shipping_fee),
    buyer: maskName(o.buyer_name || o.buyer?.name || ''),
    canceled: o.canceled === 'T' || String(status).startsWith('C'),
    channel: o.order_place_name || o.order_place_id || '',
    items
  };
}
/** 결제일 기준 주문 목록 (카페24는 한 번에 최대 3개월, 페이지당 100건) */
export async function fetchOrders(from, to) {
  const e = env();
  const out = [];
  let chunkFrom = from;
  while (chunkFrom <= to) {
    const chunkTo = [addDays(chunkFrom, 88), to].sort()[0];
    for (let offset = 0; offset <= 15000; offset += 100) {
      const data = await call('orders', { query: { shop_no: e.shopNo, start_date: chunkFrom, end_date: chunkTo, date_type: 'pay_date', embed: 'items', limit: 100, offset } });
      const list = data?.orders || [];
      for (const o of list) out.push(normalizeOrder(o));
      if (list.length < 100) break;
    }
    chunkFrom = addDays(chunkTo, 1);
  }
  return out;
}
export async function fetchCarriers() {
  const data = await call('carriers', { query: { shop_no: env().shopNo } });
  return (data?.carriers || []).map(c => ({
    code: c.shipping_carrier_code || c.carrier_code || String(c.carrier_id),
    name: c.shipping_carrier || c.carrier_name || c.shipping_carrier_code || '택배사'
  }));
}
export async function createShipment(orderId, itemCodes, carrierCode, trackingNo) {
  const request = { tracking_no: trackingNo, shipping_company_code: carrierCode, status: 'shipping' };
  if (itemCodes && itemCodes.length) request.order_item_code = itemCodes;
  return call(`orders/${encodeURIComponent(orderId)}/shipments`, { method: 'POST', body: { shop_no: env().shopNo, request } });
}

/* ---------- 상품 ---------- */
export async function fetchProducts() {
  const out = [];
  for (let offset = 0; offset <= 5000; offset += 100) {
    const data = await call('products', { query: { shop_no: env().shopNo, limit: 100, offset, fields: 'product_no,product_name,price,display,selling' } });
    const list = data?.products || [];
    for (const p of list) out.push({ productNo: num(p.product_no), name: p.product_name, price: num(p.price) });
    if (list.length < 100) break;
  }
  return out;
}

/* ---------- 게시판(CS) ---------- */
const ANSWERED = new Set(['T', 'Y', 'C', 'A']);
export async function fetchArticles(from, to) {
  const e = env();
  const boards = (await call('boards', { query: { shop_no: e.shopNo } }))?.boards || [];
  const wanted = (process.env.CAFE24_CS_BOARDS || '').split(',').map(s => s.trim()).filter(Boolean).map(Number);
  const targets = boards.filter(b => wanted.length ? wanted.includes(num(b.board_no)) : /문의|Q\s*&?\s*A|qna/i.test(b.board_name || ''));
  const out = [];
  for (const b of targets.slice(0, 6)) {
    const data = await call(`boards/${b.board_no}/articles`, { query: { shop_no: e.shopNo, start_date: from, end_date: to, limit: 100 } });
    const list = data?.articles || [];
    const repliedTo = new Set(list.filter(a => a.parent_article_no).map(a => num(a.parent_article_no)));
    for (const a of list) {
      if (a.parent_article_no) continue; // 답글 자체는 목록에서 제외
      const answered = repliedTo.has(num(a.article_no)) || ANSWERED.has(String(a.reply_status || '').toUpperCase()) || a.answered === 'T';
      out.push({
        boardNo: num(b.board_no), boardName: b.board_name, articleNo: num(a.article_no), title: a.title || '',
        content: String(a.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000),
        writer: maskName(a.writer || ''), createdAt: a.created_date || '', productNo: num(a.product_no) || null, answered, reply: null
      });
    }
  }
  return out;
}
/** 문의 답변: 기본은 답글(부모 글 번호 지정), CAFE24_CS_REPLY_MODE=comment 이면 댓글로 등록 */
export async function replyArticle(boardNo, articleNo, title, content, writer) {
  const e = env();
  if ((process.env.CAFE24_CS_REPLY_MODE || 'reply') === 'comment') {
    return call(`boards/${boardNo}/articles/${articleNo}/comments`, {
      method: 'POST', body: { shop_no: e.shopNo, request: { content, writer, password: process.env.CAFE24_CS_COMMENT_PASSWORD || 'jimi1234!' } }
    });
  }
  return call(`boards/${boardNo}/articles`, {
    method: 'POST',
    body: { shop_no: e.shopNo, requests: [{ writer, title: 'RE: ' + title, content, client_ip: '127.0.0.1', parent_article_no: articleNo, reply_mail: 'N' }] }
  });
}
