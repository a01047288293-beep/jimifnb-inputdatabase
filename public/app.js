// 지미 운영실 — 화면 뼈대: 로그인, 메뉴, 주소별 화면 전환, 공통 도구
import * as home from './pages/home.js';
import * as orders from './pages/orders.js';
import * as cs from './pages/cs.js';
import * as sales from './pages/sales.js';
import * as products from './pages/products.js';
import * as ads from './pages/ads.js';
import * as rules from './pages/rules.js';
import * as log from './pages/log.js';
import * as settings from './pages/settings.js';

/* ---------- 공통 도구 ---------- */
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const won = x => (x == null || !isFinite(x)) ? '–' : Math.round(x).toLocaleString('ko-KR') + '원';
export const man = x => (x == null || !isFinite(x)) ? '–' : Math.abs(x) >= 10000 ? (x / 10000).toFixed(Math.abs(x) >= 1000000 ? 0 : 1).replace(/\.0$/, '') + '만' : Math.round(x).toLocaleString('ko-KR');
export const pctf = (x, d = 1) => (x == null || !isFinite(x)) ? '–' : (x * 100).toFixed(d) + '%';
export const nf = x => (x == null || !isFinite(x)) ? '–' : Math.round(x).toLocaleString('ko-KR');
export const roasf = x => (x == null || !isFinite(x)) ? '–' : x.toFixed(2) + '배';
export const $ = (sel, el = document) => el.querySelector(sel);

export function kstToday() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
export function addDays(ymd, n) { return new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
/** 자사몰 상품 페이지 링크 */
export function shopLink(productNo, label) {
  const text = esc(label);
  if (!productNo) return text;
  return `<a href="${esc(state.shop.url)}/product/detail.html?product_no=${encodeURIComponent(productNo)}" target="_blank" rel="noopener">${text}</a>`;
}
export const PLAT = { meta: '메타', google: '구글', tiktok: '틱톡' };
export const platTag = p => `<span class="plat ${esc(p)}">${esc(PLAT[p] || p)}</span>`;
export function srcTag(mode) {
  return mode === 'live' ? '<span class="src live">실제</span>' : mode === 'demo' ? '<span class="src">데모</span>' : '<span class="src off">미연결</span>';
}

export async function api(path, { method = 'GET', body } = {}) {
  const opt = { method, headers: { 'x-jimi': '1' }, credentials: 'same-origin' };
  if (body !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(path, opt); } catch { throw new Error('서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.'); }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (res.status === 401 && path !== '/api/login') { state.user = null; renderLogin(); throw new Error('로그인이 필요합니다.'); }
  if (!res.ok) throw new Error(data?.error || `요청 실패 (${res.status})`);
  return data;
}

let toastTimer;
export function toast(msg, bad = false) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = bad ? 'bad' : ''; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 5000 : 2500);
}

/** 확인 대화상자 (브라우저 confirm 대신) */
export function modal(html, { onMount } = {}) {
  const back = document.createElement('div'); back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(back);
  onMount && onMount(back.firstElementChild, close);
  const first = back.querySelector('input,textarea,select,button.primary'); if (first) first.focus();
  return close;
}
export function confirmBox(message, okLabel = '확인', danger = false) {
  return new Promise(resolve => {
    modal(`<h2>확인</h2><p style="margin:0">${esc(message)}</p><div class="foot"><button class="btn" data-close>취소</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cb-ok">${esc(okLabel)}</button></div>`, {
      onMount: (el, close) => {
        el.querySelector('#cb-ok').onclick = () => { close(); resolve(true); };
        el.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => resolve(false)));
      }
    });
  });
}

export function errBox(e) { return `<div class="err">${esc(e.message || e)}</div>`; }
export function loading() { return '<div class="empty">불러오는 중…</div>'; }

