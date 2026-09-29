// 지미에프앤비 내부 운영실 — 화면 뼈대: 로그인, 메뉴, 주소별 화면 전환, 공통 도구
import * as home from './pages/home.js';
import * as orders from './pages/orders.js';
import * as cs from './pages/cs.js';
import * as sales from './pages/sales.js';
import * as products from './pages/products.js';
import * as ads from './pages/ads.js';
import * as rules from './pages/rules.js';
import * as log from './pages/log.js';
import * as settings from './pages/settings.js';
import * as stock from './pages/stock.js';
import * as customers from './pages/customers.js';
import * as fulfillment from './pages/fulfillment.js';
import * as reconcile from './pages/reconcile.js';

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

/** 기간 선택 막대: presets = 일수 목록 */
export function readPeriod(query, defDays) {
  const today = kstToday();
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.get('to') || '') ? query.get('to') : today;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.get('from') || '') ? query.get('from') : addDays(to, -(defDays - 1));
  return { from, to, today };
}
export function periodBar({ from, to, today }, presets = [7, 30, 90, 180], max = 184) {
  const cur = to === today ? Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1 : null;
  return `<div class="toolbar"><div class="seg" data-period>${presets.map(n => `<button type="button" data-days="${n}" aria-pressed="${cur === n}">${n === 7 ? '7일' : n === 30 ? '30일' : n === 90 ? '90일' : n === 180 ? '6개월' : n + '일'}</button>`).join('')}</div>
    <input type="date" id="p-from" value="${from}" max="${today}" aria-label="시작일"> <span class="muted">~</span> <input type="date" id="p-to" value="${to}" max="${today}" aria-label="종료일"><span class="hint">최대 ${max}일</span></div>`;
}
export function bindPeriod(main, page, st, extra = '') {
  const goTo = (f, t) => go(`#/${page}?from=${f}&to=${t}${extra}`);
  main.querySelectorAll('[data-period] button').forEach(b => b.onclick = () => goTo(addDays(st.today, -(Number(b.dataset.days) - 1)), st.today));
  const f = main.querySelector('#p-from'), t = main.querySelector('#p-to');
  if (f) f.onchange = () => goTo(f.value, t.value);
  if (t) t.onchange = () => goTo(f.value, t.value);
}
/** 페이지 제목 줄 */
export function pageHead(title, sub = '', right = '') {
  return `<div class="page-head"><h1>${esc(title)}${sub ? `<span class="sub">${sub}</span>` : ''}</h1>${right}</div>`;
}

