// render-go.mjs — 把 go-data.json 画成「OpenCode Go 性价比斩杀线」SVG（go-chart.svg）
//
// X = **官方估算的每月可跑请求数**（log 轴，向右＝更能跑），Y = 智力指数（AA 单源）。
// 注意本图 X 轴方向与前四张榜**相反**：那边 X 是"越低越好"的代价轴，这边 X 是"越多越好"的
// 价值轴，所以高性价比区和 Pareto 阶梯都在**右上角**，与 CommandCode tab 同构。
//
// 三个口径上的硬约束（改之前先读 fetch-go.mjs 头注释）：
//   · 只画 OpenCode Go（$10/月）一档：Go Plus / Go Teams 是同一批模型的三套额度，混进来会让
//     同名模型出现在三个 X 位置，而图上没有价格轴，读者看不出那是 3× 额度 / 4× 月费。
//   · Y 只用 AA Intelligence Index：CommandCode 的 Intelligence 列和 AA 已经不是同一把尺子
//     （国产开放权重模型系统性高 10~16 分），两根尺子混在一根 Y 轴上，点的高低就有一半来自
//     尺子差异。AA 没评分的模型（~17 个）在表里标「🆕 待更新」，不上图。
//   · X 是**官方估算**（按典型 Go 用法的 token 画像算的），不是官方保证值；轴标题里写明。
//
// 与 CommandCode 图的两处差别（都是被数据逼出来的）：
//   1. X 轴用 `X_LADDER` 阶梯自适应（同 render-vc / render-tb）：当前数据 $735~$216,670，
//      阶梯域取 500~500k；若沿用 render-plans 的"10 的整数次幂"写法（100~1M），
//      左右各空掉 1/5 画布。
//   2. Y 轴**不设 60 分母**：有分的 14 个点落在 27~50，照 render-plans 的 max(60, …) 会把
//      上面 1/6 画布留白。这里取 `ceil((max+2)/5)*5`（50 → 55），只留大圆 + callout 的抬头空间。
//
// peak 孪生（DeepSeek V4.1 Flash / V4 Pro）：官方价格表给了 off-peak 与 peak 两套真价，
// 倍率精确（2×），所以图上并排两个点。peak 点用虚线环 + 一条细引线连回同一模型的 off-peak 点，
// 表示"同一款模型的另一个时段"，而不是另一款模型。
//
// 用法: node scripts/render-go.mjs [--dir <dir>] [--in <go-data.json>] [--out <go-chart.svg>]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logoFileOf, logoUriOf } from './logos.mjs';

const argv = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
};
const DIR = argv('--dir') ?? process.env.MKL_DIR ?? path.join(os.tmpdir(), 'model-killing-line');
mkdirSync(DIR, { recursive: true });
const IN = argv('--in') ?? path.join(DIR, 'go-data.json');
const OUT = argv('--out') ?? path.join(DIR, 'go-chart.svg');

const data = JSON.parse(readFileSync(IN, 'utf8'));
const rows = data.rows ?? [];
if (!rows.length) throw new Error('go-data.json has no rows — 先跑 fetch-go.mjs');

// 绘图只收「有智力分 **且** 有官方估算请求数」的行：
//   index == null        → 没有 Y 值（🆕 待更新，只进表格）；
//   requests_month == null → 免费档（官方写 Unlimited），log 轴画不了"无限"。
// 两个条件缺一不可：只判 index 的话，免费模型一旦被评分就会以 requests_month=null 进 X()，
// 坐标域算出 NaN，整张图崩掉。
const scored = rows.filter((r) => r.index != null && r.requests_month != null);
if (!scored.length) throw new Error('go-data.json 没有同时有智力 + 请求数的行，画不出来');

// peak/off-peak 孪生名带「 (peak)」/「 (off-peak)」后缀，查 logo 前要剥掉，
// 否则带后缀的那个点会退化成无图标的实心小圆点（同一款模型在图上长得不一样）。
const baseModel = (m) => m.replace(/\s*\((?:off-)?peak\)$/i, '');
const logoInfoOf = (m) => {
  const f = logoFileOf(baseModel(m)) ?? logoFileOf(rows.find((r) => r.model === m)?.aa_model ?? '');
  return f ? { file: f, uri: logoUriOf(f) } : null;
};

