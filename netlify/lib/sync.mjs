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
    await step('주문 수집', async () => `${(await data.ordersForStats(addDays(today, -13), today)).length}건`);
    // 남은 시간 안에서만 과거 기록을 조금씩 채움 (분석용 1년치)
    if (Date.now() - started < 12000) await step('과거 기록 채우기', () => data.backfillOrders(365, 45));
    if (Date.now() - started < 14000) await step('과거 기록 묶기', () => data.packOrderMonths(3));
  }
  // 광고 분석 기본 화면(최근 14일)을 미리 받아둬서 화면을 열 때 매체를 기다리지 않게 함
  await step('광고 성과 수집', async () => {
    const [ads, cr] = await Promise.all([data.allAds(addDays(today, -13), today), data.allCreatives(addDays(today, -13), today)]);
    for (const e of [...ads.errors, ...cr.errors.filter(e => !ads.errors.some(x => x.platform === e.platform))]) res.errors.push(`${data.PLATFORM_LABEL[e.platform]}: ${e.message}`);
    return `캠페인 ${ads.campaigns.length}개 · 소재 ${new Set(cr.rows.map(r => r.platform + r.adId)).size}개`;
  });
  // 비교용 이전 14일도 비어 있으면 채움 (한 번 받으면 오래 보관)
  if (Date.now() - started < 15000) await step('광고 이전 기간', async () => { await data.allAds(addDays(today, -27), addDays(today, -14), { rowsOnly: true }); return '준비됨'; });
  await step('자동 규칙', async () => {
    const r = await runRules({ who: '자동 규칙' });
    for (const e of r.errors) res.errors.push(e);
    return `${r.dryRun ? '모의 ' : ''}실행 ${r.actions.filter(a => a.done || r.dryRun).length}건`;
  });
  res.ms = Date.now() - started;
  await setJSON('status/sync', res);
  return res;
}
