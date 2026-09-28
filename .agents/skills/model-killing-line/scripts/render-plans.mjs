// render-plans.mjs — 把 plans-data.json 画成「CommandCode 性价比斩杀线」SVG（plans-chart.svg）
//
// X = **官方发布的每月可跑请求数**（log 轴），Y = 智力指数。
// Y 轴是**混源**的：CommandCode 自家 Intelligence 优先（60 个模型），取不到的才用 AA 兜底（6 个）。
// 两边实测 |Δ| 平均 0.25、最大 0.5，是同一把尺子（CC 保留 1 位小数、AA 取整），混用不引入系统偏移；
// 而 CC 覆盖面大得多（AA 那份榜单压根没有 GPT-5.6 Luna / GLM-5.2 / Claude Sonnet 4.6），单用 AA
// 会把一批有分的模型挡在图外。点自身的来源在 tooltip 里标（CC / AA）。
// 性价比 = 请求数 ÷ 官方月费（Max 10× $100/月），即"一块钱能买多少次请求"。
//
// 数据口径（这里改过一次，教训记在 fetch-plans.mjs 头注释）：X 早先是自己按统一 token
// 口径反推的（1000 in / 50K cache / 200 out），理由是要跨站对齐每请求 token 假设——但图
// 最后收敛到单站单 plan，根本没有第二站要对齐，那个理由不成立了，反推本身反倒引入 3–11%
// 系统偏差。现在直接取官方 requests/5h/week/month 三列。
//
// 注意本图 X 轴方向与前三张榜**相反**：那边 X 是"越低越好"的代价轴，这边 X 是"越多越好"的
// 价值轴，所以高性价比区和 Pareto 阶梯都在**右上角**。
//   - 高性价比区：智力 ≥ 35 且 ≥ 100K 次/月。
//   - Pareto 阶梯：按 requests **降序**扫 index 的 record-high（两轴同向，取右上包络），
//     5 步：MiMo V2.6 Flash → DeepSeek V4.1 Flash → MiMo V2.6 Pro → GPT-6 Sol → Claude Opus 5.5。
//   - 竖虚线：官方自己给的"Max 10× 全模型混合均值 ~230K 次/月"，用来判断某模型相对该 plan
//     的典型用法是偏贵还是偏便宜（官方口径是 ~43% standard / ~57% premium 的混合）。
//
// 滚动窗口：Max 10× 月度额度 $150，但 5 小时限额 $45、每周 $90，所以"次/月"不是随时跑得满
// 的——按周限额最狠地烧，standard 池约 1.7 周、premium 池约 1.1 周就会见底。逐模型的 5h/周
// 次数都在 tooltip 里。
//
// Contributor = **数据换折扣**档（用户确认的机制；官方文档只在价格表出现、正文没写，
// 所以机制描述属于外部信息，倍率必须自己查表核实）。
// 倍率**不是 5 折**：官方价格表实测 Muse Spark 1.3 Contributor 的
// input $0.10 / output $0.20 / cache read $0.002，同款常规版 $1.25 / $4.25 / $0.15 ——
// 分别便宜 12.5×、21.25×、75×，低一到两个数量级。早期图上写"数据换 5 折"是错的，已改。
// 不计入 Pareto：它智力 48.1 且 682K 次/月，扫描时会吃掉除 Claude Opus 5.5 外的所有阶梯点，
// 5 步直接压成 2 步。单独画成虚线圈。
//
// premium 子池（$100 档 vs standard $150）曾单独用紫圈 + 图例标出，后按要求移除：次/月 已经
// 把池子算进去了（premium = $100÷单价，standard = $150÷单价），单模型用户只看次数就够；
// 混用时两个限额并行独立的细节属脚注内容，不值得占一个视觉编码。
//
// 5 小时/周窗口不进图（会再加一个数量级的轴），只在 tooltip/表格里展示官方估算。
//
// 用法: node scripts/render-plans.mjs [--dir <dir>] [--in <plans-data.json>] [--out <plans-chart.svg>]
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
const IN = argv('--in') ?? path.join(DIR, 'plans-data.json');
const OUT = argv('--out') ?? path.join(DIR, 'plans-chart.svg');

