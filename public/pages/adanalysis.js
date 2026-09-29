// 광고 분석: 개요(일별 추이·매체 비교) · 캠페인 · 소재 · 제품별 손익 · 퍼널, 광고별 코멘트
import { api, esc, won, nf, pctf, roasf, platTag, srcTag, toast, pageHead, readPeriod, periodBar, bindPeriod, PLAT, go, setBadge } from '../app.js';
import { lineChart, columnChart, delta, spark } from '../charts.js';
import { fmtTime } from './home.js';

const TABS = [['overview', '개요'], ['campaigns', '캠페인'], ['creatives', '소재'], ['products', '제품별 손익'], ['funnel', '퍼널']];
const PCOLOR = { meta: 'var(--s1)', google: 'var(--s2)', tiktok: 'var(--s3)' };
const LV = { bad: ['bad', '문제'], warn: ['warn', '주의'], good: ['good', '좋음'], info: ['info', '참고'] };
const ACTION = { pause: '끄기 검토', down: '예산 축소 검토', up: '증액 검토' };
const ratio = x => (x == null || !isFinite(x) ? '–' : x.toFixed(1) + '배');
const pct2 = x => pctf(x, 2);

function commentList(list, { max = 4, compact = false } = {}) {
  if (!list || !list.length) return compact ? '<span class="hint">특이사항 없음</span>' : '';
  return `<ul class="cmts${compact ? ' compact' : ''}">${list.slice(0, max).map(c => `<li class="${c.level}"><span class="pill ${LV[c.level][0]}">${LV[c.level][1]}</span><span>${esc(c.text)}${c.action ? ` <b class="act">${ACTION[c.action]}</b>` : ''}</span></li>`).join('')}${list.length > max ? `<li class="more hint">외 ${list.length - max}개</li>` : ''}</ul>`;
}
const worst = list => (list && list[0] ? list[0].level : null);

