// 출고 운영: 결제→출고 소요시간, 지연 주문, 취소·반품·교환
import { api, esc, nf, pctf, srcTag, pageHead, readPeriod, periodBar, bindPeriod, setBadge, toast } from '../app.js';
import { lineChart, hbars } from '../charts.js';
import { fmtTime } from './home.js';

const hrs = h => (h == null ? '–' : h < 48 ? `${Math.round(h)}시간` : `${(h / 24).toFixed(1)}일`);

export async function render(main, { query }) {
  const st = readPeriod(query, 30);
  const d = await api(`/api/insights/fulfillment?from=${st.from}&to=${st.to}`);
  setBadge('late', d.delayed.length);
  const claimTotal = d.claims.reduce((s, c) => s + c.count, 0);

  main.innerHTML = `
  ${pageHead('출고 운영', `${esc(d.from)} ~ ${esc(d.to)} · 출고 기준 ${d.slaHours}시간 (설정·연동에서 변경) ${srcTag(d.mode)}`)}
  <div class="stack">
    ${periodBar(st, [7, 30, 90], 92)}
    <div class="kpis">
      <a class="kpi ${d.delayed.length ? 'alert' : ''}" href="#/orders?group=ready"><span class="l">출고 지연</span><span class="v">${nf(d.delayed.length)}건</span><span class="s">결제 후 ${d.slaHours}시간이 지났는데 출고 전</span></a>
      <div class="kpi"><span class="l">결제→출고 (중간값)</span><span class="v">${hrs(d.leadMedian)}</span><span class="s">늦은 10%는 ${hrs(d.leadP90)} 이상</span></div>
      <div class="kpi"><span class="l">24시간 안에 출고</span><span class="v">${pctf(d.within24, 0)}</span><span class="s">48시간 안 ${pctf(d.within48, 0)} · ${nf(d.shippedCount)}건 기준</span></div>
      <div class="kpi"><span class="l">출고→배송완료</span><span class="v">${hrs(d.deliverMedian)}</span><span class="s">택배 이동 시간 중간값</span></div>
      <div class="kpi ${claimTotal / (d.totalOrders || 1) > 0.05 ? 'alert' : ''}"><span class="l">취소·반품·교환</span><span class="v">${pctf(d.totalOrders ? claimTotal / d.totalOrders : null)}</span><span class="s">${d.claims.map(c => `${c.name} ${nf(c.count)}`).join(' · ')}</span></div>
    </div>

    <section class="box"><div class="box-h"><h2>출고 지연 주문</h2>${d.delayed.length ? `<button class="btn small" id="csv-late">목록 내려받기(CSV)</button>` : ''}</div>
      ${d.delayed.length ? `<div class="tbl-wrap"><table><thead><tr><th>결제 시각</th><th>주문번호</th><th>상품</th><th>구매자</th><th class="n">지난 시간</th></tr></thead><tbody>
      ${d.delayed.map(o => `<tr><td class="hint">${esc(fmtTime(o.time))}</td><td>${esc(o.id)}</td><td>${esc(o.product)}${o.more > 0 ? ` <span class="hint">외 ${o.more}건</span>` : ''}</td><td>${esc(o.buyer)}</td><td class="n"><span class="pill ${o.hours > d.slaHours * 1.5 ? 'bad' : 'warn'}">${hrs(o.hours)}</span></td></tr>`).join('')}
      </tbody></table></div><div><a class="btn" href="#/orders?group=ready">주문·출고에서 송장 입력</a></div>` : '<div class="empty">지연된 주문이 없습니다.</div>'}
    </section>

    <section class="box"><div class="box-h"><h2>날짜별 출고 소요시간</h2><span class="hint">그날 결제된 주문의 중간값</span></div>
      ${lineChart(d.dailyLead, { series: [{ key: 'median', label: '결제→출고 (시간)', color: 'var(--s1)' }], fmt: v => (v == null ? '–' : Math.round(v) + '시간'), height: 240, width: 1000 })}
    </section>

    <div class="cols">
      <section class="box"><div class="box-h"><h2>취소·반품 사유</h2><span class="hint">${nf(claimTotal)}건</span></div>
        ${hbars(d.reasons, { value: r => r.count, fmt: v => nf(v) + '건', color: 'var(--s2)' })}</section>
      <section class="box"><div class="box-h"><h2>취소·반품이 많은 상품</h2></div>
        ${hbars(d.claimProducts, { value: r => r.count, fmt: v => nf(v) + '건', color: 'var(--s2)' })}</section>
    </div>
  </div>`;
  bindPeriod(main, 'fulfillment', st);
  const b = main.querySelector('#csv-late');
  if (b) b.onclick = () => {
    downloadCsv(`출고지연_${st.today}.csv`, [['결제시각', '주문번호', '상품', '구매자', '지난시간']].concat(d.delayed.map(o => [fmtTime(o.time), o.id, o.product + (o.more > 0 ? ` 외 ${o.more}건` : ''), o.buyer, hrs(o.hours)])));
    toast('내려받기를 시작했습니다.');
  };
}

export function downloadCsv(name, rows) {
  const text = '﻿' + rows.map(r => r.map(x => '"' + String(x ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
