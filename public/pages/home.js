import { api, esc, won, pctf, roasf, nf, srcTag, setBadge, PLAT, pageHead, shopLink } from '../app.js';
import { lineChart, delta, spark, man } from '../charts.js';

export async function render(main) {
  const d = await api('/api/home');
  setBadge('cs', d.unansweredCs); setBadge('stock', d.stockAlerts); setBadge('late', d.delayed);
  const t = d.series[d.series.length - 1] || {};
  const m = d.modes;
  const week = d.series.slice(-7), prevWeek = d.series.slice(0, 7);
  const sum = (arr, k) => arr.reduce((s, x) => s + (x[k] || 0), 0);
  const hasProfit = week.some(x => x.profit != null);
  const sparkOf = k => spark(d.series.map(x => x[k]), { color: 'var(--s1)' });
  const alerts = [
    { n: d.delayed, label: `출고 지연 (${d.slaHours}시간 초과)`, href: '#/fulfillment' },
    { n: d.pendingShip, label: '출고 대기 주문', href: '#/orders?group=ready' },
    { n: d.unansweredCs, label: '답변 필요한 문의', href: '#/cs' },
    { n: d.stockAlerts, label: '재고 확인 필요', href: '#/stock' },
    { n: d.badAds, label: '손익분기 미달 광고', href: '#/ads' }
  ];

  main.innerHTML = `
  ${pageHead('오늘 한눈에', `${esc(d.today)} · 쇼핑몰 ${srcTag(m.cafe24)} · 광고 ${['meta', 'google', 'tiktok'].map(p => PLAT[p] + ' ' + srcTag(m[p])).join(' ')}`)}
  ${d.errors.length ? `<div class="err" style="margin-bottom:14px">일부 데이터를 불러오지 못했습니다.<ul>${d.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
  ${m.cafe24 === 'demo' ? `<div class="notice" style="margin-bottom:14px">지금 보이는 숫자는 <b>데모 데이터</b>입니다. <a href="#/settings">설정·연동</a>에서 연결하면 실제 숫자로 바뀝니다.</div>` : ''}
  <div class="stack">
    <div class="alert-strip">${alerts.map(a => `<a href="${a.href}" class="${a.n ? 'on' : 'ok'}"><span class="n">${nf(a.n)}</span><span>${esc(a.label)}</span></a>`).join('')}</div>
    <div class="kpis">
      <div class="kpi"><span class="l">오늘 매출</span><span class="v">${won(t.revenue)}</span><span class="s">${delta(t.revenue, d.ySame.revenue, { label: '어제 같은 시각' })}</span>${sparkOf('revenue')}</div>
      <div class="kpi"><span class="l">오늘 주문</span><span class="v">${nf(t.orders)}건</span><span class="s">${delta(t.orders, d.ySame.orders, { label: '어제 같은 시각' })} · 객단가 ${won(t.orders ? t.revenue / t.orders : null)}</span>${sparkOf('orders')}</div>
      <div class="kpi"><span class="l">${esc(d.monthLabel)} 누적 매출</span><span class="v">${won(d.mtd.revenue)}</span><span class="s">${delta(d.mtd.revenue, d.prevMtd.revenue, { label: '지난달 같은 기간' })}</span></div>
      <div class="kpi"><span class="l">오늘 광고비</span><span class="v">${won(t.adSpend)}</span><span class="s">ROAS ${roasf(t.roas)}</span>${spark(d.series.map(x => x.adSpend), { color: 'var(--s2)' })}</div>
      <div class="kpi ${t.profit == null ? '' : t.profit >= 0 ? 'good' : 'bad'}"><span class="l">오늘 추정 이익</span><span class="v">${t.profit == null ? '–' : won(t.profit)}</span><span class="s">${t.profit == null ? '제품 원가 연결 필요' : `원가 연결 매출 ${pctf(t.coverage, 0)} 기준`}</span></div>
    </div>

    <div class="split">
      <section class="box">
        <div class="box-h"><h2>최근 14일</h2><span class="hint">7일 매출 ${won(sum(week, 'revenue'))} ${delta(sum(week, 'revenue'), sum(prevWeek, 'revenue'), { label: '전주 대비' })}</span></div>
        ${lineChart(d.series, { series: [
          { key: 'revenue', label: '매출', color: 'var(--s1)', area: true },
          { key: 'adSpend', label: '광고비', color: 'var(--s2)' },
          ...(hasProfit ? [{ key: 'profit', label: '추정 이익', color: 'var(--s3)' }] : [])
        ], width: 700, height: 280 })}
        ${d.productsCount === 0 ? `<div class="notice info">제품 원가가 없어 이익은 표시하지 않았습니다. <a href="#/products">제품·마진</a>에서 원가를 넣고 카페24 상품과 연결하세요.</div>` : ''}
      </section>
      <section class="box">
        <div class="box-h"><h2>이번 주 많이 팔린 상품</h2><a class="hint" href="#/stock">전체</a></div>
        ${d.topProducts.length ? d.topProducts.map((p, i) => `<div class="stat-line"><span><span class="muted">${i + 1}</span>&nbsp; ${shopLink(p.productNo, p.name)}<div class="hint">${nf(p.qty)}개 · ${won(p.revenue)}</div></span>${spark(p.spark, { w: 80, h: 24 })}</div>`).join('') : '<div class="empty">이번 주 판매가 없습니다.</div>'}
      </section>
    </div>

    <div class="cols">
      <section class="box"><div class="box-h"><h2>최근 변경</h2><a class="hint" href="#/log">전체 보기</a></div>
        ${d.logs.length ? `<div class="tbl-wrap"><table><tbody>${d.logs.map(l => `<tr><td class="hint" style="white-space:nowrap">${esc(fmtTime(l.at))}</td><td>${esc(l.kind)}</td><td>${esc(l.target)}</td><td class="hint">${esc(l.who)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">아직 기록이 없습니다.</div>'}
      </section>
      <section class="box"><div class="box-h"><h2>자동 수집</h2><a class="hint" href="#/settings">설정</a></div>
        ${d.sync ? `<div>마지막 실행 ${esc(fmtTime(d.sync.at))} · ${d.sync.errors.length ? `<span class="pill bad">오류 ${d.sync.errors.length}건</span>` : '<span class="pill good">정상</span>'}</div>
        ${d.sync.steps.map(s => `<div class="stat-line"><span>${esc(s.name)}</span><b style="${s.ok ? '' : 'color:var(--bad)'}">${esc(s.note)}</b></div>`).join('')}` : '<div class="hint">15분마다 주문·광고를 수집하고 자동 규칙을 실행합니다. 아직 실행 기록이 없습니다.</div>'}
      </section>
    </div>
  </div>`;
  void man;
}
export function fmtTime(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return String(iso).slice(0, 16);
  const d = new Date(t + 9 * 3600000).toISOString();
  return `${d.slice(5, 10).replace('-', '/')} ${d.slice(11, 16)}`;
}