// ---- 高性价比区 / 分层 ----
// 右上角 =「又能跑又够聪明」。阈值按本榜实际分布定（14 个有分点，27~50 分 / 735~216,670 次）：
//   100K 次/月以上只有 3 个点（DeepSeek 的 off-peak+peak 孪生、MiMo-V2.6-Flash），
//   而 27 分就是这一簇里最低的那个（MiMo-V2.6-Flash）——再往下就没有"又能跑又够用"的组合了，
//   再往上开会把 MiMo 挡在区外、只剩 DeepSeek 一家。
const ZONE_INDEX = 27;
const ZONE_REQ = 100000; // 次/月
const inZone = (r) => r.index >= ZONE_INDEX && r.requests_month >= ZONE_REQ;
// Contributor（数据换折扣档）不进主 Pareto：它两轴都是全场最好，计入会把阶梯压成一两步。
// OpenCode 上 Muse Spark 1.3/1.2 Contributor 目前 AA 还没有分 → 图上不会出现这一层；
// 代码分支留着，AA 未来给分时自动生效。
const mainRows = scored.filter((r) => !r.contributor);
// 两轴同向（都是"越多越好"）→ 按 requests 降序扫 index record-high，取右上包络。
// MIN_STEP = 0.5：一步至少涨 0.5 分才算台阶（AA 取整，+0.1 那种是测量噪声）；
// 且 best 只在**真正记入**时更新，被跳过的点不能抬高门槛。
// gen-html 表格侧的 🔪 扫描用同一常量 GO_MIN_STEP，两边必须同步。
const MIN_STEP = 0.5;
const paretoOf = (list) => {
  const out = [];
  let best = -Infinity;
  for (const r of [...list].sort((a, b) => b.requests_month - a.requests_month)) {
    if (r.index >= best + MIN_STEP) { best = r.index; out.push(r); }
  }
  return out;
};
const frontier = paretoOf(mainRows);
const frontModels = new Set(frontier.map((r) => r.model));

// 无 logo 回退字母（同 render-plans）
const logoOf = (m) => {
  const s = m.toLowerCase();
  if (s.startsWith('gpt')) return 'G';
  if (s.startsWith('gemini')) return 'M';
  if (s.startsWith('claude')) return 'C';
  if (s.startsWith('muse')) return '∞';
  if (s.startsWith('grok')) return 'X';
  if (s.startsWith('qwen')) return 'W';
  if (s.startsWith('glm')) return 'Z';
  if (s.startsWith('kimi')) return 'K';
  if (s.startsWith('deepseek')) return 'D';
  if (s.startsWith('mimo')) return 'M';
  if (s.startsWith('minimax')) return 'M';
  if (s.startsWith('step')) return 'S';
  if (/^hy\d/.test(s)) return 'T';
  if (s.startsWith('longcat')) return 'L';
  return '●';
};

const LOGO_RING = '#487265';
const DEAL_RING = '#c98415';   // Contributor 数据换折扣档（不计入阶梯）
const PEAK_RING = '#8a8a8a';   // peak 时段孪生（同一模型的另一个时段）
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtReq = (v) => (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1000 ? Math.round(v / 1000) + 'k' : String(Math.round(v)));

// ---- 画布 / 轴 ----
const svgW = 920, svgH = 560;
const padL = 70, padR = 30, padT = 50, padB = 60;
const plotW = svgW - padL - padR, plotH = svgH - padT - padB;

// x：按 1/2/5 阶梯自适应（同 render-vc / render-tb 的 X_LADDER）：
// 左边界 = 比数据最小值更低一档的刻度，右边界 = 覆盖最大值的下一档刻度。
const X_LADDER = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6, 2e6, 5e6, 1e7];
const xVals = scored.map((r) => r.requests_month);
const xLo = Math.min(...xVals), xHi = Math.max(...xVals);
const xMin = [...X_LADDER].reverse().find((t) => t <= xLo) ?? X_LADDER[0];
const xMax = X_LADDER.find((t) => t >= xHi) ?? X_LADDER[X_LADDER.length - 1];
const X = (v) => padL + (Math.log10(Math.max(v, xMin)) - Math.log10(xMin)) / (Math.log10(xMax) - Math.log10(xMin)) * plotW;

