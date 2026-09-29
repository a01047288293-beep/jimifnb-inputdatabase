// 고객 분석: 신규·재구매, 회원·비회원, 재구매 간격, 지역, 단골
import { api, esc, won, nf, pctf, srcTag, pageHead, readPeriod, periodBar, bindPeriod } from '../app.js';
import { hbars, splitBar, columnChart } from '../charts.js';

export async function render(main, { query }) {
  const st = readPeriod(query, 90);
  const d = await api(`/api/insights/customers?from=${st.from}&to=${st.to}`);
  const cov = d.coverage;
  const aov = (rev, n) => (n ? won(rev / n) : '–');

  main.innerHTML = `
  ${pageHead('고객 분석', `${esc(d.from)} ~ ${esc(d.to)} · 재구매는 최근 1년 기록 기준 ${srcTag(d.mode)}`)}
  <div class="stack">
    ${periodBar(st, [30, 90, 180])}
    ${cov.have < cov.total ? `<div class="notice">최근 1년 주문 기록을 모으는 중입니다 (${cov.have}/${cov.total}일). 다 모이기 전에는 재구매·단골 숫자가 실제보다 적게 나올 수 있습니다. 자동 수집이 15분마다 조금씩 채웁니다.</div>` : ''}
    <div class="kpis">
      <div class="kpi"><span class="l">구매 회원</span><span class="v">${nf(d.members)}명</span><span class="s">비회원 주문 ${nf(d.guestOrders)}건 별도</span></div>
      <div class="kpi"><span class="l">재구매 고객 비율</span><span class="v">${pctf(d.repeatRate, 0)}</span><span class="s">기간 중 산 회원 중 1년 안에 2번 이상 산 비율</span></div>
      <div class="kpi"><span class="l">다시 사기까지</span><span class="v">${d.medianGap == null ? '–' : Math.round(d.medianGap) + '일'}</span><span class="s">재구매 간격의 중간값</span></div>
      <div class="kpi"><span class="l">누적 회원 (1년)</span><span class="v">${nf(d.historyMembers)}명</span><span class="s">한 번 이상 구매한 회원</span></div>
    </div>

    <div class="cols">
      <section class="box"><div class="box-h"><h2>신규 · 재구매 · 비회원</h2><span class="hint">주문 건수 기준</span></div>
        ${splitBar([
          { label: '신규 회원', value: d.newOrders, color: 'var(--s1)', fmt: v => nf(v) + '건' },
          { label: '재구매 회원', value: d.returningOrders, color: 'var(--s3)', fmt: v => nf(v) + '건' },
          { label: '비회원', value: d.guestOrders, color: 'var(--fg-3)', fmt: v => nf(v) + '건' }
        ])}
        <div class="stat-line"><span>신규 회원 주문</span><b>${nf(d.newOrders)}건 · ${won(d.newRevenue)} · 객단가 ${aov(d.newRevenue, d.newOrders)}</b></div>
        <div class="stat-line"><span>재구매 회원 주문</span><b>${nf(d.returningOrders)}건 · ${won(d.returningRevenue)} · 객단가 ${aov(d.returningRevenue, d.returningOrders)}</b></div>
        <div class="stat-line"><span>비회원 주문</span><b>${nf(d.guestOrders)}건 · ${won(d.guestRevenue)} · 객단가 ${aov(d.guestRevenue, d.guestOrders)}</b></div>
      </section>
      <section class="box"><div class="box-h"><h2>1년간 구매 횟수</h2><span class="hint">회원 수</span></div>
        ${columnChart(d.freq, { key: 'members', label: '회원', fmt: v => nf(v) + '명', xLabel: f => f.label, height: 230, width: 460, highlightMax: false, tip: f => `${f.label} 구매\n${nf(f.members)}명` })}
      </section>
    </div>

    <div class="cols">
      <section class="box"><div class="box-h"><h2>지역별 매출</h2><span class="hint">받는 사람 주소의 시·도 기준</span></div>
        ${hbars(d.regions, { limit: 10, sub: r => `${nf(r.orders)}건 · ${pctf(r.share, 0)}` })}</section>
      <section class="box"><div class="box-h"><h2>단골 고객 20명</h2><span class="hint">최근 1년 구매액 순 · 이름 일부 가림</span></div>
        ${d.top.length ? `<div class="tbl-wrap"><table><thead><tr><th>고객</th><th class="n">구매</th><th class="n">구매액</th><th class="n">평균 간격</th><th>마지막 구매</th><th>지역</th></tr></thead><tbody>
        ${d.top.map(c => `<tr><td>${esc(c.buyer || '회원')}</td><td class="n">${nf(c.orders)}회</td><td class="n">${won(c.revenue)}</td><td class="n">${c.avgGap == null ? '–' : Math.round(c.avgGap) + '일'}</td><td>${esc(c.last)}</td><td>${esc(c.region)}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">회원 구매 기록이 없습니다.</div>'}
      </section>
    </div>
    <div class="hint">개인정보 보호를 위해 회원 아이디는 저장하지 않고, 되돌릴 수 없는 값으로 바꿔 재구매만 계산합니다. 연락처·주소는 저장하지 않습니다.</div>
  </div>`;
  bindPeriod(main, 'customers', st);
}