const data = JSON.parse(readFileSync(IN, 'utf8'));
// rows 里有 index == null 的（官方价格表有、但 CC 和 AA 都还没出分）。这些**画不出来**——
// Y 轴是智力，没值就没有坐标——所以绘图全链路只用 scored。关键是要连坐标域一起排除：
// Jev 无智力但官方给了 4,460,000 次/月，一旦混进 xVals，log 域被撑到 10M，
// 其余 30 多个点会全被挤到画布最左边 1/6 的位置。
const rows = data.rows;
if (!rows?.length) throw new Error('plans-data.json has no rows — 先跑 fetch-plans.mjs');
// 绘图只收「有智力分 **且** 有官方请求数」的行。两个条件缺一不可：
//   index == null        → 没有 Y 值（待更新）；
//   requests_month == null → 免费档（官方写 Free，不限量），log 轴画不了"无限"。
// 只判 index 的话，一旦某个免费模型将来被 CC 评了分就会以 requests_month=null 进 X()，
// 坐标域算出 NaN，整张图崩掉。
const scored = rows.filter((r) => r.index != null && r.requests_month != null);
if (!scored.length) throw new Error('plans-data.json 全是 index=null，没有可绘制的点');

// peak/off-peak 孪生名带「 (peak)」/「 (off-peak)」后缀，查 logo 前要剥掉，
// 否则带后缀的那个点会退化成无图标的实心小圆点（同一款模型却在图上长得不一样）。
const baseModel = (m) => m.replace(/\s*\((?:off-)?peak\)$/i, '');
const logoInfoOf = (m) => {
  const f = logoFileOf(baseModel(m)) ?? logoFileOf(data.rows.find((r) => r.model === m)?.aa_model ?? '');
  return f ? { file: f, uri: logoUriOf(f) } : null;
};

// ---- 高性价比区 / 分层 ----
// 右上角 = 「又聪明又能跑得多」：智力越高越好，官方请求数越多越好
const ZONE_INDEX = 35;
const ZONE_REQ = 100000; // 次/月
const inZone = (r) => r.index >= ZONE_INDEX && r.requests_month >= ZONE_REQ;
// Contributor（折扣档，低 1~2 个数量级）单独分层：混进 Pareto 会把 5 步阶梯压成 2 步
const mainRows = scored.filter((r) => !r.contributor);
// 两轴同向（都是"越多越好"）→ 按 requests 降序扫 index record-high，取右上包络
// MIN_STEP：一步至少要涨这么多智力才算数。
//   严格 Pareto 只要求"更高"，但 CC 的分只给到 1 位小数，+0.1 这种步是测量噪声，
//   画成"阶梯"会让人以为那里真有一档。实测踩到过：MiMo V2.6 Pro 智力 46.3 → Grok 4.7
//   智力 46.4，涨 0.1 却把次数从 214,000 打到 8,990（24 倍），这种"悬崖"不是台阶。
//   注意 best 只在**真正记入**时更新，被跳过的点不会抬高门槛，否则 46.3→46.4→46.6 会被
//   一路带偏、把后面真正够格的 47.5 也吞掉。
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

// 无 logo 回退字母
const logoOf = (m) => {
  const s = m.toLowerCase();
  if (s.startsWith('gpt-')) return 'G';
  if (s.startsWith('gemini')) return 'M';
  if (s.startsWith('claude')) return 'C';
  if (s.startsWith('muse')) return '∞';
  if (s.startsWith('grok')) return 'X';
  if (s.startsWith('qwen')) return 'W';
  if (s.startsWith('glm-')) return 'Z';
  if (s.startsWith('kimi')) return 'K';
  if (s.startsWith('deepseek')) return 'D';
  if (s.startsWith('mimo')) return 'M';
  if (s.startsWith('minimax')) return 'M';
  if (s.startsWith('tencent')) return 'T';
  if (s.startsWith('step')) return 'S';
  return '●';
};

const LOGO_RING = '#487265';
const DEAL_RING = '#c98415';   // Contributor 数据换折扣档（低 1~2 个数量级，单独分层不计入阶梯）
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtReq = (v) => (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1000 ? Math.round(v / 1000) + 'k' : String(Math.round(v)));

// ---- 画布 / 轴 ----
const svgW = 920, svgH = 560;
const padL = 70, padR = 30, padT = 50, padB = 60;
const plotW = svgW - padL - padR, plotH = svgH - padT - padB;

// x: log 基础域 1k ~ 1M，数据超界时扩展到 10 的整数倍
const niceUp = (m, base) => { let p = base; while (p < m) p *= 10; return p; };
const xVals = scored.map((r) => r.requests_month);
const xMin = Math.pow(10, Math.floor(Math.log10(Math.min(...xVals))));
const xMax = niceUp(Math.max(...xVals), xMin);
const X = (v) => padL + (Math.log10(Math.max(v, xMin)) - Math.log10(xMin)) / (Math.log10(xMax) - Math.log10(xMin)) * plotW;

