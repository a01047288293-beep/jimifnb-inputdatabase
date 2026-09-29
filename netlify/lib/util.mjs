// 공통 도구: 날짜(한국시간), 응답, 외부 API 호출
import crypto from 'node:crypto';
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
    // 외부 서비스 오류는 항상 502로 (401을 그대로 넘기면 화면이 운영실 로그아웃으로 오해함). 원래 상태는 upstream 에 보관
    const err = new HttpError(502, `${label} 오류(${res.status}): ${msg}${res.status === 401 ? ' — 키·토큰이 만료되었거나 잘못되었습니다. 설정·연동에서 확인하세요.' : ''}`, data);
    err.upstream = res.status;
    throw err;
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

const REGIONS = [['서울', '서울'], ['부산', '부산'], ['대구', '대구'], ['인천', '인천'], ['광주', '광주'], ['대전', '대전'], ['울산', '울산'], ['세종', '세종'],
  ['경기', '경기'], ['강원', '강원'], ['충북', '충북'], ['충청북', '충북'], ['충남', '충남'], ['충청남', '충남'], ['전북', '전북'], ['전라북', '전북'],
  ['전남', '전남'], ['전라남', '전남'], ['경북', '경북'], ['경상북', '경북'], ['경남', '경남'], ['경상남', '경남'], ['제주', '제주']];
/** 주소 첫 단어로 시·도 구분 (예: "서울특별시 강남구…" → 서울) */
export function regionOf(addr) {
  const first = String(addr || '').trim().split(/\s+/)[0] || '';
  if (!first) return '미상';
  // 전남광주통합특별시처럼 새 행정구역명은 가장 먼저 맞는 이름으로
  for (const [k, v] of REGIONS) if (first.startsWith(k)) return v;
  return '기타';
}
/** 회원 아이디는 저장하지 않고 되돌릴 수 없는 짧은 값으로 바꿔 재구매 계산에만 사용 */
export function memberKey(id) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET || 'jimi').update(String(id)).digest('base64url').slice(0, 16);
}

export function newId(prefix = 'x') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
