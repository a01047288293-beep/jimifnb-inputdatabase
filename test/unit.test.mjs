// 순수 계산 테스트: 마진 엔진, 규칙 판정, 매출 분석, 날짜 도구
import test from 'node:test';
import assert from 'node:assert/strict';
import { calc, targetPrice, trialYield, blankProduct, monthly } from '../public/lib/margin.js';
import { matchRule, newBudget, validateRule } from '../netlify/lib/rules.mjs';
import { orderContribution, dailySeries, productIndex, productTable, campaignSummary } from '../netlify/lib/analytics.mjs';
import { addDays, dateRange, kstDate, maskName, isYmd } from '../netlify/lib/util.mjs';

const P = Object.assign(blankProduct(), {
  id: 'p1', ingredients: [{ name: '한우', unit: 'kg', unitPrice: 32000, qty: 10 }, { name: '소스', unit: 'kg', unitPrice: 6000, qty: 3 }, { name: '양파', unit: 'kg', unitPrice: 2500, qty: 1.5 }, { name: '끈', unit: '개', unitPrice: 10, qty: 26 }],
  yieldPct: 92, packWeightG: 500, packaging: [{ cost: 180 }, { cost: 40 }], workers: 2, hours: 4, wage: 12000, overhead: 30000,
  price: 29900, taxable: true, packsPerOrder: 2, boxCost: 1800, icepacks: 2, icepackCost: 350, courier: 3500, feePct: 3.5, returnPct: 2, adPct: 15, cafe24ProductNos: [101]
});

test('마진 엔진: 손계산과 일치', () => {
  const r = calc(P);
  assert.equal(r.packs, 26);
  const unit = 342010 / 26 + 220 + 96000 / 26 + 30000 / 26;
  assert.ok(Math.abs(r.unitCost - unit) < 1e-6);
  const gross = 59800, net = gross - gross / 11, bA = net - gross * 0.035 - unit * 2 - 6000 - net * 0.02;
  assert.ok(Math.abs(r.beforeAds - bA) < 1e-6);
  assert.ok(Math.abs(r.profit - (bA - gross * 0.15)) < 1e-6);
  assert.ok(Math.abs(r.beRoas - gross / bA) < 1e-9);
});
test('마진 엔진: 목표가 역산과 오류 처리', () => {
  const tp = targetPrice(P, 0.15);
  assert.ok(calc(P, { price: tp }).margin >= 0.15 && calc(P, { price: tp - 100 }).margin < 0.15);
  assert.equal(targetPrice({ ...P, feePct: 50, adPct: 50 }, 0.15), null);
  assert.equal(calc(blankProduct()).ok, false);
  assert.ok(Math.abs(trialYield([{ inputKg: 10, outputKg: 9 }, { inputKg: 5, outputKg: 4 }]) - 86.6666667) < 1e-4);
  assert.equal(trialYield([]), null);
  assert.equal(monthly({ ordersPerMonth: 10, fixedMonthly: 0 }, calc(P)).orders, 10);
});

test('날짜 도구', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.deepEqual(dateRange('2026-09-29', '2026-10-01'), ['2026-09-29', '2026-09-30', '2026-10-01']);
  assert.deepEqual(dateRange('2026-10-02', '2026-10-01'), []);
  assert.equal(kstDate(new Date('2026-09-29T15:30:00Z')), '2026-09-30');
  assert.equal(maskName('김민웅'), '김*웅'); assert.equal(maskName('홍길'), '홍*'); assert.equal(maskName(''), '');
  assert.ok(isYmd('2026-09-29')); assert.ok(!isYmd('2026-9-29')); assert.ok(!isYmd(null));
});