/** 막대(매출·광고비) + 선(이익) 차트 */
export function barLineChart(series, { bars, line: lineOpt, height = 220 }) {
  let line = lineOpt;
  const W = 760, H = height, L = 56, R = 12, T = 12, B = 28;
  const n = series.length || 1;
  const vals = series.flatMap(d => [...bars.map(b => d[b.key] || 0), line && d[line.key] != null ? d[line.key] : 0]);
  let max = Math.max(1, ...vals), min = Math.min(0, ...vals);
  const step = niceStep((max - min) / 4);
  max = Math.ceil(max / step) * step; min = Math.floor(min / step) * step;
  const y = v => T + (max - v) / (max - min) * (H - T - B);
  const bw = (W - L - R) / n;
  const inner = Math.max(2, (bw * 0.7) / bars.length);
  let g = '';
  for (let v = min; v <= max + 1e-9; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="${v === 0 ? 1.2 : .6}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${man(v)}</text>`;
  series.forEach((d, i) => {
    const x0 = L + i * bw + bw * 0.15;
    bars.forEach((b, j) => {
      const v = d[b.key] || 0; const y1 = y(Math.max(v, 0)), y2 = y(Math.min(v, 0));
      g += `<rect x="${x0 + j * inner}" y="${y1}" width="${inner - 1}" height="${Math.max(0.5, y2 - y1)}" fill="${b.color}" rx="1.5"><title>${esc(d.date)} ${esc(b.label)} ${won(v)}</title></rect>`;
    });
    if (n <= 16 || i % Math.ceil(n / 12) === 0 || i === n - 1) g += `<text x="${L + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(String(d.date).slice(5).replace('-', '/'))}</text>`;
  });
  if (line && series.some(d => d[line.key] != null)) {
    // 값이 없는 날(null)은 선을 끊는다
    let seg = [];
    const flush = () => { if (seg.length > 1) g += `<polyline points="${seg.join(' ')}" fill="none" stroke="${line.color}" stroke-width="2"/>`; seg = []; };
    series.forEach((d, i) => { if (d[line.key] == null) flush(); else seg.push(`${L + i * bw + bw / 2},${y(d[line.key])}`); });
    flush();
    series.forEach((d, i) => { if (d[line.key] != null) g += `<circle cx="${L + i * bw + bw / 2}" cy="${y(d[line.key])}" r="${i === n - 1 ? 3.5 : 2}" fill="${line.color}"><title>${esc(d.date)} ${esc(line.label)} ${won(d[line.key])}</title></circle>`; });
  } else line = null;
  const legend = [...bars.map(b => `<span><i style="background:${b.color}"></i>${esc(b.label)}</span>`), line ? `<span><i style="background:${line.color}"></i>${esc(line.label)}</span>` : ''].join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(bars.map(b => b.label).join(', '))} 차트">${g}</svg><div class="legend">${legend}</div>`;
}
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * p) return m * p;
  return 10 * p;
}

/* ---------- 앱 ---------- */
export const state = { user: null, status: null, shop: { url: 'https://www.jimifnb0901.com', mallId: 'jimifnb0901' } };
const PAGES = [
  { id: 'home', label: '홈', mod: home },
  { id: 'orders', label: '주문·출고', mod: orders },
  { id: 'cs', label: 'CS 문의', mod: cs, badge: 'cs' },
  { id: 'sales', label: '매출·이익', mod: sales },
  { id: 'products', label: '제품·마진', mod: products },
  { id: 'sep1' },
  { id: 'ads', label: '광고', mod: ads },
  { id: 'rules', label: '자동 규칙', mod: rules },
  { id: 'sep2' },
  { id: 'log', label: '변경 이력', mod: log },
  { id: 'settings', label: '설정·연동', mod: settings }
];
let cleanup = null;

export function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, q] = h.split('?');
  const [page, ...rest] = path.split('/');
  return { page: page || 'home', args: rest, query: new URLSearchParams(q || '') };
}
export function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

