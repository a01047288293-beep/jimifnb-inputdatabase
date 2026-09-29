// 카페24 Admin API 연동 (OAuth 2.0, 토큰 자동 갱신)
import { getJSON, setJSON } from './store.mjs';
import { httpJson, HttpError, maskName, num, addDays, regionOf, memberKey } from './util.mjs';

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
    // 복사할 때 딸려 온 앞뒤 공백·줄바꿈은 제거
    clientId: (process.env.CAFE24_CLIENT_ID || '').trim(),
    secret: (process.env.CAFE24_CLIENT_SECRET || '').trim(),
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

/** 카페24는 만료 시각을 시간대 없이(한국시간) 보낼 수 있어 +09:00 을 붙여 해석 */
export function parseCafe24Time(s, fallbackMs) {
  if (!s) return fallbackMs;
  const str = String(s).trim();
  const withTz = /([zZ]|[+-]\d{2}:?\d{2})$/.test(str) ? str : str.replace(' ', 'T') + '+09:00';
  const t = Date.parse(withTz);
  return Number.isFinite(t) ? t : fallbackMs;
}
/** 연결에 쓸 Redirect URI (기본: 접속한 주소 기준, 필요하면 CAFE24_REDIRECT_URI 로 고정) */
export function redirectUriFor(origin) {
  return process.env.CAFE24_REDIRECT_URI || origin + '/api/cafe24/callback';
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
    expires_at: parseCafe24Time(data.expires_at, Date.now() + 7000 * 1000),
    refresh_token: data.refresh_token,
    refresh_token_expires_at: parseCafe24Time(data.refresh_token_expires_at, Date.now() + 13 * 86400000),
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
const pick = (...v) => v.find(x => x != null && x !== '');
const dt = v => (v && !String(v).startsWith('0000')) ? String(v) : null;
export function normalizeOrder(o) {
  const cancel = Array.isArray(o.cancellation) ? o.cancellation[0] : o.cancellation;
  const ret = Array.isArray(o.return) ? o.return[0] : o.return;
  const items = (o.items || []).map(it => ({
    itemCode: it.order_item_code, productNo: num(it.product_no), name: it.product_name || '', option: it.option_value || '',
    variant: it.variant_code || '',
    qty: num(it.quantity) || 1, price: num(it.product_price), optionPrice: num(it.option_price), status: it.order_status || '',
    shippedAt: dt(pick(it.shipped_date, it.shipbegin_date)), deliveredAt: dt(pick(it.delivered_date, it.shipend_date)),
    claimReason: pick(it.claim_reason, it.claim_reason_type, null)
  }));
  const status = o.order_status || items[0]?.status || '';
  const aoa = o.actual_order_amount || {};
  // 카페24 대시보드 '결제' = 실결제(카드·계좌 등) + 적립금 + 예치금(선불금). 쿠폰·회원 할인만 빠짐
  const cash = num(pick(o.payment_amount, aoa.payment_amount, aoa.total_amount_due, 0));
  const points = num(pick(aoa.points_spent_amount, aoa.mileage_spent_amount, o.points_spent_amount, 0));
  const credits = num(pick(aoa.credits_spent_amount, aoa.deposit_spent_amount, o.credits_spent_amount, 0));
  const amount = (cash || points || credits) ? cash + points + credits : items.reduce((s, i) => s + i.price * i.qty, 0);
  const pay = o.payment_date || o.order_date || '';
  const shippingFee = num(o.shipping_fee ?? o.actual_order_amount?.shipping_fee);
  // 카페24 대시보드의 '주문 금액'과 같은 방식: (판매가+옵션가)×수량 + 배송비 (할인·적립금 차감 전)
  const orderAmount = items.reduce((s2, i) => s2 + (i.price + i.optionPrice) * i.qty, 0) + shippingFee;
  const amounts = {};
  for (const [k, v] of Object.entries(o.actual_order_amount || {})) if (v != null && v !== '' && isFinite(Number(v))) amounts[k] = Number(v);
  const rcv = Array.isArray(o.receivers) ? o.receivers[0] : null;
  const pm = o.payment_method_name ?? o.payment_method;
  return {
    id: o.order_id, date: String(pay).slice(0, 10), time: pay, orderedAt: o.order_date || pay,
    orderDate: String(o.order_date || pay).slice(0, 10), paid: o.paid === 'T' || (o.paid == null && Boolean(o.payment_date)), status,
    amount, cash, points, credits, orderAmount, amounts, shippingFee,
    buyer: maskName(o.buyer_name || o.buyer?.name || ''),
    canceled: o.canceled === 'T' || String(status).startsWith('C'),
    channel: o.order_place_name || o.order_place_id || '',
    payment: Array.isArray(pm) ? pm.filter(Boolean).join('+') : (pm || ''),
    firstOrder: o.first_order === 'T' ? true : o.first_order === 'F' ? false : null,
    member: o.member_id ? memberKey(o.member_id) : null,
    region: regionOf(pick(rcv?.address1, rcv?.address_full, o.receiver_address, '')),
    claimReason: pick(cancel?.reason, cancel?.claim_reason, ret?.reason, ret?.claim_reason, items.find(i => i.claimReason)?.claimReason, null),
    items
  };
}
/** 결제일 기준 주문 목록 (카페24는 한 번에 최대 3개월, 페이지당 100건) */
export async function fetchOrders(from, to, dateType = 'pay_date', status = null) {
  const e = env();
  const out = [];
  let chunkFrom = from;
  while (chunkFrom <= to) {
    const chunkTo = [addDays(chunkFrom, 88), to].sort()[0];
    for (let offset = 0; offset <= 15000; offset += 100) {
      const query = { shop_no: e.shopNo, start_date: chunkFrom, end_date: chunkTo, date_type: dateType, embed: 'items,receivers,cancellation,return', limit: 100, offset };
      if (status) query.order_status = status;
      const data = await call('orders', { query });
      const list = data?.orders || [];
      for (const o of list) out.push(normalizeOrder(o));
      if (list.length < 100) break;
    }
    chunkFrom = addDays(chunkTo, 1);
  }
  return out;
}
/** 지금 해당 상태인 주문 전부 (카페24 '오늘의 할 일'처럼 주문일과 무관). 최근 12개월을 3개월씩 나눠 조회 */
export const ACTIVE_CODES = ['N00', 'N10', 'N20', 'N21', 'N22', 'N30', 'C00', 'C10', 'C34', 'R00', 'R10', 'R12', 'E00', 'E10', 'E12'];
export async function fetchActiveOrders(today, months = 12) {
  const from = addDays(today, -Math.round(months * 30.5));
  const list = await fetchOrders(from, today, 'order_date', ACTIVE_CODES.join(','));
  const seen = new Set();
  return list.filter(o => !seen.has(o.id) && seen.add(o.id));
}
/** 환불 완료일 기준 환불 목록 (카페24 대시보드 '환불' 칸과 같은 기준) */
export function normalizeRefund(r) {
  const cash = num(pick(r.actual_refund_amount, r.refund_amount, r.total_refund_amount, 0));
  const points = num(pick(r.used_points, r.refund_point, r.refund_points, 0));
  const credits = num(pick(r.used_credits, r.refund_credit, r.refund_credits, 0));
  const when = String(pick(r.refund_date, r.accepted_refund_date, r.refund_accepted_date, '') || '');
  const numeric = {};
  for (const [k, v] of Object.entries(r)) if (v != null && v !== '' && typeof v !== 'object' && isFinite(Number(v)) && /amount|point|credit|price|fee/.test(k)) numeric[k] = Number(v);
  return { code: r.refund_code || '', orderId: r.order_id || '', date: when.slice(0, 10), amount: cash + points + credits, cash, points, credits, done: r.refund_status == null ? true : r.refund_status === 'T' || /complete|done|T/.test(String(r.refund_status)), numeric };
}
export async function fetchRefunds(from, to) {
  const e = env();
  const out = [];
  for (let offset = 0; offset <= 5000; offset += 100) {
    const q = { shop_no: e.shopNo, start_date: from, end_date: to, date_type: 'refund_date', limit: 100, offset };
    let data;
    try { data = await call('refunds', { query: q }); }
    catch (err) { if (offset === 0 && err.status === 422) { delete q.date_type; data = await call('refunds', { query: q }); } else throw err; }
    const list = data?.refunds || [];
    for (const r of list) out.push(normalizeRefund(r));
    if (list.length < 100) break;
  }
  return out.filter(r => r.done);
}

/** 주문 1건 상세 (받는 분 정보는 화면에만 보여주고 저장하지 않음) */
export async function fetchOrderDetail(orderId) {
  const data = await call(`orders/${encodeURIComponent(orderId)}`, { query: { shop_no: env().shopNo, embed: 'items,receivers,buyer,cancellation,return' } });
  const o = data?.order;
  if (!o) throw new HttpError(404, '주문을 찾지 못했습니다.');
  const n = normalizeOrder(o);
  const r = Array.isArray(o.receivers) ? o.receivers[0] : {};
  const b = o.buyer || {};
  n.receiver = {
    name: r?.name || o.receiver_name || '', phone: r?.cellphone || r?.phone || '',
    zipcode: r?.zipcode || '', address: [r?.address1, r?.address2].filter(Boolean).join(' ') || o.receiver_address || '',
    message: r?.shipping_message || o.shipping_message || ''
  };
  n.buyerFull = { name: b.name || o.buyer_name || '', phone: b.cellphone || b.phone || o.buyer_cellphone || '', email: b.email || o.buyer_email || '' };
  n.shipments = (o.items || []).filter(i => i.tracking_no).map(i => ({ trackingNo: i.tracking_no, carrier: i.shipping_company_name || i.shipping_company_code || '' }));
  n.memo = o.admin_additional_memo || '';
  return n;
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

/** 상품·품목별 재고 (재고 관리를 켠 품목만 수량이 있음) */
export async function fetchInventory() {
  const out = [];
  for (let offset = 0; offset <= 5000; offset += 100) {
    const data = await call('products', { query: { shop_no: env().shopNo, limit: 100, offset, embed: 'variants,inventories' } });
    const list = data?.products || [];
    for (const p of list) {
      const variants = Array.isArray(p.variants) && p.variants.length ? p.variants : [{ variant_code: '', options: [] }];
      for (const v of variants) {
        const inv = Array.isArray(v.inventories) ? v.inventories[0] : v.inventories;
        const qty = pick(inv?.quantity, v.quantity, null);
        const opts = Array.isArray(v.options) ? v.options.map(o => o.value || o.option_value).filter(Boolean).join(' / ') : '';
        out.push({
          productNo: num(p.product_no), name: p.product_name, price: num(p.price), variant: v.variant_code || '', option: opts,
          selling: (v.selling ?? p.selling) !== 'F', display: (v.display ?? p.display) !== 'F',
          soldOut: p.sold_out === 'T' || v.sold_out === 'T',
          tracked: pick(inv?.use_inventory, v.use_inventory) === 'T',
          quantity: qty == null ? null : num(qty), safety: num(pick(inv?.safety_inventory, v.safety_inventory, 0))
        });
      }
    }
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