const sum = (over) => ({ key: 'meta:1', platform: 'meta', id: '1', name: '[불고기] 전환', status: 'on', dailyBudget: 50000, spend: 40000, revenue: 0, purchases: 0, roas: 0, cpa: null, beRoas: 3.8, ...over });
test('규칙 판정: 조건·상태·제품 연결', () => {
  const rule = validateRule({ name: 't', platform: 'all', window: 'today', conditions: [{ metric: 'spend', op: '>=', value: 30000 }, { metric: 'purchases', op: '==', value: 0 }], action: { type: 'pause' }, cooldownHours: 12 });
  assert.equal(matchRule(rule, [sum()]).length, 1);
  assert.equal(matchRule(rule, [sum({ status: 'off' })]).length, 0, '꺼진 캠페인은 끄지 않음');
  assert.equal(matchRule(rule, [sum({ purchases: 1 })]).length, 0);
  assert.equal(matchRule({ ...rule, platform: 'google' }, [sum()]).length, 0);
  assert.equal(matchRule({ ...rule, campaignMatch: '육포' }, [sum()]).length, 0);
  const be = validateRule({ name: 'b', platform: 'all', window: '3d', conditions: [{ metric: 'roasVsBe', op: '<', value: 1 }], action: { type: 'budget_down', pct: 20 } });
  assert.equal(matchRule(be, [sum({ roas: 3, spend: 1 })])[0].reason.includes('손익분기'), true);
  assert.equal(matchRule(be, [sum({ roas: 4, spend: 1 })]).length, 0);
  assert.ok(matchRule(be, [sum({ roas: 1, beRoas: null })])[0].skipped, '제품 미연결은 건너뜀');
  const en = validateRule({ name: 'e', platform: 'all', window: '7d', conditions: [{ metric: 'roas', op: '>=', value: 5 }], action: { type: 'enable' } });
  assert.equal(matchRule(en, [sum({ status: 'off', roas: 6 })]).length, 1);
  assert.equal(matchRule(en, [sum({ status: 'on', roas: 6 })]).length, 0);
});
test('규칙: 예산 계산과 입력 검증', () => {
  const s = { minBudget: 10000, maxBudgetChangePct: 50 };
  assert.equal(newBudget(50000, { type: 'budget_down', pct: 20 }, s), 40000);
  assert.equal(newBudget(50000, { type: 'budget_up', pct: 80 }, s), 75000, '최대 50%로 제한');
  assert.equal(newBudget(11000, { type: 'budget_down', pct: 50 }, s), 10000, '최소 예산 보장');
  assert.throws(() => validateRule({ name: '', platform: 'x', window: 'z', conditions: [], action: { type: 'boom' } }), /이름/);
  assert.throws(() => validateRule({ name: 'a', platform: 'all', window: 'today', conditions: [{ metric: 'spend', op: '>=', value: 1 }], action: { type: 'budget_up', pct: 0 } }), /비율/);
});

test('매출 분석: 원가 연결·취소 제외·광고비 배분', () => {
  const idx = productIndex([P]);
  const order = { id: 'o1', date: '2026-09-28', status: 'N40', amount: 59800, canceled: false, items: [{ productNo: 101, qty: 2, price: 29900 }] };
  const c = orderContribution(order, idx);
  const unit = calc(P).unitCost;
  assert.ok(Math.abs(c.contribution - (59800 - 59800 / 11 - 59800 * 0.035 - unit * 2 - 6000)) < 1e-6);
  assert.equal(orderContribution({ ...order, canceled: true }, idx).counted, false);
  assert.equal(orderContribution({ ...order, status: 'R40' }, idx).counted, false);
  assert.equal(orderContribution({ ...order, items: [{ productNo: 999, qty: 1, price: 1 }] }, idx).contribution, null);
  const unknown = { ...order, id: 'o2', amount: 40000, items: [{ productNo: 999, qty: 1, price: 40000 }] };
  const s = dailySeries(['2026-09-28'], [order, unknown], [{ date: '2026-09-28', spend: 10000, revenue: 30000, purchases: 1 }], idx)[0];
  assert.equal(s.revenue, 99800); assert.equal(s.orders, 2); assert.equal(s.mappedRevenue, 59800);
  assert.ok(Math.abs(s.profit - (c.contribution - 10000 * 59800 / 99800)) < 1e-6);
  assert.equal(s.roas, 3);
  const t = productTable([order, unknown], idx);
  assert.equal(t[0].productNo, 101); assert.equal(t[1].linked, null);
});
test('캠페인 요약: 기간 합계·판정', () => {
  const rows = [{ platform: 'meta', campaignId: '1', name: 'A', date: 'd1', spend: 100, revenue: 500, purchases: 2 }, { platform: 'meta', campaignId: '1', name: 'A', date: 'd2', spend: 100, revenue: 100, purchases: 1 }, { platform: 'google', campaignId: '9', name: '목록에 없는 캠페인', date: 'd1', spend: 10, revenue: 0, purchases: 0 }];
  const list = campaignSummary([{ platform: 'meta', id: '1', name: 'A', status: 'on', dailyBudget: 1000 }], rows, { 'meta:1': 'p1' }, [P]);
  const a = list.find(x => x.key === 'meta:1');
  assert.equal(a.spend, 200); assert.equal(a.roas, 3); assert.equal(a.productName, P.name);
  assert.equal(a.verdict, 3 >= calc(P).beRoas * 1.2 ? 'good' : 3 >= calc(P).beRoas ? 'warn' : 'bad');
  assert.ok(list.find(x => x.key === 'google:9'), '목록에 없는 캠페인도 표시');
});