export async function render(main, { query }) {
  const st = readPeriod(query, 14);
  const tab = TABS.some(t => t[0] === query.get('t')) ? query.get('t') : 'overview';
  const d = await api(`/api/ads/analysis?from=${st.from}&to=${st.to}`);
  const T = d.ov.total, P = d.ov.prev;
  setBadge('adbad', d.camps.filter(c => c.status === 'on' && worst(c.comments) === 'bad').length);
  const anyMode = Object.values(d.modes).find(m => m !== 'off') || 'off';

  main.innerHTML = `
  ${pageHead('광고 분석', `${esc(d.from)} ~ ${esc(d.to)} · 이전 기간 ${esc(d.prevFrom)} ~ ${esc(d.prevTo)} · ${d.platforms.map(p => PLAT[p] + ' ' + srcTag(d.modes[p])).join(' ')}`, '<a class="btn small" href="#/ads">광고 관리 (켜기·예산) →</a>')}
  <div class="stack">
    ${periodBar(st, [7, 14, 30, 90], 92)}
    ${d.errors.length ? `<div class="err">불러오지 못한 데이터가 있습니다.<ul>${d.errors.map(e => `<li>${esc(PLAT[e.platform] || (e.platform === 'cafe24' ? '카페24' : e.platform))}: ${esc(e.message)}</li>`).join('')}</ul></div>` : ''}
    ${anyMode === 'off' ? '<div class="notice">연결된 광고 매체가 없습니다. <a href="#/settings">설정·연동</a>에서 메타·구글을 연결하세요.</div>' : ''}
    <div class="kpis">
      <div class="kpi"><span class="l">광고비</span><span class="v">${won(T.spend)}</span><span class="s">${delta(T.spend, P.spend, { label: '이전 기간', invert: true })}</span></div>
      <div class="kpi"><span class="l">광고 매출 · ROAS</span><span class="v">${roasf(T.roas)}</span><span class="s">${won(T.revenue)} · ${delta(T.roas, P.roas, { label: '이전' })}</span></div>
      <div class="kpi"><span class="l">구매당 광고비 (CPA)</span><span class="v">${won(T.cpa)}</span><span class="s">구매 ${nf(Math.round(T.purchases))}건 · ${delta(T.cpa, P.cpa, { label: '이전', invert: true })}</span></div>
      <div class="kpi"><span class="l">자사몰 매출 ÷ 광고비</span><span class="v">${ratio(d.ov.mer)}</span><span class="s">광고비 비중 ${pctf(d.ov.spendRate)} · 자사몰 ${won(d.ov.shop)}</span></div>
    </div>

    <section class="box">
      <div class="box-h"><h2>이번 기간 요약 코멘트</h2>${d.ai ? `<button class="btn small" id="ai-go">${d.aiComment ? 'AI 코멘트 다시 쓰기' : 'AI 종합 코멘트 받기'}</button>` : '<span class="hint">AI 종합 코멘트는 ANTHROPIC_API_KEY 등록 시 사용</span>'}</div>
      ${commentList(d.headline, { max: 8 }) || '<div class="empty">표시할 코멘트가 없습니다.</div>'}
      <div id="ai-box">${d.aiComment ? aiHtml(d.aiComment) : ''}</div>
    </section>

    <div class="seg" id="ad-tabs" style="align-self:flex-start">${TABS.map(([id, l]) => `<button data-t="${id}" aria-pressed="${id === tab}">${l}${badgeFor(id, d)}</button>`).join('')}</div>
    <div id="tab-body">${TAB_RENDER[tab](d, query.get('s'))}</div>
  </div>`;

  bindPeriod(main, 'adanalysis', st, `&t=${tab}`);
  main.querySelectorAll('#ad-tabs button').forEach(b => b.onclick = () => go(`#/adanalysis?from=${st.from}&to=${st.to}&t=${b.dataset.t}`));
  const ai = main.querySelector('#ai-go');
  if (ai) ai.onclick = async () => {
    ai.disabled = true; ai.textContent = 'AI가 쓰는 중…';
    try { const r = await api('/api/ads/ai-comment', { method: 'POST', body: { from: d.from, to: d.to } }); main.querySelector('#ai-box').innerHTML = aiHtml(r); ai.textContent = 'AI 코멘트 다시 쓰기'; }
    catch (e) { toast(e.message, true); ai.textContent = 'AI 종합 코멘트 받기'; }
    ai.disabled = false;
  };
  main.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => go(`#/adanalysis?from=${st.from}&to=${st.to}&t=${tab}&s=${b.dataset.sort}`));
}

