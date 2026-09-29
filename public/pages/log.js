import { api, esc } from '../app.js';
import { fmtTime } from './home.js';

export async function render(main) {
  const list = await api('/api/log?limit=500');
  let kind = 'all';
  const kinds = [...new Set(list.map(l => l.kind))];
  const draw = () => {
    const rows = list.filter(l => kind === 'all' || l.kind === kind);
    main.innerHTML = `
    <div class="page-head"><h1>변경 이력</h1><span class="hint">누가, 언제, 무엇을 바꿨는지 (최근 3개월, 최대 500건)</span></div>
    <div class="stack">
      <div class="toolbar"><label class="f" style="flex-direction:row;align-items:center;gap:8px">종류<select id="lg-kind"><option value="all">전체</option>${kinds.map(k => `<option ${k === kind ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label></div>
      <section class="box">${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>시각</th><th>누가</th><th>종류</th><th>대상</th><th>내용</th></tr></thead><tbody>
        ${rows.map(l => `<tr><td class="hint" style="white-space:nowrap">${esc(fmtTime(l.at))}</td><td>${esc(l.who)}</td><td><span class="pill ${/끄기|삭제/.test(l.kind) ? 'bad' : /모의|알림/.test(l.kind) ? 'none' : 'info'}">${esc(l.kind)}</span></td><td>${esc(l.target)}</td><td class="hint">${esc(l.detail)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">기록이 없습니다.</div>'}</section>
    </div>`;
    main.querySelector('#lg-kind').onchange = e => { kind = e.target.value; draw(); };
  };
  draw();
}
