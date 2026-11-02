// render-vc.mjs — 把 vc-data.json 画成编码能力斩杀线 SVG（vc-chart.svg）
//
// X = Cost / Test USD（log 轴，Vals AI 页面口径：跑完一个完整 app 任务的成本），
// Y = Vibe Code Bench Score（%），前沿 = 按 cost 升序的 record-high score，
// 左上角高性价比区（Score ≥ 80 且 cost ≤ $5）。
//
// 与 render-aa.mjs 同构：logo 徽章内联 data URI、前沿大圆 + 碰撞感知 callout、透明
// hit-area、自定义 tooltip 靠 data-* 属性（gen-html.mjs 绑定）、x/y 轴自适应。
// 与旧 render.mjs（DeepSWE）的区别：
//   - 一行一个模型：fetch-vc 已把同模型的多 harness run 折叠成最高分那次，所以身份键
//     就是 model（harness 不进任何展示面——115/119 行都是 OpenHands，没有信息量）；
//   - 效率维用榜单自带的 Duration / Test（跑完一个任务要多久，越短越好），不用
//     tokens ÷ duration 那种自算速度；也不跨榜融合；
//   - cost 缺失（页面 '-')的行不画（没有 X 坐标），只在表格里出现。
//
// 用法: node scripts/render-vc.mjs [--dir <dir>] [--in <vc-data.json>] [--out <vc-chart.svg>]
//   默认读写系统临时目录: os.tmpdir()/model-killing-line/（可用 MKL_DIR 环境变量覆盖目录）
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logoFileOf, logoUriOf } from './logos.mjs';
import { vcLink } from './openrouter.mjs';

const argv = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
};
const DIR = argv('--dir') ?? process.env.MKL_DIR ?? path.join(os.tmpdir(), 'model-killing-line');
mkdirSync(DIR, { recursive: true });
const IN = argv('--in') ?? path.join(DIR, 'vc-data.json');
const OUT = argv('--out') ?? path.join(DIR, 'vc-chart.svg');

const allRows = JSON.parse(readFileSync(IN, 'utf8'));
// 只画有 X 坐标的行（cost 缺失的行留在表格里）
const rows = allRows.filter((r) => r.cost != null && r.cost > 0);
const dropped = allRows.length - rows.length;

// 身份键 = model（fetch-vc 已按模型折叠，一行一个模型）
const uid = (r) => r.model;

rmSync(path.join(DIR, 'logos'), { recursive: true, force: true });
const logoInfoOf = (m) => {
  const f = logoFileOf(m);
  return f ? { file: f, uri: logoUriOf(f) } : null;
};

// 帕累托前沿（2D：cost 升序 score 创新高，决定连线/大圆）
// 效率维 = Duration（秒，越短越高效）。pareto3 的第三维是「越大越好」，取负号。
const effOf = (r) => (r.duration_sec == null ? -Infinity : -r.duration_sec);
const byCost = [...rows].sort((a, b) => a.cost - b.cost);
const frontier = [];
let best = -Infinity;
for (const r of byCost) {
  if (r.score > best) { best = r.score; frontier.push({ ...r }); }
}
const frontIds = new Set(frontier.map(uid));
// fast 集：3D 差集（cost↓ score↑ duration↓）再在内部按 score×cost 取次级 2D 前沿 → 高效（蓝圈）；
//   次级线下（被另一个蓝色在 score+cost 上全包围）的降级为真被斩，不标蓝
const fastIds3 = new Set(rows.filter((r) => !frontIds.has(uid(r)) && !rows.some((o) =>
  o !== r && o.cost <= r.cost && o.score >= r.score && effOf(o) >= effOf(r) &&
  (o.cost < r.cost || o.score > r.score || effOf(o) > effOf(r))
)).map(uid));
const fastIds = new Set();
{
  let b2 = -Infinity;
  for (const r of rows.filter((r) => fastIds3.has(uid(r))).sort((a, b) => a.cost - b.cost)) {
    if (r.score > b2) { b2 = r.score; fastIds.add(uid(r)); }
  }
}

