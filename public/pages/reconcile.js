// 매출 대조: 카페24 대시보드와 운영실 숫자가 왜 다른지 항목별로 나눠 보여줌
import { api, esc, won, nf, srcTag, pageHead, readPeriod, periodBar, bindPeriod, state } from '../app.js';
import { fmtTime } from './home.js';

export async function render(main, { query }) {
  const st = readPeriod(query, 7);
  const d = await api(`/api/reconcile?from=${st.from}&to=${st.to}`);
  const T = d.total;
  const reasons = [
    { title: '날짜 기준이 다릅니다', body: '카페24 대시보드의 주문은 <b>주문한 날</b>, 운영실 매출은 <b>결제한 날</b> 기준입니다. 무통장입금처럼 다음 날 입금되면 두 화면에서 다른 날짜에 잡힙니다.', n: T.crossDay ? `기간 중 ${nf(T.crossDay)}건이 주문일과 결제일이 다름` : '기간 중 날짜가 엇갈린 주문 없음' },
    { title: '금액 기준이 다릅니다', body: '카페24 대시보드의 주문 금액은 <b>할인 전</b> 금액((판매가+옵션가)×수량+배송비)입니다. 운영실 매출은 쿠폰·회원 할인·적립금 사용을 뺀 <b>실제 결제금액</b>입니다.', n: `할인·적립금으로 생긴 차이 ${won(T.discount)}` },
    { title: '입금전 주문', body: '카페24 대시보드는 아직 입금되지 않은 주문도 주문 건수와 금액에 넣습니다. 운영실 매출은 결제가 끝난 주문만 셉니다.', n: `입금전 ${nf(T.unpaidCount)}건 · ${won(T.unpaidAmount)}` },
    { title: '취소·반품 처리', body: '카페24는 취소돼도 주문 건수를 줄이지 않고 금액만 줄입니다. 운영실은 취소·반품된 주문을 건수와 금액 모두에서 뺍니다.', n: `취소·반품 ${nf(T.claimCount)}건 · ${won(T.claimAmount)}` },
    { title: '갱신 시점', body: '카페24 대시보드 매출은 1시간마다, 통계는 조회 1시간 전까지 집계됩니다. 운영실은 최근 이틀을 10분마다 새로 받습니다. 방금 들어온 주문은 한쪽에만 보일 수 있습니다.', n: d.sync ? `운영실 마지막 자동 수집 ${esc(fmtTime(d.sync))}` : '' }
  ];

  main.innerHTML = `
  ${pageHead('매출 대조', `카페24 대시보드와 운영실 숫자가 다른 이유를 날짜별로 나눠 봅니다 ${srcTag(d.mode)}`, `<a class="btn small" href="https://${esc(state.shop.mallId)}.cafe24.com/disp/admin/shop1/main/dashboard" target="_blank" rel="noopener">카페24 대시보드 ↗</a>`)}
  <div class="stack">
    ${periodBar(st, [7, 30], 31)}
    <div class="kpis">
      <div class="kpi"><span class="l">카페24 방식 주문금액</span><span class="v">${won(T.orderAmount)}</span><span class="s">주문일 기준 · 주문 ${nf(T.orderCount)}건 (취소 포함 건수)</span></div>
      <div class="kpi"><span class="l">결제금액 합계</span><span class="v">${won(T.payAmount)}</span><span class="s">결제일 기준 · ${nf(T.payCount)}건 · 카페24 통계 > 매출분석의 결제와 비교</span></div>
      <div class="kpi"><span class="l">운영실 매출</span><span class="v">${won(T.ours)}</span><span class="s">결제일 기준 · 취소·반품 제외 · ${nf(T.oursCount)}건</span></div>
    </div>

    <section class="box"><div class="box-h"><h2>차이가 나는 이유</h2><span class="hint">이 기간의 실제 주문으로 계산</span></div>
      ${reasons.map((r, i) => `<div class="stat-line" style="flex-direction:column;align-items:flex-start;gap:4px"><span><b>${i + 1}. ${esc(r.title)}</b></span><span class="hint" style="font-size:13px;color:var(--fg-2)">${r.body}</span>${r.n ? `<span class="pill info">${r.n}</span>` : ''}</div>`).join('')}
    </section>

    <section class="box"><div class="box-h"><h2>날짜별 대조표</h2><span class="hint">카페24 화면의 같은 날짜 숫자와 줄 단위로 비교하세요</span></div>
      <div class="tbl-wrap"><table><thead>
        <tr><th rowspan="2">날짜</th><th colspan="4" style="text-align:center;border-bottom:1px solid var(--line)">주문일 기준 (카페24 대시보드·주문관리)</th><th colspan="2" style="text-align:center;border-bottom:1px solid var(--line)">결제일 기준 (카페24 통계)</th><th colspan="2" style="text-align:center;border-bottom:1px solid var(--line)">운영실</th></tr>
        <tr><th class="n">주문</th><th class="n">주문금액</th><th class="n">입금전</th><th class="n">취소·반품</th><th class="n">결제</th><th class="n">결제금액</th><th class="n">매출</th><th class="n">할인 차감</th></tr>
      </thead><tbody>
      ${[...d.rows].reverse().map(r => `<tr><td>${esc(r.date)}</td><td class="n">${nf(r.orderCount)}</td><td class="n">${won(r.orderAmount)}</td><td class="n">${r.unpaidCount ? `${nf(r.unpaidCount)}건 · ${won(r.unpaidAmount)}` : '–'}</td><td class="n">${r.claimCount ? `${nf(r.claimCount)}건` : '–'}</td>
        <td class="n">${nf(r.payCount)}</td><td class="n">${won(r.payAmount)}</td><td class="n"><b>${won(r.ours)}</b></td><td class="n">${r.discount ? won(r.discount) : '–'}</td></tr>`).join('')}
      </tbody><tfoot><tr><td>합계</td><td class="n">${nf(T.orderCount)}</td><td class="n">${won(T.orderAmount)}</td><td class="n">${nf(T.unpaidCount)}건</td><td class="n">${nf(T.claimCount)}건</td><td class="n">${nf(T.payCount)}</td><td class="n">${won(T.payAmount)}</td><td class="n">${won(T.ours)}</td><td class="n">${won(T.discount)}</td></tr></tfoot></table></div>
      <div class="hint">주문금액은 취소·반품을 뺀 할인 전 금액입니다. 이 표로도 설명되지 않는 차이가 있으면 해당 날짜와 카페24 화면을 캡처해 알려주세요.</div>
    </section>
  </div>`;
  bindPeriod(main, 'reconcile', st);
}
