// 제품·마진: 신제품 연구 파이프라인 + 원가·마진 계산 (마진랩을 시스템에 통합)
import { api, esc, won, pctf, toast, go, confirmBox, modal, shopLink } from '../app.js';
import { STAGES, UNITS, calc, targetPrice, monthly, actuals, trialYield, blankProduct, num } from '../lib/margin.js';

const tone = (r, p) => !r.ok ? 'none' : r.margin < 0 ? 'bad' : r.margin * 100 < num(p.targetMargin) ? 'warn' : 'good';
const clone = o => JSON.parse(JSON.stringify(o));
function norm(p) {
  const o = Object.assign(blankProduct(), clone(p || {}));
  for (const k of ['ingredients', 'trials', 'packaging', 'channels', 'cafe24ProductNos']) if (!Array.isArray(o[k])) o[k] = [];
  if (!o.checks || typeof o.checks !== 'object') o.checks = {};
  if (!o.actual || typeof o.actual !== 'object') o.actual = { orders: 0, revenue: 0, adSpend: 0 };
  if (!STAGES.some(s => s.id === o.stage)) o.stage = 'idea';
  return o;
}

export async function render(main, { args }) {
  const list = (await api('/api/products')).map(norm);
  if (args[0]) {
    const p = list.find(x => x.id === args[0]);
    if (!p) { main.innerHTML = '<div class="empty">제품을 찾지 못했습니다. <a href="#/products">목록으로</a></div>'; return; }
    return renderDetail(main, p);
  }
  renderBoard(main, list);
}

async function create(data) {
  try { const p = await api('/api/products', { method: 'POST', body: data }); go('#/products/' + p.id); }
  catch (e) { toast(e.message, true); }
}

function renderBoard(main, list) {
  main.innerHTML = `
  <div class="page-head"><h1>제품·마진</h1><button class="btn primary" id="p-new">새 제품</button></div>
  <div class="stack">
    <p class="hint" style="margin:0">신제품을 단계별로 관리하고, 배합·시생산 수율·포장·배송비로 1개 원가와 손익분기 ROAS를 계산합니다. 여기서 계산한 원가가 매출·이익과 광고 판정에 쓰입니다.</p>
    <div class="board">${STAGES.map(st => {
      const items = list.filter(p => p.stage === st.id).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));
      return `<div class="col"><div class="col-h">${esc(st.name)}<span class="num muted">${items.length}</span></div>
        ${items.length ? items.map(p => { const r = calc(p); return `<button class="card" data-id="${esc(p.id)}"><b>${esc(p.name || '이름 없음')}</b>
          <div class="meta">${r.ok ? `<span class="pill ${tone(r, p)}">마진 ${pctf(r.margin)}</span><span>손익분기 ROAS ${r.beRoas ? r.beRoas.toFixed(2) : '불가'}</span>` : '<span class="pill none">입력 필요</span>'}</div>
          <div class="meta">${p.cafe24ProductNos.length ? `카페24 상품 ${p.cafe24ProductNos.length}개 연결` : '카페24 미연결'}</div></button>`; }).join('') : '<div class="hint">없음</div>'}</div>`;
    }).join('')}</div>
    ${list.length ? '' : `<section class="box"><b>아직 등록된 제품이 없습니다.</b><p class="hint" style="margin:0">'새 제품'으로 만들거나, 데모 모드라면 설정·연동에서 예시 제품 3개를 불러올 수 있습니다.</p></section>`}
  </div>`;
  main.querySelector('#p-new').onclick = () => create(blankProduct());
  main.querySelectorAll('[data-id]').forEach(b => b.onclick = () => go('#/products/' + b.dataset.id));
}