// 无 logo 回退字母（logoFileOf 覆盖了绝大多数前沿模型，这里只是兜底）
const logoOf = (m) => {
  const s = m.toLowerCase();
  if (s.startsWith('gpt')) return 'G';
  if (s.startsWith('gemini')) return 'M';
  if (s.startsWith('claude')) return 'C';
  if (s.startsWith('muse') || s.startsWith('wonder')) return '∞';
  if (s.startsWith('grok')) return 'X';
  if (s.startsWith('qwen')) return 'W';
  if (s.startsWith('glm')) return 'Z';
  if (s.startsWith('kimi')) return 'K';
  if (s.startsWith('deepseek')) return 'D';
  if (s.startsWith('mimo')) return 'Mi';
  if (s.startsWith('mistral')) return 'Ms';
  return '●';
};

const LOGO_RING = '#487265';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 画布：plotH 固定 450，但顶部留 72px 而不是 50px——这张榜 80~92% 那一段点太密，
// 前沿气泡只能往点上方放，50px 的抬头空间不够（Gemini 4 Argon 就因为这个挂不上名字）。
const svgW = 920, svgH = 582;
const padL = 70, padR = 30, padT = 72, padB = 60;

// x: log 轴，按 log 刻度阶梯自适应（数据 $0.07~$58，基础域 0.1~30 两端都会被截）
const X_LADDER = [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
const pickLE = (v) => { const c = X_LADDER.filter((t) => t <= v); return c.length ? c[c.length - 1] : X_LADDER[0]; };
const pickGE = (v) => { const c = X_LADDER.filter((t) => t >= v); return c.length ? c[0] : X_LADDER[X_LADDER.length - 1]; };
const dataXs = rows.map((r) => r.cost);
const xMin = pickLE(Math.min(...dataXs) * 0.85);
const xMax = pickGE(Math.max(...dataXs));
const xScale = (v) => Math.log10(v / xMin) / Math.log10(xMax / xMin);
const plotW = svgW - padL - padR;
const X = (v) => padL + xScale(Math.max(v, xMin)) * plotW;

// y: 0 ~ 数据最高分向上扩到 5 的整数倍（+2 留出前沿大圆 R18+外圈的位置）
const dataYs = rows.map((r) => r.score);
const yMin = Math.min(0, Math.floor(Math.min(...dataYs) / 5) * 5);
const yMax = Math.max(100, Math.ceil((Math.max(...dataYs) + 2) / 5) * 5);
const yScale = (v) => (v - yMin) / (yMax - yMin);
const plotH = svgH - padT - padB;
const Y = (v) => padT + (1 - yScale(v)) * plotH;

// 高性价比区：Score ≥ 80 且 cost ≤ $5
const ZONE_COST = 5;
const ZONE_SCORE = 80;
const zoneX = X(ZONE_COST);
const zoneY = Y(ZONE_SCORE);

const fmtTick = (t) => `$${t < 1 ? t.toFixed(2).replace(/0$/, '') : Number.isInteger(t) ? t : t.toFixed(1)}`;
const xTicks = X_LADDER.filter((t) => t >= xMin - 1e-9 && t <= xMax + 1e-9);
const yTicks = []; for (let t = 0; t <= yMax; t += 10) yTicks.push(t);

let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" id="chart" style="font-family:-apple-system,'PingFang SC','Helvetica Neue',sans-serif;background:#ffffff">`;

s += `<rect x="${padL}" y="${padT}" width="${zoneX - padL}" height="${zoneY - padT}" fill="#8caa5e" fill-opacity="0.10" stroke="#8caa5e" stroke-opacity="0.35" stroke-dasharray="3,3"/>`;
s += `<text x="${padL + 8}" y="${padT + 18}" font-size="11" fill="#5b7a3a" font-weight="600">高性价比区</text>`;
s += `<text x="${padL + 8}" y="${padT + 32}" font-size="10" fill="#5b7a3a">Score ≥ ${ZONE_SCORE}% &amp; Cost ≤ $${ZONE_COST}</text>`;

for (const t of xTicks) s += `<line x1="${X(t).toFixed(1)}" y1="${padT}" x2="${X(t).toFixed(1)}" y2="${padT + plotH}" stroke="#ececec" stroke-width="1"/>`;
for (const t of yTicks) s += `<line x1="${padL}" y1="${Y(t).toFixed(1)}" x2="${padL + plotW}" y2="${Y(t).toFixed(1)}" stroke="#ececec" stroke-width="1"/>`;

s += `<line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="#444"/>`;
s += `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#444"/>`;

for (const t of xTicks) {
  s += `<line x1="${X(t).toFixed(1)}" y1="${padT + plotH}" x2="${X(t).toFixed(1)}" y2="${padT + plotH + 5}" stroke="#444"/>`;
  s += `<text x="${X(t).toFixed(1)}" y="${padT + plotH + 20}" text-anchor="middle" font-size="11" fill="#555">${fmtTick(t)}</text>`;
}
for (const t of yTicks) {
  s += `<line x1="${padL - 5}" y1="${Y(t).toFixed(1)}" x2="${padL}" y2="${Y(t).toFixed(1)}" stroke="#444"/>`;
  s += `<text x="${padL - 10}" y="${Y(t).toFixed(1) + 4}" text-anchor="end" font-size="11" fill="#555">${t}</text>`;
}

s += `<text x="${padL + plotW / 2}" y="${svgH - 14}" text-anchor="middle" font-size="12" fill="#333">Cost / Test（USD，log 轴）</text>`;
s += `<text transform="translate(20,${padT + plotH / 2}) rotate(-90)" text-anchor="middle" font-size="12" fill="#333">Vibe Code Bench Score (%)</text>`;

const connectorPath = 'M' + frontier.map(f => `${X(f.cost).toFixed(1)},${Y(f.score).toFixed(1)}`).join(' L');
s += `<path d="${connectorPath}" fill="none" stroke="#888" stroke-width="1.5" stroke-dasharray="5,4"/>`;

const dataAttrs = (r, isFast, info) =>
  `data-model="${esc(r.model)}" data-score="${r.score}" data-cost="${r.cost}" data-tokens="${esc(r.tokens_disp ?? '—')}" data-dur="${esc(r.duration_disp ?? '—')}"${isFast ? ' data-fast="1"' : ''}${info ? ` data-logo="${info.file}"` : ''}`;

// 非前沿点（123 行里绝大多数在这里，logo 徽章缩到 R=7 以免左端低成本的密集区糊成一团）
for (const r of rows) {
  if (frontIds.has(uid(r))) continue;
  const cx = X(r.cost), cy = Y(r.score);
  const info = logoInfoOf(r.model);
  const isFast = fastIds.has(uid(r));
  const ring = isFast ? '#1971c2' : LOGO_RING;
  const attrs = dataAttrs(r, isFast, info);
  if (info) {
    const R = 7;
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R}" fill="#fff" stroke="${ring}" stroke-width="${isFast ? 2 : 1.2}" ${attrs}/>`;
    const lr = 4.6;
    s += `<image href="${info.uri}" x="${(cx - lr).toFixed(1)}" y="${(cy - lr).toFixed(1)}" width="${lr * 2}" height="${lr * 2}" preserveAspectRatio="xMidYMid slice" ${attrs}><title>${esc(r.model)}</title></image>`;
  } else {
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${isFast ? 4.5 : 3}" fill="${isFast ? '#1971c2' : '#888'}" fill-opacity="${isFast ? 0.9 : 0.5}" ${attrs}/>`;
  }
  s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="10" fill="transparent" ${attrs} class="dot-hit"/>`;
}

// 前沿上每个模型只标一个 label
const baseName = (m) => m.replace(/\s*\(.*?\)\s*/g, '').trim();
const labeledFlags = frontier.map((f, i) =>
  i === frontier.length - 1 || baseName(frontier[i + 1].model) !== baseName(f.model));

// 前沿徽章半径按最近邻自适应：这张榜的成本轴压缩得很厉害（DeepSeek 三代挤在
// $0.36/$0.41/$0.58），固定 R=18 会让两个大圆重叠 50% 以上、其中一个几乎看不见。
// 规则：R = 最近邻距离/2 - 2，夹在 [8, 18]；即“不重叠，但也不比小圆点还小”。
// 圆仍画在真实坐标上（不推开）——斩杀线的语义就是真实位置。
const FRONT_R_MAX = 18, FRONT_R_MIN = 8;
const frontRadius = new Map();
for (const f of frontier) {
  const cx = X(f.cost), cy = Y(f.score);
  const minD = Math.min(...frontier.filter((o) => uid(o) !== uid(f))
    .map((o) => Math.hypot(X(o.cost) - cx, Y(o.score) - cy)));
  const r = Number.isFinite(minD) ? minD / 2 - 2 : FRONT_R_MAX;
  frontRadius.set(uid(f), Math.max(FRONT_R_MIN, Math.min(FRONT_R_MAX, Math.round(r))));
}
const clipRadii = [...new Set([...frontRadius.values()].map((r) => r - 3))];
s += `<defs>${clipRadii.map((r) => `<clipPath id="vc-frontier-clip-${r}"><circle r="${r}"/></clipPath>`).join('')}</defs>`;
// 前沿大圆先画（label 盒子后画，保证气泡在最上层）
for (const f of frontier) {
  const cx = X(f.cost), cy = Y(f.score);
  const R = frontRadius.get(uid(f));
  const lr = R - 3;
  const logo = logoOf(f.model);
  const info = logoInfoOf(f.model);

  s += `<g class="frontier-mark" ${dataAttrs(f, false, info)} style="cursor:pointer">`;
  if (info) {
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R}" fill="#fff" stroke="${LOGO_RING}" stroke-width="3"/>`;
    s += `<g clip-path="url(#vc-frontier-clip-${lr})" transform="translate(${cx.toFixed(1)},${cy.toFixed(1)})"><image href="${info.uri}" x="${-lr}" y="${-lr}" width="${lr * 2}" height="${lr * 2}" preserveAspectRatio="xMidYMid slice"/></g>`;
  } else {
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R}" fill="${LOGO_RING}" stroke="white" stroke-width="3"/>`;
    s += `<text x="${cx.toFixed(1)}" y="${(cy + R * 0.28).toFixed(1)}" text-anchor="middle" font-size="${Math.max(9, R * (logo.length > 1 ? 0.72 : 1))}" font-weight="700" fill="white">${logo}</text>`;
  }
  s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R + 5}" fill="none" stroke="${LOGO_RING}" stroke-width="1.5" opacity="0.45"/>`;
  // 透明 hit-area：徽章缩到 R=8 时也还能稳稳 hover 到
  s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${Math.max(14, R)}" fill="transparent"/>`;
  s += `</g>`;
}

