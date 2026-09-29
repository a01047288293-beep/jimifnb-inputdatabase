// 주기 작업: 카페24 토큰 갱신 → 광고·주문 캐시 갱신 → 자동 규칙 실행
import { getJSON, setJSON } from './store.mjs';
import { kstDate, addDays } from './util.mjs';
import * as data from './data.mjs';
import * as C from './cafe24.mjs';
import { runRules } from './rules.mjs';

export async function runSync(trigger = 'schedule') {
  const started = Date.now();
  const res = { at: new Date().toISOString(), trigger, steps: [], errors: [] };
  const step = async (name, fn) => {
    try { const r = await fn(); res.steps.push({ name, ok: true, note: r || '' }); }
    catch (e) { res.steps.push({ name, ok: false, note: e.message }); res.errors.push(`${name}: ${e.message}`); }
  };
  const today = kstDate();
  if (await C.cafe24Connected()) {
    await step('카페24 연결 유지', async () => {
      const tok = await getJSON('tokens/cafe24');
      // 리프레시 토큰이 7일 이내로 남으면 갱신해 연결을 계속 유지
      const force = tok && tok.refresh_token_expires_at - Date.now() < 7 * 86400000;
      await C.ensureToken(force);
      return force ? '토큰 갱신' : '정상';
    });
    await step('주문 수집', async () => `${(await data.ordersForStats(addDays(today, -1), today)).length}건`);
  }
  await step('광고 성과 수집', async () => {
    const ads = await data.allAds(addDays(today, -6), today);
    for (const e of ads.errors) res.errors.push(`${data.PLATFORM_LABEL[e.platform]}: ${e.message}`);
    return `캠페인 ${ads.campaigns.length}개`;
  });
  await step('자동 규칙', async () => {
    const r = await runRules({ who: '자동 규칙' });
    for (const e of r.errors) res.errors.push(e);
    return `${r.dryRun ? '모의 ' : ''}실행 ${r.actions.filter(a => a.done || r.dryRun).length}건`;
  });
  res.ms = Date.now() - started;
  await setJSON('status/sync', res);
  return res;
}
