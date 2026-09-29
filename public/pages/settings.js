import { api, esc, toast, srcTag } from '../app.js';
import { fmtTime } from './home.js';

const ENV = {
  cafe24: ['CAFE24_CLIENT_ID', 'CAFE24_CLIENT_SECRET'],
  meta: ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID'],
  google: ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID'],
  tiktok: ['TIKTOK_ACCESS_TOKEN', 'TIKTOK_ADVERTISER_ID'],
  ai: ['ANTHROPIC_API_KEY']
};
const MSG = { ok: ['info', '카페24 연결이 완료되었습니다.'], fail: ['bad', '카페24 연결에 실패했습니다. 앱 설정의 Redirect URI와 키를 확인하세요.'], state: ['bad', '연결 요청이 만료되었거나 올바르지 않습니다. 다시 시도하세요.'], denied: ['bad', '카페24에서 권한 승인이 취소되었습니다.'] };

export async function render(main, { query }) {
  const s = await api('/api/status');
  const m = s.modes; const st = s.settings;
  const msg = MSG[query.get('cafe24')];
  const envList = k => `<div class="hint">Netlify 환경변수: ${ENV[k].map(e => `<code>${e}</code>`).join(', ')}</div>`;
  const card = (title, mode, body) => `<section class="box"><div class="box-h"><h2>${title}</h2>${srcTag(mode)}</div>${body}</section>`;
  const tokenLine = s.cafe24Token ? `연결 유지 기한 ${esc(fmtTime(new Date(s.cafe24Token.refreshExpiresAt).toISOString()))} (15분마다 자동 연장)` : '';

  main.innerHTML = `
  <div class="page-head"><h1>설정·연동</h1></div>
  <div class="stack">
    ${msg ? `<div class="notice ${msg[0]}">${msg[1]}</div>` : ''}
    ${(m.cafe24 !== 'live' || ['meta', 'google', 'tiktok'].some(p => m[p] !== 'live')) ? '<div class="notice">"데모"로 표시된 영역은 연습용 데이터입니다. 아래 환경변수를 Netlify에 등록하고 다시 배포하면 해당 영역이 실제 데이터로 바뀝니다. 키 값은 채팅이나 문서에 붙여넣지 말고 Netlify 화면에만 입력하세요.</div>' : ''}
    <div class="cols">
      ${card('카페24 쇼핑몰', m.cafe24, `
        <div>연결 대상: <a href="${esc(s.shop.url)}" target="_blank" rel="noopener">${esc(s.shop.url.replace(/^https?:\/\//, ''))}</a> <span class="hint">(카페24 몰 ID ${esc(s.shop.mallId)})</span></div>
        <div>${m.cafe24 === 'live' ? '연결됨. ' + tokenLine : m.cafe24Keys ? '키가 등록되었습니다. 아래 버튼으로 쇼핑몰 권한을 승인하면 연결이 끝납니다.' : '카페24 개발자센터에서 앱을 만들고 키를 등록하세요.'}</div>
        ${m.cafe24Keys ? `<div><a class="btn ${m.cafe24 === 'live' ? '' : 'primary'}" href="/api/cafe24/connect">${m.cafe24 === 'live' ? '다시 연결' : '카페24 연결하기'}</a></div>` : ''}
        ${envList('cafe24')}<div class="hint">앱의 Redirect URI: <code>${esc(location.origin)}/api/cafe24/callback</code></div>`)}
      ${card('메타 광고', m.meta, `<div>${m.meta === 'live' ? '연결됨' : '시스템 사용자 토큰과 광고 계정 ID가 필요합니다.'}</div>${envList('meta')}`)}
      ${card('구글 Ads', m.google, `<div>${m.google === 'live' ? '연결됨' : '개발자 토큰(실계정용 승인 필요)과 OAuth 갱신 토큰이 필요합니다.'}</div>${envList('google')}<div class="hint">관리자(MCC) 계정을 거치면 GOOGLE_ADS_LOGIN_CUSTOMER_ID도 등록</div>`)}
      ${card('틱톡 광고', m.tiktok, `<div>${m.tiktok === 'live' ? '연결됨' : '틱톡 비즈니스 개발자 앱의 액세스 토큰과 광고주 ID가 필요합니다.'}</div>${envList('tiktok')}`)}
      ${card('AI 답변 초안', s.ai ? 'live' : 'off', `<div>${s.ai ? '사용 가능' : '선택 기능입니다. 등록하면 CS 문의에 답변 초안 버튼이 생깁니다.'}</div>${envList('ai')}`)}
      <section class="box"><div class="box-h"><h2>자동 수집</h2>${s.sync ? (s.sync.errors.length ? '<span class="pill bad">오류 있음</span>' : '<span class="pill good">정상</span>') : ''}</div>
        <div>${s.sync ? `마지막 실행 ${esc(fmtTime(s.sync.at))} · ${s.sync.ms}ms` : '아직 실행 기록이 없습니다. 배포 후 15분마다 자동 실행됩니다.'}</div>
        ${s.sync?.errors?.length ? `<div class="err"><ul>${s.sync.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
        <div><button class="btn" id="sync-now">지금 수집</button></div></section>
    </div>

    <section class="box"><h2>운영 설정</h2>
      <div class="fields">
        <label class="f">CS 답변 작성자 이름<input id="st-writer" value="${esc(st.csWriter)}" maxlength="30"></label>
        <label class="f">자동 규칙 하루 최대 실행(회)<input type="number" id="st-max" min="0" step="1" value="${st.maxActionsPerDay}"></label>
        <label class="f">최소 일 예산(원)<input type="number" id="st-minb" min="0" step="1000" value="${st.minBudget}"></label>
        <label class="f">예산 한 번 변경 한도(%)<input type="number" id="st-maxpct" min="1" max="100" value="${st.maxBudgetChangePct}"></label>
        <label class="f">자동 규칙 실행 방식<select id="st-dry"><option value="1" ${st.rulesDryRun ? 'selected' : ''}>모의 실행 (기록만)</option><option value="0" ${!st.rulesDryRun ? 'selected' : ''}>실제 실행</option></select></label>
      </div>
      <div><button class="btn primary" id="st-save">설정 저장</button></div>
    </section>

    ${m.cafe24 === 'demo' ? `<section class="box"><h2>데모 도우미</h2><p class="hint" style="margin:0">데모 쇼핑몰 상품과 연결된 예시 제품 3개(원가 포함)를 만들고, 데모 광고 캠페인과 연결합니다. 매출·이익과 광고 판정이 어떻게 보이는지 바로 확인할 수 있습니다. 실제 연결 뒤에는 예시 제품을 삭제하세요.</p>
      <div><button class="btn" id="demo-ex">예시 제품 불러오기</button></div></section>` : ''}
  </div>`;

  main.querySelector('#sync-now').onclick = async e => {
    const b = e.target; b.disabled = true; b.textContent = '수집 중…';
    try { const r = await api('/api/sync', { method: 'POST' }); toast(r.errors.length ? `완료, 오류 ${r.errors.length}건` : '수집 완료', Boolean(r.errors.length)); render(main, { query: new URLSearchParams() }); }
    catch (err) { toast(err.message, true); b.disabled = false; b.textContent = '지금 수집'; }
  };
  main.querySelector('#st-save').onclick = async () => {
    try {
      await api('/api/settings', { method: 'PUT', body: {
        csWriter: main.querySelector('#st-writer').value, maxActionsPerDay: Number(main.querySelector('#st-max').value),
        minBudget: Number(main.querySelector('#st-minb').value), maxBudgetChangePct: Number(main.querySelector('#st-maxpct').value),
        rulesDryRun: main.querySelector('#st-dry').value === '1'
      } });
      toast('설정을 저장했습니다.');
    } catch (e) { toast(e.message, true); }
  };
  const ex = main.querySelector('#demo-ex');
  if (ex) ex.onclick = async () => {
    ex.disabled = true;
    try { await api('/api/products/examples', { method: 'POST' }); toast('예시 제품 3개를 만들었습니다.'); location.hash = '#/products'; }
    catch (e) { toast(e.message, true); ex.disabled = false; }
  };
}
