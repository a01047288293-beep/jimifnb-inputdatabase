// 주문관리: 카페24 주문관리와 같은 메뉴 구성 (전체·입금전·배송준비중·배송대기·배송중·배송완료·취소교환반품)
import { api, esc, won, nf, srcTag, modal, toast, kstToday, addDays, go, shopLink, pageHead, state, setBadge } from '../app.js';
import { downloadCsv } from './fulfillment.js';
import { fmtTime } from './home.js';

export const VIEWS = [
  { id: 'all', label: '전체 주문 조회', desc: '기간 안의 모든 주문', codes: null },
  { id: 'unpaid', label: '입금전 관리', desc: '주문했지만 아직 결제(입금)되지 않은 주문', codes: ['N00'], live: true },
  { id: 'ready', label: '배송준비중 관리', desc: '결제 완료 후 출고 전인 주문', codes: ['N10', 'N20', 'N22'], tabs: [['N10', '상품준비중'], ['N20', '배송준비중'], ['N22', '배송보류']], ship: true, live: true },
  { id: 'waiting', label: '배송대기 관리', desc: '송장은 준비됐지만 아직 출발하지 않은 주문', codes: ['N21'], ship: true, live: true },
  { id: 'shipping', label: '배송중 관리', desc: '택배사로 넘어간 주문', codes: ['N30'], live: true },
  { id: 'done', label: '배송완료 조회', desc: '배송이 끝났거나 구매확정된 주문', codes: ['N40', 'N50'] },
  { id: 'claims', label: '취소·교환·반품', desc: '취소·교환·반품 신청과 처리 현황', prefix: ['C', 'E', 'R'], tabs: [['C', '취소'], ['E', '교환'], ['R', '반품']] }
];
const LEGACY = { unpaid: 'unpaid', ready: 'ready', shipping: 'shipping', done: 'done', claim: 'claims', all: 'all' };
const tone = s => /^C/.test(s) ? 'bad' : /^[RE]/.test(s) ? 'warn' : ['N10', 'N20', 'N21', 'N22'].includes(s) ? 'warn' : s === 'N00' ? 'none' : s === 'N30' ? 'info' : 'good';
const inView = (v, o) => v.codes ? v.codes.includes(o.status) : v.prefix ? v.prefix.includes(String(o.status)[0]) || (o.canceled && v.prefix.includes('C')) : true;
const inTab = (v, o, t) => v.prefix ? String(o.status)[0] === t || (t === 'C' && o.canceled && !/^[ER]/.test(o.status)) : o.status === t;
const AMOUNT_LABEL = {
  order_price_amount: '상품 금액', shipping_fee: '배송비', membership_discount_amount: '회원 할인', coupon_discount_price: '쿠폰 할인',
  coupon_shipping_fee_amount: '배송비 쿠폰', app_discount_amount: '앱 할인', additional_discount_price: '추가 할인', mileage_spent_amount: '적립금 사용',
  points_spent_amount: '포인트 사용', credits_spent_amount: '예치금 사용', naverpay_point: '네이버페이 포인트', total_amount_due: '결제 예정 금액', payment_amount: '실제 결제금액'
};
let carriersCache = null;
export function applyBadges(c) {
  if (!c) return;
  setBadge('unpaid', c.unpaid); setBadge('ready', c.ready); setBadge('waiting', c.waiting); setBadge('shipping', c.shipping);
}

