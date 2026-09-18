// 渲染脚本：手写 SVG + 自定义 HTML tooltip 覆盖层
// 修复点：
//   - efficient zone 改成左上角矩形（PASS@1 ≥ 某阈值 且 cost ≤ 某阈值）
//   - 小圆点 hover 改用 JS 自定义 tooltip（更稳，不再依赖原生 SVG <title>）
//
// 用法: node scripts/render.mjs [--dir <dir>] [--in <data.json>] [--out <chart.svg>]
//   默认读写系统临时目录: os.tmpdir()/model-killing-line/（可用 MKL_DIR 环境变量覆盖目录）
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logoFileOf, logoUriOf } from './logos.mjs';
import { dsLink } from './openrouter.mjs';
import { buildAaIndex, fusedEff, fusedSpeed } from './fuse.mjs';

const argv = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
};
const DIR = argv('--dir') ?? process.env.MKL_DIR ?? path.join(os.tmpdir(), 'model-killing-line');
mkdirSync(DIR, { recursive: true });
const IN = argv('--in') ?? path.join(DIR, 'data.json');
const OUT = argv('--out') ?? path.join(DIR, 'chart.svg');

const rows = JSON.parse(readFileSync(IN, 'utf8'));

// lab logo 以 data URI 直接内联进 SVG：chart.svg / index.html 均为单文件，
// 输出目录不再需要 logos/ 文件夹（历史残留的顺手删掉）
rmSync(path.join(DIR, 'logos'), { recursive: true, force: true });
// data-logo 存短文件名（tooltip 用 LOGO_MAP 查 data URI，避免 dataset 塞几十 KB 文本）
// <image href> 则直接用 data URI 内联
const logoInfoOf = (m) => {
  const f = logoFileOf(m);
  return f ? { file: f, uri: logoUriOf(f) } : null;
};

// 帕累托前沿（2D：cost 升序 pass 创新高，决定连线/大圆）
// fast 集：效率维用复合效率 E = AA 融合 Tokens/s ÷ DS 自身 Steps（fuse.mjs fusedEff，
//   同名优先同 effort，无同名/无 steps → -Inf），
//   3D 差集（cost↓ pass↑ E↑）再在内部按 pass×cost 取次级 2D 前沿 → 高效，描蓝圈；
//   次级线下（被另一个蓝色在 pass+cost 上全包围）的降级为真被斩，不标蓝。
//   steps 与 speed 在 tooltip/表格里照常展示（展示≠统计：统计用的是复合后的 E）。融合明细见 aa-data.json 同一份过滤后集合。
const byCost = [...rows].sort((a, b) => a.avg_cost - b.avg_cost);
const frontier = [];
let best = -Infinity;
for (const r of byCost) {
  if (r.pass_rate > best) { best = r.pass_rate; frontier.push({ ...r }); }
}
const frontNames = new Set(frontier.map((f) => f.model));
const aaRows = JSON.parse(readFileSync(path.join(DIR, 'aa-data.json'), 'utf8'));
const aaIndex = buildAaIndex(aaRows);
const fEff = (r) => fusedEff(r, aaIndex).num;
const fastNames3 = new Set(rows.filter((r) => !frontNames.has(r.model) && !rows.some((o) =>
  o !== r && o.avg_cost <= r.avg_cost && o.pass_rate >= r.pass_rate && fEff(o) >= fEff(r) &&
  (o.avg_cost < r.avg_cost || o.pass_rate > r.pass_rate || fEff(o) > fEff(r))
)).map((r) => r.model));
console.log('fused speed: miss(AA无同名) =', rows.filter((r) => fusedSpeed(r, aaIndex).kind === 'none').map((r) => r.model).join(', ') || '(none)');
const fastNames = new Set();
{
  let b2 = -Infinity;
  for (const r of rows.filter((r) => fastNames3.has(r.model)).sort((a, b) => a.avg_cost - b.avg_cost)) {
    if (r.pass_rate > b2) { b2 = r.pass_rate; fastNames.add(r.model); }
  }
}

// 模型 logo
const logoOf = (m) => {
  if (m.startsWith('gpt-6')) return 'G6';
  if (m === 'gpt-5.6-sol') return '☀';
  if (m === 'gpt-5.6-luna') return '☾';
  if (m === 'gpt-5.5') return 'G5';
  if (m.startsWith('gemini')) return 'M';
  if (m === 'claude-opus-5') return 'C5';
  if (m === 'claude-fable-5') return '✦';
  if (m === 'claude-sonnet-5') return 'C';
  if (m === 'claude-opus-4.8') return 'C4';
  if (m.startsWith('kimi')) return 'K';
  if (m === 'glm-5.3-flash') return 'Zf';
  if (m === 'glm-5.3') return 'Z';
  if (m === 'glm-5.2') return 'Z';
  if (m.startsWith('qwen')) return 'W';
  if (m.startsWith('grok')) return 'X';
  if (m.startsWith('deepseek')) return 'D';
  if (m.startsWith('muse')) return '∞';
  return '●';
};

