// render-tb.mjs — 把 tb-data.json 画成 Pareto 斩杀线 SVG（tb-chart.svg）
//
// X = Cost per Task USD（log 轴，total_cost_usd ÷ n_trials），
// Y = Terminal-Bench 4.0 Accuracy（%），前沿 = cost 升序 accuracy 创新高。
// 左上角高效区（Accuracy ≥ 40 且 cost ≤ $10/任务）。
// 效率维（3D 差集 + 次级 2D 前沿 → 标注蓝圈）用 Run 平均 token 流速
//   speed = total_tokens ÷ (avg_trial_duration_sec × n_trials)（缺失 → -Inf 不占便宜）。
// 结构与 render.mjs / render-aa.mjs 同构：logo 徽章内联 data URI、前沿大圆 + 碰撞感知
// callout、透明 hit-area、data-* 属性供 gen-html.mjs 绑定 tooltip。
// 与 AA 的区别：TB 每行还有 agent + effort（同模型在同榜有多种 effort 变体），
//   callout 对同模型多点组加 effort 后缀（如 `GPT-6 Astra (max)`）避免标签全同名；
//   logo 按 model_org 选（TB 模型名无品牌前缀，见 logos.mjs 的 ORG_LOGO_FILE）。
//
// 用法: node scripts/render-tb.mjs [--dir <dir>] [--in <tb-data.json>] [--out <tb-chart.svg>]
//   默认读写系统临时目录: os.tmpdir()/model-killing-line/（可用 MKL_DIR 环境变量覆盖目录）
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logoFileOfRow, logoUriOf } from './logos.mjs';

const argv = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
};
const DIR = argv('--dir') ?? process.env.MKL_DIR ?? path.join(os.tmpdir(), 'model-killing-line');
mkdirSync(DIR, { recursive: true });
const IN = argv('--in') ?? path.join(DIR, 'tb-data.json');
const OUT = argv('--out') ?? path.join(DIR, 'tb-chart.svg');

const rows = JSON.parse(readFileSync(IN, 'utf8'));

rmSync(path.join(DIR, 'logos'), { recursive: true, force: true });
const logoInfoOf = (r) => {
  const f = logoFileOfRow(r);
  return f ? { file: f, uri: logoUriOf(f) } : null;
};

// 2D 前沿：cost 升序 accuracy 创新高（决定连线/大圆）。
// 斩杀线用「全变体」口径：TB 同一模型在同榜有多个 effort 变体（各自独立成行），
// 全部参与 Pareto（能看到单模型内部的 effort 性价比曲线）。页面表格则是每模型只留
// 最佳变体的模型级视图（由 gen-html.mjs 的 tbBest 负责，这里是图上全变体口径）。
// 前后端一致的判定维度是 uid = model+effort+agent（与 gen-html.mjs 的 tbUid 同构）。
// fast 集（3D：cost↓ acc↑ speed↑，speed 缺失按 -Inf）差集后再取次级 2D 前沿
// （不画线只判断）：线上才算高效（蓝圈），线下被另一个蓝色全包围 → 真被斩。
const keyOf = (r) => `${r.model}\u0000${r.effort ?? ''}\u0000${r.agent}`;
const numSpeed = (r) => (r.speed == null ? -Infinity : r.speed);
const byCost = [...rows].sort((a, b) => a.cost - b.cost);
const frontier = [];
let best = -Infinity;
for (const r of byCost) {
  if (r.accuracy > best) { best = r.accuracy; frontier.push({ ...r }); }
}
const frontKeys = new Set(frontier.map(keyOf));
const fastKeys3 = new Set(rows.filter((r) => !frontKeys.has(keyOf(r)) && !rows.some((o) =>
  o !== r && o.cost <= r.cost && o.accuracy >= r.accuracy && numSpeed(o) >= numSpeed(r) &&
  (o.cost < r.cost || o.accuracy > r.accuracy || numSpeed(o) > numSpeed(r))
)).map(keyOf));
const fastKeys = new Set();
{
  let b2 = -Infinity;
  for (const r of rows.filter((r) => fastKeys3.has(keyOf(r))).sort((a, b) => a.cost - b.cost)) {
    if (r.accuracy > b2) { b2 = r.accuracy; fastKeys.add(keyOf(r)); }
  }
}

