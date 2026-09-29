// 매출 대조: 카페24 대시보드 '일별 매출'(주문·결제·환불)과 같은 기준으로 날짜별 숫자를 나란히 보여줌
import { api, esc, won, nf, srcTag, pageHead, readPeriod, periodBar, bindPeriod, state } from '../app.js';
import { fmtTime } from './home.js';

const cell = (n, amt) => `<td class="n">${n ? `${won(amt)}<div class="hint">${nf(n)}건</div>` : '<span class="muted">–</span>'}</td>`;

export async function render(main, { query }) {
  const st = readPeriod(query, 7);
  const d = await api(`/api/reconcile?from=${st.from}&to=${st.to}`);
  const T = d.total;
  const reasons = [
    { title: '주문·결제·환불은 각각 다른 날짜로 잡힙니다', body: '카페24 대시보드와 같게 <b>주문</b>은 주문한 날, <b>결제</b>는 결제(입금)된 날, <b>환불</b>은 환불이 끝난 날 기준입니다. 무통장입금이나 며칠 뒤 환불된 주문은 서로 다른 날짜 줄에 나옵니다.', n: T.crossDay ? `기간 중 ${nf(T.crossDay)}건이 주문일과 결제일이 다름` : '' },
    { title: '결제금액에는 선불금·적립금 사용분이 들어갑니다', body: '카페24의 결제는 카드·계좌 결제액에 <b>선불금(예치금)·적립금 사용분</b>을 더한 금액입니다. 운영실도 같은 방식으로 셉니다. 쿠폰·회원 할인만 빠집니다.', n: T.payCredits ? `기간 중 선불금·적립금 사용 ${won(T.payCredits)}` : '' },
    { title: '주문 상태별 건수는 기간과 관계없습니다', body: '대시보드의 입금전·배송준비중·배송대기·배송중 숫자는 <b>주문일과 관계없이 지금 그 상태인 주문 전부</b>입니다. 운영실 주문관리의 해당 메뉴도 같은 기준(최근 12개월)으로 보여줍니다.', n: '' },
    { title: '갱신 시점', body: '카페24 대시보드 매출은 1시간마다 집계됩니다. 이 화면은 열 때마다 카페24에서 바로 받아옵니다. 방금 들어온 주문은 한쪽에만 보일 수 있습니다.', n: d.sync ? `운영실 마지막 자동 수집 ${esc(fmtTime(d.sync))}` : '' }
  ];

  main.innerHTML = `
  ${pageHead('매출 대조', `카페24 대시보드 '일별 매출'과 같은 기준으로 날짜별 숫자를 맞춰 봅니다 ${srcTag(d.mode)}`, `<a class="btn small" href="https://${esc(state.shop.mallId)}.cafe24.com/disp/admin/shop1/main/dashboard" target="_blank" rel="noopener">카페24 대시보드 ↗</a>`)}
  <div class="stack">
    ${periodBar(st, [7, 30], 31)}
    ${d.refundError ? `<div class="err">환불 내역을 불러오지 못했습니다: ${esc(d.refundError)}<br><span class="hint">카페24 앱 권한에 '주문 읽기'가 있는지 확인하세요. 환불 칸은 비어 있는 상태로 보입니다.</span></div>` : ''}
    <div class="kpis">
      <div class="kpi"><span class="l">주문</span><span class="v">${won(T.orderAmount)}</span><span class="s">주문일 기준 · ${nf(T.orderCount)}건</span></div>
      <div class="kpi"><span class="l">결제</span><span class="v">${won(T.payAmount)}</span><span class="s">결제일 기준 · ${nf(T.payCount)}건</span></div>
      <div class="kpi"><span class="l">환불</span><span class="v">${won(T.refundAmount)}</span><span class="s">환불 완료일 기준 · ${nf(T.refundCount)}건</span></div>
      <div class="kpi"><span class="l">순결제 (결제 − 환불)</span><span class="v">${won(T.net)}</span><span class="s">실제로 남은 매출</span></div>
    </div>

    <section class="box"><div class="box-h"><h2>일별 매출</h2><span class="hint">카페24 대시보드 '일별 매출' 표와 같은 기준입니다. 같은 날짜 줄끼리 비교하세요</span></div>
      <div class="tbl-wrap"><table><thead>
        <tr><th>날짜</th><th class="n">주문</th><th class="n">결제</th><th class="n">환불</th><th class="n">순결제</th><th class="n">입금전</th><th class="n">선불금·적립금</th><th class="n">할인</th></tr>
      </thead><tbody>
      ${[...d.rows].reverse().map(r => `<tr><td>${esc(r.date)}</td>${cell(r.orderCount, r.orderAmount)}${cell(r.payCount, r.payAmount)}${cell(r.refundCount, r.refundAmount)}
        <td class="n"><b>${won(r.net)}</b></td>
        <td class="n">${r.unpaidCount ? `${won(r.unpaidAmount)}<div class="hint">${nf(r.unpaidCount)}건</div>` : '<span class="muted">–</span>'}</td>
        <td class="n">${r.payCredits ? won(r.payCredits) : '<span class="muted">–</span>'}</td>
        <td class="n">${r.discount ? won(r.discount) : '<span class="muted">–</span>'}</td></tr>`).join('')}
      </tbody><tfoot><tr><td>합계</td>${cell(T.orderCount, T.orderAmount)}${cell(T.payCount, T.payAmount)}${cell(T.refundCount, T.refundAmount)}<td class="n">${won(T.net)}</td><td class="n">${won(T.unpaidAmount)}</td><td class="n">${won(T.payCredits)}</td><td class="n">${won(T.discount)}</td></tr></tfoot></table></div>
      <div class="hint">주문 = 주문일 기준 (판매가+옵션가)×수량+배송비, 취소·반품된 주문은 금액에서 빠짐 · 결제 = 결제일 기준, 선불금·적립금 포함, 쿠폰·회원 할인 제외 · 환불 = 환불 완료일 기준. 카페24 숫자와 다른 날짜가 있으면 그 날짜 줄을 캡처해 알려주세요.</div>
    </section>

    <section class="box"><div class="box-h"><h2>숫자를 읽는 법</h2></div>
      ${reasons.map((r, i) => `<div class="stat-line" style="flex-direction:column;align-items:flex-start;gap:4px"><span><b>${i + 1}. ${esc(r.title)}</b></span><span class="hint" style="font-size:13px;color:var(--fg-2)">${r.body}</span>${r.n ? `<span class="pill info">${r.n}</span>` : ''}</div>`).join('')}
    </section>
  </div>`;
  bindPeriod(main, 'reconcile', st);
}
