import { api, esc, won, nf, srcTag, modal, toast, kstToday, addDays, go } from '../app.js';

const GROUPS = [
  { id: 'all', label: '전체', test: () => true },
  { id: 'unpaid', label: '입금전', test: s => s === 'N00' },
  { id: 'ready', label: '출고 대기', test: s => ['N10', 'N20', 'N21', 'N22'].includes(s) },
  { id: 'shipping', label: '배송중', test: s => s === 'N30' },
  { id: 'done', label: '배송완료', test: s => ['N40', 'N50'].includes(s) },
  { id: 'claim', label: '취소·반품·교환', test: s => /^[CRE]/.test(s) }
];
const tone = s => /^[CRE]/.test(s) ? 'bad' : ['N10', 'N20', 'N21', 'N22'].includes(s) ? 'warn' : s === 'N00' ? 'none' : s === 'N30' ? 'info' : 'good';

let carriersCache = null;

export async function render(main, { query }) {
  const today = kstToday();
  const st = { from: query.get('from') || addDays(today, -6), to: query.get('to') || today, group: query.get('group') || 'all' };
  const d = await api(`/api/orders?from=${st.from}&to=${st.to}`);
  const counts = Object.fromEntries(GROUPS.map(g => [g.id, d.orders.filter(o => g.test(o.status)).length]));
  const list = d.orders.filter(o => GROUPS.find(g => g.id === st.group).test(o.status));
  const total = list.filter(o => !o.canceled).reduce((s, o) => s + o.amount, 0);
  const selected = new Set();

  main.innerHTML = `
  <div class="page-head"><h1>주문·출고</h1>${srcTag(d.mode)}</div>
  <div class="stack">
    <div class="toolbar">
      <input type="date" id="o-from" value="${st.from}" max="${today}" aria-label="시작일"> ~ <input type="date" id="o-to" value="${st.to}" max="${today}" aria-label="종료일">
      <div class="seg" id="o-quick"><button data-d="0">오늘</button><button data-d="2">3일</button><button data-d="6">7일</button><button data-d="30">31일</button></div>
      <span class="hint">결제일 기준, 최대 31일</span>
    </div>
    <div class="seg" id="o-groups">${GROUPS.map(g => `<button data-g="${g.id}" aria-pressed="${g.id === st.group}">${g.label} <span class="num">${counts[g.id]}</span></button>`).join('')}</div>
    <section class="box">
      <div class="box-h"><h2>${esc(GROUPS.find(g => g.id === st.group).label)} ${nf(list.length)}건</h2>
        <div class="row"><span class="hint">결제금액 합계 ${won(total)} (취소 제외)</span>
        ${st.group === 'ready' ? '<button class="btn primary" id="bulk-ship" disabled>선택 주문 송장 입력</button>' : ''}</div></div>
      ${list.length ? `<div class="tbl-wrap"><table><thead><tr>${st.group === 'ready' ? '<th><input type="checkbox" id="sel-all" aria-label="전체 선택"></th>' : ''}<th>결제 시각</th><th>주문번호</th><th>상품</th><th class="n">수량</th><th class="n">결제금액</th><th>구매자</th><th>상태</th><th></th></tr></thead><tbody>
      ${list.map(o => {
        const first = o.items[0] || {};
        const qty = o.items.reduce((s, i) => s + i.qty, 0);
        const canShip = ['N10', 'N20', 'N21', 'N22'].includes(o.status);
        return `<tr>${st.group === 'ready' ? `<td><input type="checkbox" data-sel="${esc(o.id)}" aria-label="선택"></td>` : ''}
          <td class="hint">${esc(String(o.time).slice(5, 16).replace('T', ' '))}</td><td class="num">${esc(o.id)}</td>
          <td>${esc(first.name || '')}${o.items.length > 1 ? ` <span class="hint">외 ${o.items.length - 1}건</span>` : ''}${first.option ? `<div class="hint">${esc(first.option)}</div>` : ''}</td>
          <td class="n">${nf(qty)}</td><td class="n">${won(o.amount)}</td><td>${esc(o.buyer)}</td>
          <td><span class="pill ${tone(o.status)}">${esc(o.statusLabel)}</span>${o.tracking ? `<div class="hint">${esc(o.tracking.trackingNo || '')}</div>` : ''}</td>
          <td>${canShip ? `<button class="btn small" data-ship="${esc(o.id)}">송장 입력</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div>` : '<div class="empty">해당하는 주문이 없습니다.</div>'}
    </section>
  </div>`;

  const reload = patch => { const n = { ...st, ...patch }; go(`#/orders?from=${n.from}&to=${n.to}&group=${n.group}`); };
  main.querySelector('#o-from').onchange = e => reload({ from: e.target.value });
  main.querySelector('#o-to').onchange = e => reload({ to: e.target.value });
  main.querySelectorAll('#o-quick button').forEach(b => b.onclick = () => reload({ from: addDays(today, -Number(b.dataset.d)), to: today }));
  main.querySelectorAll('#o-groups button').forEach(b => b.onclick = () => reload({ group: b.dataset.g }));
  main.querySelectorAll('[data-ship]').forEach(b => b.onclick = () => shipModal([d.orders.find(o => o.id === b.dataset.ship)], () => reload({})));
  const bulk = main.querySelector('#bulk-ship');
  const syncBulk = () => { if (bulk) { bulk.disabled = !selected.size; bulk.textContent = selected.size ? `선택 주문 ${selected.size}건 송장 입력` : '선택 주문 송장 입력'; } };
  main.querySelectorAll('[data-sel]').forEach(c => c.onchange = () => { c.checked ? selected.add(c.dataset.sel) : selected.delete(c.dataset.sel); syncBulk(); });
  const all = main.querySelector('#sel-all');
  if (all) all.onchange = () => { main.querySelectorAll('[data-sel]').forEach(c => { c.checked = all.checked; c.checked ? selected.add(c.dataset.sel) : selected.delete(c.dataset.sel); }); syncBulk(); };
  if (bulk) bulk.onclick = () => shipModal(d.orders.filter(o => selected.has(o.id)), () => reload({}));
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