export async function render(main, { args, query }) {
  const vid = args[0] || LEGACY[query.get('group')] || 'all';
  const view = VIEWS.find(v => v.id === vid) || VIEWS[0];
  const today = kstToday();
  const defDays = ['all', 'done', 'claims'].includes(view.id) ? 7 : 30;
  const st = {
    from: query.get('from') || addDays(today, -(defDays - 1)), to: query.get('to') || today,
    basis: query.get('basis') === 'pay' ? 'pay' : 'order', tab: query.get('tab') || '', q: query.get('q') || ''
  };
  // 입금전·배송준비중·배송대기·배송중은 카페24 '오늘의 할 일'처럼 주문일과 관계없이 지금 그 상태인 주문 전부
  const active = await api(`/api/orders/active${query.get('fresh') ? '?fresh=1' : ''}`);
  const d = view.live ? { orders: active.orders, mode: active.mode } : await api(`/api/orders?from=${st.from}&to=${st.to}&basis=${st.basis}`);
  const counts = Object.fromEntries(VIEWS.map(v => [v.id, v.live ? active.orders.filter(o => inView(v, o)).length : view.live ? null : d.orders.filter(o => inView(v, o)).length]));
  applyBadges(active.counts);
  const selected = new Set();

  const draw = () => {
    let list = d.orders.filter(o => inView(view, o));
    if (st.tab) list = list.filter(o => inTab(view, o, st.tab));
    const q = st.q.trim().toLowerCase();
    if (q) list = list.filter(o => o.id.toLowerCase().includes(q) || String(o.buyer).toLowerCase().includes(q) || o.items.some(i => (i.name + ' ' + i.option).toLowerCase().includes(q)));
    const payTotal = list.filter(o => !o.canceled && o.paid !== false).reduce((s, o) => s + o.amount, 0);
    const orderTotal = list.reduce((s, o) => s + (o.orderAmount ?? o.amount), 0);
    const timeOf = o => (st.basis === 'order' ? o.orderedAt || o.time : o.time);
    selected.clear();

    main.innerHTML = `
    ${pageHead(view.label, `${esc(view.desc)} · ${view.live ? '기간과 관계없이 지금 이 상태인 주문 전부 (최근 12개월)' : (st.basis === 'order' ? '주문일' : '결제일') + ' 기준'} ${srcTag(d.mode)}`, `<a class="btn small" href="https://${esc(state.shop.mallId)}.cafe24.com/disp/admin/shop1/main/dashboard" target="_blank" rel="noopener">카페24 관리자 ↗</a>`)}
    <div class="stack">
      <div class="seg" id="o-views" style="align-self:flex-start">${VIEWS.map(v => `<button data-v="${v.id}" aria-pressed="${v.id === view.id}">${esc(v.label.replace(' 관리', '').replace(' 조회', ''))} ${counts[v.id] == null ? '' : `<span class="num muted">${counts[v.id]}</span>`}</button>`).join('')}</div>
      ${view.live ? `<div class="toolbar">
        <input type="search" id="o-q" placeholder="주문번호·상품명·주문자 검색" value="${esc(st.q)}" style="max-width:240px" aria-label="검색">
        <button class="btn small" id="o-fresh">지금 새로 받기</button>
        <span class="hint">${active.at ? `${esc(fmtTime(new Date(active.at).toISOString()))} 기준 · ` : ''}카페24 대시보드 '오늘의 할 일' 숫자와 같은 기준입니다</span>
      </div>` : `<div class="toolbar">
        <div class="seg" id="o-basis"><button data-b="order" aria-pressed="${st.basis === 'order'}">주문일</button><button data-b="pay" aria-pressed="${st.basis === 'pay'}">결제일</button></div>
        <div class="seg" id="o-quick"><button data-d="0">오늘</button><button data-d="6">7일</button><button data-d="29">1개월</button><button data-d="89">3개월</button></div>
        <input type="date" id="o-from" value="${st.from}" max="${today}" aria-label="시작일"><span class="muted">~</span><input type="date" id="o-to" value="${st.to}" max="${today}" aria-label="종료일">
        <input type="search" id="o-q" placeholder="주문번호·상품명·주문자 검색" value="${esc(st.q)}" style="max-width:240px" aria-label="검색">
      </div>`}
      ${view.tabs ? `<div class="seg" id="o-tabs" style="align-self:flex-start"><button data-t="" aria-pressed="${!st.tab}">전체</button>${view.tabs.map(([c, l]) => `<button data-t="${c}" aria-pressed="${st.tab === c}">${l} <span class="num muted">${d.orders.filter(o => inView(view, o) && inTab(view, o, c)).length}</span></button>`).join('')}</div>` : ''}
      <section class="box">
        <div class="box-h"><h2>${nf(list.length)}건</h2>
          <div class="row"><span class="hint">주문금액 ${won(orderTotal)} · 결제금액 ${won(payTotal)} (취소·결제 전 제외)</span>
          ${list.length ? '<button class="btn small" id="o-csv">목록 내려받기(CSV)</button>' : ''}
          ${view.ship ? '<button class="btn primary small" id="bulk-ship" disabled>선택 주문 송장 입력</button>' : ''}</div></div>
        ${list.length ? `<div class="tbl-wrap"><table><thead><tr>${view.ship ? '<th><input type="checkbox" id="sel-all" aria-label="전체 선택"></th>' : ''}<th>${st.basis === 'order' ? '주문' : '결제'} 시각</th><th>주문번호</th><th>상품</th><th class="n">수량</th><th class="n">주문금액</th><th class="n">결제금액</th><th>결제수단</th><th>주문자</th><th>상태</th><th></th></tr></thead><tbody>
        ${list.map(o => {
          const first = o.items[0] || {};
          const qty = o.items.reduce((s, i) => s + i.qty, 0);
          const canShip = ['N10', 'N20', 'N21', 'N22'].includes(o.status);
          return `<tr>${view.ship ? `<td><input type="checkbox" data-sel="${esc(o.id)}" aria-label="선택"></td>` : ''}
            <td class="hint" style="white-space:nowrap">${esc(fmtTime(timeOf(o)))}</td>
            <td><button class="btn ghost small" style="color:var(--accent-2);padding:0" data-open="${esc(o.id)}">${esc(o.id)}</button></td>
            <td>${shopLink(first.productNo, first.name || '')}${o.items.length > 1 ? ` <span class="hint">외 ${o.items.length - 1}건</span>` : ''}${first.option ? `<div class="hint">${esc(first.option)}</div>` : ''}</td>
            <td class="n">${nf(qty)}</td><td class="n">${won(o.orderAmount ?? o.amount)}</td><td class="n">${o.paid === false ? '<span class="muted">결제 전</span>' : won(o.amount)}${(o.points || 0) + (o.credits || 0) > 0 ? `<div class="hint">${o.credits ? `선불금 ${won(o.credits)}` : ''}${o.credits && o.points ? ' · ' : ''}${o.points ? `적립금 ${won(o.points)}` : ''} 포함</div>` : ''}</td>
            <td>${esc(o.payment || '')}</td><td>${esc(o.buyer)}</td>
            <td><span class="pill ${tone(o.status)}">${esc(o.statusLabel)}</span>${o.tracking ? `<div class="hint">${esc(o.tracking.trackingNo || '')}</div>` : ''}</td>
            <td>${canShip ? `<button class="btn small" data-ship="${esc(o.id)}">송장 입력</button>` : ''}</td></tr>`;
        }).join('')}</tbody></table></div>` : '<div class="empty">해당하는 주문이 없습니다.</div>'}
      </section>
      <div class="hint">주문금액은 (판매가+옵션가)×수량+배송비로 할인 전 금액이고, 결제금액은 쿠폰·회원 할인을 뺀 금액입니다(카드·계좌 결제에 선불금·적립금 사용분 포함, 카페24 '결제'와 같은 기준). 카페24 숫자와 맞춰 볼 때는 <a href="#/reconcile">매출 대조</a>를 보세요. 주문번호를 누르면 상세가 열립니다.</div>
    </div>`;
    bind(list);
  };

  const url = patch => { const n = { ...st, ...patch }; return `#/orders/${view.id}?from=${n.from}&to=${n.to}&basis=${n.basis}${n.tab ? `&tab=${n.tab}` : ''}${n.q ? `&q=${encodeURIComponent(n.q)}` : ''}`; };
  const bind = list => {
    main.querySelectorAll('#o-views button').forEach(b => b.onclick = () => go(`#/orders/${b.dataset.v}?from=${st.from}&to=${st.to}&basis=${st.basis}`));
    main.querySelectorAll('#o-basis button').forEach(b => b.onclick = () => go(url({ basis: b.dataset.b })));
    main.querySelectorAll('#o-quick button').forEach(b => b.onclick = () => go(url({ from: addDays(today, -Number(b.dataset.d)), to: today })));
    const fromEl = main.querySelector('#o-from'), toEl = main.querySelector('#o-to'), fresh = main.querySelector('#o-fresh');
    if (fromEl) fromEl.onchange = e => go(url({ from: e.target.value }));
    if (toEl) toEl.onchange = e => go(url({ to: e.target.value }));
    if (fresh) fresh.onclick = () => go(url({}) + '&fresh=1&r=' + Date.now());
    main.querySelectorAll('#o-tabs button').forEach(b => b.onclick = () => { st.tab = b.dataset.t; draw(); });
    const qi = main.querySelector('#o-q');
    let t; qi.oninput = () => { clearTimeout(t); t = setTimeout(() => { st.q = qi.value; const pos = qi.selectionStart; draw(); const n = main.querySelector('#o-q'); n.focus(); n.setSelectionRange(pos, pos); }, 250); };
    main.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openDetail(b.dataset.open, () => go(url({}))));
    main.querySelectorAll('[data-ship]').forEach(b => b.onclick = () => shipModal([d.orders.find(o => o.id === b.dataset.ship)], () => go(url({}))));
    const csv = main.querySelector('#o-csv');
    if (csv) csv.onclick = () => {
      const rows = [['주문시각', '결제시각', '주문번호', '상품', '옵션', '수량', '주문금액', '결제금액', '결제수단', '주문경로', '주문자', '상태']];
      for (const o of list) for (const it of o.items) rows.push([fmtTime(o.orderedAt), o.paid === false ? '' : fmtTime(o.time), o.id, it.name, it.option, it.qty, o.orderAmount ?? o.amount, o.paid === false ? '' : o.amount, o.payment || '', o.channel || '', o.buyer, o.statusLabel]);
      downloadCsv(`주문_${view.label}_${st.from}_${st.to}.csv`, rows);
    };
    const bulk = main.querySelector('#bulk-ship');
    const sync = () => { if (bulk) { bulk.disabled = !selected.size; bulk.textContent = selected.size ? `선택 ${selected.size}건 송장 입력` : '선택 주문 송장 입력'; } };
    main.querySelectorAll('[data-sel]').forEach(c => c.onchange = () => { c.checked ? selected.add(c.dataset.sel) : selected.delete(c.dataset.sel); sync(); });
    const all = main.querySelector('#sel-all');
    if (all) all.onchange = () => { main.querySelectorAll('[data-sel]').forEach(c => { c.checked = all.checked; c.checked ? selected.add(c.dataset.sel) : selected.delete(c.dataset.sel); }); sync(); };
    if (bulk) bulk.onclick = () => shipModal(d.orders.filter(o => selected.has(o.id)), () => go(url({})));
  };
  draw();
}