// callout 碰撞感知布局（同 render-aa）：候选位逐个试，盒子不得压住任何圆点/已放盒子/标题轴标签，
// 选不中就跳过该 label（圆点照画，hover/tooltip 不受影响）。
// 这张榜尤其需要：DeepSeek 三代 + Claude Haiku 5.5 挤在 y 82~90 的窄带里。
const DOT_PAD = 8;
const BOX_GAP = 8;
const LABEL_CANDIDATES = [
  { dx: 0, dy: -43 }, { dx: 0, dy: 43 },
  { dx: 0, dy: -75 }, { dx: 0, dy: 75 },
  { dx: -90, dy: -43 }, { dx: 90, dy: -43 },
  { dx: -90, dy: 43 }, { dx: 90, dy: 43 },
  { dx: -140, dy: -43 }, { dx: 140, dy: -43 },   // 同高度邻居太密时的远侧位（$5~$10 那段 80~92% 的密集区需要）
  { dx: -140, dy: 43 }, { dx: 140, dy: 43 },
];
const FRONTIER_DOTS = frontier.map((f) => ({ x: X(f.cost), y: Y(f.score), pad: frontRadius.get(uid(f)) + 6, id: uid(f) }));
const BG_DOTS = rows.filter((r) => !frontIds.has(uid(r)))
  .map((r) => ({ x: X(r.cost), y: Y(r.score), pad: DOT_PAD, id: uid(r) }));
