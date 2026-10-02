// 주기 작업: 카페24 토큰 갱신 → 광고·주문 캐시 갱신 → 자동 규칙 실행
import { getJSON, setJSON } from './store.mjs';
import { kstDate, addDays } from './util.mjs';
import * as data from './data.mjs';
import * as C from './cafe24.mjs';
import { runRules } from './rules.mjs';
import { runAutoLink } from './autolink.mjs';

export async function runSync(trigger = 'schedule') {
  const started = Date.now();
  const res = { at: new Date().toISOString(), trigger, steps: [], errors: [] };
  const step = async (name, fn) => {
    try { const r = await fn(); res.steps.push({ name, ok: true, note: r || '' }); }
    catch (e) { res.steps.push({ name, ok: false, note: e.message }); res.errors.push(`${name}: ${e.message}`); }
  };
  const today = kstDate();
  const left = () => 26000 - (Date.now() - started); // 넷리파이 함수 제한 안에서 안전하게
  const shop = await C.cafe24Connected();
  // 1) 꼭 필요한 것부터: 토큰 유지 → 최근 주문 + 광고 캠페인 성과(동시에) → 자동 규칙
  if (shop) {
    await step('카페24 연결 유지', async () => {
      const tok = await getJSON('tokens/cafe24');
      // 리프레시 토큰이 7일 이내로 남으면 갱신해 연결을 계속 유지
      const force = tok && tok.refresh_token_expires_at - Date.now() < 7 * 86400000;
      await C.ensureToken(force);
      return force ? '토큰 갱신' : '정상';
    });
  }
  await Promise.all([
    shop ? step('주문 수집', async () => `${(await data.ordersForStats(addDays(today, -13), today)).length}건`) : null,
    step('광고 성과 수집', async () => {
      const ads = await data.allAds(addDays(today, -13), today);
      for (const e of ads.errors) res.errors.push(`${data.PLATFORM_LABEL[e.platform]}: ${e.message}`);
      return `캠페인 ${ads.campaigns.length}개`;
    })
  ]);
  // 새로 올라온 캠페인은 규칙·손익 판정 전에 제품에 먼저 연결
  await step('제품 자동 연결', async () => {
    const r = await runAutoLink({ who: '자동 연결' });
    if (r.skipped) return r.skipped;
    return `${r.applied.length}개 연결${r.unresolved.length ? `, 미해결 ${r.unresolved.length}개` : ''}`;
  });
  await step('자동 규칙', async () => {
    const r = await runRules({ who: '자동 규칙' });
    for (const e of r.errors) res.errors.push(e);
    return `${r.dryRun ? '모의 ' : ''}실행 ${r.actions.filter(a => a.done || r.dryRun).length}건`;
  });
  res.ms = Date.now() - started;
  await setJSON('status/sync', res); // 여기까지는 항상 기록 (아래는 시간이 남을 때만)
  // 2) 여유가 있을 때: 소재별 성과, 광고 이전 기간, 과거 주문 채우기·묶기
  if (left() > 12000) await step('광고 소재 수집', async () => {
    const cr = await data.allCreatives(addDays(today, -13), today);
    for (const e of cr.errors) if (!res.errors.some(x => x.startsWith(data.PLATFORM_LABEL[e.platform]))) res.errors.push(`${data.PLATFORM_LABEL[e.platform]}: ${e.message}`);
    return `소재 ${new Set(cr.rows.map(r => r.platform + r.adId)).size}개`;
  });
  if (left() > 8000) await step('광고 이전 기간', async () => { await data.allAds(addDays(today, -27), addDays(today, -14), { rowsOnly: true }); return '준비됨'; });
  if (shop && left() > 10000) await step('과거 기록 채우기', () => data.backfillOrders(365 + 184, 30));
  if (shop && left() > 6000) await step('과거 기록 묶기', () => data.packOrderMonths(2));
  res.ms = Date.now() - started;
  await setJSON('status/sync', res);
  return res;
}
