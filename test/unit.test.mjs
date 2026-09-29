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

import { salesInsights, productInsights, customerInsights, fulfillmentInsights, kstParts, summary } from '../netlify/lib/insights.mjs';
import { regionOf } from '../netlify/lib/util.mjs';
const O = (id, date, hh, amount, extra = {}) => ({ id, date, time: `${date}T${hh}:00:00+09:00`, status: 'N40', amount, canceled: false, payment: '카드', channel: '모바일 웹', member: null, region: '서울', firstOrder: null, items: [{ productNo: 1, name: 'A', option: '1팩', qty: 1, price: amount, shippedAt: null, deliveredAt: null }], ...extra });

test('운영 분석: 매출·요일·시간·비교', () => {
  const days = ['2026-09-28', '2026-09-29'];
  const cur = [O('a', '2026-09-28', '10', 10000), O('b', '2026-09-29', '21', 30000, { payment: '네이버페이' }), O('c', '2026-09-29', '21', 5000, { canceled: true, status: 'C40' })];
  const s = salesInsights(cur, [O('p', '2026-09-26', '09', 20000)], null, days);
  assert.equal(s.summary.revenue, 40000); assert.equal(s.summary.orders, 2); assert.equal(s.canceled, 1);
  assert.equal(s.prev.revenue, 20000); assert.equal(s.lastYear, null);
  assert.equal(s.hours[21].orders, 1); assert.equal(s.heat[1][10], 1, '9/28은 월요일');
  assert.equal(s.weekday[2].avgRevenue, 30000);
  assert.deepEqual(s.payments.map(p => p.name), ['네이버페이', '카드']);
  assert.deepEqual(kstParts({ time: '2026-09-29T12:30:00Z', date: '2026-09-29' }), [2, 21]);
  assert.equal(summary([]).aov, null);
  assert.equal(regionOf('전남광주통합특별시 남구 봉선로 21'), '전남'); assert.equal(regionOf('경상남도 창원시'), '경남'); assert.equal(regionOf(''), '미상');
});
test('운영 분석: 상품 순위·재고 경고', () => {
  const days = Array.from({ length: 14 }, (_, i) => `2026-09-${String(16 + i).padStart(2, '0')}`);
  const cur = days.map((d, i) => O('o' + i, d, '10', 20000, { items: [{ productNo: 1, name: 'A', option: '1팩', qty: 2, price: 10000 }] }));
  cur.push(O('x', days[0], '11', 5000, { items: [{ productNo: 2, name: 'B', option: '', qty: 1, price: 5000 }] }));
  const inv = [{ productNo: 1, name: 'A', option: '1팩', quantity: 10, safety: 3, tracked: true, soldOut: false }, { productNo: 2, name: 'B', option: '', quantity: 0, safety: 0, tracked: true, soldOut: true }, { productNo: 3, name: 'C', option: '', quantity: 50, safety: 5, tracked: true, soldOut: false }];
  const r = productInsights(cur, [O('p', '2026-09-01', '10', 1000, { items: [{ productNo: 2, name: 'B', qty: 1, price: 1000 }] })], inv, days, new Map());
  assert.equal(r.products[0].productNo, 1); assert.equal(r.products[0].prevRank, null); assert.equal(r.products[1].prevRank, 1);
  const a = r.stock.find(s => s.productNo === 1); assert.equal(a.perDay, 2); assert.equal(a.cover, 5); assert.equal(a.level, 'warn');
  assert.equal(r.stock[0].productNo, 2); assert.equal(r.stock[0].level, 'critical', '팔리던 품목 품절');
  assert.equal(r.stock.find(s => s.productNo === 3).level, 'ok'); assert.equal(r.alerts, 2);
});
test('운영 분석: 고객 신규·재구매', () => {
  const hist = [O('h1', '2026-05-01', '10', 1000, { member: 'm1' }), O('h2', '2026-09-20', '10', 2000, { member: 'm1' }), O('h3', '2026-09-21', '10', 3000, { member: 'm2' }), O('h4', '2026-09-22', '10', 4000)];
  const r = customerInsights(hist.slice(1), hist, '2026-09-01');
  assert.equal(r.members, 2); assert.equal(r.returningOrders, 1); assert.equal(r.newOrders, 1); assert.equal(r.guestOrders, 1);
  assert.equal(r.repeatRate, 0.5); assert.equal(r.medianGap, 142); assert.equal(r.top[0].orders, 2);
});
test('운영 분석: 출고 소요·지연·클레임', () => {
  const now = Date.parse('2026-09-29T12:00:00+09:00');
  const shipped = O('s', '2026-09-27', '10', 1000, { items: [{ productNo: 1, name: 'A', qty: 1, price: 1000, shippedAt: '2026-09-28T10:00:00+09:00', deliveredAt: '2026-09-29T10:00:00+09:00' }] });
  const late = O('l', '2026-09-26', '10', 1000, { status: 'N20' });
  const fresh = O('f', '2026-09-29', '10', 1000, { status: 'N20' });
  const ret = O('r', '2026-09-20', '10', 1000, { status: 'R40', claimReason: '포장 파손' });
  const f = fulfillmentInsights([shipped, late, fresh, ret], { now, slaHours: 48, days: ['2026-09-27'] });
  assert.equal(f.leadMedian, 24); assert.equal(f.deliverMedian, 24); assert.equal(f.within24, 1);
  assert.deepEqual(f.delayed.map(o => o.id), ['l']);
  assert.equal(f.claims.find(c => c.type === 'R').count, 1); assert.equal(f.reasons[0].name, '포장 파손');
  assert.equal(f.dailyLead[0].median, 24);
});