const hitsAny = (list, boxX, boxY, boxW, boxH) =>
  list.some((d) => d.x > boxX - d.pad && d.x < boxX + boxW + d.pad && d.y > boxY - d.pad && d.y < boxY + boxH + d.pad);
const placedBoxes = [
  // 高性价比区的标题文字也是“已占用区域”，否则最便宜那几个前沿点的气泡会压在
  // 「Score ≥ 80% & Cost ≤ $5」上（实测 DeepSeek V4.1 Flash 就会盖住）。
  { x: padL + 4, y: padT + 8, w: 118, h: 32 },
];
const hitsBox = (boxX, boxY, boxW, boxH) =>
  placedBoxes.some((b) => boxX < b.x + b.w + BOX_GAP && boxX + boxW + BOX_GAP > b.x && boxY < b.y + b.h + BOX_GAP && boxY + boxH + BOX_GAP > b.y);
let aboveFirst = true;
const placedLabels = [];
for (const [i, f] of frontier.entries()) {
  if (!labeledFlags[i]) continue;
  const cx = X(f.cost), cy = Y(f.score);
  const R = frontRadius.get(uid(f));
  const fullText = f.model;
  // 盒子比 render-aa 小一号（10px 字 / 18px 高）：这张榜 116 个点，22px 高的气泡在
  // $5~$10 那一段根本挤不下，前沿点会连名字都挂不上。
  const charW = 5.6;
  const boxW = Math.max(72, fullText.length * charW + 14);
  const boxH = 18;
  const ordered = [...LABEL_CANDIDATES].sort((a, b) =>
    (aboveFirst ? (a.dy < 0 ? 0 : 1) - (b.dy < 0 ? 0 : 1) : (a.dy > 0 ? 0 : 1) - (b.dy > 0 ? 0 : 1))
    || (Math.abs(a.dx) + Math.abs(a.dy) - (Math.abs(b.dx) + Math.abs(b.dy))));
  let placed = null;
  // 两轮：先严格（不压任何小圆点），不行再放宽（允许盖住背景小圆点，但永不得
  // 压住其他前沿大圆 / 已放盒子 / 标题轴标签）。这张榜 116 个点，纯严格模式在
  // $5~$10 的密集区基本抢不到位，会导致前沿点没名字。
  for (const relaxBg of [false, true]) {
    for (const c of ordered) {
      let boxX = cx + c.dx - boxW / 2;
      if (boxX < 4) boxX = 4;
      if (boxX + boxW > svgW - 4) boxX = svgW - 4 - boxW;
      const boxY = cy + c.dy - boxH / 2;
      if (boxY < 42 || boxY + boxH > svgH - 26) continue; // 避开顶部标题与底部轴标签
      if (hitsAny(FRONTIER_DOTS.filter((d) => d.id !== uid(f)), boxX, boxY, boxW, boxH)) continue;
      if (!relaxBg && hitsAny(BG_DOTS, boxX, boxY, boxW, boxH)) continue;
      if (hitsBox(boxX, boxY, boxW, boxH)) continue;
      placed = { boxX, boxY };
      break;
    }
    if (placed) break;
  }
  aboveFirst = !aboveFirst;
  if (!placed) continue;
  const { boxX, boxY } = placed;
  placedBoxes.push({ x: boxX, y: boxY, w: boxW, h: boxH });
  placedLabels.push(f.model);
  const above = boxY + boxH / 2 < cy;
  const targetX = Math.min(Math.max(cx, boxX), boxX + boxW);
  const targetY = above ? boxY + boxH : boxY;
  const dotY = above ? cy - R - 1 : cy + R + 1;
  // label 文字可点 → OpenRouter 详情页（org 取自 vals 详情页路径，见 openrouter.mjs）
  const orLink = vcLink(f.model, f.org).url;
  s += `<line x1="${cx.toFixed(1)}" y1="${dotY.toFixed(1)}" x2="${targetX.toFixed(1)}" y2="${targetY.toFixed(1)}" stroke="#888" stroke-width="0.8"/>`;
  s += `<a href="${orLink}" target="_blank" rel="noopener"><rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="9" fill="white" stroke="#d0d0d0"/><text x="${boxX + boxW / 2}" y="${boxY + boxH / 2 + 3.5}" text-anchor="middle" font-size="10" fill="#333">${esc(fullText)}</text></a>`;
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

s += `<text x="${padL}" y="${22}" font-size="14" font-weight="700" fill="#222">编码能力斩杀线</text>`;

s += `</svg>`;
writeFileSync(OUT, s);
console.log('vc-chart.svg bytes:', s.length, '→', OUT);
console.log(`plotted: ${rows.length}/${allRows.length}（cost 缺失 ${dropped} 行只进表格）`);
console.log('efficient zone rect: x=', padL, '→', zoneX.toFixed(1), ', y=', padT, '→', zoneY.toFixed(1));
console.log('frontier points:', frontier.map(f => `${f.model}@$${f.cost}/${f.score}%/${f.duration_disp}`).join(', '));
console.log('labeled:', placedLabels.join(', '), placedLabels.length < frontier.length ? `（未放下 ${frontier.filter((f) => !placedLabels.includes(f.model)).map((f) => f.model).join(', ')}，圆点仍在，hover 看名字）` : '');
console.log('efficient:', rows.filter((r) => fastIds.has(uid(r))).map((r) => `${r.model}/${r.duration_disp}`).join(', ') || '(none)');