function renderDetail(main, p) {
  let shop = null;
  let saveTimer = null, saving = false, again = false, confirmDel = false;
  const status = t => { const el = main.querySelector('#p-save'); if (el) el.textContent = t; };
  const save = async () => {
    if (saving) { again = true; return; }
    saving = true; status('저장 중…');
    try { await api(`/api/products/${encodeURIComponent(p.id)}`, { method: 'PUT', body: p }); status('저장됨'); }
    catch (e) { status('저장 실패'); toast(e.message, true); }
    saving = false; if (again) { again = false; save(); }
  };
  const touch = () => { clearTimeout(saveTimer); status('저장 대기'); saveTimer = setTimeout(save, 800); results(); };

  const numF = (k, label, hint, step) => `<label class="f">${label}<input type="number" inputmode="decimal" step="${step || 'any'}" min="0" id="f-${k}" data-k="${k}" value="${esc(p[k])}">${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
  const rowsTable = (arr, cols, extra) => `<div class="tbl-wrap"><table class="rows"><thead><tr>${cols.map(c => `<th class="${c.type === 'number' ? 'n' : ''}">${c.label}</th>`).join('')}${extra ? `<th class="n">${extra.label}</th>` : ''}<th></th></tr></thead><tbody>
    ${p[arr].map((row, i) => '<tr>' + cols.map(c => {
      const id = `r-${arr}-${i}-${c.f}`;
      if (c.type === 'select') return `<td><select id="${id}" data-arr="${arr}" data-i="${i}" data-f="${c.f}" aria-label="${c.label}">${c.opts.map(o => `<option ${row[c.f] === o ? 'selected' : ''}>${o}</option>`).join('')}</select></td>`;
      return `<td><input id="${id}" type="${c.type}" ${c.type === 'number' ? 'inputmode="decimal" step="any" min="0"' : ''} data-arr="${arr}" data-i="${i}" data-f="${c.f}" value="${esc(row[c.f])}" aria-label="${c.label}"></td>`;
    }).join('') + (extra ? `<td class="n" data-extra="${arr}-${i}"></td>` : '') + `<td><button class="btn ghost small" data-del="${arr}" data-i="${i}">삭제</button></td></tr>`).join('')}
    </tbody>${extra && extra.foot ? `<tfoot><tr><td colspan="${cols.length + 2}" id="foot-${arr}"></td></tr></tfoot>` : ''}</table></div><div><button class="btn small" data-add="${arr}">행 추가</button></div>`;

  const draw = () => {
    const stIdx = STAGES.findIndex(s => s.id === p.stage);
    main.innerHTML = `
    <div class="page-head"><a class="btn small" href="#/products">← 파이프라인</a><h1 id="d-title">${esc(p.name || '이름 없음')}</h1>
      <span class="hint" id="p-save">저장됨</span><button class="btn" id="dup">복제</button>
      ${confirmDel ? '<span class="row"><span class="hint" style="color:var(--bad)">삭제하면 되돌릴 수 없습니다.</span><button class="btn danger" id="del-yes">삭제</button><button class="btn" id="del-no">취소</button></span>' : '<button class="btn danger" id="del">삭제</button>'}</div>
    <div class="grid2">
     <div class="stack">
      <section class="box"><h2>기본 정보</h2>
        <div class="fields">
          <label class="f wide">제품명<input id="f-name" data-k="name" data-t="text" value="${esc(p.name)}"></label>
          <label class="f">분류<input id="f-category" data-k="category" data-t="text" value="${esc(p.category)}" placeholder="예: 양념육, 육포"></label>
          <label class="f">연구 단계<select id="f-stage" data-k="stage" data-t="text">${STAGES.map(s => `<option value="${s.id}" ${s.id === p.stage ? 'selected' : ''}>${s.name}</option>`).join('')}</select></label>
          <label class="f wide">메모<textarea id="f-memo" data-k="memo" data-t="text" rows="3">${esc(p.memo)}</textarea></label>
        </div>
        <div class="stage-track">${STAGES.map((s, i) => `<span class="${i < stIdx ? 'done' : i === stIdx ? 'on' : ''}">${s.name}</span>`).join('')}</div>
        <h3>${esc(STAGES[stIdx].name)} 단계 확인 항목</h3>
        <div class="checks">${STAGES[stIdx].checks.map((c, i) => `<label><input type="checkbox" id="c-${p.stage}-${i}" data-check="${p.stage}:${i}" ${p.checks[p.stage + ':' + i] ? 'checked' : ''}>${esc(c)}</label>`).join('')}</div>
      </section>
      <section class="box"><div class="box-h"><h2>카페24 상품 연결</h2><span class="hint">연결한 상품의 판매에 이 원가를 씁니다</span></div>
        <div id="map-area"><button class="btn" id="load-shop">카페24 상품 목록 불러오기</button> <span class="hint">연결된 상품번호: ${p.cafe24ProductNos.length ? p.cafe24ProductNos.map(n => '#' + esc(n)).join(', ') : '없음'}</span></div>
        <div class="fields" style="margin-top:10px"><label class="f wide">광고 키워드 <span class="hint">캠페인 이름에 이 말이 있으면 자동으로 이 제품에 연결 (쉼표로 구분, 제품명은 자동 포함)</span><input id="f-adKeywords" data-k="adKeywords" data-t="text" value="${esc(p.adKeywords || '')}" placeholder="예: 불고기, 양념육, BG"></label></div>
      </section>
      <section class="box"><div class="box-h"><h2>배합 (배치 1회)</h2><span class="hint">단가는 VAT 별도, 단위당 금액</span></div>
        ${rowsTable('ingredients', [{ f: 'name', label: '원재료', type: 'text' }, { f: 'unit', label: '단위', type: 'select', opts: UNITS }, { f: 'unitPrice', label: '단가(원)', type: 'number' }, { f: 'qty', label: '투입량', type: 'number' }], { label: '금액', foot: true })}
      </section>
      <section class="box"><div class="box-h"><h2>시생산 기록</h2><span class="hint" id="trial-y"></span></div>
        ${rowsTable('trials', [{ f: 'date', label: '날짜', type: 'date' }, { f: 'inputKg', label: '투입(kg)', type: 'number' }, { f: 'outputKg', label: '산출(kg)', type: 'number' }, { f: 'note', label: '메모', type: 'text' }], { label: '수율' })}
        <div><button class="btn" id="apply-yield">실측 수율을 생산 조건에 적용</button></div>
      </section>
      <section class="box"><h2>생산 조건</h2>
        <div class="fields">
          ${numF('yieldPct', '공정 수율(%)', '해동·정형·가열 손실 반영')}${numF('packWeightG', '1개 중량(g)')}
          ${numF('packsOverride', '배치당 생산 개수 직접 입력', '0이면 중량으로 자동 계산', '1')}
          ${numF('workers', '작업 인원(명)', '', '1')}${numF('hours', '배치당 작업시간(h)')}${numF('wage', '시급(원)')}
          ${numF('overhead', '배치당 제조경비(원)', '전기·가스·세척·소모품')}
        </div>
        <h3>포장재 (1개당)</h3>
        ${rowsTable('packaging', [{ f: 'name', label: '포장재', type: 'text' }, { f: 'cost', label: '단가(원)', type: 'number' }])}
      </section>
      <section class="box"><div class="box-h"><h2>판매·배송 조건</h2><span class="hint">주문 1건 기준</span></div>
        <div class="fields">
          ${numF('price', '1개 판매가(원, VAT 포함)')}${numF('packsPerOrder', '주문당 수량(개)', '', '1')}
          <label class="f">부가세<select id="f-taxable" data-k="taxable" data-t="bool"><option value="1" ${p.taxable ? 'selected' : ''}>과세 (판매가에 10% 포함)</option><option value="0" ${!p.taxable ? 'selected' : ''}>면세</option></select></label>
          ${numF('couponPct', '쿠폰·할인(%)')}${numF('shipCharged', '고객 부담 배송비(원)', '무료배송이면 0')}
          ${numF('boxCost', '아이스박스(원)')}${numF('icepacks', '아이스팩 개수', '', '1')}${numF('icepackCost', '아이스팩 단가(원)')}${numF('courier', '택배비(원)')}
          ${numF('feePct', '결제·채널 수수료(%)', '결제금액 대비')}${numF('returnPct', '반품·파손 손실(%)', '순매출 대비')}
          ${numF('adPct', '광고비 비율(%)', '결제금액 대비, VAT 별도')}${numF('targetMargin', '목표 마진율(%)')}
        </div>
      </section>
      <section class="box"><div class="box-h"><h2>판매 채널 비교</h2><span class="hint">수수료만 달리 적용</span></div>
        ${rowsTable('channels', [{ f: 'name', label: '채널', type: 'text' }, { f: 'feePct', label: '수수료(%)', type: 'number' }])}
      </section>
      <section class="box"><h2>월 손익 가정</h2>
        <div class="fields">${numF('ordersPerMonth', '월 예상 주문수(건)', '', '1')}${numF('fixedMonthly', '이 제품 월 고정비(원)', '전용 인력·설비 리스 등')}</div>
      </section>
      <section class="box"><div class="box-h"><h2>실제 판매 성과</h2><span class="hint">출시 후 한 달 단위로 기록</span></div>
        <div class="fields">
          <label class="f">주문수(건)<input type="number" min="0" step="1" id="a-orders" data-act="orders" value="${esc(p.actual.orders)}"></label>
          <label class="f">매출(원, 결제금액)<input type="number" min="0" step="any" id="a-revenue" data-act="revenue" value="${esc(p.actual.revenue)}"></label>
          <label class="f">광고비(원, VAT 별도)<input type="number" min="0" step="any" id="a-adSpend" data-act="adSpend" value="${esc(p.actual.adSpend)}"></label>
        </div>
      </section>
     </div>
     <div class="sticky" id="results"></div>
    </div>`;
    bind(); results();
  };

  const bind = () => {
    main.oninput = e => {
      const el = e.target;
      if (el.dataset.k) {
        const k = el.dataset.k, t = el.dataset.t;
        p[k] = t === 'text' ? el.value : t === 'bool' ? el.value === '1' : num(el.value);
        if (k === 'name') main.querySelector('#d-title').textContent = p.name || '이름 없음';
      } else if (el.dataset.arr) {
        p[el.dataset.arr][+el.dataset.i][el.dataset.f] = el.type === 'number' ? num(el.value) : el.value;
      } else if (el.dataset.act) p.actual[el.dataset.act] = num(el.value);
      else return;
      touch();
    };
    main.onchange = e => {
      const el = e.target;
      if (el.dataset.check) { p.checks[el.dataset.check] = el.checked; touch(); return; }
      if (el.dataset.map) {
        const no = Number(el.dataset.map);
        p.cafe24ProductNos = el.checked ? [...new Set([...p.cafe24ProductNos.map(Number), no])] : p.cafe24ProductNos.map(Number).filter(n => n !== no);
        touch(); return;
      }
      if (el.dataset.k === 'stage') { p.stage = el.value; touch(); draw(); }
    };
    main.onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.add) {
        const t = { ingredients: { name: '', unit: 'kg', unitPrice: 0, qty: 0 }, trials: { date: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10), inputKg: 0, outputKg: 0, note: '' }, packaging: { name: '', cost: 0 }, channels: { name: '', feePct: 0 } }[b.dataset.add];
        p[b.dataset.add].push(clone(t)); touch(); draw();
      } else if (b.dataset.del) { p[b.dataset.del].splice(+b.dataset.i, 1); touch(); draw(); }
      else if (b.id === 'apply-yield') { const y = trialYield(p.trials); if (y != null) { p.yieldPct = Math.round(y * 10) / 10; touch(); draw(); } }
      else if (b.id === 'dup') { const c = clone(p); delete c.id; c.name = (p.name || '제품') + ' (복사본)'; c.cafe24ProductNos = []; await flush(); create(c); }
      else if (b.id === 'del') { confirmDel = true; draw(); }
      else if (b.id === 'del-no') { confirmDel = false; draw(); }
      else if (b.id === 'del-yes') {
        clearTimeout(saveTimer);
        try { await api(`/api/products/${encodeURIComponent(p.id)}`, { method: 'DELETE' }); toast('삭제했습니다.'); go('#/products'); }
        catch (err) { toast(err.message, true); }
      } else if (b.id === 'load-shop') loadShop();
    };
  };

  const loadShop = async () => {
    const area = main.querySelector('#map-area');
    area.innerHTML = '<div class="hint">불러오는 중…</div>';
    try { shop = shop || await api('/api/shop-products'); }
    catch (e) { area.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
    const nos = p.cafe24ProductNos.map(Number);
    area.innerHTML = shop.length ? `<div class="map-list">${shop.map(s => `<label><input type="checkbox" id="m-${s.productNo}" data-map="${s.productNo}" ${nos.includes(s.productNo) ? 'checked' : ''}>${esc(s.name)} <span class="hint">#${s.productNo} · ${won(s.price)} · ${shopLink(s.productNo, '보기 ↗')}</span></label>`).join('')}</div>` : '<div class="hint">카페24 상품이 없습니다.</div>';
  };
  const flush = async () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; await save(); } };

  const results = () => {
    const box = main.querySelector('#results'); if (!box) return;
    const r = calc(p);
    p.ingredients.forEach((g, i) => { const c = main.querySelector(`[data-extra="ingredients-${i}"]`); if (c) c.textContent = won(num(g.unitPrice) * num(g.qty)); });
    p.trials.forEach((t, i) => { const c = main.querySelector(`[data-extra="trials-${i}"]`); if (c) c.textContent = num(t.inputKg) > 0 ? (num(t.outputKg) / num(t.inputKg) * 100).toFixed(1) + '%' : '–'; });
    const foot = main.querySelector('#foot-ingredients');
    if (foot) foot.textContent = `원재료비 ${won(r.rawCostBatch)} · 투입 ${(+r.inputKg || 0).toFixed(2)}kg → 완제품 ${(+r.finishedKg || 0).toFixed(2)}kg · 생산 ${r.packs || 0}개`;
    const ty = trialYield(p.trials);
    const tyEl = main.querySelector('#trial-y'); if (tyEl) tyEl.textContent = ty == null ? '기록 없음' : '가중 평균 실측 수율 ' + ty.toFixed(1) + '%';
    const ay = main.querySelector('#apply-yield'); if (ay) ay.disabled = ty == null;
    if (!r.ok) { box.innerHTML = `<section class="box"><h2>계산 결과</h2><div class="err">계산하려면 다음을 입력하세요.<ul>${r.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div></section>`; return; }
    const t = tone(r, p);
    const tp = targetPrice(p, num(p.targetMargin) / 100);
    const kpi = (l, v, s, cls) => `<div class="kpi ${cls || ''}"><span class="l">${l}</span><span class="v">${v}</span>${s ? `<span class="s">${s}</span>` : ''}</div>`;
    let h = `<section class="box"><div class="box-h"><h2>계산 결과</h2><span class="hint">주문 1건 = ${r.n}개</span></div><div class="kpis" style="grid-template-columns:repeat(2,minmax(0,1fr))">
      ${kpi('주문당 순이익', won(r.profit), `1개당 ${won(r.profit / r.n)}`, t)}
      ${kpi('순매출 대비 마진율', pctf(r.margin), `목표 ${num(p.targetMargin)}%`, t)}
      ${kpi('손익분기 ROAS', r.beRoas ? r.beRoas.toFixed(2) + '배' : '불가', r.beRoas ? '광고 규칙의 기준값' : '광고 전부터 적자', r.beRoas ? '' : 'bad')}
      ${kpi('1개 제조원가', won(r.unitCost), `원가율 ${pctf(r.costRatio)} (공급가 대비)`)}
    </div><div class="hint">목표 마진 ${num(p.targetMargin)}%를 맞추는 1개 판매가: <b style="color:var(--fg)">${tp == null ? '수수료·광고비 비율이 너무 높아 불가' : won(tp)}</b></div></section>`;
    const items = [['결제금액', r.gross, 'var(--c2)'], ['부가세', -r.vat, 'var(--muted)'], ['수수료', -r.channelFee, 'var(--c4)'], ['제조원가', -r.cogs, 'var(--c3)'], ['박스·아이스팩·택배', -r.fulfil, 'var(--c2)'], ['반품·파손', -r.returnLoss, 'var(--muted)'], ['광고비', -r.ads, 'var(--c4)'], ['순이익', r.profit, r.profit >= 0 ? 'var(--good)' : 'var(--bad)']];
    let run = 0; const max = r.gross || 1;
    h += `<section class="box"><h2>결제금액이 이익이 되기까지</h2><div class="wf">` + items.map(([l, v, c], i) => {
      let left, width;
      if (i === 0) { left = 0; width = v; run = v; } else if (i === items.length - 1) { left = 0; width = Math.abs(v); } else { run += v; left = run; width = -v; }
      const L = Math.max(0, left) / max * 100, W = Math.min(100 - L, Math.abs(width) / max * 100);
      return `<div class="wf-row"><span>${l}</span><span class="bar"><i style="left:${L}%;width:${Math.max(W, 0.5)}%;background:${c}"></i></span><span class="amt">${won(v)}</span></div>`;
    }).join('') + `</div><div class="hint">광고 전 공헌이익 ${won(r.beforeAds)} (공헌이익률 ${pctf(r.cmRate)})</div></section>`;
    const parts = [['원재료', r.perPack.material, 'var(--c1)'], ['포장재', r.perPack.packaging, 'var(--c2)'], ['인건비', r.perPack.labor, 'var(--c3)'], ['제조경비', r.perPack.overhead, 'var(--c4)']];
    h += `<section class="box"><div class="box-h"><h2>1개 제조원가 구성</h2><span class="hint">배치당 ${r.packs}개</span></div>
      <div class="stackbar">${parts.map(([, v, c]) => `<i style="display:block;width:${r.unitCost > 0 ? v / r.unitCost * 100 : 0}%;background:${c}"></i>`).join('')}</div>
      <div class="legend">${parts.map(([l, v, c]) => `<span><i style="background:${c}"></i>${l} ${won(v)}</span>`).join('')}</div></section>`;
    if (p.channels.length) h += `<section class="box"><h2>채널별 수익</h2><div class="tbl-wrap"><table><thead><tr><th>채널</th><th class="n">수수료</th><th class="n">주문당 이익</th><th class="n">마진율</th><th class="n">손익분기 ROAS</th></tr></thead><tbody>` +
      p.channels.map(c => { const x = calc(p, { feePct: c.feePct }); if (!x.ok) return ''; return `<tr><td>${esc(c.name || '이름 없음')}</td><td class="n">${num(c.feePct)}%</td><td class="n">${won(x.profit)}</td><td class="n"><span class="pill ${tone(x, p)}">${pctf(x.margin)}</span></td><td class="n">${x.beRoas ? x.beRoas.toFixed(2) : '불가'}</td></tr>`; }).join('') + '</tbody></table></div></section>';
    const rf = [0.9, 1, 1.1, 1.2], pf = [0.9, 1, 1.1];
    h += `<section class="box"><div class="box-h"><h2>민감도: 원재료 단가 × 판매가</h2><span class="hint">칸 = 마진율</span></div><div class="tbl-wrap"><table class="sens"><thead><tr><th>원재료 단가</th>${pf.map(f => `<th class="n">${won(Math.round(p.price * f / 100) * 100)}</th>`).join('')}</tr></thead><tbody>` +
      rf.map(a => `<tr><td>${a === 1 ? '현재' : (a > 1 ? '+' : '') + Math.round((a - 1) * 100) + '%'}</td>` + pf.map(b => { const x = calc(p, { rawFactor: a, price: Math.round(p.price * b / 100) * 100 }); return `<td class="n ${tone(x, p)} ${a === 1 && b === 1 ? 'cur' : ''}">${x.ok ? pctf(x.margin) : '–'}</td>`; }).join('') + '</tr>').join('') + '</tbody></table></div></section>';
    const m = monthly(p, r);
    h += `<section class="box"><h2>월 손익</h2><div class="kpis" style="grid-template-columns:repeat(2,minmax(0,1fr))">${kpi('월 이익', won(m.profit), `주문 ${m.orders.toLocaleString('ko-KR')}건 − 고정비 ${won(m.fixed)}`, m.profit >= 0 ? 'good' : 'bad')}${kpi('손익분기 주문수', m.bep == null ? '불가' : m.bep.toLocaleString('ko-KR') + '건', '월 고정비를 넘기는 주문수')}</div></section>`;
    const a = actuals(p, r);
    if (a) h += `<section class="box"><h2>실제 성과 점검</h2><div class="kpis" style="grid-template-columns:repeat(2,minmax(0,1fr))">${kpi('실제 ROAS', a.roas == null ? '–' : a.roas.toFixed(2) + '배', `손익분기 ${r.beRoas ? r.beRoas.toFixed(2) + '배' : '불가'}`, a.roas == null ? '' : r.beRoas && a.roas >= r.beRoas ? 'good' : 'bad')}${kpi('추정 이익', won(a.profit), '주문수 × 광고 전 이익 − 실제 광고비', a.profit >= 0 ? 'good' : 'bad')}</div></section>`;
    box.innerHTML = h;
  };

  draw();
  // 화면을 떠날 때 저장 안 된 변경을 저장
  return () => { main.oninput = null; main.onchange = null; main.onclick = null; if (saveTimer) { clearTimeout(saveTimer); save(); } };
}
void modal; void confirmBox;