// y：下界沿用 min(20, …) 的惯例（留出"不聪明"的参照带），上界按数据上沿 + 抬头空间扩到 5 的倍数。
const yVals = scored.map((r) => r.index);
const yMin = Math.min(20, Math.floor(Math.min(...yVals) / 5) * 5);
const yMax = Math.max(Math.ceil((Math.max(...yVals) + 2) / 5) * 5, yMin + 20);
const Y = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * plotH;

const xTicks = X_LADDER.filter((t) => t >= xMin && t <= xMax);
const yTicks = [];
for (let t = yMin + 5; t <= yMax; t += 5) yTicks.push(t);

const zoneX = X(ZONE_REQ), zoneY = Y(ZONE_INDEX);

let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" id="chart" style="font-family:-apple-system,'PingFang SC','Helvetica Neue',sans-serif;background:#ffffff">`;

// 高性价比区（右上：次数 ≥ 阈值 且 智力 ≥ 阈值）
s += `<rect x="${zoneX.toFixed(1)}" y="${padT}" width="${(padL + plotW - zoneX).toFixed(1)}" height="${(zoneY - padT).toFixed(1)}" fill="#8caa5e" fill-opacity="0.10" stroke="#8caa5e" stroke-opacity="0.35" stroke-dasharray="3,3"/>`;
s += `<text x="${(padL + plotW - 8).toFixed(1)}" y="${padT + 18}" font-size="11" fill="#5b7a3a" font-weight="600" text-anchor="end">高性价比区</text>`;
s += `<text x="${(padL + plotW - 8).toFixed(1)}" y="${padT + 32}" font-size="10" fill="#5b7a3a" text-anchor="end">智力 ≥ ${ZONE_INDEX} 且 ≥ ${fmtReq(ZONE_REQ)} 次/月</text>`;

for (const t of xTicks) s += `<line x1="${X(t).toFixed(1)}" y1="${padT}" x2="${X(t).toFixed(1)}" y2="${padT + plotH}" stroke="#ececec"/>`;
for (const t of yTicks) s += `<line x1="${padL}" y1="${Y(t).toFixed(1)}" x2="${padL + plotW}" y2="${Y(t).toFixed(1)}" stroke="#ececec"/>`;
s += `<line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="#444"/>`;
s += `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#444"/>`;
for (const t of xTicks) {
  s += `<line x1="${X(t).toFixed(1)}" y1="${padT + plotH}" x2="${X(t).toFixed(1)}" y2="${padT + plotH + 5}" stroke="#444"/>`;
  s += `<text x="${X(t).toFixed(1)}" y="${padT + plotH + 20}" text-anchor="middle" font-size="11" fill="#555">${fmtReq(t)}</text>`;
}
for (const t of yTicks) {
  s += `<line x1="${padL - 5}" y1="${Y(t).toFixed(1)}" x2="${padL}" y2="${Y(t).toFixed(1)}" stroke="#444"/>`;
  s += `<text x="${padL - 10}" y="${(Y(t) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#555">${t}</text>`;
}
s += `<text x="${padL + plotW / 2}" y="${svgH - 14}" text-anchor="middle" font-size="12" fill="#333">OpenCode Go（$${data.plan_price ?? 10}/月）每月可跑请求数（官方估算）</text>`;
s += `<text transform="translate(20,${padT + plotH / 2}) rotate(-90)" text-anchor="middle" font-size="12" fill="#333">智力指数</text>`;

// Pareto 阶梯：请求数升序连线 = 从左下到右上的上升阶梯
if (frontier.length > 1) {
  const asc = [...frontier].sort((a, b) => a.requests_month - b.requests_month);
  const d = 'M' + asc.map((f) => `${X(f.requests_month).toFixed(1)},${Y(f.index).toFixed(1)}`).join(' L');
  s += `<path d="${d}" fill="none" stroke="#888" stroke-width="1.5" stroke-dasharray="5,4"/>`;
}