async function openDetail(id, done) {
  const close = modal('<div class="empty">주문을 불러오는 중…</div>');
  let o;
  try { o = await api('/api/orders/' + encodeURIComponent(id)); } catch (e) { close(); toast(e.message, true); return; }
  close();
  const amounts = Object.entries(o.amounts || {}).filter(([k, v]) => AMOUNT_LABEL[k] && v !== 0 && k !== 'payment_amount');
  const canShip = ['N10', 'N20', 'N21', 'N22'].includes(o.status);
  modal(`<div class="box-h"><h2>주문 ${esc(o.id)}</h2><span class="pill ${tone(o.status)}">${esc(o.statusLabel)}</span></div>
    <div class="stat-line"><span>주문 시각</span><b>${esc(fmtTime(o.orderedAt))}</b></div>
    <div class="stat-line"><span>결제 시각</span><b>${o.paid === false ? '결제 전' : esc(fmtTime(o.time))}</b></div>
    <div class="stat-line"><span>결제수단 · 주문 경로</span><b>${esc(o.payment || '–')} · ${esc(o.channel || '–')}</b></div>
    <h3>품목</h3>
    <div class="tbl-wrap"><table><thead><tr><th>상품</th><th>옵션</th><th class="n">수량</th><th class="n">판매가</th><th>상태</th></tr></thead><tbody>
      ${o.items.map(i => `<tr><td>${shopLink(i.productNo, i.name)}</td><td>${esc(i.option || '–')}</td><td class="n">${nf(i.qty)}</td><td class="n">${won(i.price + (i.optionPrice || 0))}</td><td><span class="pill ${tone(i.status)}">${esc(i.statusLabel)}</span></td></tr>`).join('')}
    </tbody></table></div>
    <h3>금액</h3>
    <div class="stat-line"><span>주문금액 (할인 전)</span><b>${won(o.orderAmount ?? o.amount)}</b></div>
    ${amounts.map(([k, v]) => `<div class="stat-line"><span>${esc(AMOUNT_LABEL[k])}</span><b>${won(v)}</b></div>`).join('')}
    <div class="stat-line"><span>실제 결제금액</span><b>${o.paid === false ? '결제 전' : won(o.amount)}</b></div>
    <h3>받는 분</h3>
    <div class="stat-line"><span>이름 · 연락처</span><b>${esc(o.receiver?.name || '–')} · ${esc(o.receiver?.phone || '–')}</b></div>
    <div class="stat-line"><span>주소</span><b style="text-align:right">${esc([o.receiver?.zipcode, o.receiver?.address].filter(Boolean).join(' ') || '–')}</b></div>
    ${o.receiver?.message ? `<div class="stat-line"><span>배송 메시지</span><b>${esc(o.receiver.message)}</b></div>` : ''}
    <div class="stat-line"><span>주문자</span><b>${esc(o.buyerFull?.name || o.buyer)}${o.buyerFull?.phone ? ' · ' + esc(o.buyerFull.phone) : ''}</b></div>
    ${o.shipments?.length ? `<div class="stat-line"><span>송장</span><b>${o.shipments.map(s => esc(`${s.carrier} ${s.trackingNo}`)).join(', ')}</b></div>` : ''}
    ${o.claimReason ? `<div class="stat-line"><span>취소·반품 사유</span><b>${esc(o.claimReason)}</b></div>` : ''}
    <div class="hint">받는 분 정보는 이 화면에서만 보여주며 운영실에 저장하지 않습니다.</div>
    <div class="foot"><button class="btn" id="d-copy">주문번호 복사</button>${canShip ? '<button class="btn primary" id="d-ship">송장 입력</button>' : ''}<button class="btn" data-close>닫기</button></div>`, {
    onMount: (el, closeD) => {
      el.querySelector('#d-copy').onclick = async () => { try { await navigator.clipboard.writeText(o.id); toast('주문번호를 복사했습니다.'); } catch { toast('복사하지 못했습니다. 번호를 직접 선택해 복사하세요.', true); } };
      const s = el.querySelector('#d-ship');
      if (s) s.onclick = () => { closeD(); shipModal([o], done); };
    }
  });
}