function badgeFor(id, d) {
  const n = id === 'campaigns' ? d.camps.filter(c => worst(c.comments) === 'bad').length
    : id === 'creatives' ? d.creatives.list.filter(c => worst(c.comments) === 'bad').length
      : id === 'products' ? d.pl.list.filter(p => p.profit != null && p.profit < 0).length : 0;
  return n ? ` <span class="pill bad" style="margin-left:4px">${n}</span>` : '';
}
function aiHtml(a) {
  const lines = String(a.text).split('\n').map(l => l.trim()).filter(Boolean);
  return `<div class="ai-note"><div class="hint">AI 종합 코멘트 · ${esc(fmtTime(new Date(a.at).toISOString()))}${a.by ? ' · ' + esc(a.by) + ' 요청' : ''}</div>${lines.map(l => /^[-•]/.test(l) ? `<div class="li">${esc(l.replace(/^[-•]\s*/, ''))}</div>` : `<div class="h">${esc(l.replace(/^#+\s*/, '').replace(/\*\*/g, ''))}</div>`).join('')}</div>`;
}

const TAB_RENDER = {
  overview(d) {
    const ov = d.ov;
    const pl = ov.byPlatform;
    const series = d.platforms.filter(p => pl.some(x => x.platform === p)).map(p => ({ key: 'spend_' + p, label: PLAT[p] + ' 광고비', color: PCOLOR[p] }));
    const WD = ['일', '월', '화', '수', '목', '금', '토'];
    return `<div class="stack">
    <section class="box"><div class="box-h"><h2>일별 광고비</h2><span class="hint">매체별</span></div>
      ${lineChart(ov.daily, { series, width: 1000, height: 260 })}
    </section>
    <div class="cols">
      <section class="box"><div class="box-h"><h2>일별 효율</h2><span class="hint">ROAS = 매체 보고 광고 매출 ÷ 광고비 · 자사몰 배수 = 자사몰 전체 매출 ÷ 광고비</span></div>
        ${lineChart(ov.daily, { series: [{ key: 'roas', label: 'ROAS', color: 'var(--s1)' }, { key: 'mer', label: '자사몰 매출 ÷ 광고비', color: 'var(--s3)' }], fmt: ratio, width: 560, height: 240 })}
      </section>
      <section class="box"><div class="box-h"><h2>요일별 ROAS</h2><span class="hint">기간 합계 기준</span></div>
        ${columnChart([1, 2, 3, 4, 5, 6, 0].map(i => ov.weekday[i]), { key: 'roas', label: 'ROAS', fmt: ratio, xLabel: w => WD[w.dow], width: 560, height: 240, tip: w => `${WD[w.dow]}요일\nROAS ${ratio(w.roas)}\n광고비 ${won(w.spend)} · 광고 매출 ${won(w.revenue)}` })}
      </section>
    </div>
    <section class="box"><div class="box-h"><h2>매체 비교</h2><span class="hint">괄호는 이전 기간 대비</span></div>
      ${pl.length ? `<div class="tbl-wrap"><table><thead><tr><th>매체</th><th class="n">광고비</th><th class="n">비중</th><th class="n">노출</th><th class="n">클릭률</th><th class="n">클릭당</th><th class="n">1,000회 노출당</th><th class="n">구매</th><th class="n">구매율</th><th class="n">구매당</th><th class="n">광고 매출</th><th class="n">ROAS</th></tr></thead><tbody>
      ${pl.map(p => `<tr><td>${platTag(p.platform)}</td><td class="n">${won(p.spend)}<div class="hint">${delta(p.spend, p.prev.spend, { invert: true })}</div></td><td class="n">${pctf(p.share, 0)}</td><td class="n">${nf(p.impressions)}</td>
        <td class="n">${pct2(p.ctr)}</td><td class="n">${won(p.cpc)}</td><td class="n">${won(p.cpm)}</td><td class="n">${nf(Math.round(p.purchases))}</td><td class="n">${pct2(p.cvr)}</td>
        <td class="n">${won(p.cpa)}<div class="hint">${delta(p.cpa, p.prev.cpa, { invert: true })}</div></td><td class="n">${won(p.revenue)}</td><td class="n"><b>${roasf(p.roas)}</b><div class="hint">${delta(p.roas, p.prev.roas)}</div></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">광고 데이터가 없습니다.</div>'}
      <div class="hint">매체가 보고한 광고 매출은 각 매체의 기여 기간(메타 기본 클릭 후 7일·조회 후 1일 등)으로 잡혀 매체끼리 겹치거나 자사몰 주문보다 많게 나올 수 있습니다. 전체 흐름은 '자사몰 매출 ÷ 광고비'로 함께 보세요.</div>
    </section></div>`;
  },

  campaigns(d) {
    const list = d.camps;
    if (!list.length) return '<div class="empty">캠페인이 없습니다.</div>';
    return `<section class="box"><div class="box-h"><h2>캠페인 ${list.length}개</h2><span class="hint">문제가 큰 순서 · 손익 판정은 광고 관리에서 연결한 제품의 손익분기 ROAS 기준</span></div>
      <div class="stack">${[...list].sort((a, b) => lvRank(a.comments) - lvRank(b.comments) || b.spend - a.spend).map(c => `
        <div class="ad-card ${worst(c.comments) || ''}">
          <div class="ad-card-h">${platTag(c.platform)} <b>${esc(c.name)}</b> <span class="pill ${c.status === 'on' ? 'good' : 'none'}">${c.status === 'on' ? '켜짐' : '꺼짐'}</span>
            ${c.beRoas ? `<span class="hint">손익분기 ${roasf(c.beRoas)} · ${esc(c.productName || '')}</span>` : '<span class="hint">제품 미연결</span>'}</div>
          <div class="ad-metrics">
            ${m('광고비', won(c.spend))}${m('ROAS', roasf(c.roas), c.beRoas && c.roas != null ? (c.roas >= c.beRoas ? 'good' : 'bad') : '')}${m('구매', nf(Math.round(c.purchases)) + '건')}${m('구매당', won(c.cpa))}${m('클릭률', pct2(c.ctr))}${m('구매율', pct2(c.cvr))}
            <div class="mm"><span class="l">일별 ROAS</span>${spark(c.daily.map(x => x.roas), { w: 140, h: 30 })}</div>
          </div>
          ${commentList(c.comments, { compact: true })}
        </div>`).join('')}</div></section>`;
  },

  creatives(d, sortKey) {
    const cr = d.creatives;
    if (!cr.list.length) return '<div class="empty">소재 단위 데이터가 없습니다. 메타·구글을 연결하면 광고(소재)별 성과가 보입니다.</div>';
    const S = { spend: (a, b) => b.spend - a.spend, roas: (a, b) => (b.roas ?? -1) - (a.roas ?? -1), ctr: (a, b) => (b.ctr ?? -1) - (a.ctr ?? -1), issue: (a, b) => lvRank(a.comments) - lvRank(b.comments) || b.spend - a.spend };
    const key = S[sortKey] ? sortKey : 'spend';
    const list = [...cr.list].sort(S[key]);
    const best = new Set(cr.best), low = new Set(cr.worst);
    return `<div class="stack">
    <section class="box"><div class="box-h"><h2>형식별 비교</h2><span class="hint">영상·이미지·검색 문구</span></div>
      <div class="tbl-wrap"><table><thead><tr><th>형식</th><th class="n">소재 수</th><th class="n">광고비</th><th class="n">클릭률</th><th class="n">구매율</th><th class="n">구매당</th><th class="n">ROAS</th></tr></thead><tbody>
      ${cr.formats.map(f => `<tr><td>${esc(f.format)}</td><td class="n">${nf(f.count)}</td><td class="n">${won(f.spend)}</td><td class="n">${pct2(f.ctr)}</td><td class="n">${pct2(f.cvr)}</td><td class="n">${won(f.cpa)}</td><td class="n"><b>${roasf(f.roas)}</b></td></tr>`).join('')}
      </tbody></table></div></section>
    <section class="box"><div class="box-h"><h2>소재 ${list.length}개</h2>
      <div class="seg">${[['spend', '광고비순'], ['roas', 'ROAS순'], ['ctr', '클릭률순'], ['issue', '문제순']].map(([k, l]) => `<button data-sort="${k}" aria-pressed="${k === key}">${l}</button>`).join('')}</div></div>
      <div class="cr-grid">${list.map(c => `
        <div class="cr ${worst(c.comments) || ''}">
          <div class="cr-top">
            ${c.thumb ? `<img src="${esc(c.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<div class="cr-ph">${esc(c.format)}</div>`}
            <div class="cr-name">${platTag(c.platform)} ${best.has(c.key) ? '<span class="pill good">효율 상위</span>' : ''}${low.has(c.key) ? '<span class="pill bad">효율 하위</span>' : ''}${c.status === 'off' ? '<span class="pill none">꺼짐</span>' : ''}
              <b>${esc(c.name)}</b><span class="hint">${esc(c.campaignName || '')}${c.group ? ' · ' + esc(c.group) : ''}</span></div>
          </div>
          <div class="ad-metrics">
            ${m('광고비', won(c.spend))}${m('ROAS', roasf(c.roas), c.beRoas && c.roas != null ? (c.roas >= c.beRoas ? 'good' : 'bad') : '')}${m('구매', nf(Math.round(c.purchases)))}${m('클릭률', pct2(c.ctr))}${c.frequency ? m('빈도', c.frequency.toFixed(1) + '회', c.frequency >= 4 ? 'bad' : '') : ''}
            <div class="mm"><span class="l">일별 클릭률</span>${spark(c.ctrDaily, { w: 120, h: 28, color: 'var(--s1)' })}</div>
          </div>
          ${commentList(c.comments, { compact: true, max: 3 })}
        </div>`).join('')}</div>
      <div class="hint">빈도 = 한 사람이 평균 몇 번 봤는지(메타만). 4회를 넘기거나 기간 후반 클릭률이 25% 이상 떨어지면 교체 신호로 봅니다. 효율 상위·하위는 구매 3건 이상인 소재끼리 비교합니다.</div>
    </section></div>`;
  },

  products(d) {
    const { list, unlinked } = d.pl;
    if (!list.length) return '<div class="empty">등록된 제품이 없습니다. 제품·마진에서 원가를 입력하세요.</div>';
    return `<section class="box"><div class="box-h"><h2>제품별 광고 손익</h2><span class="hint">자사몰 매출의 공헌이익(원가·수수료·포장·택배·부가세 차감)에서 연결된 광고비를 뺀 금액</span></div>
      <div class="tbl-wrap"><table><thead><tr><th>제품</th><th class="n">자사몰 매출</th><th class="n">공헌이익률</th><th class="n">광고비</th><th class="n">광고비 비중</th><th class="n">광고 ROAS</th><th class="n">손익분기</th><th class="n">광고 후 이익</th><th>코멘트</th></tr></thead><tbody>
      ${list.map(p => `<tr><td><b>${esc(p.name)}</b>${p.campaigns.length ? `<div class="hint">${p.campaigns.map(c => PLAT[c.platform] + ' ' + esc(c.name)).join(', ')}</div>` : ''}</td>
        <td class="n">${won(p.shopRevenue)}<div class="hint">${nf(p.units)}개</div></td><td class="n">${pctf(p.margin)}</td><td class="n">${won(p.adSpend)}</td><td class="n">${pctf(p.adRate)}</td>
        <td class="n">${roasf(p.roas)}</td><td class="n">${roasf(p.beRoas)}</td>
        <td class="n"><b class="${p.profit == null ? '' : p.profit < 0 ? 'neg' : 'pos'}">${p.profit == null ? '–' : won(p.profit)}</b></td>
        <td style="min-width:240px">${commentList(p.notes, { compact: true, max: 2 })}</td></tr>`).join('')}
      </tbody></table></div>
      ${unlinked.spend ? `<div class="notice">제품에 연결되지 않은 캠페인 ${nf(unlinked.count)}개의 광고비 ${won(unlinked.spend)}은 위 손익에 빠져 있습니다. <a href="#/ads">광고 관리</a>에서 제품을 연결하세요.</div>` : ''}
      <div class="hint">광고 후 이익은 자사몰 전체 판매(광고로 온 주문 + 자연 주문)의 이익에서 그 제품 광고비를 뺀 값입니다. 원가를 모르는 상품이 섞인 주문이 있으면 '–'로 표시합니다.</div>
    </section>`;
  },

  funnel(d) {
    const F = d.fun.total;
    if (!F.steps.length || !F.steps[0].value) return '<div class="empty">퍼널 데이터가 없습니다.</div>';
    const prevBy = Object.fromEntries((F.prev.steps || []).map(s => [s.key, s]));
    const max = F.steps[0].value;
    const clicks = F.steps.find(s => s.key === 'clicks')?.value || 1;
    const bar = (s, i) => {
      const w = s.key === 'impressions' ? 100 : Math.max(2, s.value / clicks * 100);
      const pv = prevBy[s.key];
      return `<div class="fn-row ${F.weakest && F.weakest.key === s.key ? 'weak' : ''}">
        <span class="fn-l">${esc(s.label)}${s.partial ? '<small>메타만 측정</small>' : ''}</span>
        <span class="fn-tr"><i style="width:${w.toFixed(1)}%" data-tip="${esc(`${s.label}: ${nf(Math.round(s.value))}${s.rate != null ? `\n앞 단계 대비 ${pctf(s.rate)}` : ''}${pv && pv.rate != null ? `\n이전 기간 ${pctf(pv.rate)}` : ''}`)}"></i></span>
        <span class="fn-v">${nf(Math.round(s.value))}</span>
        <span class="fn-r">${i && s.rate != null ? `${pctf(s.rate)} ${pv && pv.rate != null ? delta(s.rate, pv.rate) : ''}` : ''}</span></div>`;
    };
    void max;
    const camps = d.fun.byCampaign;
    return `<div class="stack">
    <section class="box"><div class="box-h"><h2>전체 퍼널</h2><span class="hint">막대 길이는 클릭 대비 · 오른쪽은 앞 단계에서 넘어온 비율과 이전 기간 대비 변화</span></div>
      <div class="fn">${F.steps.map(bar).join('')}</div>
      ${F.weakest ? `<ul class="cmts"><li class="warn"><span class="pill warn">주의</span><span>'${esc(F.weakest.label)}' 단계 전환이 ${pctf(F.weakest.rate)}로 참고 기준(${pctf(F.weakest.bench, 0)})보다 낮습니다. ${WEAK_TIP[F.weakest.key] || ''}</span></li></ul>` : ''}
      <div class="hint">랜딩 도착·상품 조회는 메타 픽셀에서만 잡힙니다. 구글은 장바구니·결제 시작 전환을 구글 애즈에 등록해야 보입니다. 참고 기준은 식품 자사몰에서 흔한 수준으로 잡은 값입니다.</div>
    </section>
    <section class="box"><div class="box-h"><h2>캠페인별 단계 전환</h2><span class="hint">가장 약한 단계에 표시</span></div>
      <div class="tbl-wrap"><table><thead><tr><th>캠페인</th><th class="n">광고비</th><th class="n">클릭률</th><th class="n">클릭→장바구니</th><th class="n">장바구니→결제 시작</th><th class="n">결제 시작→구매</th><th class="n">클릭→구매</th><th>가장 약한 단계</th></tr></thead><tbody>
      ${camps.map(c => `<tr><td>${platTag(c.platform)} ${esc(c.name)}</td><td class="n">${won(c.spend)}</td><td class="n">${pct2(c.ctr)}</td><td class="n">${pctf(c.cartRate)}</td><td class="n">${pctf(c.checkoutRate)}</td><td class="n">${pctf(c.buyRate)}</td><td class="n">${pct2(c.cvr)}</td>
        <td>${c.weakest ? `<span class="pill warn">${esc(c.weakest.label)} ${pctf(c.weakest.rate, 0)}</span>` : '<span class="pill good">양호</span>'}</td></tr>`).join('')}
      </tbody></table></div></section></div>`;
  }
};
const WEAK_TIP = {
  landing: '클릭 후 페이지가 늦게 뜨거나 잘못된 주소로 가는지 확인하세요(모바일 속도, 이벤트 페이지 링크).',
  views: '도착 페이지에서 상품으로 넘어가는 동선을 점검하세요.',
  carts: '상세 페이지 첫 화면(가격·구성·후기)과 광고 내용이 맞는지 점검하세요.',
  checkouts: '장바구니에서 배송비·최소 주문금액·쿠폰 적용을 확인하세요.',
  purchases: '결제 단계 이탈입니다. 간편결제 노출, 회원가입 강요 여부를 확인하세요.'
};
function m(label, value, tone = '') { return `<div class="mm"><span class="l">${label}</span><span class="v ${tone}">${value}</span></div>`; }
function lvRank(list) { return list && list[0] ? { bad: 0, warn: 1, good: 3, info: 2 }[list[0].level] : 4; }
