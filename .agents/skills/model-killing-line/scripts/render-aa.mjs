// render-aa.mjs — 把 aa-data.json 画成 Pareto 斩杀线 SVG（aa-chart.svg）
//
// X = Cost per Task USD（log 轴），Y = Artificial Analysis Intelligence Index，
// 前沿 = 按 cost 升序的 record-high index，左上角高效区（Index > 35 且 cost < $1）。
// 结构与 render.mjs 同构：logo 徽章内联 data URI、前沿大圆 + callout、透明 hit-area、
// 自定义 tooltip 靠 data-* 属性（gen-html.mjs 绑定）。
// 区别：无 effort 字段（tooltip/表格显示 creator），回退小圆点按 creator 上色，
//   前沿同基名只标一个 label（锚定组内 index 最高点）+ 碰撞感知布局
//   （8 候选位 × 避点/避盒，前沿大圆先画、盒子后画置顶）。
//
// 用法: node scripts/render-aa.mjs [--dir <dir>] [--in <aa-data.json>] [--out <aa-chart.svg>]
//   默认读写系统临时目录: os.tmpdir()/model-killing-line/（可用 MKL_DIR 环境变量覆盖目录）
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logoFileOf, logoUriOf } from './logos.mjs';
import { aaLink } from './openrouter.mjs';

const argv = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
};
const DIR = argv('--dir') ?? process.env.MKL_DIR ?? path.join(os.tmpdir(), 'model-killing-line');
mkdirSync(DIR, { recursive: true });
const IN = argv('--in') ?? path.join(DIR, 'aa-data.json');
const OUT = argv('--out') ?? path.join(DIR, 'aa-chart.svg');

const rows = JSON.parse(readFileSync(IN, 'utf8'));

rmSync(path.join(DIR, 'logos'), { recursive: true, force: true });
const logoInfoOf = (m) => {
  const f = logoFileOf(m);
  return f ? { file: f, uri: logoUriOf(f) } : null;
};

// 帕累托前沿（2D：cost 升序 index 创新高，决定连线/大圆）
// fast 集（3D 差集再在内部按 index×cost 取次级 2D 前沿 → 高效，描蓝圈；speed 缺失按 -Inf；
//   次级线下（被另一个蓝色在 index+cost 上全包围）的降级为真被斩，不标蓝）
const numSpeed = (r) => { const v = parseFloat(r.speed); return Number.isNaN(v) ? -Infinity : v; };
const byCost = [...rows].sort((a, b) => a.cost - b.cost);
const frontier = [];
let best = -Infinity;
for (const r of byCost) {
  if (r.index > best) { best = r.index; frontier.push({ ...r }); }
}
const frontNames = new Set(frontier.map((f) => f.model));
const fastNames3 = new Set(rows.filter((r) => !frontNames.has(r.model) && !rows.some((o) =>
  o !== r && o.cost <= r.cost && o.index >= r.index && numSpeed(o) >= numSpeed(r) &&
  (o.cost < r.cost || o.index > r.index || numSpeed(o) > numSpeed(r))
)).map((r) => r.model));
const fastNames = new Set();
{
  let b2 = -Infinity;
  for (const r of rows.filter((r) => fastNames3.has(r.model)).sort((a, b) => a.cost - b.cost)) {
    if (r.index > b2) { b2 = r.index; fastNames.add(r.model); }
  }
}

// 无 logo 回退字母（logoFileOf 覆盖了全部前沿模型，这里只是兜底）
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
  return '●';
};

const CREATOR_COLORS = {
  'OpenAI': '#4c78a8', 'Anthropic': '#e45756', 'Google': '#54a24f', 'Meta': '#9467bd',
  'SpaceXAI': '#555555', 'Alibaba': '#f58518', 'Z AI': '#1c7ff8', 'Kimi': '#72b7b2',
  'DeepSeek': '#eeca3b', 'MiniMax': '#ff9da6', 'Xiaomi': '#ff6f59', 'Tencent': '#59a14f',
  'Thinking Machines': '#9d7660', 'Multiverse Computing': '#b07aa1', 'NVIDIA': '#76b900',
};
const creatorColor = (c) => {
  if (CREATOR_COLORS[c]) return CREATOR_COLORS[c];
  let h = 0;
  for (const ch of c) h = (h * 31 + ch.codePointAt(0)) % 360;
  return `hsl(${h},45%,45%)`;
};

const LOGO_RING = '#487265';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 画布
const svgW = 920, svgH = 560;
const padL = 70, padR = 30, padT = 50, padB = 60;

