// 차트 도구 (SVG·HTML 문자열). 한 축만 쓰고, 마우스를 올리면 data-tip 내용이 뜬다.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const won = x => (x == null || !isFinite(x)) ? '–' : Math.round(x).toLocaleString('ko-KR') + '원';
export const man = x => {
  if (x == null || !isFinite(x)) return '–';
  const a = Math.abs(x);
  if (a >= 100000000) return (x / 100000000).toFixed(a >= 1e9 ? 0 : 1).replace(/\.0$/, '') + '억';
  if (a >= 10000) return (x / 10000).toFixed(a >= 1000000 ? 0 : 1).replace(/\.0$/, '') + '만';
  return Math.round(x).toLocaleString('ko-KR');
};
export const pctf = (x, d = 1) => (x == null || !isFinite(x)) ? '–' : (x * 100).toFixed(d) + '%';
const md = d => String(d).slice(5).replace('-', '/');

export function niceScale(lo, hi, ticks = 4) {
  if (hi === lo) hi = lo + 1;
  const raw = (hi - lo) / ticks;
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(Math.abs(raw), 1e-9))));
  let step = 10 * p;
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * p) { step = m * p; break; }
  return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step, step };
}

/** 증감 표시: 이전 값 대비 비율. invert=true 면 줄어드는 게 좋은 지표 */
export function delta(cur, prev, { invert = false, label = '' } = {}) {
  if (cur == null || prev == null || !isFinite(cur) || !isFinite(prev) || prev === 0) return `<span class="delta flat">${label ? esc(label) + ' ' : ''}비교 없음</span>`;
  const r = cur / prev - 1;
  if (Math.abs(r) < 0.005) return `<span class="delta flat">${label ? esc(label) + ' ' : ''}변동 없음</span>`;
  const good = invert ? r < 0 : r > 0;
  return `<span class="delta ${good ? 'up' : 'down'}" title="${label ? esc(label) : '이전'} ${esc(man(prev))}">${r > 0 ? '▲' : '▼'} ${Math.abs(r * 100).toFixed(1)}%</span>${label ? ` <span>${esc(label)}</span>` : ''}`;
}

