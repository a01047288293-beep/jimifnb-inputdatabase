import { api, esc, won, nf, roasf, pctf, platTag, srcTag, toast, modal, confirmBox, kstToday, addDays, go, PLAT } from '../app.js';

const RANGES = [{ id: 'today', label: '오늘', f: 0, t: 0 }, { id: 'yday', label: '어제', f: 1, t: 1 }, { id: '7d', label: '7일', f: 6, t: 0 }, { id: '30d', label: '30일', f: 29, t: 0 }];
const VERDICT = { good: ['good', '여유'], warn: ['warn', '손익분기 근접'], bad: ['bad', '손익분기 미달'] };

export async function render(main, { query }) {
  const today = kstToday();
  const rid = query.get('r') || '7d';
  const plat = query.get('p') || 'all';
  const R = RANGES.find(x => x.id === rid) || RANGES[2];
  const from = addDays(today, -R.f), to = addDays(today, -R.t);
  const d = await api(`/api/ads?from=${from}&to=${to}`);
  const list = d.campaigns.filter(c => plat === 'all' || c.platform === plat);
  const sum = k => list.reduce((s, c) => s + (c[k] || 0), 0);
  const spend = sum('spend'), rev = sum('revenue'), buys = sum('purchases');
  const bad = list.filter(c => c.verdict === 'bad' && c.status === 'on').length;
  const unlinked = list.filter(c => !c.productId && c.spend > 0).length;

  main.innerHTML = `
  <div class="page-head"><h1>광고 관리 <a class="btn small" href="#/adanalysis" style="margin-left:8px">광고 분석 보기 →</a></h1><span class="hint">${Object.entries(d.modes).map(([p, m]) => PLAT[p] + ' ' + srcTag(m)).join(' ')}</span></div>
  <div class="stack">
    <div class="toolbar">
      <div class="seg" id="a-range">${RANGES.map(x => `<button data-r="${x.id}" aria-pressed="${x.id === R.id}">${x.label}</button>`).join('')}</div>
      <div class="seg" id="a-plat"><button data-p="all" aria-pressed="${plat === 'all'}">전체</button>${Object.keys(PLAT).map(p => `<button data-p="${p}" aria-pressed="${plat === p}">${PLAT[p]}</button>`).join('')}</div>
      <span class="hint">${from === to ? from : from + ' ~ ' + to}</span>
    </div>
    ${d.errors.length ? `<div class="err">불러오지 못한 매체가 있습니다.<ul>${d.errors.map(e => `<li>${esc(PLAT[e.platform])}: ${esc(e.message)}</li>`).join('')}</ul></div>` : ''}
    <div class="kpis">
      <div class="kpi"><span class="l">광고비</span><span class="v">${won(spend)}</span><span class="s">VAT 별도</span></div>
      <div class="kpi"><span class="l">광고 매출</span><span class="v">${won(rev)}</span><span class="s">구매 ${nf(buys)}건 · 구매당 ${won(buys ? spend / buys : null)}</span></div>
      <div class="kpi"><span class="l">ROAS</span><span class="v">${roasf(spend ? rev / spend : null)}</span><span class="s">매체 보고 기준</span></div>
      <div class="kpi ${bad ? 'alert' : ''}"><span class="l">손익분기 미달 (켜짐)</span><span class="v">${nf(bad)}개</span><span class="s">${unlinked ? `제품 미연결 ${unlinked}개는 판정 불가` : '모든 캠페인 판정 가능'}</span></div>
    </div>
    <section class="box">
      <div class="box-h"><h2>캠페인 ${list.length}개</h2><span class="hint">손익분기 ROAS는 연결한 제품의 원가로 계산합니다</span></div>
      ${list.length ? `<div class="tbl-wrap"><table><thead><tr><th>켜짐</th><th>매체</th><th>캠페인</th><th class="n">일 예산</th><th class="n">광고비</th><th class="n">구매</th><th class="n">광고 매출</th><th class="n">ROAS</th><th>연결 제품 · 손익분기</th><th>판정</th></tr></thead><tbody>
      ${list.map(c => `<tr>
        <td><label class="switch" title="${c.status === 'on' ? '켜짐' : '꺼짐'}"><input type="checkbox" data-toggle="${esc(c.key)}" ${c.status === 'on' ? 'checked' : ''} ${c.status === 'other' ? 'disabled' : ''} aria-label="${esc(c.name)} 켜기/끄기"><span></span></label></td>
        <td>${platTag(c.platform)}</td><td>${esc(c.name)}</td>
        <td class="n">${c.dailyBudget == null ? '<span class="hint">세트 예산</span>' : `<button class="btn small" data-budget="${esc(c.key)}">${won(c.dailyBudget)}</button>`}</td>
        <td class="n">${won(c.spend)}</td><td class="n">${nf(c.purchases)}</td><td class="n">${won(c.revenue)}</td><td class="n">${roasf(c.roas)}</td>
        <td><select data-link="${esc(c.key)}" aria-label="연결 제품"><option value="">제품 연결 안 함</option>${d.products.map(p => `<option value="${esc(p.id)}" ${p.id === c.productId ? 'selected' : ''}>${esc(p.name)} (${p.beRoas ? p.beRoas.toFixed(2) + '배' : '불가'})</option>`).join('')}</select></td>
        <td>${c.verdict ? `<span class="pill ${VERDICT[c.verdict][0]}">${VERDICT[c.verdict][1]}</span>` : '<span class="pill none">판정 불가</span>'}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">캠페인이 없습니다. 설정·연동에서 광고 매체를 연결하세요.</div>'}
      <div class="hint">판정: ROAS가 손익분기의 1.2배 이상이면 여유, 1~1.2배면 근접, 1배 미만이면 미달. 매체 전환 집계 기준(기여 기간)에 따라 실제 주문과 차이가 날 수 있습니다.</div>
    </section>
  </div>`;

  const reload = patch => { const n = { r: R.id, p: plat, ...patch }; go(`#/ads?r=${n.r}&p=${n.p}`); };
  main.querySelectorAll('#a-range button').forEach(b => b.onclick = () => reload({ r: b.dataset.r }));
  main.querySelectorAll('#a-plat button').forEach(b => b.onclick = () => reload({ p: b.dataset.p }));
  const byKey = k => d.campaigns.find(c => c.key === k);

  main.querySelectorAll('[data-toggle]').forEach(el => el.onchange = async () => {
    const c = byKey(el.dataset.toggle); const on = el.checked;
    el.checked = !on; // 확인 전까지 원래대로
    if (!(await confirmBox(`${PLAT[c.platform]} "${c.name}" 캠페인을 ${on ? '켤까요' : '끌까요'}?`, on ? '켜기' : '끄기', !on))) return;
    el.disabled = true;
    try { await api('/api/ads/status', { method: 'POST', body: { platform: c.platform, id: c.id, on } }); el.checked = on; c.status = on ? 'on' : 'off'; toast(on ? '켰습니다.' : '껐습니다.'); }
    catch (e) { toast(e.message, true); }
    el.disabled = false;
  });
  main.querySelectorAll('[data-budget]').forEach(el => el.onclick = () => {
    const c = byKey(el.dataset.budget);
    modal(`<h2>일 예산 변경</h2><p style="margin:0">${platTag(c.platform)} ${esc(c.name)}</p>
      <label class="f">새 일 예산(원)<input type="number" id="b-val" min="0" step="1000" value="${c.dailyBudget}"></label>
      <div class="row">${[-20, -10, 10, 20].map(p => `<button class="btn small" data-pct="${p}">${p > 0 ? '+' : ''}${p}%</button>`).join('')}</div>
      <div class="hint" id="b-diff"></div>
      <div class="foot"><button class="btn" data-close>취소</button><button class="btn primary" id="b-ok">변경</button></div>`, {
      onMount: (m, close) => {
        const inp = m.querySelector('#b-val');
        const diff = () => { const v = Number(inp.value); m.querySelector('#b-diff').textContent = c.dailyBudget ? `현재 ${won(c.dailyBudget)} 대비 ${pctf((v - c.dailyBudget) / c.dailyBudget)}` : ''; };
        inp.oninput = diff; diff();
        m.querySelectorAll('[data-pct]').forEach(b => b.onclick = () => { inp.value = Math.round(c.dailyBudget * (1 + Number(b.dataset.pct) / 100) / 100) * 100; diff(); });
        m.querySelector('#b-ok').onclick = async () => {
          try { await api('/api/ads/budget', { method: 'POST', body: { platform: c.platform, id: c.id, budget: Number(inp.value) } }); close(); toast('예산을 바꿨습니다.'); reload({}); }
          catch (e) { toast(e.message, true); }
        };
      }
    });
  });
  main.querySelectorAll('[data-link]').forEach(el => el.onchange = async () => {
    const c = byKey(el.dataset.link);
    try { await api('/api/ads/link', { method: 'POST', body: { platform: c.platform, id: c.id, productId: el.value || null } }); toast('연결을 저장했습니다.'); reload({}); }
    catch (e) { toast(e.message, true); }
  });
}