// x: log 0.01 ~ 10
const xMin = 0.01, xMax = 10;
const xScale = (v) => Math.log10(v / xMin) / Math.log10(xMax / xMin);
const plotW = svgW - padL - padR;
const X = (v) => padL + xScale(Math.max(v, xMin)) * plotW;

// y: 20 ~ 55
const yMin = 20, yMax = 55;
const yScale = (v) => (v - yMin) / (yMax - yMin);
const plotH = svgH - padT - padB;
const Y = (v) => padT + (1 - yScale(v)) * plotH;

// 高效区：Index > 35 且 cost < $1
const ZONE_COST = 1;
const ZONE_INDEX = 35;
const zoneX = X(ZONE_COST);
const zoneY = Y(ZONE_INDEX);

const xTicks = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const yTicks = [25, 30, 35, 40, 45, 50];

let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" id="chart" style="font-family:-apple-system,'PingFang SC','Helvetica Neue',sans-serif;background:#ffffff">`;

s += `<rect x="${padL}" y="${padT}" width="${zoneX - padL}" height="${zoneY - padT}" fill="#8caa5e" fill-opacity="0.10" stroke="#8caa5e" stroke-opacity="0.35" stroke-dasharray="3,3"/>`;
s += `<text x="${padL + 8}" y="${padT + 18}" font-size="11" fill="#5b7a3a" font-weight="600">高性价比区</text>`;
s += `<text x="${padL + 8}" y="${padT + 32}" font-size="10" fill="#5b7a3a">Index &gt; ${ZONE_INDEX} &amp; Cost &lt; $${ZONE_COST}</text>`;

for (const t of xTicks) s += `<line x1="${X(t).toFixed(1)}" y1="${padT}" x2="${X(t).toFixed(1)}" y2="${padT + plotH}" stroke="#ececec" stroke-width="1"/>`;
for (const t of yTicks) s += `<line x1="${padL}" y1="${Y(t).toFixed(1)}" x2="${padL + plotW}" y2="${Y(t).toFixed(1)}" stroke="#ececec" stroke-width="1"/>`;

s += `<line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="#444"/>`;
s += `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#444"/>`;

for (const t of xTicks) {
  s += `<line x1="${X(t).toFixed(1)}" y1="${padT + plotH}" x2="${X(t).toFixed(1)}" y2="${padT + plotH + 5}" stroke="#444"/>`;
  s += `<text x="${X(t).toFixed(1)}" y="${padT + plotH + 20}" text-anchor="middle" font-size="11" fill="#555">$${t}</text>`;
}
for (const t of yTicks) {
  s += `<line x1="${padL - 5}" y1="${Y(t).toFixed(1)}" x2="${padL}" y2="${Y(t).toFixed(1)}" stroke="#444"/>`;
  s += `<text x="${padL - 10}" y="${Y(t).toFixed(1) + 4}" text-anchor="end" font-size="11" fill="#555">${t}</text>`;
}

s += `<text x="${padL + plotW / 2}" y="${svgH - 14}" text-anchor="middle" font-size="12" fill="#333">Cost per Task (USD, log 轴)</text>`;
s += `<text transform="translate(20,${padT + plotH / 2}) rotate(-90)" text-anchor="middle" font-size="12" fill="#333">Intelligence Index</text>`;

const connectorPath = 'M' + frontier.map(f => `${X(f.cost).toFixed(1)},${Y(f.index).toFixed(1)}`).join(' L');
s += `<path d="${connectorPath}" fill="none" stroke="#888" stroke-width="1.5" stroke-dasharray="5,4"/>`;

