// 데모 데이터: API 키가 없을 때 모든 화면을 확인할 수 있도록 날짜 기반으로 항상 같은 값을 만든다.
// 화면에서 "데모" 표시가 붙고, 실제 키를 등록하면 해당 영역은 실제 데이터로 바뀐다.
import { getJSON, setJSON } from './store.mjs';
import { addDays, kstDate } from './util.mjs';

function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = hash(seed); return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export const DEMO_PRODUCTS = [
  { productNo: 101, name: '한우 불고기 양념육 500g', price: 34900 },
  { productNo: 102, name: '한우 육포 100g', price: 24900 },
  { productNo: 103, name: '수제 떡갈비 6팩', price: 39900 },
  { productNo: 104, name: '선물세트 (불고기+떡갈비)', price: 69900 }
];
const PAYMENTS = ['카드', '카드', '카드', '네이버페이', '네이버페이', '카카오페이', '무통장입금', '토스페이'];
const CHANNELS = ['모바일 웹', '모바일 웹', '모바일 웹', 'PC', '네이버 체크아웃', '카카오 톡체크아웃'];
const REGIONS = ['서울', '서울', '서울', '경기', '경기', '경기', '인천', '부산', '대구', '광주', '광주', '전남', '대전', '경남', '충남', '강원', '제주'];
const OPTIONS = { 101: ['1팩', '2팩 세트', '3팩 세트'], 102: ['오리지널', '매운맛', '카레맛'], 103: ['6팩', '12팩'], 104: [''] };
const CLAIM_REASONS = ['단순 변심', '배송 지연', '포장 파손', '주문 실수', '상품 불만족'];
const MEMBERS = Array.from({ length: 1400 }, (_, i) => 'm' + i);
const NAMES = ['김서연', '이도윤', '박지우', '최하준', '정서아', '강민준', '조하은', '윤지호', '장예린', '임도현', '한수아', '오지훈'];
// 무통장입금은 며칠 동안 입금전(N00)으로 남을 수 있음
const ITEM_STATUS_BY_AGE = age => age === 0 ? ['N10', 'N20', 'N20', 'N00', 'N00'] : age === 1 ? ['N00', 'N20', 'N21', 'N30', 'N30'] : age === 2 ? ['N00', 'N30', 'N40', 'N40'] : age <= 3 ? ['N30', 'N40'] : ['N40', 'N50', 'N50'];

async function demoState() { return (await getJSON('demo/state')) || { campaigns: {}, shipped: {}, replied: {} }; }
async function saveDemoState(s) { await setJSON('demo/state', s); }