async function shipModal(orders, done) {
  if (!carriersCache) { try { carriersCache = await api('/api/carriers'); } catch (e) { toast(e.message, true); return; } }
  let saved = null; try { saved = localStorage.getItem('jimi-carrier'); } catch { /* 무시 */ }
  modal(`<h2>송장 입력 · ${orders.length}건</h2>
    <label class="f">택배사<select id="s-carrier">${carriersCache.map(c => `<option value="${esc(c.code)}" ${c.code === saved ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <div class="stack" style="gap:8px">${orders.map((o, i) => `<label class="f">${esc(o.id)} · ${esc(o.items[0]?.name || '')} · ${esc(o.buyer)}<input id="s-no-${i}" inputmode="numeric" autocomplete="off" placeholder="송장번호"></label>`).join('')}</div>
    <div class="hint">등록하면 카페24 주문 상태가 배송중으로 바뀌고 고객에게 배송 안내가 나갈 수 있습니다.</div>
    <div id="s-msg"></div>
    <div class="foot"><button class="btn" data-close>취소</button><button class="btn primary" id="s-ok">등록</button></div>`, {
    onMount: (el, close) => {
      el.querySelector('#s-ok').onclick = async () => {
        const carrier = el.querySelector('#s-carrier').value;
        try { localStorage.setItem('jimi-carrier', carrier); } catch { /* 무시 */ }
        const jobs = orders.map((o, i) => ({ o, no: el.querySelector('#s-no-' + i).value.trim() })).filter(j => j.no);
        if (!jobs.length) { el.querySelector('#s-msg').innerHTML = '<div class="err">송장번호를 하나 이상 입력하세요.</div>'; return; }
        const btn = el.querySelector('#s-ok'); btn.disabled = true; btn.textContent = '등록 중…';
        const fails = [];
        for (const j of jobs) {
          try { await api(`/api/orders/${encodeURIComponent(j.o.id)}/shipment`, { method: 'POST', body: { carrierCode: carrier, trackingNo: j.no, itemCodes: j.o.items.map(x => x.itemCode).filter(Boolean) } }); }
          catch (e) { fails.push(`${j.o.id}: ${e.message}`); }
        }
        if (fails.length) { btn.disabled = false; btn.textContent = '다시 등록'; el.querySelector('#s-msg').innerHTML = `<div class="err">${fails.length}건 실패<ul>${fails.map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>`; }
        else { close(); toast(`송장 ${jobs.length}건 등록됨`); done(); }
      };
    }
  });
}