const attrsOf = (r, extra = '') => {
  const info = logoInfoOf(r.model);
  return `data-model="${esc(r.model)}" data-index="${r.index}" data-isrc="${r.index_source}" data-req="${Math.round(r.requests_month)}"`
    + ` data-req5h="${r.requests_5h == null ? '' : Math.round(r.requests_5h)}" data-reqweek="${r.requests_week == null ? '' : Math.round(r.requests_week)}"`
    + ` data-limit="${r.monthly_limit ?? ''}" data-contributor="${r.contributor ? 1 : 0}" data-tier="${r.tier ?? 'off-peak'}"`
    + ` data-peakratio="${r.peak_ratio ?? ''}" data-peakwin="${esc(r.peak_window ?? '')}" data-perusd="${Math.round(r.requests_per_usd ?? 0)}"`
    + ` data-in="${r.price_in ?? ''}" data-out="${r.price_out ?? ''}" data-cache="${r.price_cache ?? ''}"`
    + ` data-aa="${r.aa_index ?? ''}" data-aavariant="${esc(r.aa_model ?? '')}" data-creator="${esc(r.creator)}"`
    + (inZone(r) ? ' data-zone="1"' : '')
    + (frontModels.has(r.model) ? ' data-front="1"' : '') + (r.contributor ? ' data-deal="1"' : '')
    + (info ? ` data-logo="${info.file}"` : '') + extra;
};

// peak 孪生：先画一条从 off-peak 到 peak 的细引线，让"这两个点是同一款模型"一眼可见
const twinBase = (m) => /\(peak\)$/i.test(m) ? m.replace(/\s*\(peak\)$/i, '') : null;
for (const r of scored) {
  const b = twinBase(r.model);
  if (!b) continue;
  const off = scored.find((o) => o.model === `${b} (off-peak)`);
  if (!off) continue;
  s += `<line x1="${X(off.requests_month).toFixed(1)}" y1="${Y(off.index).toFixed(1)}" x2="${X(r.requests_month).toFixed(1)}" y2="${Y(r.index).toFixed(1)}" stroke="${PEAK_RING}" stroke-width="1" stroke-dasharray="2,2" opacity="0.8"/>`;
}

// 非前沿点
for (const r of scored) {
  if (frontModels.has(r.model)) continue;
  const cx = X(r.requests_month), cy = Y(r.index);
  const info = logoInfoOf(r.model);
  const isPeak = /\(peak\)$/i.test(r.model);
  const ring = r.contributor ? DEAL_RING : (isPeak ? PEAK_RING : LOGO_RING);
  const attrs = attrsOf(r);
  if (info) {
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="9" fill="#fff" stroke="${ring}" stroke-width="${r.contributor || isPeak ? 1.6 : 1.2}" ${isPeak ? 'stroke-dasharray="3,2" ' : ''}${attrs}/>`;
    s += `<image href="${info.uri}" x="${(cx - 6).toFixed(1)}" y="${(cy - 6).toFixed(1)}" width="12" height="12" preserveAspectRatio="xMidYMid slice" ${attrs}/>`;
  } else {
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4" fill="${ring}" fill-opacity="0.7" ${attrs}/>`;
  }
  s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="12" fill="transparent" ${attrs} class="dot-hit"/>`;
}

// ---- 前沿大圆：固定画在**真实坐标**上，不做 de-clutter（同 render-plans）----
// 斩杀线的语义就是点的真实位置。R=15：DeepSeek off-peak(216,670) 与 peak(108,335) 两个孪生
// 在 log 轴上相距 ~38px，2R=30 不相交；再大会叠在一起。
const R = 15;
const markPos = new Map();
for (const f of frontier) markPos.set(f.model, { cx: X(f.requests_month), cy: Y(f.index) });

s += `<defs><clipPath id="go-frontier-clip"><circle r="13"/></clipPath></defs>`;
for (const f of frontier) {
  const { cx, cy } = markPos.get(f.model);
  const info = logoInfoOf(f.model);
  const ring = f.contributor ? DEAL_RING : LOGO_RING;
  s += `<g class="frontier-mark" ${attrsOf(f)} style="cursor:pointer">`;
  if (info) {
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R}" fill="#fff" stroke="${ring}" stroke-width="3"/>`;
    s += `<g clip-path="url(#go-frontier-clip)" transform="translate(${cx.toFixed(1)},${cy.toFixed(1)})"><image href="${info.uri}" x="-13" y="-13" width="26" height="26" preserveAspectRatio="xMidYMid slice"/></g>`;
  } else {
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R}" fill="${ring}" stroke="white" stroke-width="3"/>`;
    s += `<text x="${cx.toFixed(1)}" y="${(cy + 5).toFixed(1)}" text-anchor="middle" font-size="${logoOf(f.model).length > 1 ? 13 : 18}" font-weight="700" fill="white">${logoOf(f.model)}</text>`;
  }
  s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R + 5}" fill="none" stroke="${ring}" stroke-width="1.5" opacity="0.45"/>`;
  s += `</g>`;
}