const effortColor = (e) => ({ max: '#e45756', xhigh: '#4c78a8', high: '#f58518', medium: '#72b7b2' })[e] || '#888';

// lab logo 外圈统一绿色，不再按 effort 区分（effort 只保留在表格/tooltip 文字里）
const LOGO_RING = '#487265';

// 画布
const svgW = 920, svgH = 560;
const padL = 70, padR = 30, padT = 50, padB = 60;

// x: log 0.1 ~ 30
const xMin = 0.1, xMax = 30;
const xScale = (v) => Math.log10(v / xMin) / Math.log10(xMax / xMin);
const plotW = svgW - padL - padR;
const X = (v) => padL + xScale(v) * plotW;

// y: 30 ~ 80
const yMin = 30, yMax = 80;
const yScale = (v) => (v - yMin) / (yMax - yMin);
const plotH = svgH - padT - padB;
const Y = (v) => padT + (1 - yScale(v)) * plotH;

// 高性价比区阈值：PASS@1 ≥ 50 且 cost ≤ $2.5（定义"左上角"边界）
const ZONE_COST = 2.5;   // x 边界（log 轴上的美元）
const ZONE_PASS = 50;    // y 边界
const zoneX = X(ZONE_COST);
const zoneY = Y(ZONE_PASS);

const xTicks = [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25];
const yTicks = [40, 50, 60, 70];

let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" id="chart" style="font-family:-apple-system,'PingFang SC','Helvetica Neue',sans-serif;background:#ffffff">`;

// 高性价比区：左上角矩形（从 (padL, padT) 到 (zoneX, zoneY)）
s += `<rect x="${padL}" y="${padT}" width="${zoneX - padL}" height="${zoneY - padT}" fill="#8caa5e" fill-opacity="0.10" stroke="#8caa5e" stroke-opacity="0.35" stroke-dasharray="3,3"/>`;
s += `<text x="${padL + 8}" y="${padT + 18}" font-size="11" fill="#5b7a3a" font-weight="600">高性价比区</text>`;
s += `<text x="${padL + 8}" y="${padT + 32}" font-size="10" fill="#5b7a3a">PASS@1 ≥ ${ZONE_PASS}% &amp; Cost ≤ $${ZONE_COST}</text>`;

// 网格线
for (const t of xTicks) s += `<line x1="${X(t).toFixed(1)}" y1="${padT}" x2="${X(t).toFixed(1)}" y2="${padT + plotH}" stroke="#ececec" stroke-width="1"/>`;
for (const t of yTicks) s += `<line x1="${padL}" y1="${Y(t).toFixed(1)}" x2="${padL + plotW}" y2="${Y(t).toFixed(1)}" stroke="#ececec" stroke-width="1"/>`;

// 50 参考虚线（与高性价比区底边重合，省略）
// 轴
s += `<line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="#444"/>`;
s += `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#444"/>`;

for (const t of xTicks) {
  s += `<line x1="${X(t).toFixed(1)}" y1="${padT + plotH}" x2="${X(t).toFixed(1)}" y2="${padT + plotH + 5}" stroke="#444"/>`;
  s += `<text x="${X(t).toFixed(1)}" y="${padT + plotH + 20}" text-anchor="middle" font-size="11" fill="#555">$${t.toFixed(t < 1 ? 2 : (t === 1 || t === 25 ? 0 : 1))}</text>`;
}
for (const t of yTicks) {
  s += `<line x1="${padL - 5}" y1="${Y(t).toFixed(1)}" x2="${padL}" y2="${Y(t).toFixed(1)}" stroke="#444"/>`;
  s += `<text x="${padL - 10}" y="${Y(t).toFixed(1) + 4}" text-anchor="end" font-size="11" fill="#555">${t}</text>`;
}

s += `<text x="${padL + plotW / 2}" y="${svgH - 14}" text-anchor="middle" font-size="12" fill="#333">Avg Cost per task</text>`;
s += `<text transform="translate(20,${padT + plotH / 2}) rotate(-90)" text-anchor="middle" font-size="12" fill="#333">PASS@1 (%)</text>`;

// dashed Pareto connector
const connectorPath = 'M' + frontier.map(f => `${X(f.avg_cost).toFixed(1)},${Y(f.pass_rate).toFixed(1)}`).join(' L');
s += `<path d="${connectorPath}" fill="none" stroke="#888" stroke-width="1.5" stroke-dasharray="5,4"/>`;