function renderShell() {
  const app = document.getElementById('app');
  if (app.querySelector('.shell')) return;
  app.innerHTML = `<div class="shell">
    <nav class="side" aria-label="메뉴">
      <div class="brand">지미 운영실<small>(주)지미에프앤비</small></div>
      <div class="nav" id="nav">${PAGES.map(p => p.label ? `<a href="#/${p.id}" data-page="${p.id}">${p.label}${p.badge ? `<span class="badge" id="badge-${p.badge}" hidden></span>` : ''}</a>` : '<div class="nav-sep"></div>').join('')}</div>
      <div class="side-foot"><a id="shop-link" target="_blank" rel="noopener">자사몰 열기 ↗</a><a id="admin-link" target="_blank" rel="noopener">카페24 관리자 ↗</a><span id="who"></span><button class="btn small" id="logout" type="button">로그아웃</button></div>
    </nav>
    <main class="main" id="main"></main></div>`;
  document.getElementById('logout').onclick = async () => { try { await api('/api/logout', { method: 'POST' }); } catch { /* 무시 */ } state.user = null; renderLogin(); };
}

export function setBadge(id, n) { const b = document.getElementById('badge-' + id); if (b) { b.hidden = !n; b.textContent = n || ''; } }

async function route() {
  if (!state.user) return;
  renderShell();
  document.getElementById('who').textContent = state.user + ' 님';
  document.getElementById('shop-link').href = state.shop.url;
  document.getElementById('admin-link').href = `https://${state.shop.mallId}.cafe24.com/disp/admin/shop1/main/dashboard`;
  const { page, args, query } = parseHash();
  const p = PAGES.find(x => x.id === page && x.mod) || PAGES[0];
  document.querySelectorAll('#nav a').forEach(a => a.setAttribute('aria-current', a.dataset.page === p.id ? 'page' : 'false'));
  document.title = `${p.label} · 지미 운영실`;
  if (cleanup) { try { cleanup(); } catch { /* 무시 */ } cleanup = null; }
  const main = document.getElementById('main');
  main.innerHTML = loading();
  try { cleanup = (await p.mod.render(main, { args, query })) || null; }
  catch (e) { main.innerHTML = errBox(e); }
  window.scrollTo(0, 0);
}

function renderLogin(msg, typedName) {
  document.title = '로그인 · 지미 운영실';
  const app = document.getElementById('app');
  app.innerHTML = `<div class="login"><form id="login-form" autocomplete="on">
    <div class="brand">지미 운영실</div>
    <p class="hint" style="margin:0">(주)지미에프앤비 내부 운영 시스템입니다.</p>
    <label class="f">이름<input id="login-name" name="name" autocomplete="name" placeholder="김민웅" maxlength="20"></label>
    <label class="f">비밀번호<input id="login-pw" name="password" type="password" autocomplete="current-password" required></label>
    ${msg ? `<div class="err">${esc(msg)}</div>` : ''}
    <button class="btn primary" type="submit">로그인</button></form></div>`;
  const f = document.getElementById('login-form');
  try { f.elements.name.value = typedName ?? (localStorage.getItem('jimi-name') || ''); } catch { f.elements.name.value = typedName || ''; }
  f.onsubmit = async e => {
    e.preventDefault();
    const name = f.elements.name.value.trim() || '관리자';
    try {
      const r = await api('/api/login', { method: 'POST', body: { name, password: f.elements.password.value } });
      try { localStorage.setItem('jimi-name', name); } catch { /* 무시 */ }
      state.user = r.name; route();
    } catch (err) { renderLogin(err.message, f.elements.name.value); }
  };
}

window.addEventListener('hashchange', route);
(async () => {
  try {
    const me = await api('/api/me');
    if (me.shop) state.shop = me.shop;
    if (me.loggedIn) { state.user = me.name; route(); } else renderLogin();
  } catch (e) { renderLogin(e.message); }
})();