// TB 模型名无括号，这里的 baseName 恒等于 model；组内同模型多个 effort 变体时
// callout 加 ` (effort)` 后缀（frontier 上只有 1 个该模型的点时仍只显示模型名）。
const groupCount = new Map();
for (const f of frontier) groupCount.set(f.model, (groupCount.get(f.model) ?? 0) + 1);
const labelOf = (f) => (groupCount.get(f.model) > 1 ? `${f.model} (${f.effort})` : f.model);

const effortColor = (e) => ({ max: '#e45756', xhigh: '#4c78a8', high: '#f58518', medium: '#72b7b2' })[e] || '#888';
const ORG_COLORS = {
  'OpenAI': '#4c78a8', 'Anthropic': '#e45756', 'Google': '#54a24f', 'Z.ai': '#1c7ff8', 'xAI': '#555555',
};
const orgColor = (o) => {
  if (ORG_COLORS[o]) return ORG_COLORS[o];
  let h = 0;
  for (const ch of o) h = (h * 31 + ch.codePointAt(0)) % 360;
  return `hsl(${h},45%,45%)`;
};

const LOGO_RING = '#487265';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 画布
const svgW = 920, svgH = 560;
const padL = 70, padR = 30, padT = 50, padB = 60;

// x: log 0.5 ~ 50（数据 $1.05 ~ $29.10）
const niceCeil = (m) => { const s = 10 ** Math.floor(Math.log10(Math.max(m, 1e-9))); for (const i of [1, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (s * i >= m) return s * i; return s * 10; };
const dataXs = rows.map((r) => +r.cost || 0).filter((v) => v > 0);
const xMin = Math.min(0.5, 10 ** Math.floor(Math.log10(Math.min(...dataXs))));
const xMax = Math.max(50, niceCeil(Math.max(...dataXs)));
const xScale = (v) => Math.log10(v / xMin) / Math.log10(xMax / xMin);
const plotW = svgW - padL - padR;
const X = (v) => padL + xScale(Math.max(v, xMin)) * plotW;

// y: 0 ~ 70（数据 11.21 ~ 58.18）
const dataYs = rows.map((r) => +r.accuracy || 0);
const yMin = Math.min(0, Math.floor(Math.min(...dataYs) / 10) * 10);
const yMax = Math.max(70, Math.ceil(Math.max(...dataYs) / 10) * 10);
const yScale = (v) => (v - yMin) / (yMax - yMin);
const plotH = svgH - padT - padB;
const Y = (v) => padT + (1 - yScale(v)) * plotH;

// 高效区：Accuracy ≥ 40 且每任务成本 ≤ $10
const ZONE_COST = 10;
const ZONE_ACC = 40;
const zoneX = X(ZONE_COST);
const zoneY = Y(ZONE_ACC);

const xTicks = [0.5, 1, 2.5, 5, 10, 20, 40];
const yTicks = []; for (let t = 10; t <= yMax; t += 10) yTicks.push(t);

let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" id="chart" style="font-family:-apple-system,'PingFang SC','Helvetica Neue',sans-serif;background:#ffffff">`;

s += `<rect x="${padL}" y="${padT}" width="${zoneX - padL}" height="${zoneY - padT}" fill="#8caa5e" fill-opacity="0.10" stroke="#8caa5e" stroke-opacity="0.35" stroke-dasharray="3,3"/>`;
s += `<text x="${padL + 8}" y="${padT + 18}" font-size="11" fill="#5b7a3a" font-weight="600">高性价比区</text>`;
s += `<text x="${padL + 8}" y="${padT + 32}" font-size="10" fill="#5b7a3a">Accuracy ≥ ${ZONE_ACC}% &amp; Cost ≤ $${ZONE_COST}</text>`;

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

const N_TRIALS = rows[0]?.n_trials ?? 330;
s += `<text x="${padL + plotW / 2}" y="${svgH - 14}" text-anchor="middle" font-size="12" fill="#333">每任务成本（总成本 ÷ ${N_TRIALS} 任务，USD log 轴）</text>`;
s += `<text transform="translate(20,${padT + plotH / 2}) rotate(-90)" text-anchor="middle" font-size="12" fill="#333">Terminal-Bench 4.0 Accuracy (%)</text>`;

const connectorPath = 'M' + frontier.map(f => `${X(f.cost).toFixed(1)},${Y(f.accuracy).toFixed(1)}`).join(' L');
s += `<path d="${connectorPath}" fill="none" stroke="#888" stroke-width="1.5" stroke-dasharray="5,4"/>`;

// 非前沿点 + 透明 hit-area
const tbAttrs = (r, extra = {}) => {
  const isFast = fastKeys.has(keyOf(r));
  const info = logoInfoOf(r);
  return {
    isFast,
    info,
    attrs: `data-model="${esc(r.model)}" data-agent="${esc(r.agent)}" data-effort="${esc(r.effort ?? '')}" data-acc="${r.accuracy}" data-cost="${r.cost}" data-cost-total="${esc(r.cost_total_disp ?? '')}" data-tokens="${esc(r.display_total_tokens)}" data-date="${esc(r.date ?? '')}" data-ci="${r.accuracy_ci ?? ''}" data-speed="${r.speed ?? ''}" data-p2="${r.pass_at_2 ?? ''}" data-p5="${r.pass_at_5 ?? ''}"${isFast ? ' data-fast="1"' : ''}${info ? ` data-logo="${info.file}"` : ''}`,
  };
};

for (const r of rows) {
  if (frontKeys.has(keyOf(r))) continue;
  const cx = X(r.cost), cy = Y(r.accuracy);
  const { isFast, info, attrs } = tbAttrs(r);
  const ring = isFast ? '#1971c2' : LOGO_RING;
  if (info) {
    const R = 9;
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R}" fill="#fff" stroke="${ring}" stroke-width="${isFast ? 2 : 1.2}" ${attrs}/>`;
    const lr = 6;
    s += `<image href="${info.uri}" x="${(cx - lr).toFixed(1)}" y="${(cy - lr).toFixed(1)}" width="${lr * 2}" height="${lr * 2}" preserveAspectRatio="xMidYMid slice" ${attrs}><title>${esc(r.model)}</title></image>`;
  } else {
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${isFast ? 5 : 3.5}" fill="${orgColor(r.model_org)}" fill-opacity="0.65" stroke="${isFast ? '#1971c2' : 'none'}" stroke-width="${isFast ? 1.5 : 0}" ${attrs}/>`;
  }
  s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="12" fill="transparent" ${attrs} class="dot-hit"/>`;
}

// 前沿大圆 + callout（碰撞感知布局，同 render-aa）：同模型多点组标 ` (effort)`。
s += `<defs><clipPath id="tb-frontier-clip"><circle r="15"/></clipPath></defs>`;
for (const f of frontier) {
  const cx = X(f.cost), cy = Y(f.accuracy);
  const R = 18;
  const info = logoInfoOf(f);
  s += `<g class="frontier-mark" data-model="${esc(f.model)}" data-agent="${esc(f.agent)}" data-effort="${esc(f.effort ?? '')}" data-acc="${f.accuracy}" data-cost="${f.cost}" data-cost-total="${esc(f.cost_total_disp ?? '')}" data-tokens="${esc(f.display_total_tokens)}" data-date="${esc(f.date ?? '')}" data-ci="${f.accuracy_ci ?? ''}" data-speed="${f.speed ?? ''}" data-p2="${f.pass_at_2 ?? ''}" data-p5="${f.pass_at_5 ?? ''}"${info ? ` data-logo="${info.file}"` : ''} style="cursor:pointer">`;
  if (info) {
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R}" fill="#fff" stroke="${LOGO_RING}" stroke-width="3"/>`;
    s += `<g clip-path="url(#tb-frontier-clip)" transform="translate(${cx.toFixed(1)},${cy.toFixed(1)})"><image href="${info.uri}" x="-15" y="-15" width="30" height="30" preserveAspectRatio="xMidYMid slice"/></g>`;
  } else {
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R}" fill="${LOGO_RING}" stroke="white" stroke-width="3"/>`;
    s += `<text x="${cx.toFixed(1)}" y="${(cy + 5).toFixed(1)}" text-anchor="middle" font-size="18" font-weight="700" fill="white">●</text>`;
  }
  s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R + 5}" fill="none" stroke="${LOGO_RING}" stroke-width="1.5" opacity="0.45"/>`;
  s += `</g>`;
}

