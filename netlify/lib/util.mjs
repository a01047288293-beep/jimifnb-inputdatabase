// 공통 도구: 날짜(한국시간), 응답, 외부 API 호출
export const KST_OFFSET = 9 * 3600 * 1000;

/** 한국시간 기준 YYYY-MM-DD */
export function kstDate(d = new Date()) {
  return new Date(d.getTime() + KST_OFFSET).toISOString().slice(0, 10);
}
/** YYYY-MM-DD 에 n일 더하기 */
export function addDays(ymd, n) {
  const t = Date.parse(ymd + 'T00:00:00Z') + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
/** from~to (포함) 날짜 목록 */
export function dateRange(from, to) {
  const out = [];
  if (!isYmd(from) || !isYmd(to) || from > to) return out;
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}
export function isYmd(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)); }
export function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

export class HttpError extends Error {
  constructor(status, message, detail) { super(message); this.status = status; this.detail = detail; }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
  });
}

/** 외부 API 호출: 시간 제한, JSON 파싱, 오류 메시지 정리 */
export async function httpJson(url, { method = 'GET', headers = {}, body, timeoutMs = 12000, label = 'API' } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { method, headers, body, signal: ctrl.signal });
  } catch (e) {
    throw new HttpError(502, `${label} 연결 실패: ${e.name === 'AbortError' ? '응답 시간 초과' : e.message}`);
  } finally { clearTimeout(timer); }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
  if (!res.ok) {
    const msg = (data && (data.error?.message || data.error_description || data.message || (typeof data.error === 'string' ? data.error : ''))) || res.statusText;
    throw new HttpError(res.status === 401 ? 401 : 502, `${label} 오류(${res.status}): ${msg}`, data);
  }
  return data;
}

/** 이름 가운데 가리기: 김민웅 → 김*웅 */
export function maskName(name) {
  const s = String(name || '').trim();
  if (s.length <= 1) return s;
  if (s.length === 2) return s[0] + '*';
  return s[0] + '*'.repeat(s.length - 2) + s[s.length - 1];
}

export function newId(prefix = 'x') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