/* ---------- 카페24 데모 ---------- */
export async function demoOrders(from, to) {
  const st = await demoState();
  const today = kstDate();
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (d > today) break;
    const r = rng('orders' + d);
    const dow = new Date(d + 'T00:00:00Z').getUTCDay();
    const base = dow === 0 || dow === 6 ? 9 : 14;
    const age = Math.round((Date.parse(today) - Date.parse(d)) / 86400000);
    let count = Math.round(base + r() * 10);
    if (d === today) count = Math.max(2, Math.round(count * 0.55));
    for (let i = 0; i < count; i++) {
      const p = DEMO_PRODUCTS[Math.floor(r() * (r() < 0.15 ? 4 : 3))];
      const qty = p.productNo === 104 ? 1 : 1 + Math.floor(r() * 3);
      const id = `${d.replace(/-/g, '')}-${String(1000000 + i * 7919 % 999999).slice(1)}`;
      const statuses = ITEM_STATUS_BY_AGE(age);
      let status = statuses[Math.floor(r() * statuses.length)];
      if (r() < 0.04) status = age < 2 ? 'C00' : 'C40';
      else if (age >= 2 && age <= 4 && r() < 0.05) status = 'N20'; // 출고가 늦어진 주문
      else if (age > 3 && r() < 0.03) status = 'R40';
      if (st.shipped[id] && status.startsWith('N') && status < 'N30') status = 'N30';
      const nowH = new Date(Date.now() + 9 * 3600000).getUTCHours();
      const maxH = d === today ? Math.max(1, nowH - 7) : 14;
      const hh = String(Math.min(23, 8 + Math.floor(r() * maxH))).padStart(2, '0'), mm = String(Math.floor(r() * 60)).padStart(2, '0');
      const ship = p.price * qty >= 50000 ? 0 : 3500;
      const time = `${d}T${hh}:${mm}:00+09:00`;
      // 결제 후 출고까지 12~60시간, 배송 1~2일
      const shipH = 12 + Math.floor(r() * 48);
      const shippedAt = ['N30', 'N40', 'N50', 'R40'].includes(status) ? new Date(Date.parse(time) + shipH * 3600000).toISOString() : null;
      const deliveredAt = ['N40', 'N50', 'R40'].includes(status) ? new Date(Date.parse(time) + (shipH + 24 + Math.floor(r() * 24)) * 3600000).toISOString() : null;
      const isMember = r() < 0.72;
      const mIdx = Math.floor(Math.pow(r(), 2.2) * MEMBERS.length); // 소수 단골이 자주 사고 대부분은 한두 번
      const opts = OPTIONS[p.productNo] || [''];
      const buyer = NAMES[(mIdx + (isMember ? 0 : 5)) % NAMES.length].replace(/^(.).(.)$/, '$1*$2');
      // 일부 주문은 쿠폰 할인 → 결제금액이 주문금액보다 작음. 일부는 선불금(예치금)으로 일부 결제
      const amount = p.price * qty + ship - (i % 5 === 0 ? 2000 : 0);
      const credits = i % 7 === 3 ? Math.min(amount, 22000) : 0;
      out.push({
        id, date: d, time, orderedAt: time, orderDate: d, paid: status !== 'N00', status,
        amount, cash: amount - credits, points: 0, credits, orderAmount: p.price * qty + ship,
        amounts: credits ? { payment_amount: amount - credits, credits_spent_amount: credits } : {}, shippingFee: ship, buyer,
        canceled: status.startsWith('C'), channel: CHANNELS[Math.floor(r() * CHANNELS.length)],
        payment: PAYMENTS[Math.floor(r() * PAYMENTS.length)],
        firstOrder: null,
        member: isMember ? MEMBERS[mIdx] : null,
        region: REGIONS[Math.floor(r() * REGIONS.length)],
        claimReason: /^[CR]/.test(status) ? CLAIM_REASONS[Math.floor(r() * CLAIM_REASONS.length)] : null,
        tracking: st.shipped[id] || null,
        items: [{ itemCode: id + '-01', productNo: p.productNo, name: p.name, option: opts[Math.floor(r() * opts.length)], variant: '', qty, price: p.price, status, shippedAt, deliveredAt, claimReason: null }]
      });
    }
  }
  return out;
}
/** 취소·반품 완료 주문의 환불: 주문 다음날(취소) 또는 사흘 뒤(반품) 환불 완료 */
export async function demoRefunds(from, to) {
  const orders = await demoOrders(addDays(from, -5), to);
  return orders.filter(o => o.paid !== false && (o.status === 'C40' || o.status === 'R40')).map(o => {
    const date = addDays(o.date, o.status === 'C40' ? 1 : 3);
    return { code: 'RF' + o.id, orderId: o.id, date, amount: o.amount, cash: o.cash, points: 0, credits: o.credits, done: true, numeric: {} };
  }).filter(r => r.date >= from && r.date <= to && r.date <= kstDate());
}
export async function demoInventory() {
  const r = rng('inv' + kstDate());
  const out = [];
  for (const p of DEMO_PRODUCTS) for (const o of OPTIONS[p.productNo] || ['']) {
    const q = p.productNo === 102 && o === '카레맛' ? 0 : p.productNo === 103 && o === '12팩' ? 4 : Math.floor(10 + r() * 120);
    out.push({ productNo: p.productNo, name: p.name, price: p.price, variant: `${p.productNo}-${o}`, option: o, selling: true, display: true, soldOut: q === 0, tracked: true, quantity: q, safety: 10 });
  }
  return out;
}
export async function demoCarriers() {
  return [{ code: 'CJ', name: 'CJ대한통운' }, { code: 'POST', name: '우체국택배' }, { code: 'HANJIN', name: '한진택배' }, { code: 'LOTTE', name: '롯데택배' }];
}
export async function demoShip(orderId, carrierCode, trackingNo) {
  const st = await demoState(); st.shipped[orderId] = { carrierCode, trackingNo }; await saveDemoState(st); return { ok: true };
}
export async function demoArticles(from, to) {
  const st = await demoState();
  const today = kstDate();
  const qs = [
    ['배송 문의', '어제 주문했는데 언제 출고되나요? 주말 전에 받고 싶어요.', 101],
    ['보관 방법', '냉동 보관하면 소비기한이 얼마나 되나요?', 102],
    ['선물 포장', '선물세트에 메시지 카드 넣어주실 수 있나요?', 104],
    ['원재료', '떡갈비에 돼지고기가 들어가나요? 한우 100%인지 궁금합니다.', 103],
    ['교환 요청', '아이스팩이 다 녹아서 왔어요. 고기 상태가 괜찮은지 걱정됩니다.', 101],
    ['대량 주문', '회사 명절 선물로 50세트 주문하려고 하는데 할인 가능한가요?', 104],
    ['조리 방법', '불고기 양념육은 해동 후 바로 구우면 되나요?', 101]
  ];
  const out = [];
  qs.forEach(([title, content, productNo], i) => {
    const date = addDays(today, -Math.floor(i * 1.7));
    if (date < from || date > to) return;
    const no = 5000 + i;
    out.push({
      boardNo: i % 3 === 0 ? 4 : 6, boardName: i % 3 === 0 ? '1:1 문의' : '상품 Q&A',
      articleNo: no, title, content, writer: NAMES[i].replace(/^(.).(.)$/, '$1*$2'),
      createdAt: `${date}T${String(9 + i).padStart(2, '0')}:10:00+09:00`, productNo,
      answered: Boolean(st.replied[no]) || i >= 5, reply: st.replied[no] || (i >= 5 ? '안녕하세요, 지미에프앤비입니다. 문의 주신 내용 안내드립니다.' : null)
    });
  });
  return out;
}
export async function demoReply(articleNo, content) {
  const st = await demoState(); st.replied[articleNo] = content; await saveDemoState(st); return { ok: true };
}

