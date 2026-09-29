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
const NAMES = ['김서연', '이도윤', '박지우', '최하준', '정서아', '강민준', '조하은', '윤지호', '장예린', '임도현', '한수아', '오지훈'];
const ITEM_STATUS_BY_AGE = age => age === 0 ? ['N10', 'N20', 'N20', 'N00'] : age === 1 ? ['N20', 'N21', 'N30'] : age <= 3 ? ['N30', 'N40'] : ['N40', 'N50', 'N50'];

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
      else if (age > 3 && r() < 0.03) status = 'R40';
      if (st.shipped[id] && status.startsWith('N') && status < 'N30') status = 'N30';
      const nowH = new Date(Date.now() + 9 * 3600000).getUTCHours();
      const maxH = d === today ? Math.max(1, nowH - 7) : 14;
      const hh = String(Math.min(23, 8 + Math.floor(r() * maxH))).padStart(2, '0'), mm = String(Math.floor(r() * 60)).padStart(2, '0');
      const ship = p.price * qty >= 50000 ? 0 : 3500;
      out.push({
        id, date: d, time: `${d}T${hh}:${mm}:00+09:00`, status,
        amount: p.price * qty + ship, shippingFee: ship,
        buyer: NAMES[Math.floor(r() * NAMES.length)].replace(/^(.).(.)$/, '$1*$2'),
        canceled: status.startsWith('C'), channel: r() < 0.7 ? '모바일' : 'PC',
        tracking: st.shipped[id] || null,
        items: [{ itemCode: id + '-01', productNo: p.productNo, name: p.name, option: '', qty, price: p.price, status }]
      });
    }
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
      rows.push({ date: d, platform, campaignId: c.id, name: c.name, spend, impressions: clicks * Math.round(40 + r() * 60), clicks, purchases, revenue: purchases ? revenue : 0 });
    }
  }
  return rows;
}
export async function demoSetStatus(platform, id, on) {
  const st = await demoState(); const k = platform + ':' + id;
  st.campaigns[k] = { ...(st.campaigns[k] || {}), status: on ? 'on' : 'off' }; await saveDemoState(st);
}
export async function demoSetBudget(platform, id, budget) {
  const st = await demoState(); const k = platform + ':' + id;
  st.campaigns[k] = { ...(st.campaigns[k] || {}), budget }; await saveDemoState(st);
}