// 同 render-aa：前沿上同模型组（多个 effort 档）只标一个 label，锚定 accuracy 最高的档
//（frontier 沿 cost 升序 accuracy 严格递增，组内最后一个即最高档，如前沿 4 个 Astra 档只标 (max)）。
const labeledFlags = frontier.map((f, i) =>
  i === frontier.length - 1 || frontier[i + 1].model !== f.model);

// callout 碰撞感知布局（同 render-aa.mjs）：8 候选位 × 避点/避盒；放不下则跳过该点 label
const FRONTIER_PAD = 24;
const DOT_PAD = 13;
const BOX_GAP = 8;
const LABEL_CANDIDATES = [
  { dx: 0, dy: -43 }, { dx: 0, dy: 43 },
  { dx: 0, dy: -75 }, { dx: 0, dy: 75 },
  { dx: -80, dy: -43 }, { dx: 80, dy: -43 },
  { dx: -80, dy: 43 }, { dx: 80, dy: 43 },
];
const FRONTIER_DOTS = frontier.map((f) => ({ x: X(f.cost), y: Y(f.accuracy), pad: FRONTIER_PAD, model: f.model }));
const BG_DOTS = rows.filter((r) => !frontKeys.has(keyOf(r)))
  .map((r) => ({ x: X(r.cost), y: Y(r.accuracy), pad: DOT_PAD, model: r.model }));
