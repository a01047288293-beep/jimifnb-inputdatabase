// 상품·재고: 판매 순위와 변화, 옵션별 판매, 재고 경고, 원가 연결
import { api, esc, won, nf, pctf, srcTag, pageHead, readPeriod, periodBar, bindPeriod, shopLink, modal, toast, setBadge } from '../app.js';
import { spark, hbars } from '../charts.js';

const LEVEL = { critical: ['bad', '품절 주의'], warn: ['warn', '확인 필요'], ok: ['good', '여유'] };

export async function render(main, { query }) {
  const st = readPeriod(query, 30);
  const [d, costProducts] = await Promise.all([api(`/api/insights/products?from=${st.from}&to=${st.to}`), api('/api/products')]);
  setBadge('stock', d.alerts);
  const linked = d.products.filter(p => p.linked).reduce((s, p) => s + p.revenue, 0);
  const alerts = d.stock.filter(s => s.level !== 'ok');
  let open = null;

  const draw = () => {
    main.innerHTML = `
    ${pageHead('상품·재고', `${esc(d.from)} ~ ${esc(d.to)} · 순위 변화는 바로 앞 같은 길이의 기간과 비교 ${srcTag(d.mode)}`)}
    <div class="stack">
      ${periodBar(st)}
      <div class="kpis">
        <div class="kpi"><span class="l">판매된 상품</span><span class="v">${nf(d.products.length)}개</span><span class="s">매출 ${won(d.total)}</span></div>
        <div class="kpi"><span class="l">1위 상품</span><span class="v" style="font-size:17px">${d.products[0] ? esc(d.products[0].name) : '–'}</span><span class="s">${d.products[0] ? `매출의 ${pctf(d.products[0].share, 0)}` : ''}</span></div>
        <div class="kpi ${alerts.length ? 'alert' : ''}"><span class="l">재고 확인 필요</span><span class="v">${nf(alerts.length)}개 품목</span><span class="s">품절·안전재고 이하·7일 안에 소진 예상</span></div>
        <div class="kpi"><span class="l">원가 연결된 매출</span><span class="v">${pctf(d.total ? linked / d.total : null, 0)}</span><span class="s">연결해야 이익이 계산됩니다</span></div>
      </div>
      ${d.invError ? `<div class="err">재고를 불러오지 못했습니다: ${esc(d.invError)}</div>` : ''}
      ${alerts.length ? `<section class="box"><div class="box-h"><h2>재고 경고</h2><span class="hint">최근 14일 판매 속도 기준</span></div>
        <div class="tbl-wrap"><table><thead><tr><th>상품</th><th>옵션</th><th class="n">재고</th><th class="n">하루 판매</th><th>상태</th></tr></thead><tbody>
        ${alerts.map(s => `<tr><td>${shopLink(s.productNo, s.name)}</td><td>${esc(s.option || '기본')}</td><td class="n">${s.quantity == null ? '관리 안 함' : nf(s.quantity) + '개'}</td><td class="n">${s.perDay ? s.perDay.toFixed(1) + '개' : '–'}</td><td><span class="pill ${LEVEL[s.level][0]}">${esc(s.note)}</span></td></tr>`).join('')}
        </tbody></table></div></section>` : ''}

      <section class="box">
        <div class="box-h"><h2>판매 순위</h2><span class="hint">행을 누르면 옵션별 판매가 보입니다</span></div>
        ${d.products.length ? `<div class="tbl-wrap"><table><thead><tr><th class="n">순위</th><th>상품</th><th class="n">수량</th><th class="n">매출</th><th style="min-width:120px">비중</th><th class="n">이전 대비</th><th>일별 수량</th><th>원가</th><th class="n">원가율</th><th></th></tr></thead><tbody>
        ${d.products.map(p => {
          const mv = p.prevRank == null ? '<span class="rank-up">NEW</span>' : p.prevRank > p.rank ? `<span class="rank-up">▲${p.prevRank - p.rank}</span>` : p.prevRank < p.rank ? `<span class="rank-down">▼${p.rank - p.prevRank}</span>` : '';
          const row = `<tr class="click" data-row="${p.productNo}"><td class="n">${p.rank} ${mv}</td><td>${shopLink(p.productNo, p.name)}</td><td class="n">${nf(p.qty)}</td><td class="n">${won(p.revenue)}</td>
            <td><div class="hbar" style="grid-template-columns:1fr auto"><span class="tr"><i style="width:${(p.share * 100).toFixed(1)}%"></i></span><span class="vl">${pctf(p.share, 0)}</span></div></td>
            <td class="n">${p.growth == null ? '<span class="muted">–</span>' : `<span class="${p.growth >= 0 ? 'rank-up' : 'rank-down'}">${p.growth >= 0 ? '▲' : '▼'} ${Math.abs(p.growth * 100).toFixed(0)}%</span>`}</td>
            <td>${spark(p.spark, { w: 90, h: 22 })}</td>
            <td>${p.linked ? `<a href="#/products/${esc(p.linked.id)}">${esc(p.linked.name)}</a>` : '<span class="pill warn">미연결</span>'}</td>
            <td class="n">${p.costRate == null ? '–' : `<span class="pill ${p.costRate > 0.7 ? 'bad' : p.costRate > 0.55 ? 'warn' : 'good'}">${pctf(p.costRate, 0)}</span>`}</td>
            <td><button class="btn small" data-link="${p.productNo}">${p.linked ? '변경' : '원가 연결'}</button></td></tr>`;
          const opt = open === p.productNo ? `<tr><td></td><td colspan="9"><div style="padding:6px 0 10px">${hbars(p.options, { name: o => o.option, value: o => o.qty, fmt: v => nf(v) + '개', sub: o => won(o.revenue), color: 'var(--s3)' })}</div></td></tr>` : '';
          return row + opt;
        }).join('')}</tbody></table></div>
        <div class="hint">원가율 = 판매 수량 × 1개 제조원가 ÷ 부가세 제외 매출(과세 가정). 배송비·수수료는 제외.</div>` : '<div class="empty">기간 안에 판매된 상품이 없습니다.</div>'}
      </section>

      <section class="box" id="stock-table"><div class="box-h"><h2>전체 재고</h2><span class="hint">카페24에서 재고 관리를 켠 품목만 수량이 나옵니다</span></div>
        ${d.stock.length ? `<div class="tbl-wrap"><table><thead><tr><th>상품</th><th>옵션</th><th class="n">재고</th><th class="n">안전재고</th><th class="n">하루 판매</th><th class="n">남은 기간</th><th>상태</th></tr></thead><tbody>
        ${d.stock.map(s => `<tr><td>${shopLink(s.productNo, s.name)}</td><td>${esc(s.option || '기본')}</td><td class="n">${s.quantity == null ? '<span class="muted">관리 안 함</span>' : nf(s.quantity)}</td><td class="n">${s.tracked ? nf(s.safety) : '–'}</td>
          <td class="n">${s.perDay ? s.perDay.toFixed(1) : '–'}</td><td class="n">${s.cover == null ? '–' : s.cover > 365 ? '1년 이상' : s.cover < 1 ? '1일 미만' : Math.floor(s.cover) + '일'}</td>
          <td><span class="pill ${LEVEL[s.level][0]}">${esc(s.note || LEVEL[s.level][1])}</span></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">재고 정보가 없습니다.</div>'}
      </section>
    </div>`;
    bindPeriod(main, 'stock', st);
    main.querySelectorAll('[data-row]').forEach(tr => tr.onclick = e => {
      if (e.target.closest('a,button')) return;
      const no = Number(tr.dataset.row); open = open === no ? null : no; draw();
    });
    main.querySelectorAll('[data-link]').forEach(b => b.onclick = () => linkModal(Number(b.dataset.link), d.products.find(p => p.productNo === Number(b.dataset.link)), costProducts, () => render(main, { query })));
  };
  draw();
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