// y: 基础域 20 ~ 60，超界扩展到 5 的整数倍
const yVals = scored.map((r) => r.index);
const yMin = Math.min(20, Math.floor(Math.min(...yVals) / 5) * 5);
const yMax = Math.max(60, Math.ceil(Math.max(...yVals) / 5) * 5);
const Y = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * plotH;

const xTicks = [];
for (let t = xMin; t <= xMax; t *= 10) for (const m of [1, 2, 5]) if (t * m <= xMax) xTicks.push(t * m);
const yTicks = [];
for (let t = yMin + 5; t <= yMax; t += 5) yTicks.push(t);

const zoneX = X(ZONE_REQ), zoneY = Y(ZONE_INDEX);

let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" id="chart" style="font-family:-apple-system,'PingFang SC','Helvetica Neue',sans-serif;background:#ffffff">`;

// 高性价比区（右上：次数 ≥ 阈值 且智力 ≥ 阈值）
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
  s += `<text x="${padL - 10}" y="${Y(t).toFixed(1) + 4}" text-anchor="end" font-size="11" fill="#555">${t}</text>`;
}
s += `<text x="${padL + plotW / 2}" y="${svgH - 14}" text-anchor="middle" font-size="12" fill="#333">CommandCode Max 10× 每月可跑请求数</text>`;
s += `<text transform="translate(20,${padT + plotH / 2}) rotate(-90)" text-anchor="middle" font-size="12" fill="#333">智力指数</text>`;

// Pareto 阶梯：请求数升序连线 = 从左下到右上的上升阶梯
if (frontier.length > 1) {
  const asc = [...frontier].sort((a, b) => a.requests_month - b.requests_month);
  const d = 'M' + asc.map((f) => `${X(f.requests_month).toFixed(1)},${Y(f.index).toFixed(1)}`).join(' L');
  s += `<path d="${d}" fill="none" stroke="#888" stroke-width="1.5" stroke-dasharray="5,4"/>`;
}

const attrsOf = (r, extra = '') => {
  const info = logoInfoOf(r.model);
  return `data-model="${esc(r.model)}" data-index="${r.index}" data-isrc="${r.index_source}" data-req="${Math.round(r.requests_month)}"` +
    ` data-credits="${r.credit_10x}" data-req5h="${r.requests_5h ?? ''}" data-reqweek="${r.requests_week ?? ''}"` +
    ` data-contributor="${r.contributor ? 1 : 0}" data-tier="${r.tier ?? 'off-peak'}" data-peakratio="${r.peak_ratio ?? ''}" data-peakwin="${esc(r.peak_window ?? '')}" data-perusd="${Math.round(r.requests_per_usd)}" data-est="${Math.round(r.est_requests_month)}" data-estratio="${r.est_vs_official ? r.est_vs_official.toFixed(3) : ''}"` +
    ` data-in="${r.price_in}" data-out="${r.price_out}" data-cache="${r.price_cache}"` +
    ` data-aa="${r.aa_index ?? ''}" data-aavariant="${esc(r.aa_model ?? '')}" data-creator="${esc(r.creator)}"` +
    ` data-official="${r.official_requests_month ?? ''}" data-suspect="${r.suspect_slug ? 1 : 0}"` +
    (inZone(r) ? ' data-zone="1"' : '') +
    (frontModels.has(r.model) ? ' data-front="1"' : '') + (r.contributor ? ' data-deal="1"' : '') +
    (info ? ` data-logo="${info.file}"` : '') + extra;
};