const hitsAny = (list, boxX, boxY, boxW, boxH) =>
  list.some((d) => d.x > boxX - d.pad && d.x < boxX + boxW + d.pad && d.y > boxY - d.pad && d.y < boxY + boxH + d.pad);
const placedBoxes = [];
const hitsBox = (boxX, boxY, boxW, boxH) =>
  placedBoxes.some((b) => boxX < b.x + b.w + BOX_GAP && boxX + boxW + BOX_GAP > b.x && boxY < b.y + b.h + BOX_GAP && boxY + boxH + BOX_GAP > b.y);
let aboveFirst = true;
for (const [i, f] of frontier.entries()) {
  if (!labeledFlags[i]) continue;
  const cx = X(f.cost), cy = Y(f.accuracy);
  const R = 18;
  const fullText = labelOf(f);
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
    if (boxY < 42 || boxY + boxH > svgH - 26) continue;
    if (hitsAny(FRONTIER_DOTS.filter((d) => d.model !== f.model), boxX, boxY, boxW, boxH)) continue;
    if (hitsAny(BG_DOTS, boxX, boxY, boxW, boxH)) continue;
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
  const url = f.model_url;
  s += `<line x1="${cx.toFixed(1)}" y1="${dotY.toFixed(1)}" x2="${targetX.toFixed(1)}" y2="${targetY.toFixed(1)}" stroke="#888" stroke-width="0.8"/>`;
  s += `<a href="${url}" target="_blank" rel="noopener"><rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="11" fill="white" stroke="#d0d0d0"/><text x="${boxX + boxW / 2}" y="${boxY + boxH / 2 + 4}" text-anchor="middle" font-size="11" fill="#333">${esc(fullText)}</text></a>`;
}

// legend：左上横排（标题下方第二行）
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

s += `<text x="${padL}" y="${22}" font-size="14" font-weight="700" fill="#222">终端智能斩杀线</text>`;

s += `</svg>`;
writeFileSync(OUT, s);
console.log('tb-chart.svg bytes:', s.length, '→', OUT);
console.log('frontier points:', frontier.map(f => `${labelOf(f)}@$${f.cost}/${f.accuracy}%`).join(', '));
console.log('efficient:', [...fastKeys].map((k) => k.split('\u0000').slice(0, 2).join('/')).join(', ') || '(none)');