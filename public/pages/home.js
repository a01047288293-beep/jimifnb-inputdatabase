import { api, esc, won, pctf, roasf, nf, barLineChart, srcTag, setBadge, errBox, PLAT } from '../app.js';

export async function render(main) {
  const d = await api('/api/home');
  setBadge('cs', d.unansweredCs);
  const today = d.series[d.series.length - 1] || {};
  const yest = d.series[d.series.length - 2] || {};
  const diff = (a, b) => b ? `어제 ${won(b)}` : '어제 없음';
  const m = d.modes;
  const tone = v => v == null ? '' : v >= 0 ? 'good' : 'bad';
  const week = d.series.slice(-7);
  const sum = k => week.reduce((s, x) => s + (x[k] || 0), 0);
  const hasProfit = week.some(x => x.profit != null);
  const wkRev = sum('revenue'), wkAd = sum('adSpend'), wkAdRev = sum('adRevenue'), wkProfit = sum('profit');
  const cov = sum('revenue') > 0 ? sum('mappedRevenue') / sum('revenue') : null;

  main.innerHTML = `
  <div class="page-head"><h1>오늘 한눈에</h1>
    <span class="hint">${esc(d.today)} · 쇼핑몰 ${srcTag(m.cafe24)} · 광고 ${['meta', 'google', 'tiktok'].map(p => PLAT[p] + ' ' + srcTag(m[p])).join(' ')}</span></div>
  ${d.errors.length ? `<div class="err" style="margin-bottom:12px">일부 데이터를 불러오지 못했습니다.<ul>${d.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
  ${m.cafe24 === 'demo' ? `<div class="notice" style="margin-bottom:12px">지금 보이는 숫자는 <b>데모 데이터</b>입니다. <a href="#/settings">설정·연동</a>에서 카페24와 광고 매체를 연결하면 실제 숫자로 바뀝니다.</div>` : ''}
  <div class="stack">
    <div class="kpis">
      <div class="kpi"><span class="l">오늘 매출</span><span class="v">${won(today.revenue)}</span><span class="s">${diff(today.revenue, yest.revenue)} · 주문 ${nf(today.orders)}건</span></div>
      <a class="kpi ${d.pendingShip ? 'alert' : ''}" href="#/orders?group=ready"><span class="l">출고 대기</span><span class="v">${nf(d.pendingShip)}건</span><span class="s">상품준비·배송준비 상태 (최근 7일)</span></a>
      <a class="kpi ${d.unansweredCs ? 'alert' : ''}" href="#/cs"><span class="l">답변 안 한 문의</span><span class="v">${nf(d.unansweredCs)}건</span><span class="s">최근 30일</span></a>
      <div class="kpi"><span class="l">오늘 광고비</span><span class="v">${won(today.adSpend)}</span><span class="s">ROAS ${roasf(today.roas)}</span></div>
      <div class="kpi ${tone(today.profit)}"><span class="l">오늘 추정 이익</span><span class="v">${today.profit == null ? '–' : won(today.profit)}</span><span class="s">${today.profit == null ? '제품 원가 연결 필요' : `원가 연결 매출 ${pctf(today.coverage, 0)} 기준`}</span></div>
    </div>

    <section class="box">
      <div class="box-h"><h2>최근 14일 매출·광고비·추정 이익</h2><span class="hint">7일 합계: 매출 ${won(wkRev)} · 광고비 ${won(wkAd)} · 광고 ROAS ${roasf(wkAd ? wkAdRev / wkAd : null)} · 추정 이익 ${hasProfit ? won(wkProfit) : '원가 연결 필요'}</span></div>
      ${barLineChart(d.series, { bars: [{ key: 'revenue', label: '매출', color: 'var(--c1)' }, { key: 'adSpend', label: '광고비', color: 'var(--c3)' }], line: { key: 'profit', label: '추정 이익 (원가 연결분 − 광고비 배분)', color: 'var(--c4)' } })}
      ${cov != null && cov < 0.95 ? `<div class="notice">최근 7일 매출 중 원가가 연결된 비율은 ${pctf(cov, 0)}입니다. <a href="#/sales">매출·이익</a>에서 원가 없는 상품을 제품에 연결하면 이익 계산이 정확해집니다.</div>` : ''}
      ${d.productsCount === 0 ? `<div class="notice info">등록된 제품 원가가 없습니다. <a href="#/products">제품·마진</a>에서 제품을 만들고 카페24 상품과 연결하세요.</div>` : ''}
    </section>

    <div class="cols">
      <section class="box"><div class="box-h"><h2>최근 변경</h2><a class="hint" href="#/log">전체 보기</a></div>
        ${d.logs.length ? `<div class="tbl-wrap"><table><tbody>${d.logs.map(l => `<tr><td class="hint">${esc(fmtTime(l.at))}</td><td>${esc(l.kind)}</td><td>${esc(l.target)}</td><td class="hint">${esc(l.who)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">아직 기록이 없습니다.</div>'}
      </section>
      <section class="box"><div class="box-h"><h2>자동 수집</h2><a class="hint" href="#/settings">설정</a></div>
        ${d.sync ? `<div>마지막 실행 ${esc(fmtTime(d.sync.at))} · ${d.sync.errors.length ? `<span class="pill bad">오류 ${d.sync.errors.length}건</span>` : '<span class="pill good">정상</span>'}</div>
        <ul style="margin:0;padding-left:18px">${d.sync.steps.map(s => `<li>${esc(s.name)}: ${s.ok ? esc(s.note) : `<span style="color:var(--bad)">${esc(s.note)}</span>`}</li>`).join('')}</ul>` : '<div class="hint">배포 후 15분마다 자동으로 주문·광고를 수집하고 자동 규칙을 실행합니다. 아직 실행 기록이 없습니다.</div>'}
      </section>
    </div>
  </div>`;
}
export function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(Date.parse(iso) + 9 * 3600000).toISOString();
  return `${d.slice(5, 10).replace('-', '/')} ${d.slice(11, 16)}`;
}
void errBox;
