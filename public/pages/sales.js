// 매출 분석: 기간 비교, 일별 추이, 요일·시간대, 결제수단·유입경로, 광고비·이익
import { api, esc, won, nf, pctf, roasf, srcTag, pageHead, readPeriod, periodBar, bindPeriod } from '../app.js';
import { lineChart, columnChart, hbars, heatmap, delta, man } from '../charts.js';

export async function render(main, { query }) {
  const st = readPeriod(query, 30);
  const d = await api(`/api/insights/sales?from=${st.from}&to=${st.to}`);
  const S = d.summary, P = d.prev, LY = d.lastYear;
  const merged = d.daily.map((x, i) => ({ ...x, prevRevenue: d.prevDaily[i]?.revenue ?? null }));
  const profit = d.profit;
  const pSum = k => profit.reduce((s, x) => s + (x[k] || 0), 0);
  const hasProfit = profit.some(x => x.profit != null);
  const bestHour = [...d.hours].sort((a, b) => b.orders - a.orders)[0];
  const bestDay = [...d.weekday].sort((a, b) => b.avgRevenue - a.avgRevenue)[0];
  const cmp = (cur, prev, ly, opts) => `${delta(cur, prev, { label: '이전 기간', ...opts })}${LY ? ` ${delta(cur, ly, { label: '작년', ...opts })}` : ''}`;

  main.innerHTML = `
  ${pageHead('매출 분석', `${esc(d.from)} ~ ${esc(d.to)} · 이전 기간 ${esc(d.prevFrom)} ~ ${esc(d.prevTo)} ${srcTag(d.mode)}`)}
  <div class="stack">
    ${periodBar(st)}
    ${d.missingDays ? `<div class="notice">아직 모으지 못한 ${d.missingDays}일이 있어 일부 숫자가 빠져 있습니다. 자동 수집이 15분마다 과거 기록을 채웁니다.</div>` : ''}
    <div class="kpis">
      <div class="kpi"><span class="l">매출</span><span class="v">${won(S.revenue)}</span><span class="s">${cmp(S.revenue, P?.revenue, LY?.revenue)}</span></div>
      <div class="kpi"><span class="l">주문</span><span class="v">${nf(S.orders)}건</span><span class="s">${cmp(S.orders, P?.orders, LY?.orders)}</span></div>
      <div class="kpi"><span class="l">객단가</span><span class="v">${won(S.aov)}</span><span class="s">${cmp(S.aov, P?.aov, LY?.aov)}</span></div>
      <div class="kpi"><span class="l">판매 수량</span><span class="v">${nf(S.units)}개</span><span class="s">주문당 ${S.orders ? (S.units / S.orders).toFixed(2) : '–'}개</span></div>
      <div class="kpi"><span class="l">구매자</span><span class="v">${nf(S.buyers)}명</span><span class="s">취소·반품 ${nf(d.canceled)}건 제외</span></div>
    </div>

    <section class="box">
      <div class="box-h"><h2>일별 매출</h2><span class="hint">점선은 바로 앞 같은 길이의 기간${LY ? '' : ' · 작년 비교는 1년치 기록이 모이면 표시'}</span></div>
      ${lineChart(merged, { series: [{ key: 'revenue', label: '이번 기간 매출', color: 'var(--s1)', area: true }, { key: 'prevRevenue', label: '이전 기간 매출', color: 'var(--fg-3)', dash: true }], width: 1000, height: 300 })}
    </section>

    <div class="cols">
      <section class="box"><div class="box-h"><h2>요일별 하루 평균 매출</h2><span class="hint">가장 높은 요일: ${esc(bestDay.name)}요일</span></div>
        ${columnChart([1, 2, 3, 4, 5, 6, 0].map(i => d.weekday[i]), { key: 'avgRevenue', label: '하루 평균 매출', xLabel: w => w.name, height: 230, width: 460, tip: w => `${w.name}요일 (기간 중 ${w.days}번)\n하루 평균 ${won(w.avgRevenue)}\n주문 ${nf(w.orders)}건` })}
      </section>
      <section class="box"><div class="box-h"><h2>시간대별 주문</h2><span class="hint">가장 많은 시간: ${bestHour.orders ? bestHour.hour + '시' : '–'}</span></div>
        ${columnChart(d.hours, { key: 'orders', label: '주문', fmt: v => nf(v) + '건', xLabel: h => String(h.hour), height: 230, width: 460, tip: h => `${h.hour}시대\n주문 ${nf(h.orders)}건 · ${won(h.revenue)}` })}
      </section>
    </div>

    <section class="box"><div class="box-h"><h2>요일 × 시간대 주문 분포</h2><span class="hint">광고 예산을 몰아줄 시간대를 정할 때 참고</span></div>${heatmap(d.heat)}</section>

    <div class="cols">
      <section class="box"><div class="box-h"><h2>결제수단</h2><span class="hint">매출 기준</span></div>
        ${hbars(d.payments, { sub: x => `${nf(x.orders)}건 · ${pctf(x.share, 0)}` })}</section>
      <section class="box"><div class="box-h"><h2>주문 경로</h2><span class="hint">카페24 주문 경로 기준</span></div>
        ${hbars(d.channels, { color: 'var(--s3)', sub: x => `${nf(x.orders)}건 · ${pctf(x.share, 0)}` })}</section>
    </div>

    <div class="cols">
      <section class="box"><div class="box-h"><h2>객단가 추이</h2></div>
        ${lineChart(d.daily, { series: [{ key: 'aov', label: '객단가', color: 'var(--s4)' }], height: 240, width: 460 })}</section>
      <section class="box"><div class="box-h"><h2>광고비와 추정 이익</h2><span class="hint">광고 ROAS ${roasf(pSum('adSpend') ? pSum('adRevenue') / pSum('adSpend') : null)}</span></div>
        ${lineChart(profit, { series: [{ key: 'adSpend', label: '광고비', color: 'var(--s2)' }, ...(hasProfit ? [{ key: 'profit', label: '추정 이익', color: 'var(--s3)' }] : [])], height: 240, width: 460 })}
        <div class="stat-line"><span>광고비 합계</span><b>${won(pSum('adSpend'))} (매출의 ${pctf(S.revenue ? pSum('adSpend') / S.revenue : null)})</b></div>
        <div class="stat-line"><span>추정 이익 합계</span><b>${hasProfit ? won(profit.reduce((s, x) => s + (x.profit || 0), 0)) : '제품 원가 연결 필요'}</b></div>
        ${d.adErrors.length ? `<div class="hint">광고 일부 실패: ${d.adErrors.map(e => esc(e.platform)).join(', ')}</div>` : ''}
      </section>
    </div>
  </div>`;
  bindPeriod(main, 'sales', st);
  void man;
}
