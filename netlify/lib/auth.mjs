// 로그인과 세션: ADMIN_PASSWORD 하나로 로그인, 서명된 쿠키로 14일 유지
import crypto from 'node:crypto';
import { getJSON, setJSON } from './store.mjs';
import { HttpError } from './util.mjs';

const COOKIE = 'jimi_session';
const MAX_AGE = 14 * 86400;

function secret() {
  const s = process.env.SESSION_SECRET || '';
  if (s.length < 16) throw new HttpError(500, '서버 설정 필요: SESSION_SECRET 환경변수를 16자 이상으로 등록하세요.');
  return s;
}
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + mac;
}
function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expect = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p.exp || p.exp < Date.now() / 1000) return null;
    return p;
  } catch { return null; }
}
function readCookie(req, name) {
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function secureFlag(req) { return new URL(req.url).protocol === 'https:' ? '; Secure' : ''; }

export function sessionOf(req) { return verify(readCookie(req, COOKIE)); }

export function requireSession(req) {
  const s = sessionOf(req);
  if (!s) throw new HttpError(401, '로그인이 필요합니다.');
  return s;
}

function clientIp(req) {
  return (req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'local').split(',')[0].trim();
}

function samePassword(input, actual) {
  const a = crypto.createHash('sha256').update(String(input)).digest();
  const b = crypto.createHash('sha256').update(String(actual)).digest();
  return crypto.timingSafeEqual(a, b);
}

/** 로그인: 5회 실패하면 10분 잠금 */
export async function login(req, body) {
  const pw = process.env.ADMIN_PASSWORD || '';
  if (pw.length < 8) throw new HttpError(500, '서버 설정 필요: ADMIN_PASSWORD 환경변수를 8자 이상으로 등록하세요.');
  const key = 'auth/fail/' + clientIp(req).replace(/[^0-9a-zA-Z.:_-]/g, '_');
  const rec = (await getJSON(key)) || { n: 0, until: 0 };
  if (rec.until > Date.now()) {
    const min = Math.ceil((rec.until - Date.now()) / 60000);
    throw new HttpError(429, `로그인 시도가 많아 ${min}분 동안 잠겼습니다.`);
  }
  if (!body || !samePassword(body.password || '', pw)) {
    rec.n += 1;
    if (rec.n >= 5) { rec.until = Date.now() + 10 * 60000; rec.n = 0; }
    await setJSON(key, rec);
    throw new HttpError(401, '비밀번호가 맞지 않습니다.');
  }
  if (rec.n) await setJSON(key, { n: 0, until: 0 });
  const name = String(body.name || '관리자').slice(0, 20);
  const token = sign({ name, exp: Math.floor(Date.now() / 1000) + MAX_AGE });
  return { name, cookie: `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secureFlag(req)}` };
}

export function logoutCookie(req) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag(req)}`;
}

/** OAuth state 값 서명 (카페24 연결용) */
export function signState(data) { return sign({ ...data, exp: Math.floor(Date.now() / 1000) + 600 }); }
export function verifyState(token) { return verify(token); }