// Contributor 数据换折扣档：单独虚线大圈 + 标注，不计入阶梯（AA 有分时才会出现）
for (const r of scored.filter((x) => x.contributor)) {
  const cx = X(r.requests_month), cy = Y(r.index);
  s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="26" fill="none" stroke="${DEAL_RING}" stroke-width="1.5" stroke-dasharray="4,3" ${attrsOf(r)}/>`;
  s += `<text x="${cx.toFixed(1)}" y="${(cy - 32).toFixed(1)}" text-anchor="middle" font-size="10" fill="${DEAL_RING}" font-weight="600">数据换折扣</text>`;
  s += `<text x="${cx.toFixed(1)}" y="${(cy - 21).toFixed(1)}" text-anchor="middle" font-size="9" fill="${DEAL_RING}">不计入阶梯</text>`;
}

// callout 碰撞感知布局（同 render-plans：8 候选位 + 避点/避盒）
const FRONTIER_PAD = 24, DOT_PAD = 13, BOX_GAP = 8;
const CANDIDATES = [
  { dx: 0, dy: -43 }, { dx: 0, dy: 43 }, { dx: 0, dy: -75 }, { dx: 0, dy: 75 },
  { dx: -80, dy: -43 }, { dx: 80, dy: -43 }, { dx: -80, dy: 43 }, { dx: 80, dy: 43 },
];
const fDots = frontier.map((f) => { const p = markPos.get(f.model); return { x: p.cx, y: p.cy, pad: FRONTIER_PAD, model: f.model }; });
const bDots = scored.filter((r) => !frontModels.has(r.model) && !r.contributor)
  .map((r) => ({ x: X(r.requests_month), y: Y(r.index), pad: DOT_PAD, model: r.model }));
const hitsAny = (list, bx, by, bw, bh) => list.some((d) => d.x > bx - d.pad && d.x < bx + bw + d.pad && d.y > by - d.pad && d.y < by + bh + d.pad);
const placed = [];
const hitsBox = (bx, by, bw, bh) => placed.some((b) => bx < b.x + b.w + BOX_GAP && bx + bw + BOX_GAP > b.x && by < b.y + b.h + BOX_GAP && by + bh + BOX_GAP > b.y);
let above = true;
let unplaced = 0;
for (const f of frontier) {
  const mp = markPos.get(f.model);
  const cx = mp.cx, cy = mp.cy;
  const boxW = Math.max(80, f.model.length * 6.2 + 16), boxH = 22;
  const ordered = [...CANDIDATES].sort((a, b) =>
    (above ? (a.dy < 0 ? 0 : 1) - (b.dy < 0 ? 0 : 1) : (a.dy > 0 ? 0 : 1) - (b.dy > 0 ? 0 : 1))
    || (Math.abs(a.dx) + Math.abs(a.dy) - (Math.abs(b.dx) + Math.abs(b.dy))));
  let pos = null;
  for (const c of ordered) {
    let bx = Math.min(Math.max(4, cx + c.dx - boxW / 2), svgW - 4 - boxW);
    const by = cy + c.dy - boxH / 2;
    if (by < 42 || by + boxH > svgH - 26) continue;
    if (hitsAny(fDots.filter((d) => d.model !== f.model), bx, by, boxW, boxH)) continue;
    if (hitsAny(bDots, bx, by, boxW, boxH)) continue;
    if (hitsBox(bx, by, boxW, boxH)) continue;
    pos = { bx, by }; break;
  }
  above = !above;
  if (!pos) { unplaced++; continue; }
  placed.push({ x: pos.bx, y: pos.by, w: boxW, h: boxH });
  const isAbove = pos.by + boxH / 2 < cy;
  const tx = Math.min(Math.max(cx, pos.bx), pos.bx + boxW);
  const ty = isAbove ? pos.by + boxH : pos.by;
  const dy = isAbove ? cy - 19 : cy + 19;
  s += `<line x1="${cx.toFixed(1)}" y1="${dy.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${ty.toFixed(1)}" stroke="#888" stroke-width="0.8"/>`;
  s += `<rect x="${pos.bx}" y="${pos.by}" width="${boxW}" height="${boxH}" rx="11" fill="white" stroke="#d0d0d0"/>`;
  s += `<text x="${(pos.bx + boxW / 2).toFixed(1)}" y="${(pos.by + boxH / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="#333">${esc(f.model)}</text>`;
}

