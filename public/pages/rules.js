import { api, esc, toast, confirmBox, modal, PLAT, platTag } from '../app.js';
import { fmtTime } from './home.js';

export async function render(main) {
  const [d, status] = await Promise.all([api('/api/rules'), api('/api/status')]);
  const settings = status.settings;
  const opLabel = { '>=': '이상', '>': '초과', '<=': '이하', '<': '미만', '==': '같음' };
  const winLabel = { today: '오늘', '3d': '최근 3일', '7d': '최근 7일' };
  const describe = r => `${winLabel[r.window]} · ${r.platform === 'all' ? '전체 매체' : PLAT[r.platform]}${r.campaignMatch ? ` · 이름에 "${r.campaignMatch}"` : ''} · ` +
    r.conditions.map(c => `${d.metrics[c.metric]} ${c.value.toLocaleString('ko-KR')} ${opLabel[c.op]}`).join(' 그리고 ') + ` → ${d.actions[r.action.type]}${r.action.pct ? ` ${r.action.pct}%` : ''}`;

  main.innerHTML = `
  <div class="page-head"><h1>자동 규칙</h1>
    <button class="btn" id="run-now">지금 한 번 실행</button><button class="btn primary" id="new-rule">새 규칙</button></div>
  <div class="stack">
    <div class="notice ${settings.rulesDryRun ? 'info' : 'bad'} row" style="justify-content:space-between">
      <span>${settings.rulesDryRun ? '<b>모의 실행 중</b>: 조건에 걸린 캠페인을 기록만 하고 실제로 끄거나 예산을 바꾸지 않습니다. 며칠 기록을 보고 규칙이 맞으면 실제 실행으로 바꾸세요.' : '<b>실제 실행 중</b>: 조건에 걸리면 광고를 실제로 끄고 예산을 바꿉니다.'}
      하루 최대 ${settings.maxActionsPerDay}회 · 예산 한 번에 최대 ${settings.maxBudgetChangePct}% · 최소 일 예산 ${settings.minBudget.toLocaleString('ko-KR')}원</span>
      <button class="btn small" id="toggle-dry">${settings.rulesDryRun ? '실제 실행으로 바꾸기' : '모의 실행으로 되돌리기'}</button></div>
    <section class="box"><div class="box-h"><h2>규칙 ${d.rules.length}개</h2><span class="hint">15분마다 자동 실행</span></div>
      ${d.rules.length ? `<div class="tbl-wrap"><table><thead><tr><th>사용</th><th>규칙</th><th>마지막 실행</th><th></th></tr></thead><tbody>
      ${d.rules.map(r => `<tr><td><label class="switch"><input type="checkbox" data-en="${esc(r.id)}" ${r.enabled ? 'checked' : ''} aria-label="${esc(r.name)} 사용"><span></span></label></td>
        <td><b>${esc(r.name)}</b><div class="hint">${esc(describe(r))}</div></td><td class="hint">${esc(fmtTime(r.lastRun) || '아직 없음')}</td>
        <td class="row" style="flex-wrap:nowrap"><button class="btn small" data-edit="${esc(r.id)}">수정</button><button class="btn small ghost" data-rm="${esc(r.id)}">삭제</button></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">규칙이 없습니다. 아래 추천 규칙으로 시작해 보세요.</div>'}
    </section>
    <section class="box"><h2>추천 규칙</h2>
      <div class="stack" style="gap:8px">${d.templates.map((t, i) => `<div class="row" style="justify-content:space-between;border:1px solid var(--line);border-radius:8px;padding:10px"><div><b>${esc(t.name)}</b><div class="hint">${esc(describe(t))}</div></div><button class="btn small" data-tpl="${i}">이 규칙으로 시작</button></div>`).join('')}</div>
      <div class="hint">"손익분기 대비 ROAS"는 광고 화면에서 캠페인에 제품을 연결해야 계산됩니다. 1.0 = 손익분기와 같음.</div>
    </section>
  </div>`;

  main.querySelector('#new-rule').onclick = () => editor({ name: '', enabled: false, platform: 'all', campaignMatch: '', window: 'today', conditions: [{ metric: 'spend', op: '>=', value: 30000 }], action: { type: 'pause', pct: 0 }, cooldownHours: 12 });
  main.querySelectorAll('[data-tpl]').forEach(b => b.onclick = () => editor({ ...JSON.parse(JSON.stringify(d.templates[+b.dataset.tpl])), enabled: false }));
  main.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editor(JSON.parse(JSON.stringify(d.rules.find(r => r.id === b.dataset.edit)))));
  main.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
    const r = d.rules.find(x => x.id === b.dataset.rm);
    if (!(await confirmBox(`"${r.name}" 규칙을 삭제할까요?`, '삭제', true))) return;
    try { await api('/api/rules/' + encodeURIComponent(r.id), { method: 'DELETE' }); toast('삭제했습니다.'); render(main); } catch (e) { toast(e.message, true); }
  });
  main.querySelectorAll('[data-en]').forEach(el => el.onchange = async () => {
    const r = d.rules.find(x => x.id === el.dataset.en);
    try { await api('/api/rules/' + encodeURIComponent(r.id), { method: 'PUT', body: { ...r, enabled: el.checked } }); r.enabled = el.checked; toast(el.checked ? '규칙을 켰습니다.' : '규칙을 껐습니다.'); }
    catch (e) { el.checked = !el.checked; toast(e.message, true); }
  });
  main.querySelector('#toggle-dry').onclick = async () => {
    const toReal = settings.rulesDryRun;
    if (toReal && !(await confirmBox('실제 실행으로 바꾸면 규칙이 광고를 직접 끄고 예산을 바꿉니다. 바꿀까요?', '실제 실행', true))) return;
    try { await api('/api/settings', { method: 'PUT', body: { rulesDryRun: !toReal } }); render(main); } catch (e) { toast(e.message, true); }
  };
  main.querySelector('#run-now').onclick = async () => {
    const btn = main.querySelector('#run-now'); btn.disabled = true; btn.textContent = '실행 중…';
    try {
      const r = await api('/api/rules/run', { method: 'POST' });
      modal(`<h2>${r.dryRun ? '모의 실행 결과' : '실행 결과'}</h2>
        <p style="margin:0">규칙 ${r.ran}개 확인, 조건에 걸린 캠페인 ${r.actions.length}개${r.dryRun ? ' (기록만 남김)' : ''}</p>
        ${r.actions.length ? `<div class="tbl-wrap"><table><thead><tr><th>규칙</th><th>캠페인</th><th>동작</th><th>사유</th></tr></thead><tbody>${r.actions.map(a => `<tr><td>${esc(a.rule)}</td><td>${platTag(a.platform)} ${esc(a.campaign)}</td><td>${esc(a.action)}${a.error ? `<div style="color:var(--bad)">${esc(a.error)}</div>` : ''}</td><td class="hint">${esc(a.reason)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        ${r.errors.length ? `<div class="err"><ul>${r.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
        <div class="hint">같은 캠페인에는 규칙의 대기 시간이 지나야 다시 실행됩니다.</div>
        <div class="foot"><button class="btn primary" data-close>닫기</button></div>`);
      render(main);
    } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = '지금 한 번 실행'; }
  };

  function editor(rule) {
    const isNew = !rule.id;
    const condRow = (c, i) => `<div class="cond" data-ci="${i}">
      <select data-cf="metric" aria-label="지표">${Object.entries(d.metrics).map(([k, v]) => `<option value="${k}" ${k === c.metric ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
      <select data-cf="op" aria-label="비교">${d.ops.map(o => `<option value="${esc(o)}" ${o === c.op ? 'selected' : ''}>${opLabel[o]}</option>`).join('')}</select>
      <input type="number" step="any" data-cf="value" value="${esc(c.value)}" aria-label="값">
      <button class="btn small ghost" data-crm="${i}" ${rule.conditions.length < 2 ? 'disabled' : ''}>빼기</button></div>`;
    const html = () => `<h2>${isNew ? '새 규칙' : '규칙 수정'}</h2>
      <label class="f">이름<input id="e-name" value="${esc(rule.name)}" maxlength="80"></label>
      <div class="fields">
        <label class="f">매체<select id="e-plat"><option value="all">전체</option>${Object.keys(PLAT).map(p => `<option value="${p}" ${p === rule.platform ? 'selected' : ''}>${PLAT[p]}</option>`).join('')}</select></label>
        <label class="f">기간<select id="e-win">${d.windows.map(w => `<option value="${w}" ${w === rule.window ? 'selected' : ''}>${winLabel[w]}</option>`).join('')}</select></label>
        <label class="f">캠페인 이름에 포함<input id="e-match" value="${esc(rule.campaignMatch)}" placeholder="비우면 전체"></label>
      </div>
      <h3>조건 (모두 만족할 때)</h3><div class="stack" id="e-conds" style="gap:6px">${rule.conditions.map(condRow).join('')}</div>
      <div><button class="btn small" id="e-cadd">조건 추가</button></div>
      <div class="fields">
        <label class="f">동작<select id="e-act">${Object.entries(d.actions).map(([k, v]) => `<option value="${k}" ${k === rule.action.type ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label class="f">예산 변경 비율(%)<input type="number" id="e-pct" min="0" max="100" value="${esc(rule.action.pct)}"></label>
        <label class="f">같은 캠페인 대기 시간(시간)<input type="number" id="e-cool" min="0" value="${esc(rule.cooldownHours)}"></label>
      </div>
      <label class="row"><input type="checkbox" id="e-en" ${rule.enabled ? 'checked' : ''}> 저장하면 바로 사용</label>
      <div id="e-prev"></div>
      <div class="foot"><button class="btn" id="e-preview">지금 걸리는 캠페인 보기</button><button class="btn" data-close>취소</button><button class="btn primary" id="e-save">저장</button></div>`;
    modal('<div id="ed"></div>', {
      onMount: (m, close) => {
        const box = m.querySelector('#ed');
        const read = () => {
          rule.name = box.querySelector('#e-name').value; rule.platform = box.querySelector('#e-plat').value; rule.window = box.querySelector('#e-win').value;
          rule.campaignMatch = box.querySelector('#e-match').value; rule.enabled = box.querySelector('#e-en').checked;
          rule.action = { type: box.querySelector('#e-act').value, pct: Number(box.querySelector('#e-pct').value) || 0 };
          rule.cooldownHours = Number(box.querySelector('#e-cool').value) || 0;
          rule.conditions = [...box.querySelectorAll('.cond')].map(el => ({ metric: el.querySelector('[data-cf="metric"]').value, op: el.querySelector('[data-cf="op"]').value, value: Number(el.querySelector('[data-cf="value"]').value) }));
        };
        const paint = () => {
          box.innerHTML = html();
          box.querySelector('#e-cadd').onclick = () => { read(); rule.conditions.push({ metric: 'roas', op: '<', value: 2 }); paint(); };
          box.querySelectorAll('[data-crm]').forEach(b => b.onclick = () => { read(); rule.conditions.splice(+b.dataset.crm, 1); paint(); });
          box.querySelector('#e-preview').onclick = async () => {
            read(); const pv = box.querySelector('#e-prev'); pv.innerHTML = '<div class="hint">확인 중…</div>';
            try {
              const r = await api('/api/rules/preview', { method: 'POST', body: rule });
              const hit = r.matches.filter(x => !x.skipped), skip = r.matches.filter(x => x.skipped);
              pv.innerHTML = `<div class="notice info">지금 조건에 걸리는 캠페인 ${hit.length}개${hit.length ? `<ul style="margin:4px 0 0;padding-left:18px">${hit.map(x => `<li>${esc(PLAT[x.platform])} ${esc(x.name)} <span class="hint">${esc(x.reason)}</span></li>`).join('')}</ul>` : ''}${skip.length ? `<div class="hint">판정 불가 ${skip.length}개: 제품이 연결되지 않은 캠페인</div>` : ''}</div>`;
            } catch (e) { pv.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
          };
          box.querySelector('#e-save').onclick = async () => {
            read();
            try {
              await api(isNew ? '/api/rules' : '/api/rules/' + encodeURIComponent(rule.id), { method: isNew ? 'POST' : 'PUT', body: rule });
              close(); toast('규칙을 저장했습니다.'); render(main);
            } catch (e) { box.querySelector('#e-prev').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
          };
        };
        paint();
      }
    });
  }
}
