import { api, esc, srcTag, toast, setBadge, confirmBox } from '../app.js';
import { fmtTime } from './home.js';

export async function render(main, { query }) {
  const d = await api('/api/cs');
  let filter = query.get('f') || 'open';
  let sel = null;
  setBadge('cs', d.articles.filter(a => !a.answered).length);

  const draw = () => {
    const list = d.articles.filter(a => filter === 'all' || !a.answered);
    const cur = d.articles.find(a => a.articleNo === sel) || null;
    main.innerHTML = `
    <div class="page-head"><h1>CS 문의</h1>${srcTag(d.mode)}<span class="hint">최근 30일 · 게시판 문의</span></div>
    <div class="grid2">
      <div class="stack">
        <div class="seg"><button data-f="open" aria-pressed="${filter === 'open'}">답변 필요 ${d.articles.filter(a => !a.answered).length}</button><button data-f="all" aria-pressed="${filter === 'all'}">전체 ${d.articles.length}</button></div>
        <div class="cs-list">${list.length ? list.map(a => `<button class="cs-item" data-a="${a.articleNo}" aria-current="${a.articleNo === sel}">
          <div class="row"><span class="pill ${a.answered ? 'good' : 'bad'}">${a.answered ? '답변 완료' : '답변 필요'}</span><span class="hint">${esc(a.boardName)} · ${esc(a.writer)} · ${esc(fmtTime(a.createdAt) || String(a.createdAt).slice(0, 10))}</span></div>
          <span class="t">${esc(a.title)}</span><span class="c">${esc(a.content)}</span></button>`).join('') : '<div class="empty">답변할 문의가 없습니다.</div>'}</div>
      </div>
      <div class="sticky">${cur ? detail(cur) : '<section class="box"><div class="empty">왼쪽에서 문의를 고르세요.</div></section>'}</div>
    </div>`;
    main.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { filter = b.dataset.f; draw(); });
    main.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { sel = Number(b.dataset.a); draw(); });
    if (cur) bind(cur);
  };

  const detail = a => `<section class="box">
    <div class="box-h"><h2>${esc(a.title)}</h2><span class="hint">${esc(a.boardName)} · ${esc(a.writer)}</span></div>
    <div class="quote">${esc(a.content)}</div>
    ${a.answered ? `<div class="notice info">이미 답변한 문의입니다.${a.reply ? `<div class="quote" style="margin-top:8px">${esc(a.reply)}</div>` : ''}</div>` : `
    <label class="f">답변<textarea id="cs-reply" rows="8" placeholder="고객에게 보낼 답변을 입력하세요."></textarea></label>
    <div class="row">
      ${d.ai ? '<button class="btn" id="cs-draft">AI 답변 초안</button>' : '<span class="hint">AI 초안은 설정·연동에서 AI 키를 등록하면 쓸 수 있습니다.</span>'}
      <span style="flex:1"></span><button class="btn primary" id="cs-send">답변 등록</button></div>
    <div class="hint">[확인 필요] 표시가 남아 있으면 등록되지 않습니다.</div>`}
  </section>`;

  const bind = a => {
    const ta = main.querySelector('#cs-reply'); if (!ta) return;
    try { ta.value = sessionStorage.getItem('cs-draft-' + a.articleNo) || ''; } catch { /* 무시 */ }
    ta.oninput = () => { try { sessionStorage.setItem('cs-draft-' + a.articleNo, ta.value); } catch { /* 무시 */ } };
    const dr = main.querySelector('#cs-draft');
    if (dr) dr.onclick = async () => {
      dr.disabled = true; dr.textContent = '작성 중…';
      try { const r = await api('/api/cs/draft', { method: 'POST', body: { title: a.title, content: a.content, productNo: a.productNo } }); ta.value = r.draft; ta.oninput(); }
      catch (e) { toast(e.message, true); }
      dr.disabled = false; dr.textContent = 'AI 답변 초안';
    };
    main.querySelector('#cs-send').onclick = async () => {
      const content = ta.value.trim();
      if (content.length < 5) { toast('답변을 5자 이상 입력하세요.', true); return; }
      if (/\[확인 필요/.test(content)) { toast('[확인 필요] 부분을 실제 내용으로 바꾼 뒤 등록하세요.', true); return; }
      if (!(await confirmBox('이 답변을 쇼핑몰 게시판에 등록할까요? 고객에게 바로 보입니다.', '등록'))) return;
      try {
        await api('/api/cs/reply', { method: 'POST', body: { boardNo: a.boardNo, articleNo: a.articleNo, title: a.title, content } });
        a.answered = true; a.reply = content;
        try { sessionStorage.removeItem('cs-draft-' + a.articleNo); } catch { /* 무시 */ }
        setBadge('cs', d.articles.filter(x => !x.answered).length);
        toast('답변을 등록했습니다.'); draw();
      } catch (e) { toast(e.message, true); }
    };
  };
  draw();
}