// 非前沿点 + 透明扩大 hit-area（半径 12，捕捉更稳）
// 有 lab logo 的只显示 logo 徽章（白底 + 统一绿色描边，不再画填充小圆点）；
// 无 logo 回退到原来的填充小圆点（data URI 内联，hover 时 tooltip 用 LOGO_MAP 查图，见 gen-html.mjs）
for (const r of rows) {
  if (frontier.some(f => f.model === r.model)) continue;
  const cx = X(r.avg_cost), cy = Y(r.pass_rate);
  const info = logoInfoOf(r.model);
  const isFast = fastNames.has(r.model);
  const ring = isFast ? '#1971c2' : LOGO_RING;
  const fs = fusedSpeed(r, aaIndex);
  const attrs = `data-model="${r.model}" data-effort="${r.effort}" data-pass="${r.pass_rate}" data-cost="${r.avg_cost}" data-steps="${r.steps}" data-speed="${fs.text}"${fs.matched ? ` data-speed-from="${fs.matched}"` : ''}${isFast ? ' data-fast="1"' : ''}${info ? ` data-logo="${info.file}"` : ''}`;
  if (info) {
    const R = 9;
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R}" fill="#fff" stroke="${ring}" stroke-width="${isFast ? 2 : 1.2}" ${attrs}/>`;
    const lr = 6;
    s += `<image href="${info.uri}" x="${(cx - lr).toFixed(1)}" y="${(cy - lr).toFixed(1)}" width="${lr * 2}" height="${lr * 2}" preserveAspectRatio="xMidYMid slice" ${attrs}><title>${r.model}</title></image>`;
  } else {
    // 无 logo 回退：填充小圆点（仍用 effort 色；fast 加蓝描边）
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${isFast ? 5 : 3.5}" fill="${effortColor(r.effort)}" fill-opacity="0.65" stroke="${isFast ? '#1971c2' : 'none'}" stroke-width="${isFast ? 1.5 : 0}" ${attrs}/>`;
  }
  // 透明 hit-area
  s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="12" fill="transparent" ${attrs} class="dot-hit"/>`;
}

// 前沿大圆 + callout：圆点直接显示 lab logo（clip 成圆形，无 logo 时回退字母）
s += `<defs><clipPath id="frontier-clip"><circle r="15"/></clipPath></defs>`;
for (const f of frontier) {
  const cx = X(f.avg_cost), cy = Y(f.pass_rate);
  const R = 18;
  const logo = logoOf(f.model);
  const info = logoInfoOf(f.model);

  const ffs = fusedSpeed(f, aaIndex);
  s += `<g class="frontier-mark" data-model="${f.model}" data-effort="${f.effort}" data-pass="${f.pass_rate}" data-cost="${f.avg_cost}" data-speed="${ffs.text}"${ffs.matched ? ` data-speed-from="${ffs.matched}"` : ''}${info ? ` data-logo="${info.file}"` : ''} style="cursor:pointer">`;
  if (info) {
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R}" fill="#fff" stroke="${LOGO_RING}" stroke-width="3"/>`;
    s += `<g clip-path="url(#frontier-clip)" transform="translate(${cx.toFixed(1)},${cy.toFixed(1)})"><image href="${info.uri}" x="-15" y="-15" width="30" height="30" preserveAspectRatio="xMidYMid slice"/></g>`;
  } else {
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R}" fill="${LOGO_RING}" stroke="white" stroke-width="3"/>`;
    s += `<text x="${cx.toFixed(1)}" y="${(cy + 5).toFixed(1)}" text-anchor="middle" font-size="${logo.length > 1 ? 13 : 18}" font-weight="700" fill="white">${logo}</text>`;
  }
  s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R + 5}" fill="none" stroke="${LOGO_RING}" stroke-width="1.5" opacity="0.45"/>`;
  s += `</g>`;

  // callout label：只显示模型名，不带 effort 后缀（effort 在 hover tooltip 里看）
  const fullText = f.model;
  const charW = 6.2;
  const boxW = Math.max(80, fullText.length * charW + 16);
  const boxH = 22;
  let boxX = cx - boxW / 2;
  if (boxX < 4) boxX = 4;
  if (boxX + boxW > svgW - 4) boxX = svgW - 4 - boxW;
  const boxY = cy - 32 - boxH / 2;
  // label 文字可点 → OpenRouter 详情页（归一化 + 前缀 org 映射，见 openrouter.mjs）
  const orLink = dsLink(f.model).url;
  s += `<line x1="${cx.toFixed(1)}" y1="${(cy - R - 1).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(boxY + boxH / 2).toFixed(1)}" stroke="#888" stroke-width="0.8"/>`;
  s += `<a href="${orLink}" target="_blank" rel="noopener"><rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="11" fill="white" stroke="#d0d0d0"/><text x="${boxX + boxW / 2}" y="${boxY + boxH / 2 + 4}" text-anchor="middle" font-size="11" fill="#333">${fullText}</text></a>`;
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

s += `<text x="${padL}" y="${22}" font-size="14" font-weight="700" fill="#222">长程编码能力斩杀线</text>`;

s += `</svg>`;
writeFileSync(OUT, s);
console.log('chart.svg bytes:', s.length, '→', OUT);
console.log('efficient zone rect: x=', padL, '→', zoneX.toFixed(1), ', y=', padT, '→', zoneY.toFixed(1));
console.log('frontier points:', frontier.map(f => `${f.model}@$${f.avg_cost}/${f.pass_rate}%`).join(', '));
console.log('efficient:', [...fastNames].join(', ') || '(none)');