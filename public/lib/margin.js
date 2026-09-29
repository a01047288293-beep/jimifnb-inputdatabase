/* 제품 원가·마진 계산 엔진 — 서버와 화면이 함께 씀 (순수 함수) */
const STAGES = [
  { id: 'idea', name: '아이디어', checks: ['타깃 고객·용도 정의', '경쟁 제품 가격 조사', '예상 판매가 범위 설정'] },
  { id: 'recipe', name: '배합 설계', checks: ['원재료·부재료 배합비 확정', '원재료 매입처·단가 확인', '알레르기 유발 원료 확인'] },
  { id: 'trial', name: '시생산', checks: ['시생산 2회 이상 기록', '실측 수율 반영', '관능 평가(맛·식감·색)'] },
  { id: 'costing', name: '원가·가격', checks: ['목표 마진율 설정', '채널별 수익 비교', '손익분기 ROAS 확인'] },
  { id: 'label', name: '표시·신고', checks: ['영업 형태별 신고·보고 요건 확인', '표시사항(원재료명·소비기한 등) 작성', '소비기한 설정 근거 확보', '검사 의무(자가품질검사 등) 확인'] },
  { id: 'launch', name: '출시', checks: ['상세페이지·제품 사진 준비', '자사몰 상품 등록', '광고 세팅(손익분기 ROAS 기준 규칙)'] },
  { id: 'review', name: '판매 분석', checks: ['첫 달 판매량·매출 기록', '실제 광고비·ROAS 기록', '원가·판매가 재검토'] }
];

const UNITS = ['kg', 'L', '개'];

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function pct(v) { return Math.min(Math.max(num(v), 0), 100) / 100; }
function sum(arr, f) { let s = 0; for (const x of arr || []) s += f(x); return s; }

function trialYield(trials) {
  const valid = (trials || []).filter(t => num(t.inputKg) > 0 && num(t.outputKg) >= 0);
  const inKg = sum(valid, t => num(t.inputKg));
  if (inKg <= 0) return null;
  return sum(valid, t => num(t.outputKg)) / inKg * 100;
}

/* 한 제품에 대한 전체 계산. opts: { price, feePct, rawFactor, adPct } 로 일부 값 덮어쓰기 */
function calc(p, opts) {
  opts = opts || {};
  const errors = [];
  const ings = (p.ingredients || []).filter(i => i && (num(i.qty) > 0 || num(i.unitPrice) > 0));
  const rawFactor = opts.rawFactor == null ? 1 : opts.rawFactor;
  const rawCostBatch = sum(ings, i => num(i.unitPrice) * num(i.qty)) * rawFactor;
  const inputKg = sum(ings.filter(i => i.unit !== '개'), i => num(i.qty));
  const yieldRate = pct(p.yieldPct);
  const finishedKg = inputKg * yieldRate;
  const packG = num(p.packWeightG);
  let packs;
  if (num(p.packsOverride) > 0) packs = Math.floor(num(p.packsOverride));
  else packs = packG > 0 ? Math.floor(finishedKg * 1000 / packG + 1e-9) : 0;

  if (!ings.length) errors.push('배합에 원재료를 1개 이상 입력하세요.');
  if (!(num(p.packsOverride) > 0)) {
    if (inputKg <= 0) errors.push('무게 단위(kg·L) 원재료가 없어 생산 개수를 계산할 수 없습니다. 무게 원재료를 넣거나 배치당 생산 개수를 직접 입력하세요.');
    if (yieldRate <= 0) errors.push('수율을 0보다 크게 입력하세요.');
    if (packG <= 0) errors.push('1개당 중량(g)을 입력하세요.');
  }
  if (packs <= 0 && !errors.length) errors.push('완제품 중량이 1개 중량보다 작아 생산 개수가 0개입니다.');

  const price = opts.price != null ? num(opts.price) : num(p.price);
  const n = Math.max(1, Math.floor(num(p.packsPerOrder) || 1));
  if (price <= 0) errors.push('판매가를 입력하세요.');
  if (errors.length) return { ok: false, errors, packs, inputKg, finishedKg, rawCostBatch };

  // 1개당 제조원가 (VAT 별도 원가 기준)
  const perPack = {
    material: rawCostBatch / packs,
    packaging: sum(p.packaging, x => num(x.cost)),
    labor: num(p.workers) * num(p.hours) * num(p.wage) / packs,
    overhead: num(p.overhead) / packs
  };
  const unitCost = perPack.material + perPack.packaging + perPack.labor + perPack.overhead;

  // 주문 1건 기준
  const feeRate = opts.feePct != null ? pct(opts.feePct) : pct(p.feePct);
  const adRate = opts.adPct != null ? pct(opts.adPct) : pct(p.adPct);
  const productGross = price * n * (1 - pct(p.couponPct));      // 고객 결제 상품금액(VAT 포함)
  const shipCharged = num(p.shipCharged);                         // 고객 부담 배송비
  const gross = productGross + shipCharged;                       // 결제 총액(VAT 포함)
  const vat = p.taxable ? gross / 11 : 0;
  const netRevenue = gross - vat;
  const channelFee = gross * feeRate;
  const cogs = unitCost * n;
  const fulfil = num(p.boxCost) + num(p.icepacks) * num(p.icepackCost) + num(p.courier);
  const returnLoss = netRevenue * pct(p.returnPct);
  const beforeAds = netRevenue - channelFee - cogs - fulfil - returnLoss; // 광고 전 공헌이익
  const ads = gross * adRate;
  const profit = beforeAds - ads;
  const margin = netRevenue > 0 ? profit / netRevenue : 0;
  const beRoas = beforeAds > 0 ? gross / beforeAds : null;  // 광고비(부가세 별도) 대비 결제금액 기준
  const cmRate = netRevenue > 0 ? beforeAds / netRevenue : 0;

  return {
    ok: true, errors: [], n, price, packs, inputKg, finishedKg, rawCostBatch,
    perPack, unitCost, productGross, shipCharged, gross, vat, netRevenue,
    channelFee, cogs, fulfil, returnLoss, beforeAds, ads, profit, margin, beRoas, cmRate,
    costRatio: price > 0 ? unitCost / (p.taxable ? price / 1.1 : price) : 0
  };
}