/** 작은 추이선 */
export function spark(values, { color = 'var(--s1)', w = 120, h = 28 } = {}) {
  const v = values.map(x => (x == null || !isFinite(x) ? 0 : x));
  if (v.length < 2) return '';
  const max = Math.max(...v, 1), min = Math.min(...v, 0);
  const x = i => (i / (v.length - 1)) * (w - 4) + 2, y = val => h - 3 - ((val - min) / (max - min || 1)) * (h - 6);
  const pts = v.map((val, i) => `${x(i).toFixed(1)},${y(val).toFixed(1)}`).join(' ');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/><circle cx="${x(v.length - 1)}" cy="${y(v[v.length - 1])}" r="2.5" fill="${color}"/></svg>`;
}

/** 선 차트: series = [{key,label,color,dash,area}], 날짜 축 */
export function lineChart(data, { series, height = 240, fmt = won, x = 'date', width = 760 }) {
  const W = width, H = height, L = 52, R = 12, T = 14, B = 26;
  const n = data.length;
  if (!n) return '<div class="empty">표시할 데이터가 없습니다.</div>';
  const vals = data.flatMap(d => series.map(s => d[s.key]).filter(v => v != null && isFinite(v)));
  const sc = niceScale(Math.min(0, ...vals), Math.max(1, ...vals));
  const X = i => L + (n === 1 ? (W - L - R) / 2 : i * (W - L - R) / (n - 1));
  const Y = v => T + (sc.max - v) / (sc.max - sc.min) * (H - T - B);
  let g = '';
  for (let v = sc.min; v <= sc.max + 1e-9; v += sc.step) g += `<line class="${v === 0 ? 'base' : 'grid'}" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${esc(man(v))}</text>`;
  const every = Math.max(1, Math.ceil(n / Math.max(4, Math.floor(W / 80))));
  data.forEach((d, i) => { if (i % every === 0 || i === n - 1) g += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${esc(md(d[x]))}</text>`; });
  series.forEach((s, si) => {
    const segs = []; let cur = [];
    data.forEach((d, i) => { const v = d[s.key]; if (v == null || !isFinite(v)) { if (cur.length) segs.push(cur); cur = []; } else cur.push([X(i), Y(v)]); });
    if (cur.length) segs.push(cur);
    for (const seg of segs) {
      const pts = seg.map(p => p.join(',')).join(' ');
      if (s.area && seg.length > 1) g += `<polygon points="${seg[0][0]},${Y(Math.max(0, sc.min))} ${pts} ${seg[seg.length - 1][0]},${Y(Math.max(0, sc.min))}" fill="${s.color}" opacity=".12"/>`;
      g += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" ${s.dash ? 'stroke-dasharray="4 4" opacity=".8"' : ''}/>`;
    }
    const last = [...data.keys()].reverse().find(i => data[i][s.key] != null && isFinite(data[i][s.key]));
    if (last != null && !s.dash) g += `<circle cx="${X(last)}" cy="${Y(data[last][s.key])}" r="3.5" fill="${s.color}" stroke="var(--panel)" stroke-width="2"/>`;
    void si;
  });
  // 마우스 영역: 날짜별 세로 띠
  const bw = (W - L - R) / Math.max(1, n - 1);
  data.forEach((d, i) => {
    const tip = [d[x], ...series.map(s => `${s.label}: ${fmt(d[s.key])}`)].join('\n');
    g += `<rect class="hit" x="${Math.max(L, X(i) - bw / 2)}" y="${T}" width="${n === 1 ? W - L - R : bw}" height="${H - T - B}" data-tip="${esc(tip)}"/>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map(s => s.label).join(', '))} 추이">${g}</svg>` + legend(series);
}

export function legend(series) {
  return `<div class="legend">${series.map(s => `<span><i class="${s.dash ? 'dash' : ''}" style="${s.dash ? `color:${s.color}` : `background:${s.color}`}"></i>${esc(s.label)}</span>`).join('')}</div>`;
}

/** 세로 막대 (한 계열) */
export function columnChart(data, { key, label, color = 'var(--s1)', xLabel, height = 200, fmt = won, tip, highlightMax = true, width = 760 }) {
  const W = width, H = height, L = 52, R = 8, T = 12, B = 26;
  const n = data.length || 1;
  const vals = data.map(d => d[key] || 0);
  const sc = niceScale(Math.min(0, ...vals), Math.max(1, ...vals));
  const Y = v => T + (sc.max - v) / (sc.max - sc.min) * (H - T - B);
  const bw = (W - L - R) / n, inner = Math.max(3, Math.min(38, bw * 0.62));
  const maxV = Math.max(...vals);
  let g = '';
  for (let v = sc.min; v <= sc.max + 1e-9; v += sc.step) g += `<line class="${v === 0 ? 'base' : 'grid'}" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${esc(man(v))}</text>`;
  const every = Math.max(1, Math.ceil(n / Math.max(6, Math.floor(W / 30))));
  data.forEach((d, i) => {
    const v = d[key] || 0, cx = L + i * bw + bw / 2;
    const y1 = Y(Math.max(v, 0)), y2 = Y(Math.min(v, 0));
    const c = highlightMax && v === maxV && v > 0 ? color : color;
    g += `<rect x="${cx - inner / 2}" y="${y1}" width="${inner}" height="${Math.max(1, y2 - y1)}" rx="3" fill="${c}" opacity="${highlightMax && v !== maxV ? .6 : 1}"/>`;
    g += `<rect class="hit" x="${L + i * bw}" y="${T}" width="${bw}" height="${H - T - B}" data-tip="${esc(tip ? tip(d) : `${xLabel ? xLabel(d, i) : ''}\n${label}: ${fmt(v)}`)}"/>`;
    if (i % every === 0 || i === n - 1) g += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${esc(xLabel ? xLabel(d, i) : '')}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${g}</svg>`;
}

/** 가로 막대 목록 (구성비) */
export function hbars(list, { name = d => d.name, value = d => d.revenue, fmt = won, sub = null, color = 'var(--s1)', limit = 8 } = {}) {
  if (!list.length) return '<div class="empty">데이터가 없습니다.</div>';
  const rows = list.slice(0, limit);
  const rest = list.slice(limit);
  if (rest.length) rows.push({ __other: true, name: `그 외 ${rest.length}개`, v: rest.reduce((s, d) => s + value(d), 0) });
  const max = Math.max(...rows.map(d => (d.__other ? d.v : value(d))), 1);
  return `<div class="hbars">${rows.map(d => {
    const v = d.__other ? d.v : value(d);
    return `<div class="hbar" data-tip="${esc(`${d.__other ? d.name : name(d)}\n${fmt(v)}${sub && !d.__other ? '\n' + sub(d) : ''}`)}"><span class="nm">${esc(d.__other ? d.name : name(d))}</span><span class="tr"><i style="width:${(v / max * 100).toFixed(1)}%;background:${d.__other ? 'var(--fg-3)' : color}"></i></span><span class="vl">${esc(fmt(v))}${sub && !d.__other ? `<small>${esc(sub(d))}</small>` : ''}</span></div>`;
  }).join('')}</div>`;
}

/** 요일×시간 열지도 */
export function heatmap(heat, { rows = ['일', '월', '화', '수', '목', '금', '토'], unit = '건' } = {}) {
  const max = Math.max(1, ...heat.flat());
  const step = v => v === 0 ? 0 : Math.min(6, 1 + Math.floor((v / max) * 5.999));
  const order = [1, 2, 3, 4, 5, 6, 0]; // 월요일부터
  let h = '<div class="heat" role="img" aria-label="요일·시간대별 주문 수"><span class="lb"></span>';
  for (let i = 0; i < 24; i++) h += `<span class="hr">${i % 3 === 0 ? i : ''}</span>`;
  for (const r of order) {
    h += `<span class="lb">${rows[r]}</span>`;
    for (let i = 0; i < 24; i++) h += `<span style="background:var(--heat-${step(heat[r][i])})" data-tip="${rows[r]}요일 ${i}시\n주문 ${heat[r][i]}${unit}"></span>`;
  }
  h += '</div><div class="heat-scale">적음 ' + [0, 1, 2, 3, 4, 5, 6].map(i => `<i style="background:var(--heat-${i})"></i>`).join('') + ' 많음</div>';
  return h;
}

/** 합이 100%인 가로 분할 막대 */
export function splitBar(parts) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return `<div class="split-bar">${parts.map(p => `<i style="width:${(p.value / total * 100).toFixed(2)}%;background:${p.color}" data-tip="${esc(`${p.label}\n${p.fmt ? p.fmt(p.value) : p.value} (${pctf(p.value / total)})`)}"></i>`).join('')}</div>` +
    `<div class="legend">${parts.map(p => `<span><i style="background:${p.color}"></i>${esc(p.label)} ${pctf(p.value / total, 0)}</span>`).join('')}</div>`;
}
