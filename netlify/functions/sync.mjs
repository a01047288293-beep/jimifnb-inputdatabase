// 15분마다 실행 (UTC 기준 cron, 15분 간격이라 시간대 무관)
import { runSync } from '../lib/sync.mjs';

export default async () => {
  const r = await runSync('schedule');
  console.log('sync', JSON.stringify({ ms: r.ms, errors: r.errors }));
};

export const config = { schedule: '*/15 * * * *' };