// legend
const ly = 38;
let lx = padL;
s += `<line x1="${lx}" y1="${ly}" x2="${lx + 22}" y2="${ly}" stroke="#888" stroke-dasharray="5,4"/>`;
s += `<text x="${lx + 26}" y="${ly + 4}" font-size="10" fill="#555">Pareto 阶梯</text>`; lx += 108;
s += `<rect x="${lx}" y="${ly - 6}" width="22" height="12" fill="#8caa5e" fill-opacity="0.2" stroke="#8caa5e" stroke-opacity="0.4" stroke-dasharray="2,2"/>`;
s += `<text x="${lx + 26}" y="${ly + 4}" font-size="10" fill="#555">高性价比区</text>`; lx += 118;
if (scored.some((r) => /\(peak\)$/i.test(r.model))) {
  s += `<circle cx="${lx + 8}" cy="${ly}" r="7" fill="none" stroke="${PEAK_RING}" stroke-width="1.5" stroke-dasharray="3,2"/>`;
  s += `<text x="${lx + 20}" y="${ly + 4}" font-size="10" fill="#555">peak 时段孪生</text>`; lx += 110;
}
if (scored.some((r) => r.contributor)) {
  s += `<circle cx="${lx + 8}" cy="${ly}" r="7" fill="none" stroke="${DEAL_RING}" stroke-width="1.5" stroke-dasharray="3,2"/>`;
  s += `<text x="${lx + 20}" y="${ly + 4}" font-size="10" fill="#555">数据换折扣 · 不计入阶梯</text>`;
}

s += `<text x="${padL}" y="22" font-size="14" font-weight="700" fill="#222">OpenCode Go 斩杀线</text>`;
s += `</svg>`;

writeFileSync(OUT, s);
console.log('go-chart.svg bytes:', s.length, '→', OUT);
console.log(`plan: ${data.plan} $${data.plan_price}/mo  rows: ${rows.length}  (catalog ${data.catalog_size} → 有智力 ${scored.length})`);
console.log(`x domain: ${fmtReq(xMin)}–${fmtReq(xMax)} 次/月   y domain: ${yMin}–${yMax}`);
console.log(`高性价比区 (智力≥${ZONE_INDEX} & ≥${fmtReq(ZONE_REQ)}次/月，右上): ${scored.filter(inZone).length} 个模型`);
console.log('pareto (主图层, Contributor 除外):', frontier.map((f) => `${f.model}/智力${f.index}/${fmtReq(f.requests_month)}次`).join(', '));
console.log('labeled:', placed.length, '/', frontier.length, unplaced ? `（未放下 ${unplaced} 个，圆点仍在，hover 可看名字）` : '');
console.log('待更新（AA 无分，只进表格）:', rows.filter((r) => r.index == null).map((r) => r.model).join(', ') || '(none)');
console.log('免费档:', rows.filter((r) => r.free).map((r) => r.model).join(', ') || '(none)');