/* ---------- 광고 데모 ---------- */
const DEMO_CAMPAIGNS = {
  meta: [
    { id: 'm-1001', name: '[불고기] 전환_리타게팅', budget: 50000, roas: [3.2, 6.5], productNo: 101 },
    { id: 'm-1002', name: '[육포] 신규_관심사', budget: 30000, roas: [1.2, 3.4], productNo: 102 },
    { id: 'm-1003', name: '[선물세트] 추석 프로모션', budget: 80000, roas: [2.4, 5.2], productNo: 104 }
  ],
  google: [
    { id: 'g-2001', name: '검색_한우불고기', budget: 40000, roas: [3.5, 7.0], productNo: 101 },
    { id: 'g-2002', name: 'P-MAX_전체상품', budget: 60000, roas: [1.8, 4.2], productNo: null }
  ],
  tiktok: [
    { id: 't-3001', name: '떡갈비 숏폼_테스트', budget: 20000, roas: [0.4, 2.1], productNo: 103 }
  ]
};
export async function demoCampaigns(platform) {
  const st = await demoState();
  return (DEMO_CAMPAIGNS[platform] || []).map(c => {
    const o = st.campaigns[platform + ':' + c.id] || {};
    return { platform, id: c.id, name: c.name, status: o.status || 'on', dailyBudget: o.budget ?? c.budget, budgetId: null };
  });
}
/** 데모 광고의 랜딩 주소 (제품 자동 연결 시험용) */
export async function demoCampaignUrls(platform) {
  return Object.fromEntries((DEMO_CAMPAIGNS[platform] || []).filter(c => c.productNo).map(c => [c.id, [`https://demo.example.com/product/${encodeURIComponent(c.name)}/${c.productNo}/category/1/display/1/`]]));
}
export async function demoAdRows(platform, from, to) {
  const camps = await demoCampaigns(platform);
  const today = kstDate();
  const hourFrac = Math.min(1, Math.max(0.15, (new Date(Date.now() + 9 * 3600000).getUTCHours() + 1) / 24));
  const rows = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (d > today) break;
    for (const c of camps) {
      const def = DEMO_CAMPAIGNS[platform].find(x => x.id === c.id);
      const r = rng(platform + c.id + d);
      if (d === today && c.status !== 'on') continue;
      const frac = d === today ? hourFrac : 1;
      const spend = Math.round(c.dailyBudget * (0.75 + r() * 0.3) * frac);
      const roas = def.roas[0] + r() * (def.roas[1] - def.roas[0]);
      const revenue = Math.round(spend * roas / 100) * 100;
      const purchases = Math.max(0, Math.round(revenue / (def.productNo === 104 ? 69900 : 45000)));
      const clicks = Math.round(spend / (300 + r() * 500));
      // 퍼널: 클릭 → 랜딩 → 상품 조회 → 장바구니 → 결제 시작 → 구매 (구글은 장바구니·결제 시작만 전환으로 잡힌다고 가정)
      const landing = platform === 'meta' ? Math.round(clicks * (0.7 + r() * 0.15)) : 0;
      const views = platform === 'meta' ? Math.round(landing * (0.75 + r() * 0.15)) : 0;
      const checkouts = Math.max(purchases, Math.round(purchases * (1.4 + r() * 0.5)));
      const carts = Math.max(checkouts, Math.round(checkouts * (def.productNo === 102 ? 3.4 : 2.1) + r() * 2));
      rows.push({ date: d, platform, campaignId: c.id, name: c.name, spend, impressions: clicks * Math.round(40 + r() * 60), clicks, purchases, revenue: purchases ? revenue : 0, landing, views, carts, checkouts });
    }
  }
  return rows;
}
/* 소재: 캠페인마다 2~3개. 일부 소재는 시간이 지나며 클릭률이 떨어지는(피로도) 패턴 */
const DEMO_ADS = {
  'm-1001': [['불고기 굽는 영상 15초', '영상', 0.5, 0], ['후기 캡처 이미지', '이미지', 0.3, 0], ['3팩 할인 배너', '이미지', 0.2, 1]],
  'm-1002': [['육포 언박싱 릴스', '영상', 0.6, 1], ['매운맛 신제품 이미지', '이미지', 0.4, 0]],
  'm-1003': [['추석 선물세트 카드뉴스', '이미지', 0.55, 0], ['보자기 포장 영상', '영상', 0.45, 0]],
  'g-2001': [['한우 불고기 택배 | 3대째 해남성내식당', '검색 문구', 0.7, 0], ['양념 불고기 선물 | 무료배송', '검색 문구', 0.3, 0]],
  'g-2002': [['전체상품 애셋 그룹', '이미지', 1, 0]],
  't-3001': [['떡갈비 ASMR', '영상', 1, 1]]
};
export async function demoCreativeRows(platform, from, to) {
  const camp = await demoAdRows(platform, from, to);
  const out = [];
  for (const row of camp) {
    const ads = DEMO_ADS[row.campaignId] || [];
    const age = Math.round((Date.parse(kstDate()) - Date.parse(row.date)) / 86400000);
    ads.forEach(([name, , w, tired], k) => {
      const r = rng(row.campaignId + k + row.date);
      const decay = tired ? Math.max(0.4, 1 - (14 - Math.min(14, age)) * 0.045) : 1; // 최근일수록 약해짐
      const share = w * (0.85 + r() * 0.3);
      const part = x => Math.round(x * share);
      const clicks = Math.round(row.clicks * share * decay);
      const purchases = Math.round(row.purchases * share * (tired ? decay * 0.8 : 1.1));
      out.push({ date: row.date, platform, adId: `${row.campaignId}-a${k + 1}`, name, group: platform === 'google' ? '광고그룹 1' : '광고세트 1', campaignId: row.campaignId, campaignName: row.name,
        spend: part(row.spend), impressions: part(row.impressions), clicks, purchases, revenue: row.purchases ? Math.round(row.revenue * purchases / row.purchases) : 0,
        landing: Math.round(row.landing * share * decay), views: Math.round(row.views * share * decay), carts: Math.round(row.carts * share * decay), checkouts: Math.round(row.checkouts * share * decay) });
    });
  }
  return out;
}
export async function demoCreativeInfo(platform) {
  const out = {};
  for (const c of DEMO_CAMPAIGNS[platform] || []) (DEMO_ADS[c.id] || []).forEach(([name, format, , tired], k) => {
    out[`${c.id}-a${k + 1}`] = { status: 'on', thumb: null, format, text: name };
    void tired;
  });
  return out;
}
export async function demoReach(platform, from, to) {
  if (platform !== 'meta') return {};
  const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1);
  const out = {};
  for (const c of DEMO_CAMPAIGNS.meta) (DEMO_ADS[c.id] || []).forEach(([, , , tired], k) => {
    const frequency = +(1.2 + days * (tired ? 0.22 : 0.06)).toFixed(2);
    out[`${c.id}-a${k + 1}`] = { frequency, reach: null };
  });
  return out;
}
export async function demoSetStatus(platform, id, on) {
  const st = await demoState(); const k = platform + ':' + id;
  st.campaigns[k] = { ...(st.campaigns[k] || {}), status: on ? 'on' : 'off' }; await saveDemoState(st);
}
export async function demoSetBudget(platform, id, budget) {
  const st = await demoState(); const k = platform + ':' + id;
  st.campaigns[k] = { ...(st.campaigns[k] || {}), budget }; await saveDemoState(st);
}