// 非前沿点
for (const r of scored) {
  if (frontModels.has(r.model)) continue;
  const cx = X(r.requests_month), cy = Y(r.index);
  const info = logoInfoOf(r.model);
  const ring = r.contributor ? DEAL_RING : LOGO_RING;
  const attrs = attrsOf(r);
  if (info) {
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="9" fill="#fff" stroke="${ring}" stroke-width="${r.contributor ? 1.6 : 1.2}" ${attrs}/>`;
    s += `<image href="${info.uri}" x="${(cx - 6).toFixed(1)}" y="${(cy - 6).toFixed(1)}" width="12" height="12" preserveAspectRatio="xMidYMid slice" ${attrs}/>`;
  } else {
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4" fill="${ring}" fill-opacity="0.7" ${attrs}/>`;
  }
  s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="12" fill="transparent" ${attrs} class="dot-hit"/>`;
}

// ---- 前沿大圆：固定画在**真实坐标**上，不做 de-clutter ----
// 原来这里会沿径向把挤在一起的大圆推开，再用细线连回真实坐标。peak 孪生点把
// DeepSeek V4.1 Flash (off-peak) 顶开了 34px（y 255→221），一条这么长的引线 + 端点小圆会让人
// 误读成"点其实在那儿"——可斩杀线的语义恰恰是点的真实位置，引线越显眼越有害。
// 改成宁可让两个大圆挨着：R 由 18 缩到 15 之后，Flash(487k,38) 与 DeepSeek(385k,39.5) 的
// 圆心距 32.7px > 2R=30，圆形本身并不相交（只是轴对齐 bbox 判据仍算"碰着"）。
// callout 标签另有自己的碰撞感知布局，会自动避开真实位置的大圆。
const R = 15;
const markPos = new Map(); // model -> {cx, cy} = 真实坐标，不偏移
for (const f of frontier) markPos.set(f.model, { cx: X(f.requests_month), cy: Y(f.index) });

s += `<defs><clipPath id="plans-frontier-clip"><circle r="13"/></clipPath></defs>`;
for (const f of frontier) {
  const { cx, cy } = markPos.get(f.model);
  const info = logoInfoOf(f.model);
  const ring = f.contributor ? DEAL_RING : LOGO_RING;
  s += `<g class="frontier-mark" ${attrsOf(f)} style="cursor:pointer">`;
  if (info) {
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R}" fill="#fff" stroke="${ring}" stroke-width="3"/>`;
    s += `<g clip-path="url(#plans-frontier-clip)" transform="translate(${cx.toFixed(1)},${cy.toFixed(1)})"><image href="${info.uri}" x="-13" y="-13" width="26" height="26" preserveAspectRatio="xMidYMid slice"/></g>`;
  } else {
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R}" fill="${ring}" stroke="white" stroke-width="3"/>`;
    s += `<text x="${cx.toFixed(1)}" y="${(cy + 5).toFixed(1)}" text-anchor="middle" font-size="${logoOf(f.model).length > 1 ? 13 : 18}" font-weight="700" fill="white">${logoOf(f.model)}</text>`;
  }
  s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R + 5}" fill="none" stroke="${ring}" stroke-width="1.5" opacity="0.45"/>`;
  s += `</g>`;
}

// Contributor 数据换折扣档：主图层的支配者，单独用虚线大圈 + 标注，不计入阶梯
for (const r of scored.filter((x) => x.contributor)) {
  const cx = X(r.requests_month), cy = Y(r.index);
  s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="26" fill="none" stroke="${DEAL_RING}" stroke-width="1.5" stroke-dasharray="4,3" ${attrsOf(r)}/>`;
  // 两行：第一行机制、第二行为什么不进阶梯。原来第一行写的是「数据换 5 折」，倍率是错的。
  s += `<text x="${cx.toFixed(1)}" y="${(cy - 32).toFixed(1)}" text-anchor="middle" font-size="10" fill="${DEAL_RING}" font-weight="600">数据换折扣</text>`;
  s += `<text x="${cx.toFixed(1)}" y="${(cy - 21).toFixed(1)}" text-anchor="middle" font-size="9" fill="${DEAL_RING}">不计入阶梯</text>`;
}

// callout 碰撞感知布局（同 render-aa：8 候选位 + 避点/避盒）
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
  if (!pos) continue;
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
s += `<circle cx="${lx + 8}" cy="${ly}" r="7" fill="none" stroke="${DEAL_RING}" stroke-width="1.5" stroke-dasharray="3,2"/>`;
s += `<text x="${lx + 20}" y="${ly + 4}" font-size="10" fill="#555">数据换折扣 · 不计入阶梯</text>`;

s += `<text x="${padL}" y="22" font-size="14" font-weight="700" fill="#222">CommandCode 斩杀线</text>`;
s += `</svg>`;

writeFileSync(OUT, s);
console.log('plans-chart.svg bytes:', s.length, '→', OUT);
console.log(`plan: ${data.plan}  rows: ${rows.length}  (catalog ${data.catalog_size} → AA 交集 ${data.rows.length})`);
console.log(`x domain: ${xMin}–${xMax} 次/月   y domain: ${yMin}–${yMax}`);
console.log(`高性价比区 (智力≥${ZONE_INDEX} & ≥${fmtReq(ZONE_REQ)}次/月，右上): ${scored.filter(inZone).length} 个模型`);
console.log('pareto (主图层, Contributor 除外):', frontier.map((f) => `${f.model}/智力${f.index}/${fmtReq(f.requests_month)}次`).join(', '));
console.log('deal layer:', scored.filter((r) => r.contributor).map((r) => `${r.model}/idx${r.index}/${fmtReq(r.requests_month)}次`).join(', ') || '(none)');
console.log('premium pool:', scored.filter((r) => r.premium_pool).map((r) => r.model).join(', ') || '(none)');
console.log('suspect slug:', scored.filter((r) => r.suspect_slug).map((r) => r.model).join(', ') || '(none)');
