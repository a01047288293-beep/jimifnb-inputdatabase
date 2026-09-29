import { api, esc, won, nf, pctf, roasf, barLineChart, srcTag, kstToday, addDays, go, modal, toast } from '../app.js';

export async function render(main, { query }) {
  const today = kstToday();
  const st = { from: query.get('from') || addDays(today, -29), to: query.get('to') || today };
  const [d, products] = await Promise.all([api(`/api/sales?from=${st.from}&to=${st.to}`), api('/api/products')]);
  const s = k => d.series.reduce((a, x) => a + (x[k] || 0), 0);
  const rev = s('revenue'), ad = s('adSpend'), adRev = s('adRevenue'), contrib = s('contribution'), mapped = s('mappedRevenue'), profit = s('profit');
  const unlinked = d.products.filter(p => !p.linked);
  const hasProfit = d.series.some(x => x.profit != null && x.mappedRevenue > 0);

  main.innerHTML = `
  <div class="page-head"><h1>매출·이익</h1>${srcTag(d.modes.cafe24)}</div>
  <div class="stack">
    <div class="toolbar">
      <input type="date" id="s-from" value="${st.from}" max="${today}" aria-label="시작일"> ~ <input type="date" id="s-to" value="${st.to}" max="${today}" aria-label="종료일">
      <div class="seg" id="s-quick"><button data-d="6">7일</button><button data-d="29">30일</button><button data-d="89">90일</button></div>
      <span class="hint">결제일 기준, 취소·반품 제외</span>
    </div>
    ${d.errors.length ? `<div class="err">광고 데이터 일부 실패: ${d.errors.map(e => esc(e.platform + ' ' + e.message)).join(' / ')}</div>` : ''}
    <div class="kpis">
      <div class="kpi"><span class="l">매출</span><span class="v">${won(rev)}</span><span class="s">주문 ${nf(s('orders'))}건 · 객단가 ${won(s('orders') ? rev / s('orders') : null)}</span></div>
      <div class="kpi"><span class="l">광고비</span><span class="v">${won(ad)}</span><span class="s">매출 대비 ${pctf(rev ? ad / rev : null)} · 광고 ROAS ${roasf(ad ? adRev / ad : null)}</span></div>
      <div class="kpi"><span class="l">광고 전 공헌이익</span><span class="v">${won(contrib)}</span><span class="s">원가 연결 매출 ${won(mapped)} 기준</span></div>
      <div class="kpi ${!hasProfit ? '' : profit >= 0 ? 'good' : 'bad'}"><span class="l">추정 이익</span><span class="v">${hasProfit ? won(profit) : '–'}</span><span class="s">원가 연결 비율 ${pctf(rev ? mapped / rev : null, 0)}</span></div>
    </div>
    <section class="box"><div class="box-h"><h2>일별 매출·광고비</h2><span class="hint">막대 위에 마우스를 올리면 금액이 보입니다</span></div>
      ${barLineChart(d.series, { bars: [{ key: 'revenue', label: '매출', color: 'var(--c1)' }, { key: 'adSpend', label: '광고비', color: 'var(--c3)' }], line: { key: 'profit', label: '추정 이익', color: 'var(--c4)' } })}
    </section>
    <section class="box">
      <div class="box-h"><h2>상품별 판매</h2>${unlinked.length ? `<span class="pill warn">원가 미연결 ${unlinked.length}개</span>` : '<span class="pill good">모두 원가 연결됨</span>'}</div>
      ${d.products.length ? `<div class="tbl-wrap"><table><thead><tr><th>카페24 상품</th><th class="n">판매 수량</th><th class="n">매출</th><th>연결된 제품 원가</th><th class="n">1개 원가</th><th class="n">원가율</th><th></th></tr></thead><tbody>
      ${d.products.map(p => `<tr><td>${esc(p.name)} <span class="hint">#${p.productNo}</span></td><td class="n">${nf(p.qty)}</td><td class="n">${won(p.revenue)}</td>
        <td>${p.linked ? `<a href="#/products/${esc(p.linked.id)}">${esc(p.linked.name)}</a>` : '<span class="pill warn">미연결</span>'}</td>
        <td class="n">${won(p.unitCost)}</td><td class="n">${p.costRate == null ? '–' : `<span class="pill ${p.costRate > 0.7 ? 'bad' : p.costRate > 0.55 ? 'warn' : 'good'}">${pctf(p.costRate, 0)}</span>`}</td>
        <td><button class="btn small" data-link="${p.productNo}">${p.linked ? '변경' : '원가 연결'}</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="hint">원가율 = 판매 수량 × 1개 제조원가 ÷ 부가세 제외 매출(과세 가정). 배송비·수수료는 포함하지 않습니다.</div>` : '<div class="empty">기간 안에 판매된 상품이 없습니다.</div>'}
    </section>
  </div>`;

  const reload = patch => { const n = { ...st, ...patch }; go(`#/sales?from=${n.from}&to=${n.to}`); };
  main.querySelector('#s-from').onchange = e => reload({ from: e.target.value });
  main.querySelector('#s-to').onchange = e => reload({ to: e.target.value });
  main.querySelectorAll('#s-quick button').forEach(b => b.onclick = () => reload({ from: addDays(today, -Number(b.dataset.d)), to: today }));
  main.querySelectorAll('[data-link]').forEach(b => b.onclick = () => linkModal(Number(b.dataset.link), d.products.find(p => p.productNo === Number(b.dataset.link)), products, () => reload({})));
}

export function linkModal(productNo, shopItem, products, done) {
  const current = products.find(p => (p.cafe24ProductNos || []).map(Number).includes(productNo));
  modal(`<h2>원가 연결</h2><p style="margin:0">카페24 상품 <b>${esc(shopItem?.name || '#' + productNo)}</b>의 원가를 어느 제품으로 계산할까요?</p>
    <label class="f">제품<select id="l-p"><option value="">연결 안 함</option>${products.map(p => `<option value="${esc(p.id)}" ${current?.id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    ${products.length ? '' : '<div class="notice">먼저 제품·마진에서 제품을 만드세요.</div>'}
    <div class="foot"><a class="btn" href="#/products" data-close>새 제품 만들기</a><button class="btn" data-close>취소</button><button class="btn primary" id="l-ok">저장</button></div>`, {
    onMount: (el, close) => {
      el.querySelector('#l-ok').onclick = async () => {
        const pid = el.querySelector('#l-p').value;
        try {
          for (const p of products) {
            const nos = (p.cafe24ProductNos || []).map(Number);
            const want = p.id === pid;
            if (want === nos.includes(productNo)) continue;
            const next = want ? [...nos, productNo] : nos.filter(n => n !== productNo);
            await api(`/api/products/${encodeURIComponent(p.id)}`, { method: 'PUT', body: { ...p, cafe24ProductNos: next } });
          }
          close(); toast('원가 연결을 저장했습니다.'); done();
        } catch (e) { toast(e.message, true); }
      };
    }
  });
}