/* 목표 마진율(0~1)을 맞추는 최소 판매가(100원 단위 올림). 불가능하면 null */
function targetPrice(p, targetMargin, opts) {
  opts = opts || {};
  const m = x => { const r = calc(p, Object.assign({}, opts, { price: x })); return r.ok ? r.margin : -Infinity; };
  let lo = 1, hi = 10000000;
  if (m(hi) < targetMargin) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (m(mid) >= targetMargin) hi = mid; else lo = mid;
  }
  let price = Math.ceil(hi / 100) * 100;
  while (m(price) < targetMargin) price += 100;
  return price;
}

/* 월 손익: 주문수 × 주문당 이익 − 월 고정비 */
function monthly(p, r) {
  const orders = Math.max(0, Math.floor(num(p.ordersPerMonth)));
  const fixed = num(p.fixedMonthly);
  const profit = r.ok ? r.profit * orders - fixed : 0;
  const bep = r.ok && r.profit > 0 ? Math.ceil(fixed / r.profit) : null;
  return { orders, fixed, profit, bep };
}

/* 실제 판매 성과(판매 분석 단계) */
function actuals(p, r) {
  const a = p.actual || {};
  const orders = num(a.orders), revenue = num(a.revenue), adSpend = num(a.adSpend);
  if (!r.ok || orders <= 0) return null;
  return {
    orders, revenue, adSpend,
    roas: adSpend > 0 ? revenue / adSpend : null,
    profit: r.beforeAds * orders - adSpend
  };
}

function blankProduct() {
  return {
    name: '새 제품', stage: 'idea', category: '', memo: '', checks: {},
    ingredients: [{ name: '', unit: 'kg', unitPrice: 0, qty: 0 }],
    yieldPct: 90, packWeightG: 500, packsOverride: 0,
    trials: [],
    packaging: [{ name: '진공 포장재', cost: 0 }, { name: '라벨', cost: 0 }],
    workers: 1, hours: 0, wage: 0, overhead: 0,
    price: 0, taxable: true, packsPerOrder: 1, couponPct: 0, shipCharged: 0,
    boxCost: 0, icepacks: 0, icepackCost: 0, courier: 0,
    feePct: 3.5, returnPct: 1, adPct: 10, targetMargin: 15,
    ordersPerMonth: 0, fixedMonthly: 0,
    channels: [
      { name: '자사몰', feePct: 3.5 },
      { name: '오픈마켓 A', feePct: 6 },
      { name: '오픈마켓 B', feePct: 11 }
    ],
    actual: { orders: 0, revenue: 0, adSpend: 0 },
    cafe24ProductNos: []
  };
}

export { STAGES, UNITS, calc, targetPrice, monthly, actuals, trialYield, blankProduct, num, pct };