// 非前沿点
for (const r of rows) {
  if (frontier.some(f => f.model === r.model)) continue;
  const cx = X(r.cost), cy = Y(r.index);
  const info = logoInfoOf(r.model);
  const isFast = fastNames.has(r.model);
  const ring = isFast ? '#1971c2' : LOGO_RING;
  const attrs = `data-model="${esc(r.model)}" data-creator="${esc(r.creator)}" data-index="${r.index}" data-cost="${r.cost}" data-speed="${esc(r.speed)}" data-latency="${esc(r.latency)}"${isFast ? ' data-fast="1"' : ''}${info ? ` data-logo="${info.file}"` : ''}`;
  if (info) {
    const R = 9;
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R}" fill="#fff" stroke="${ring}" stroke-width="${isFast ? 2 : 1.2}" ${attrs}/>`;
    const lr = 6;
    s += `<image href="${info.uri}" x="${(cx - lr).toFixed(1)}" y="${(cy - lr).toFixed(1)}" width="${lr * 2}" height="${lr * 2}" preserveAspectRatio="xMidYMid slice" ${attrs}><title>${esc(r.model)}</title></image>`;
  } else {
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${isFast ? 5 : 3.5}" fill="${creatorColor(r.creator)}" fill-opacity="0.65" stroke="${isFast ? '#1971c2' : 'none'}" stroke-width="${isFast ? 1.5 : 0}" ${attrs}/>`;
  }
  s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="12" fill="transparent" ${attrs} class="dot-hit"/>`;
}

// 同基名（去括号 effort 后缀，如 "GPT-5.6 Luna (max)" → "GPT-5.6 Luna"）只标一个 label，
// 锚定在组内 index 最高的点（前沿沿 cost 升序 index 严格递增，所以组内最后一个即最高）。
// 跨组不再做 X 稀疏，全交给下面的碰撞感知布局（实在放不下才跳过 label）。
const baseName = (m) => m.replace(/\s*\(.*?\)\s*/g, '').trim();
const labeledFlags = frontier.map((f, i) =>
  i === frontier.length - 1 || baseName(frontier[i + 1].model) !== baseName(f.model));

s += `<defs><clipPath id="aa-frontier-clip"><circle r="15"/></clipPath></defs>`;
// 前沿大圆先画（label 盒子后画，保证气泡在最上层）
for (const f of frontier) {
  const cx = X(f.cost), cy = Y(f.index);
  const R = 18;
  const logo = logoOf(f.model);
  const info = logoInfoOf(f.model);

  s += `<g class="frontier-mark" data-model="${esc(f.model)}" data-creator="${esc(f.creator)}" data-index="${f.index}" data-cost="${f.cost}" data-speed="${esc(f.speed)}" data-latency="${esc(f.latency)}"${info ? ` data-logo="${info.file}"` : ''} style="cursor:pointer">`;
  if (info) {
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R}" fill="#fff" stroke="${LOGO_RING}" stroke-width="3"/>`;
    s += `<g clip-path="url(#aa-frontier-clip)" transform="translate(${cx.toFixed(1)},${cy.toFixed(1)})"><image href="${info.uri}" x="-15" y="-15" width="30" height="30" preserveAspectRatio="xMidYMid slice"/></g>`;
  } else {
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R}" fill="${LOGO_RING}" stroke="white" stroke-width="3"/>`;
    s += `<text x="${cx.toFixed(1)}" y="${(cy + 5).toFixed(1)}" text-anchor="middle" font-size="${logo.length > 1 ? 13 : 18}" font-weight="700" fill="white">${logo}</text>`;
  }
  s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R + 5}" fill="none" stroke="${LOGO_RING}" stroke-width="1.5" opacity="0.45"/>`;
  s += `</g>`;
}

// callout 碰撞感知布局（严格轮）：按顺序依次尝试上/下/远距/侧向候选位，
// 盒子不得压住任何圆点（前沿 R18+外圈、非前沿小圆点一视同仁），
// 也不得与已放盒子互叠、不得碰标题/轴标签；首个候选按上下交错倾向排序，
// 选不中就跳过该点 label（圆点照画，hover/tooltip 不受影响）。
const FRONTIER_PAD = 24; // 前沿大圆外圈半径+余量
const DOT_PAD = 13;      // 非前沿小圆点半径+余量
const BOX_GAP = 8;       // label 盒子之间的最小间距
const LABEL_CANDIDATES = [
  { dx: 0, dy: -43 }, { dx: 0, dy: 43 },     // 正上 / 正下
  { dx: 0, dy: -75 }, { dx: 0, dy: 75 },     // 远上 / 远下
  { dx: -80, dy: -43 }, { dx: 80, dy: -43 }, // 上左 / 上右
  { dx: -80, dy: 43 }, { dx: 80, dy: 43 },   // 下左 / 下右
];
const FRONTIER_DOTS = frontier.map((f) => ({ x: X(f.cost), y: Y(f.index), pad: FRONTIER_PAD, model: f.model }));
const BG_DOTS = rows.filter((r) => !frontier.some((f) => f.model === r.model))
  .map((r) => ({ x: X(r.cost), y: Y(r.index), pad: DOT_PAD, model: r.model }));
const hitsAny = (list, boxX, boxY, boxW, boxH) =>
  list.some((d) => d.x > boxX - d.pad && d.x < boxX + boxW + d.pad && d.y > boxY - d.pad && d.y < boxY + boxH + d.pad);
const placedBoxes = [];
const hitsBox = (boxX, boxY, boxW, boxH) =>
  placedBoxes.some((b) => boxX < b.x + b.w + BOX_GAP && boxX + boxW + BOX_GAP > b.x && boxY < b.y + b.h + BOX_GAP && boxY + boxH + BOX_GAP > b.y);
