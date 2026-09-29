// AI 참모: 매출·광고 데이터를 보고 의사결정을 돕는 대화 화면
import { api, esc, won, toast, confirmBox, pageHead, PLAT, platTag } from '../app.js';

const SUGGEST = [
  '오늘 기준으로 매출과 광고 상황을 3줄로 브리핑해줘',
  '지금 광고비를 어디서 줄이고 어디에 더 써야 할까?',
  '손익분기에 못 미치는 캠페인 정리해줘',
  '이번 주와 지난주 매출이 달라진 이유가 뭐야?',
  '교체해야 할 광고 소재가 있어?',
  '다음 주 광고 예산을 어떻게 짜면 좋을까?'
];
const TOOL_LABEL = { get_sales_report: '매출 보고서 조회', get_ad_report: '광고 보고서 조회', get_campaign_detail: '캠페인 상세 조회', propose_action: '조치 제안 작성' };

/** 짧은 마크다운(굵게·목록·제목)만 안전하게 표시 */
function md(text) {
  const lines = esc(text).split('\n');
  let html = '', inList = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    const li = line.match(/^\s*(?:[-•*]|\d+\.)\s+(.*)$/);
    if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${li[1]}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) html += `<div class="md-h">${h[1]}</div>`;
    else if (line.trim()) html += `<p>${line}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}

export async function render(main) {
  const d = await api('/api/advisor');
  const st = { messages: d.messages || [], proposals: new Map((d.proposals || []).map(p => [p.id, p])), busy: false, activity: '' };

  if (!d.configured) {
    main.innerHTML = `${pageHead('AI 참모', '매출과 광고비 의사결정을 돕는 대화형 참모')}
    <section class="box" style="max-width:720px"><h2>연결이 필요합니다</h2>
      <p>AI 참모는 Anthropic(Claude) API 키로 동작합니다. 한 번만 등록하면 됩니다.</p>
      <ol class="steps">
        <li><a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a> 가입·로그인 → <b>Billing</b>에서 결제 수단 등록(사용한 만큼 과금)</li>
        <li><b>API Keys → Create Key</b> → 이름 <code>jimi-ops</code> → 키 복사 (채팅에 붙여넣지 마세요)</li>
        <li>Netlify → Environment variables → <code>ANTHROPIC_API_KEY</code> 추가 → Trigger deploy</li>
      </ol>
      <p class="hint">등록하면 CS 답변 초안, 광고 분석의 AI 종합 코멘트도 함께 켜집니다. 고객 이름·연락처 같은 개인정보는 보내지 않고, 합계 숫자만 보냅니다.</p>
    </section>`;
    return;
  }

  main.innerHTML = `${pageHead('AI 참모', '운영실의 실제 매출·광고 숫자를 보고 답합니다. 광고 조치는 제안만 하고, 실행은 버튼으로 직접', '<button class="btn small" id="adv-reset">새 대화</button>')}
  <div class="adv">
    <div class="adv-log" id="adv-log" aria-live="polite"></div>
    <form class="adv-input" id="adv-form">
      <textarea id="adv-q" rows="2" placeholder="예: 이번 주 광고비 어디를 줄일까?" aria-label="질문"></textarea>
      <button class="btn primary" id="adv-send" type="submit">보내기</button>
    </form>
    <div class="hint">Enter로 보내기 · Shift+Enter 줄바꿈 · 숫자는 최대 20분 전 자동 수집 기준입니다.</div>
  </div>`;
  const log = main.querySelector('#adv-log'), q = main.querySelector('#adv-q'), send = main.querySelector('#adv-send');

  const proposalIdsIn = content => {
    if (!Array.isArray(content)) return [];
    const ids = [];
    for (const b of content) if (b.type === 'tool_result') { try { const r = JSON.parse(b.content); if (r?.제안?.id) ids.push(r.제안.id); } catch { /* 무시 */ } }
    return ids;
  };
  const card = p => {
    const what = p.type === 'budget' ? `일 예산 ${won(p.currentBudget)} → <b>${won(p.newBudget)}</b> (${p.newBudget > p.currentBudget ? '+' : ''}${Math.round((p.newBudget / p.currentBudget - 1) * 100)}%)` : p.type === 'pause' ? '<b>캠페인 끄기</b>' : '<b>캠페인 켜기</b>';
    const state = p.state === 'done' ? `<span class="pill good">실행됨</span>` : p.state === 'dismissed' ? '<span class="pill none">무시함</span>' : `<button class="btn primary small" data-run="${esc(p.id)}">실행</button> <button class="btn small" data-dismiss="${esc(p.id)}">무시</button>`;
    return `<div class="adv-card ${p.state}"><div class="adv-card-h">${platTag(p.platform)} <b>${esc(p.name)}</b></div><div>${what}</div><div class="hint">${esc(p.reason)}</div><div class="row">${state}</div></div>`;
  };
  const draw = () => {
    let html = '';
    if (!st.messages.length) {
      html += `<div class="adv-empty"><div class="adv-hello">무엇을 도와드릴까요?</div><div class="hint">최근 30일 매출, 최근 14일 메타·구글 광고, 캠페인·소재·제품 손익을 보고 답합니다.</div>
        <div class="adv-sugs">${SUGGEST.map(s => `<button class="btn small" data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`;
    }
    for (const m of st.messages) {
      if (m.role === 'user') {
        if (typeof m.content === 'string') html += `<div class="msg me">${esc(m.content)}</div>`;
        for (const id of proposalIdsIn(m.content)) { const p = st.proposals.get(id); if (p) html += card(p); }
        continue;
      }
      const blocks = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content || '') }];
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      const tools = blocks.filter(b => b.type === 'tool_use');
      if (text) html += `<div class="msg ai">${md(text)}</div>`;
      if (tools.length) html += `<div class="adv-tools">${tools.map(t => `<span class="pill info">${esc(TOOL_LABEL[t.name] || t.name)}${typeof t.input?.from === 'string' ? ` · ${esc(t.input.from.slice(5))}~${esc(String(t.input.to || '').slice(5))}` : ''}</span>`).join(' ')}</div>`;
    }
    if (st.busy) html += `<div class="msg ai typing"><span class="dots"><i></i><i></i><i></i></span> ${esc(st.activity || '생각하는 중')}</div>`;
    log.innerHTML = html;
    log.scrollTop = log.scrollHeight;
    log.querySelectorAll('[data-sug]').forEach(b => b.onclick = () => ask(b.dataset.sug));
    log.querySelectorAll('[data-run]').forEach(b => b.onclick = () => run(b.dataset.run));
    log.querySelectorAll('[data-dismiss]').forEach(b => b.onclick = () => dismiss(b.dataset.dismiss));
    send.disabled = st.busy; q.disabled = st.busy;
  };

  async function ask(text) {
    text = String(text || '').trim();
    if (!text || st.busy) return;
    st.messages.push({ role: 'user', content: text });
    st.busy = true; st.activity = '생각하는 중'; q.value = ''; draw();
    try {
      for (let i = 0; i < 6; i++) {
        const r = await api('/api/advisor/step', { method: 'POST', body: { messages: st.messages, proposalIds: [...st.proposals.keys()] } });
        st.messages = r.messages;
        for (const p of r.proposals || []) st.proposals.set(p.id, p);
        if (r.done) break;
        st.activity = (r.activity || []).map(a => TOOL_LABEL[a] || a).join(', ') + ' 후 정리하는 중';
        draw();
      }
    } catch (e) {
      toast(e.message, true);
      st.messages.push({ role: 'assistant', content: [{ type: 'text', text: `답변을 만들지 못했습니다: ${e.message}` }] });
    }
    st.busy = false; st.activity = ''; draw(); q.focus();
  }
  async function run(id) {
    const p = st.proposals.get(id); if (!p) return;
    const label = p.type === 'budget' ? `일 예산을 ${won(p.currentBudget)}에서 ${won(p.newBudget)}으로 바꿀까요?` : p.type === 'pause' ? '이 캠페인을 끌까요?' : '이 캠페인을 켤까요?';
    if (!(await confirmBox(`${PLAT[p.platform]} "${p.name}"\n${label}`, '실행', p.type === 'pause'))) return;
    try { const r = await api(`/api/advisor/proposals/${encodeURIComponent(id)}/run`, { method: 'POST' }); st.proposals.set(id, r); toast('실행했습니다. 변경 이력에 기록됐습니다.'); }
    catch (e) { toast(e.message, true); }
    draw();
  }
  async function dismiss(id) {
    try { const r = await api(`/api/advisor/proposals/${encodeURIComponent(id)}/dismiss`, { method: 'POST' }); st.proposals.set(id, r); } catch (e) { toast(e.message, true); }
    draw();
  }

  main.querySelector('#adv-form').onsubmit = e => { e.preventDefault(); ask(q.value); };
  q.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(q.value); } };
  main.querySelector('#adv-reset').onclick = async () => {
    if (st.busy) return;
    await api('/api/advisor/reset', { method: 'POST' }).catch(() => {});
    st.messages = []; st.proposals.clear(); draw(); q.focus();
  };
  draw();
}