/* ---------- 앱 ---------- */
export const state = { user: null, status: null, shop: { url: 'https://www.jimifnb0901.com', mallId: 'jimifnb0901' } };
export const APP_NAME = '지미에프앤비 내부 운영실';
// 메뉴 아이콘 (선 아이콘, 16px)
const IC = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  orders: '<path d="M3 7h18l-2 12H5z"/><path d="M8 7V5a4 4 0 0 1 8 0v2"/>',
  cs: '<path d="M4 5h16v11H8l-4 4z"/>',
  sales: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  stock: '<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7"/>',
  customers: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  fulfillment: '<path d="M2 7h12v10H2zM14 10h4l3 3v4h-7"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  products: '<path d="M9 3h6v5l4 11a1.5 1.5 0 0 1-1.4 2H6.4A1.5 1.5 0 0 1 5 19L9 8z"/>',
  ads: '<path d="M3 11v2a1 1 0 0 0 1 1h3l6 5V5L7 10H4a1 1 0 0 0-1 1z"/><path d="M17 8a5 5 0 0 1 0 8"/>',
  rules: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  log: '<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/>',
  reconcile: '<path d="M4 7h11M4 7l3-3M4 7l3 3M20 17H9M20 17l-3-3M20 17l-3 3"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'
};
const PAGES = [
  { grp: '운영' },
  { id: 'home', label: '홈', mod: home },
  { id: 'cs', label: 'CS 문의', mod: cs, badge: 'cs' },
  { grp: '주문관리' },
  { id: 'orders', label: '전체 주문 조회', mod: orders, icon: 'orders' },
  { id: 'orders/unpaid', label: '입금전 관리', mod: orders, sub: true, badge: 'unpaid' },
  { id: 'orders/ready', label: '배송준비중 관리', mod: orders, sub: true, badge: 'ready' },
  { id: 'orders/waiting', label: '배송대기 관리', mod: orders, sub: true },
  { id: 'orders/shipping', label: '배송중 관리', mod: orders, sub: true },
  { id: 'orders/done', label: '배송완료 조회', mod: orders, sub: true },
  { id: 'orders/claims', label: '취소·교환·반품', mod: orders, sub: true },
  { id: 'reconcile', label: '매출 대조', mod: reconcile, icon: 'reconcile' },
  { grp: '분석' },
  { id: 'sales', label: '매출 분석', mod: sales },
  { id: 'stock', label: '상품·재고', mod: stock, badge: 'stock' },
  { id: 'customers', label: '고객 분석', mod: customers },
  { id: 'fulfillment', label: '출고 운영', mod: fulfillment, badge: 'late' },
  { grp: '제품·마케팅' },
  { id: 'products', label: '제품·마진', mod: products },
  { id: 'ads', label: '광고', mod: ads },
  { id: 'rules', label: '자동 규칙', mod: rules },
  { grp: '시스템' },
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
      <div class="brand"><span class="logo">지</span><span><b>지미에프앤비</b><small>내부 운영실</small></span></div>
      <div class="nav" id="nav">${PAGES.map(p => p.grp ? `<div class="grp">${p.grp}</div>` : `<a href="#/${p.id}" data-page="${p.id}" class="${p.sub ? 'sub' : ''}">${p.sub ? '' : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[p.icon || p.id] || ''}</svg>`}${p.label}${p.badge ? `<span class="badge" id="badge-${p.badge}" hidden></span>` : ''}</a>`).join('')}</div>
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
  const p = PAGES.find(x => x.mod && args[0] && x.id === `${page}/${args[0]}`) || PAGES.find(x => x.id === page && x.mod) || PAGES.find(x => x.mod);
  document.querySelectorAll('#nav a').forEach(a => a.setAttribute('aria-current', a.dataset.page === p.id ? 'page' : 'false'));
  const pageArgs = p.id.includes('/') ? args.slice(1) : args;
  const viewArgs = p.id.includes('/') ? [p.id.split('/')[1], ...pageArgs] : args;
  document.title = `${p.label} · ${APP_NAME}`;
  if (cleanup) { try { cleanup(); } catch { /* 무시 */ } cleanup = null; }
  const main = document.getElementById('main');
  main.innerHTML = loading();
  try { cleanup = (await p.mod.render(main, { args: viewArgs, query })) || null; }
  catch (e) { main.innerHTML = errBox(e); }
  window.scrollTo(0, 0);
}

function renderLogin(msg, typedName) {
  document.title = `로그인 · ${APP_NAME}`;
  const app = document.getElementById('app');
  app.innerHTML = `<div class="login"><form id="login-form" autocomplete="on">
    <div class="brand"><span class="logo">지</span><span><b>지미에프앤비</b><small>내부 운영실</small></span></div>
    <p class="hint" style="margin:0">관계자만 이용할 수 있습니다.</p>
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
// 차트·막대에 마우스를 올리면 data-tip 내용을 보여줌
(() => {
  const tip = document.getElementById('tip');
  if (!tip) return;
  document.addEventListener('mousemove', e => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t.getAttribute('data-tip');
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + w > innerWidth - 8) x = e.clientX - w - 14;
    if (y + h > innerHeight - 8) y = e.clientY - h - 14;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  });
  document.addEventListener('scroll', () => { tip.hidden = true; }, true);
})();
(async () => {
  try {
    const me = await api('/api/me');
    if (me.shop) state.shop = me.shop;
    if (me.loggedIn) { state.user = me.name; route(); } else renderLogin();
  } catch (e) { renderLogin(e.message); }
})();