let aboveFirst = true;
for (const [i, f] of frontier.entries()) {
  if (!labeledFlags[i]) continue;
  const cx = X(f.cost), cy = Y(f.index);
  const R = 18;
  const fullText = f.model;
  const charW = 6.2;
  const boxW = Math.max(80, fullText.length * charW + 16);
  const boxH = 22;
  const ordered = [...LABEL_CANDIDATES].sort((a, b) =>
    (aboveFirst ? (a.dy < 0 ? 0 : 1) - (b.dy < 0 ? 0 : 1) : (a.dy > 0 ? 0 : 1) - (b.dy > 0 ? 0 : 1))
    || (Math.abs(a.dx) + Math.abs(a.dy) - (Math.abs(b.dx) + Math.abs(b.dy))));
  let placed = null;
  for (const c of ordered) {
    let boxX = cx + c.dx - boxW / 2;
    if (boxX < 4) boxX = 4;
    if (boxX + boxW > svgW - 4) boxX = svgW - 4 - boxW;
    const boxY = cy + c.dy - boxH / 2;
    if (boxY < 42 || boxY + boxH > svgH - 26) continue; // 避开顶部标题与底部轴标签
    if (hitsAny(FRONTIER_DOTS.filter((d) => d.model !== f.model), boxX, boxY, boxW, boxH)) continue; // 不盖其他前沿大圆
    if (hitsAny(BG_DOTS, boxX, boxY, boxW, boxH)) continue; // 不盖非前沿小圆点
    if (hitsBox(boxX, boxY, boxW, boxH)) continue;
    placed = { boxX, boxY };
    break;
  }
  aboveFirst = !aboveFirst;
  if (!placed) continue;
  const { boxX, boxY } = placed;
  placedBoxes.push({ x: boxX, y: boxY, w: boxW, h: boxH });
  const above = boxY + boxH / 2 < cy;
  const targetX = Math.min(Math.max(cx, boxX), boxX + boxW);
  const targetY = above ? boxY + boxH : boxY;
  const dotY = above ? cy - R - 1 : cy + R + 1;
  // label 文字可点 → OpenRouter 详情页（归一化 + org 映射，见 openrouter.mjs）
  const orLink = aaLink(f.model, f.creator).url;
  s += `<line x1="${cx.toFixed(1)}" y1="${dotY.toFixed(1)}" x2="${targetX.toFixed(1)}" y2="${targetY.toFixed(1)}" stroke="#888" stroke-width="0.8"/>`;
  s += `<a href="${orLink}" target="_blank" rel="noopener"><rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="11" fill="white" stroke="#d0d0d0"/><text x="${boxX + boxW / 2}" y="${boxY + boxH / 2 + 4}" text-anchor="middle" font-size="11" fill="#333">${esc(fullText)}</text></a>`;
}

// legend：左上横排（标题下方第二行，原中文说明位置）
const legendY = 38;
let lx = padL;
s += `<line x1="${lx}" y1="${legendY}" x2="${lx + 22}" y2="${legendY}" stroke="#888" stroke-dasharray="5,4"/>`;
s += `<text x="${lx + 26}" y="${legendY + 4}" font-size="10" fill="#555">Pareto frontier</text>`;
lx += 132;
s += `<rect x="${lx}" y="${legendY - 6}" width="22" height="12" fill="#8caa5e" fill-opacity="0.2" stroke="#8caa5e" stroke-opacity="0.4" stroke-dasharray="2,2"/>`;
s += `<text x="${lx + 26}" y="${legendY + 4}" font-size="10" fill="#555">value zone</text>`;
lx += 122;
s += `<circle cx="${lx + 11}" cy="${legendY}" r="6" fill="#fff" stroke="#1971c2" stroke-width="2"/>`;
s += `<text x="${lx + 26}" y="${legendY + 4}" font-size="10" fill="#555">efficient model</text>`;

s += `<text x="${padL}" y="${22}" font-size="14" font-weight="700" fill="#222">通用智力斩杀线</text>`;

s += `</svg>`;
writeFileSync(OUT, s);
console.log('aa-chart.svg bytes:', s.length, '→', OUT);
console.log('efficient zone rect: x=', padL, '→', zoneX.toFixed(1), ', y=', padT, '→', zoneY.toFixed(1));
console.log('frontier points:', frontier.map(f => `${f.model}/$${f.cost}/${f.index}`).join(', '));
console.log('labeled:', frontier.filter((_, i) => labeledFlags[i]).map(f => f.model).join(', '));
console.log('efficient:', [...fastNames].join(', ') || '(none)');
