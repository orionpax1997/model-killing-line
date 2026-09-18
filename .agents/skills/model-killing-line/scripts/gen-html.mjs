// gen-html.mjs — 把 DeepSWE + Artificial Analysis 两套图表/表格组装成单文件 index.html
//
// 页面结构：AA 图表 + AA 表格 ｜ DeepSWE 图表 + DeepSWE 表格（各自独立，AA 在上），
//   最后只有一块联合解读：脚本只留 <div id="llm-obs"> 占位，文案由 LLM 用 --obs 注入（不自动生成）。
// 两个 SVG 的 id 分别重写为 chart-code / chart-gen（避免重复 id），
//   tooltip/表格各绑各的卡片，logo 共用一份 LOGO_MAP。
//
// 可选：--with-top-missing（或 MKL_INCLUDE_TOP_MISSING=1）会把 OpenRouter Top 20 里
//   "用了但还没上双榜"的模型嵌进表格：
//   - 「上一代」型（hy4-preview / deepseek-v4-flash-0423 / muse-spark-1.3-contributor / ...）：
//     黄色（🆕 待更新）行，挂在 DS/AA 上对应锚点行的正上方；
//   - 纯免费型（Laguna S 2.1 (free) 等）：青色（🆓 免费）行，放两张表的最顶部。
//   需要 top-missing.json（find-top-missing.mjs 生成）。
//
// 用法: node scripts/gen-html.mjs [--dir <dir>] [--out <index.html>] [--with-top-missing] [--obs <html文件|->]
//   默认读写系统临时目录: os.tmpdir()/model-killing-line/（可用 MKL_DIR 环境变量覆盖目录）
//   依赖 data.json + chart.svg（fetch/render）与 aa-data.json + aa-chart.svg（fetch-aa/render-aa）都已生成。
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logoFileOf, logoUriOf } from './logos.mjs';
import { aaLink, dsLink, normalizeSlug } from './openrouter.mjs';
import { buildAaIndex, fusedEff, fusedSpeed, canonKey } from './fuse.mjs';

const argv = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
};
const DIR = argv('--dir') ?? process.env.MKL_DIR ?? path.join(os.tmpdir(), 'model-killing-line');
mkdirSync(DIR, { recursive: true });
const OUT = argv('--out') ?? path.join(DIR, 'index.html');
const WITH_TOP_MISSING = process.argv.includes('--with-top-missing') || process.env.MKL_INCLUDE_TOP_MISSING === '1';
// LLM 解读注入：--obs <html文件|->（- 从 stdin 读）。内容直接填进 #llm-obs 占位。
const OBS = (() => {
  const v = argv('--obs') ?? process.env.MKL_OBS;
  if (!v) return '';
  return v === '-' ? readFileSync(0, 'utf8') : readFileSync(v, 'utf8');
})();

for (const f of ['data.json', 'chart.svg', 'aa-data.json', 'aa-chart.svg']) {
  if (!existsSync(path.join(DIR, f))) {
    console.error(`missing ${path.join(DIR, f)} — 先跑 fetch → fetch-aa → render → render-aa`);
    process.exit(1);
  }
}

const dsRows = JSON.parse(readFileSync(path.join(DIR, 'data.json'), 'utf8'));
const aaRows = JSON.parse(readFileSync(path.join(DIR, 'aa-data.json'), 'utf8'));
rmSync(path.join(DIR, 'logos'), { recursive: true, force: true });

// ---- 二维前沿：cost 升序，y 创新高即高性价比（决定图上连线/大圆） ----
// ---- 三维 Pareto：cost↓ y↑ speed↑（speed 缺失按 -Inf，不占便宜）----
//   2D 前沿 ⊂ 3D 前沿；差集再在内部按能力×成本取一次 2D 前沿（次级线，
//   不画线只做判断）—— 线上才算「高效」标蓝，线下（被另一个蓝色在
//   能力+成本上全包围）降级为真被斩，不标蓝
const numSpeed = (r) => { const v = parseFloat(r.speed); return Number.isNaN(v) ? -Infinity : v; };
const pareto2 = (rows, costOf, yOf) => {
  const names = new Set();
  let best = -Infinity;
  for (const r of [...rows].sort((a, b) => costOf(a) - costOf(b))) {
    if (yOf(r) > best) { best = yOf(r); names.add(r.model); }
  }
  return names;
};
const pareto3 = (rows, costOf, yOf, speedOf) => {
  const names = new Set();
  for (const r of rows) {
    const dominated = rows.some((o) =>
      o !== r && costOf(o) <= costOf(r) && yOf(o) >= yOf(r) && speedOf(o) >= speedOf(r) &&
      (costOf(o) < costOf(r) || yOf(o) > yOf(r) || speedOf(o) > speedOf(r)));
    if (!dominated) names.add(r.model);
  }
  return names;
};
const dsFront = pareto2(dsRows, (r) => r.avg_cost, (r) => r.pass_rate);
const aaFront = pareto2(aaRows, (r) => r.cost, (r) => r.index);
// DS 效率维 = 复合效率 E = AA 融合 Tokens/s ÷ DS 自身 Steps（同名优先同 effort，无同名/无 steps → -Inf）——见 fuse.mjs
const aaIndex = buildAaIndex(aaRows);
const dsFused = new Map(dsRows.map((r) => [r.model, fusedSpeed(r, aaIndex)]));
const dsEffNum = (r) => fusedEff(r, aaIndex).num;
console.log('fused speed: DS miss(AA无同名) =', dsRows.filter((r) => dsFused.get(r.model).kind === 'none').map((r) => r.model).join(', ') || '(none)');
const dsFast3 = new Set([...pareto3(dsRows, (r) => r.avg_cost, (r) => r.pass_rate, dsEffNum)].filter((m) => !dsFront.has(m)));
const aaFast3 = new Set([...pareto3(aaRows, (r) => r.cost, (r) => r.index, numSpeed)].filter((m) => !aaFront.has(m)));
const pareto2On = (rows, names, costOf, yOf) => pareto2(rows.filter((r) => names.has(r.model)), costOf, yOf);
const dsFast = pareto2On(dsRows, dsFast3, (r) => r.avg_cost, (r) => r.pass_rate);
const aaFast = pareto2On(aaRows, aaFast3, (r) => r.cost, (r) => r.index);
const dsRest = dsRows.filter((r) => !dsFront.has(r.model));
const aaRest = aaRows.filter((r) => !aaFront.has(r.model));
const dsCut = dsRest.filter((r) => !dsFast.has(r.model));
const aaCut = aaRest.filter((r) => !aaFast.has(r.model));
const dsWorst = dsCut.reduce((a, b) => (b.avg_cost > a.avg_cost ? b : a));
const aaWorst = aaCut.reduce((a, b) => (b.cost > a.cost ? b : a));
const dsZone = dsRows.filter((r) => r.pass_rate >= 50 && r.avg_cost <= 2.5);
const aaZone = aaRows.filter((r) => r.index > 35 && r.cost < 1);
const dsFrontList = [...dsRows].sort((a, b) => a.avg_cost - b.avg_cost).filter((r) => dsFront.has(r.model));
const aaFrontList = [...aaRows].sort((a, b) => a.cost - b.cost).filter((r) => aaFront.has(r.model));

// ---- 跨榜重合：同一归一键（fuse.mjs canonKey）即同一模型，不再是约等于 ----
//   DS 前沿名 → AA 同键的前沿变体（取 index 最高者展示）
const aaFrontByKey = new Map();
for (const m of aaFront) {
  const k = canonKey(m);
  if (!aaFrontByKey.has(k)) aaFrontByKey.set(k, []);
  aaFrontByKey.get(k).push(m);
}
for (const arr of aaFrontByKey.values()) arr.sort((a, b) => aaRows.find((r) => r.model === b).index - aaRows.find((r) => r.model === a).index);
const overlap = [...dsFront].map((d) => [d, (aaFrontByKey.get(canonKey(d)) ?? [])[0]]).filter(([, a]) => a);

// ---- SVG 内联（重写 id，避免同页重复） ----
const prepSvg = (file, id) => readFileSync(path.join(DIR, file), 'utf8')
  .replace(/<\?xml[^?]*\?>\s*/g, '').trim()
  .replace('id="chart"', `id="${id}"`);
const dsSvg = prepSvg('chart.svg', 'chart-code');
const aaSvg = prepSvg('aa-chart.svg', 'chart-gen');

const usedFiles = [...new Set([...dsRows, ...aaRows].map((r) => logoFileOf(r.model)).filter(Boolean))];
const LOGO_MAP = Object.fromEntries(usedFiles.map((f) => [f, logoUriOf(f)]));

// ---- 模型名归一化 → OpenRouter 详情页链接（精确命中拼详情页，
//   OR 无详情页的回退搜索页；见 openrouter.mjs，构建期算好注入页面） ----
const DS_LINK = Object.fromEntries(dsRows.map((r) => [r.model, dsLink(r.model).url]));
const AA_LINK = Object.fromEntries(aaRows.map((r) => [r.model, aaLink(r.model, r.creator).url]));
const orMiss = [...Object.entries(DS_LINK), ...Object.entries(AA_LINK)]
  .filter(([, u]) => u.includes('/models?q=')).map(([m, u]) => `${m} -> ${u}`);
if (orMiss.length) console.log('openrouter fallback(search):', orMiss.length, orMiss.join('; '));

// ---- OpenRouter Top 缺失（仅 --with-top-missing 时注入；可选 top-missing.json） ----
const topMissingPath = path.join(DIR, 'top-missing.json');
const topMissing = (WITH_TOP_MISSING && existsSync(topMissingPath))
  ? JSON.parse(readFileSync(topMissingPath, 'utf8'))
  : { successors: [], free: [], skipped: [], top: 0 };
const TM_SUCCESSORS = topMissing.successors ?? [];
const TM_FREE = topMissing.free ?? [];
const TM_SKIPPED = topMissing.skipped ?? [];
// 给 unbench 行拼 OR 详情页 URL（用 provider + slug；都已在 find-top-missing 时准备好了）
const TM_URL = (m) => `https://openrouter.ai/${m.provider.toLowerCase()}/${m.slug}${m.is_free ? ':free' : ''}`;
if (WITH_TOP_MISSING) console.log(`top-missing: ${TM_SUCCESSORS.length} successors + ${TM_FREE.length} free + ${TM_SKIPPED.length} skipped${TM_SKIPPED.length ? ' (skipped: ' + TM_SKIPPED.map((s) => s.short_name).join(', ') + ')' : ''}`);
const EFFORT_COLOR = { max: '#e45756', xhigh: '#4c78a8', high: '#f58518', medium: '#72b7b2' };

// 解读文案不由脚本生成：LLM 读 data.json/aa-data.json/top-missing.json + 终端
// 打印的前沿/高效区/最惨名单，自由撰写 HTML 片段后经 --obs 注入 #llm-obs
// （--obs <文件> 或 --obs - 从 stdin 读；也可用 MKL_OBS 环境变量传文件路径）。

// 通用 unbench 行内 HTML（DS 7 列 / AA 7 列）。
// `idx` 列填 "—"；Model 列里塞徽标 + OR 信息子行；其它列填 "—"。
const fmtWeekly = (n) => n >= 1e12 ? (n / 1e12).toFixed(1) + 'T' : n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(0) + 'M' : String(n);
const tmSubLine = (m) => {
  // AA 独立信号行（via=aa-highlight-no-or）：Intelligence Index + 价格 + 速度
  if (m.predecessor?.via === 'aa-highlight-no-or') {
    const bits = [];
    if (m.aa_index != null) bits.push(`Intelligence Index ${m.aa_index}`);
    if (m.input_price != null && m.input_price === m.output_price) bits.push(`$${m.input_price.toFixed(2)}/M`);
    else {
      if (m.input_price != null) bits.push(`$${m.input_price.toFixed(2)}/M 输入`);
      if (m.output_price != null) bits.push(`$${m.output_price.toFixed(2)}/M 输出`);
    }
    if (m.aa_speed != null) bits.push(`${m.aa_speed} tok/s`);
    return bits.join(' · ');
  }
  const wk = m.weekly_tokens ? fmtWeekly(m.weekly_tokens) + '/周' : '周用量不在 OR Top 30';
  const ctx = m.context_length ? m.context_length.toLocaleString() + ' ctx' : 'AA 独家';
  const price = m.is_free
    ? `免费 · ${ctx}`
    : (m.input_price != null && m.output_price != null
       ? `$${m.input_price.toFixed(2)}/M 输入 · $${m.output_price.toFixed(2)}/M 输出 · ${ctx}`
       : `AA highlight · ${ctx}`);
  return (m.rank != null ? `OR Top #${m.rank} · ` : 'AA highlight · ') + wk + ' · ' + price;
};
const tmBadge = (m) => m.is_free
  ? '<span class="tag tag-free">🆓 免费</span>'
  : '<span class="tag tag-warn">🆕 待更新</span>';

const GEN_DATE = new Date().toISOString().slice(0, 10);
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>模型斩杀线：通用智力 × 长程编码能力</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; margin: 0; background: #fafafa; color: #222; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 26px; margin: 0 0 6px; }
  .sub { color: #666; font-size: 14px; margin-bottom: 6px; }
  .gen-date { color: #999; font-size: 12px; margin-top: 8px; }
  .stale { display: none; color: #9c5b00; background: #fff4e0; border: 1px solid #f0c36d; border-radius: 8px; padding: 8px 12px; font-size: 13px; margin-bottom: 20px; }
  .card { background: #fff; border: 1px solid #e5e5e5; border-radius: 12px; padding: 20px; margin: 20px 0; box-shadow: 0 1px 4px rgba(0,0,0,.04); position: relative; }
  .card h2 { font-size: 18px; margin: 0 0 12px; }
  .chart-box { padding: 0; overflow: hidden; }
  .chart-box svg { width: 100%; height: auto; display: block; background: #fff; }
  .chart-box svg image { clip-path: circle(50%); background: #fff; }

  .tooltip {
    position: absolute;
    pointer-events: none;
    background: rgba(20, 20, 28, 0.95);
    color: #fff;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 12px;
    line-height: 1.5;
    opacity: 0;
    transition: opacity 0.12s;
    z-index: 10;
    white-space: nowrap;
    box-shadow: 0 4px 16px rgba(0,0,0,.18);
  }
  .tooltip.show { opacity: 1; }
  .tooltip .tip-name { font-weight: 700; font-size: 13px; }
  .tooltip .tip-head { display: flex; align-items: center; gap: 8px; }
  .tooltip .tip-logo { width: 32px; height: 32px; padding: 2px; border-radius: 50%; object-fit: cover; background: #fff; flex-shrink: 0; border: 2px solid #487265; }
  .tooltip .tip-effort {
    display: inline-block;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 4px;
    margin-left: 6px;
    text-transform: uppercase;
    background: rgba(255,255,255,.15);
  }
  .tooltip .tip-row { color: #b9bcc7; margin-top: 2px; }
  .tooltip .tip-row b { color: #fff; font-variant-numeric: tabular-nums; }

  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { padding: 8px 10px; border-bottom: 1px solid #eee; text-align: left; }
  th { background: #f6f6f6; font-weight: 600; position: sticky; top: 0; }
  td.num { font-variant-numeric: tabular-nums; text-align: right; font-family: ui-monospace, monospace; }
  th.num { text-align: right; }
  tr.alive { background: #eef7ee; font-weight: 600; }
  tr.fast { background: #eef3fd; font-weight: 600; }
  tbody tr[data-url] { cursor: pointer; transition: background .12s; }
  tbody tr[data-url]:hover { background: #edf3fe; }
  tbody tr.alive[data-url]:hover { background:#dcefdc; }
  tbody tr.fast[data-url]:hover { background: #d9e5fa; }
  tbody tr[data-url]:focus-visible { outline: 2px solid #1a73e8; outline-offset: -2px; }
  tbody tr:hover .model a { color: #1a73e8; text-decoration: underline; text-underline-offset: 3px; }
  tbody tr:hover .model a::after { color: #1a73e8; }
  .model .tag { display: inline-block; font-size: 11px; font-weight: 700; color: #fff; background: #2f9e44; border-radius: 20px; padding: 1px 8px; margin-left: 6px; vertical-align: 1px; }
  .model .tag-fast { background: #1971c2; }
  .model a, .obs a { color: inherit; text-decoration: none; transition: color .12s; }
  .model a:hover, .obs a:hover { color: #1a73e8; text-decoration: underline; text-underline-offset: 3px; }
  .model a:visited, .obs a:visited { color: inherit; }
  .model a::after, .obs a::after { content: '↗'; font-size: 10px; color: #c3c7d1; margin-left: 3px; vertical-align: 1px; }
  .model a:hover::after, .obs a:hover::after { color: #1a73e8; }
  .chart-box svg a { cursor: pointer; }
  .chart-box svg a rect { transition: stroke .12s; }
  .chart-box svg a:hover rect { stroke: #1a73e8; }
  .chart-box svg a:hover text { fill: #1a73e8; }
  .eff { color: #fff; font-size: 12px; border-radius: 4px; padding: 1px 7px; }
  ul.obs { margin: 8px 0; padding-left: 20px; line-height: 1.9; font-size: 14px; }
  .tabs { display: flex; gap: 8px; margin: 20px 0 0; }
  .tab { padding: 8px 22px; border-radius: 20px; border: 1px solid #ddd; background: #fff; cursor: pointer; font-size: 14px; color: #555; }
  .tab.active { background: #222; border-color: #222; color: #fff; font-weight: 600; }
  .tab:focus-visible { outline: 2px solid #1a73e8; outline-offset: 2px; }
  .board.hidden { display: none; }
  footer { color: #999; font-size: 12px; margin-top: 28px; }

  /* OR Top 缺失行（find-top-missing.mjs 产出的行；默认 --with-top-missing 才出现） */
  tr.unbench-succ { background: #fff5cc; }
  tr.unbench-succ:hover { background: #ffeaa6; }
  tr.unbench-free { background: #d9f3ff; }
  tr.unbench-free:hover { background: #b8e6fb; }
  tr.unbench-succ, tr.unbench-free { font-weight: normal; }
  tr.unbench-succ td, tr.unbench-free td { border-bottom-color: rgba(0,0,0,.05); }
  .model .model-sub { display: block; font-size: 11px; color: #6b6b6b; font-weight: normal; margin-top: 3px; line-height: 1.45; }
  .model .tag-warn { background: #c98415; }
  .model .tag-free { background: #1971c2; }
</style>
</head>
<body>
<div class="wrap">
  <h1>🔪 模型斩杀线：通用智力 × 长程编码能力</h1>
  <div class="stale" id="stale-tip">⚠️ 数据已过期（生成于 <span id="stale-date">${GEN_DATE}</span>，距今超过 15 天），模型迭代较快请获取最新报告。</div>
  <div class="sub">双榜 Pareto 前沿 · 通用智力 ${aaRows.length} 模型 / 长程编码能力 ${dsRows.length} 模型${WITH_TOP_MISSING ? ` / 叠加 OpenRouter Top 20 模型` : ''}</div>

  <div class="tabs" role="tablist">
    <button class="tab active" data-board="board-gen" role="tab" aria-selected="true">通用智力</button>
    <button class="tab" data-board="board-code" role="tab" aria-selected="false">长程编码能力</button>
  </div>

  <div class="board" id="board-gen">
  <div class="card chart-box" id="card-gen">
    ${aaSvg}
    <div class="tooltip" id="tip-gen"></div>
  </div>

  <div class="card">
    <h2>通用智力排名</h2>
    <table>
      <thead><tr><th>#</th><th>Model</th><th>Creator</th><th class="num">Index</th><th class="num">Cost/Task</th><th class="num">Tokens/s</th><th class="num">Latency(s)</th></tr></thead>
      <tbody id="tbody-gen"></tbody>
    </table>
  </div>
  </div>

  <div class="board hidden" id="board-code">
  <div class="card chart-box" id="card-code">
    ${dsSvg}
    <div class="tooltip" id="tip-code"></div>
  </div>

  <div class="card">
    <h2>长程编码能力排名</h2>
    <table>
      <thead><tr><th>#</th><th>Model</th><th>Effort</th><th class="num">PASS@1</th><th class="num">Avg Cost</th><th class="num">Steps</th><th class="num">Tokens/s*</th></tr></thead>
      <tbody id="tbody-code"></tbody>
    </table>
  </div>
  </div>

  <div class="card">
    <h2>解读</h2>
    <div id="llm-obs">${OBS}</div>
  </div>

  <footer>数据来源 https://artificialanalysis.ai/leaderboards/models · https://deepswe.datacurve.ai/${WITH_TOP_MISSING ? ' · https://openrouter.ai/models?order=top-weekly' : ''}</footer>
  <div class="gen-date">报告生成日期 ${GEN_DATE} · 榜单数据来自第三方公开来源，仅供学习交流，不构成选型或采购建议</div>
</div>

<script>
const DS_ROWS = ${JSON.stringify(dsRows)};
const AA_ROWS = ${JSON.stringify(aaRows)};
const LOGO_MAP = ${JSON.stringify(LOGO_MAP)};
const EFFORT_COLOR = ${JSON.stringify(EFFORT_COLOR)};
const DS_SURVIVORS = new Set(${JSON.stringify([...dsFront])});
const AA_SURVIVORS = new Set(${JSON.stringify([...aaFront])});
const DS_FAST = new Set(${JSON.stringify([...dsFast])});
const AA_FAST = new Set(${JSON.stringify([...aaFast])});
const DS_LINK = ${JSON.stringify(DS_LINK)};
const AA_LINK = ${JSON.stringify(AA_LINK)};
const DS_FUSED = ${JSON.stringify(Object.fromEntries([...dsFused].map(([m, f]) => [m, { text: f.text, matched: f.matched, kind: f.kind }])))};
const WITH_TM = ${JSON.stringify(WITH_TOP_MISSING)};
const TM_SUCCESSORS = ${JSON.stringify(TM_SUCCESSORS)};
const TM_FREE = ${JSON.stringify(TM_FREE)};
const orA = (name, url) => '<a href="' + url + '" target="_blank" rel="noopener">' + name + '</a>';
const normalizeSlug = ${normalizeSlug.toString().replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')};

const fmtWeekly = (n) => n >= 1e12 ? (n / 1e12).toFixed(1) + 'T' : n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(0) + 'M' : String(n);
const tmSubLine = (m) => {
  if (m.predecessor && m.predecessor.via === 'aa-highlight-no-or') {
    const bits = [];
    if (m.aa_index != null) bits.push('Intelligence Index ' + m.aa_index);
    if (m.input_price != null && m.input_price === m.output_price) bits.push('$' + m.input_price.toFixed(2) + '/M');
    else {
      if (m.input_price != null) bits.push('$' + m.input_price.toFixed(2) + '/M 输入');
      if (m.output_price != null) bits.push('$' + m.output_price.toFixed(2) + '/M 输出');
    }
    if (m.aa_speed != null) bits.push(m.aa_speed + ' tok/s');
    return bits.join(' · ');
  }
  const wk = m.weekly_tokens ? fmtWeekly(m.weekly_tokens) + '/周' : '周用量不在 OR Top 30';
  const ctx = m.context_length ? m.context_length.toLocaleString() + ' ctx' : 'AA 独家';
  const price = m.is_free
    ? '免费 · ' + ctx
    : (m.input_price != null && m.output_price != null
       ? '$' + m.input_price.toFixed(2) + '/M 输入 · $' + m.output_price.toFixed(2) + '/M 输出 · ' + ctx
       : 'AA highlight · ' + ctx);
  return (m.rank != null ? 'OR Top #' + m.rank + ' · ' : 'AA highlight · ') + wk + ' · ' + price;
};
const tmBadge = (m) => m.is_free
  ? '<span class="tag tag-free">🆓 免费</span>'
  : '<span class="tag tag-warn">🆕 待更新</span>';
const tmUrl = (m) => 'https://openrouter.ai/' + m.provider.toLowerCase() + '/' + m.slug + (m.is_free ? ':free' : '');

// unbench 行的 7 列 HTML（DS 表 / AA 表共用同一布局，列顺序按各自表头调整）
const tmCells = (m, numCols) => {
  const sub = tmSubLine(m);
  const tag = tmBadge(m);
  const link = orA(m.short_name, tmUrl(m));
  const mid = '<td class="model">' + link + ' ' + tag + '<span class="model-sub">' + sub + '</span></td>';
  const dash = '<td class="num">—</td>';
  // 第一列 # 用 "—"，第二列 Model（已经构造 mid），后面 numCols-2 个 "—"
  const rest = Array(numCols - 2).fill(dash).join('');
  return '<td>—</td>' + mid + rest;
};

// ---- DeepSWE 表格 ----
{
  const tbody = document.getElementById('tbody-code');
  const trByModel = new Map(); // 用于 unbench 插入"上一代"锚点上方
  const trByCanon = new Map(); // 按 normalizeSlug(dsLink) 也建索引（AA-highlight succ 用 canon key 找锚点）
  [...DS_ROWS].sort((a,b)=>b.pass_rate-a.pass_rate).forEach((r,i)=>{
    const alive = DS_SURVIVORS.has(r.model);
    const fast = !alive && DS_FAST.has(r.model);
    const tr = document.createElement('tr');
    tr.className = alive ? 'alive' : (fast ? 'fast' : '');
    if (fast) tr.title = '高效：能力/成本被压制，但 Tokens/s 更高（更快），不是真被斩';
    tr.dataset.url = DS_LINK[r.model];
    tr.tabIndex = 0;
    tr.innerHTML = \`<td>\${i+1}</td>
      <td class="model">\${alive ? '🔪 ' : (fast ? '⚡ ' : '')}\${orA(r.model, DS_LINK[r.model])}\${alive ? ' <span class="tag">高性价比</span>' : (fast ? ' <span class="tag tag-fast">高效</span>' : '')}</td>
      <td><span class="eff" style="background:\${EFFORT_COLOR[r.effort]}">\${r.effort}</span></td>
      <td class="num">\${r.pass_rate}%</td>
      <td class="num">$\${r.avg_cost.toFixed(2)}</td>
      <td class="num">\${r.steps}</td>
      <td class="num">\${DS_FUSED[r.model].text}</td>\`;
    tbody.appendChild(tr);
    trByModel.set(r.model, tr);
    trByCanon.set(normalizeSlug(DS_LINK[r.model].replace(new RegExp('^https://openrouter\\.ai/[^/]+/'), '')), tr);
  });
  if (WITH_TM) {
    // 1) 上一代型：插入到对应锚点的正上方
    //    predecessor.key 可能是 ds display name（findPredecessor 出来的）、也可能是 AA canon key（AA-highlight 出来的）
    for (const s of TM_SUCCESSORS.filter((x) => x.predecessor.board === 'ds')) {
      const anchor = trByModel.get(s.predecessor.key) || trByCanon.get(s.predecessor.key);
      if (!anchor) {
        // AA highlight 但 DS 完全没这个 row（AA canon key 不在 trByCanon 里）。
        // 可能是两种原因：1) AA 独立信号（OR 上没有，via=aa-highlight-no-or），
        // 2) OR 上有但 dsLink 覆盖后还是找不到锚点。
        const tr = document.createElement('tr');
        tr.className = 'unbench-succ';
        tr.dataset.url = tmUrl(s);
        tr.tabIndex = 0;
        if (s.predecessor.via === 'aa-highlight-no-or') {
          tr.title = 'AA 高效模型「' + s.short_name + '」（Intelligence Index ' + s.aa_index + ' · $' + s.input_price.toFixed(2) + '/M · ' + s.aa_speed + ' tok/s），DS 暂缺（锚点不在 DS 表中）';
        } else {
          tr.title = 'OR 周用量 ' + fmtWeekly(s.weekly_tokens) + '（第 ' + s.rank + ' 名），AA 已 highlight 但 DS 暂缺（推测锚点 ' + s.predecessor.key + ' 不在 DS 表中）';
        }
        tr.innerHTML = tmCells(s, 7);
        tbody.appendChild(tr);
        continue;
      }
      const tr = document.createElement('tr');
      tr.className = 'unbench-succ';
      tr.dataset.url = tmUrl(s);
      tr.tabIndex = 0;
      if (s.predecessor.via === 'aa-highlight-no-or') {
        tr.title = 'AA 高效模型「' + s.short_name + '」（Intelligence Index ' + s.aa_index + ' · $' + s.input_price.toFixed(2) + '/M · ' + s.aa_speed + ' tok/s），DS 暂缺；上一代疑似「' + s.predecessor.key + '」';
      } else {
        tr.title = 'OR 周用量 ' + fmtWeekly(s.weekly_tokens) + '（第 ' + s.rank + ' 名），尚未上 DeepSWE；推测为上一代「' + s.predecessor.key + '」的后续';
      }
      tr.innerHTML = tmCells(s, 7);
      tbody.insertBefore(tr, anchor);
    }
    // 2) 纯免费型：按 OR 排名顺序（高位先）插到最顶部
    for (const f of [...TM_FREE].reverse()) {
      const tr = document.createElement('tr');
      tr.className = 'unbench-free';
      tr.dataset.url = tmUrl(f);
      tr.tabIndex = 0;
      tr.title = 'OR Top ' + f.rank + ' 免费模型（' + fmtWeekly(f.weekly_tokens) + '/周），双榜暂缺';
      tr.innerHTML = tmCells(f, 7);
      tbody.insertBefore(tr, tbody.firstChild);
    }
  }
}

// ---- AA 表格 ----
{
  const tbody = document.getElementById('tbody-gen');
  const trByModel = new Map();
  const trByCanon = new Map();
  [...AA_ROWS].sort((a,b)=>b.index-a.index).forEach((r,i)=>{
    const alive = AA_SURVIVORS.has(r.model);
    const fast = !alive && AA_FAST.has(r.model);
    const tr = document.createElement('tr');
    tr.className = alive ? 'alive' : (fast ? 'fast' : '');
    if (fast) tr.title = '高效：能力/成本被压制，但 Tokens/s 更高（更快），不是真被斩';
    tr.dataset.url = AA_LINK[r.model];
    tr.tabIndex = 0;
    tr.innerHTML = \`<td>\${i+1}</td>
      <td class="model">\${alive ? '🔪 ' : (fast ? '⚡ ' : '')}\${orA(r.model, AA_LINK[r.model])}\${alive ? ' <span class="tag">高性价比</span>' : (fast ? ' <span class="tag tag-fast">高效</span>' : '')}</td>
      <td>\${r.creator}</td>
      <td class="num">\${r.index}\${r.estimated ? '*' : ''}</td>
      <td class="num">$\${r.cost.toFixed(2)}</td>
      <td class="num">\${r.speed}</td>
      <td class="num">\${r.latency}</td>\`;
    tbody.appendChild(tr);
    trByModel.set(r.model, tr);
    trByCanon.set(normalizeSlug(AA_LINK[r.model].replace(new RegExp('^https://openrouter\\.ai/[^/]+/'), '')), tr);
  });
  if (WITH_TM) {
    for (const s of TM_SUCCESSORS.filter((x) => x.predecessor.board === 'aa')) {
      const anchor = trByModel.get(s.predecessor.key) || trByCanon.get(s.predecessor.key);
      if (!anchor) continue;
      const tr = document.createElement('tr');
      tr.className = 'unbench-succ';
      tr.dataset.url = tmUrl(s);
      tr.tabIndex = 0;
      tr.title = 'OR 周用量 ' + fmtWeekly(s.weekly_tokens) + '（第 ' + s.rank + ' 名），尚未上 AA；推测为「' + s.predecessor.key + '」的后续';
      tr.innerHTML = tmCells(s, 7);
      tbody.insertBefore(tr, anchor);
    }
    for (const f of [...TM_FREE].reverse()) {
      const tr = document.createElement('tr');
      tr.className = 'unbench-free';
      tr.dataset.url = tmUrl(f);
      tr.tabIndex = 0;
      tr.title = 'OR Top ' + f.rank + ' 免费模型（' + fmtWeekly(f.weekly_tokens) + '/周），双榜暂缺';
      tr.innerHTML = tmCells(f, 7);
      tbody.insertBefore(tr, tbody.firstChild);
    }
  }
}

// ---- 表格整行可点：点行内任意处（行内链接除外）新标签页打开 OpenRouter，回车/空格亦可 ----
document.querySelectorAll('tbody tr[data-url]').forEach((tr) => {
  tr.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    window.open(tr.dataset.url, '_blank', 'noopener');
  });
  tr.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('a')) {
      e.preventDefault();
      window.open(tr.dataset.url, '_blank', 'noopener');
    }
  });
});

// ---- 过期提示：打开时间距生成日期超过 15 天则显示 ----
(() => {
  const days = (Date.now() - new Date(document.getElementById('stale-date').textContent + 'T00:00:00Z').getTime()) / 864e5;
  if (days > 15) document.getElementById('stale-tip').style.display = 'block';
})();

// ---- 双榜切换：默认通用智力，解读卡常驻显示 ----
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => { b.classList.toggle('active', b === btn); b.setAttribute('aria-selected', b === btn ? 'true' : 'false'); });
    document.querySelectorAll('.board').forEach((bd) => bd.classList.toggle('hidden', bd.id !== btn.dataset.board));
  });
});

// ---- 通用 tooltip 绑定（两套卡片各用各的） ----
function bindTip(svgId, cardId, tipId, fmt) {
  const card = document.getElementById(cardId);
  const tip = document.getElementById(tipId);
  const showTip = (e, d) => {
    tip.innerHTML = fmt(d);
    tip.classList.add('show');
    positionTip(e);
  };
  const positionTip = (e) => {
    const r = card.getBoundingClientRect();
    let x = e.clientX - r.left + 14;
    let y = e.clientY - r.top + 14;
    const tipW = tip.offsetWidth, tipH = tip.offsetHeight;
    if (x + tipW > r.width) x = e.clientX - r.left - tipW - 14;
    if (y + tipH > r.height) y = e.clientY - r.top - tipH - 14;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  };
  const hideTip = () => tip.classList.remove('show');
  document.querySelectorAll('#' + svgId + ' [data-model]').forEach(el => {
    const logo = (el.dataset.logo && LOGO_MAP[el.dataset.logo]) || null;
    const d = { el, logo };
    el.addEventListener('mouseenter', e => showTip(e, d));
    el.addEventListener('mousemove', positionTip);
    el.addEventListener('mouseleave', hideTip);
  });
}

const logoImg = (d) => d.logo ? \`<img class="tip-logo" src="\${d.logo}" alt="">\` : '';
bindTip('chart-code', 'card-code', 'tip-code', (d) => {
  const m = d.el.dataset;
  return \`<div class="tip-head">\${logoImg(d)}<span><span class="tip-name">\${m.model}</span><span class="tip-effort" style="background:\${EFFORT_COLOR[m.effort]}">\${m.effort}</span>\${m.fast ? '<span class="tip-effort" style="background:#1971c2">⚡高效</span>' : ''}</span></div>
    <div class="tip-row">PASS@1: <b>\${m.pass}%</b></div>
    <div class="tip-row">Avg Cost: <b>$\${(+m.cost).toFixed(2)}</b></div>
    <div class="tip-row">Steps: <b>\${m.steps || '—'}</b> · Speed: <b>\${m.speed && m.speed !== '—' ? m.speed + ' tok/s*' : '—'}</b></div>\`;
});
bindTip('chart-gen', 'card-gen', 'tip-gen', (d) => {
  const m = d.el.dataset;
  return \`<div class="tip-head">\${logoImg(d)}<span><span class="tip-name">\${m.model}</span>\${m.fast ? '<span class="tip-effort" style="background:#1971c2">⚡高效</span>' : ''}</span></div>
    <div class="tip-row">\${m.creator} · Index: <b>\${m.index}</b> · Cost: <b>$\${(+m.cost).toFixed(2)}</b></div>
    <div class="tip-row">Speed: <b>\${m.speed} tok/s</b> · Latency: <b>\${m.latency}s</b></div>\`;
});
</script>
</body>
</html>`;

writeFileSync(OUT, html);
console.log('index.html bytes:', html.length, '→', OUT);
console.log(`deepswe frontier: ${dsFront.size}/${dsRows.length}, zone: ${dsZone.length}, worst: ${dsWorst.model}/$${dsWorst.avg_cost}`);
console.log(`aa frontier: ${aaFront.size}/${aaRows.length}, zone: ${aaZone.length}, worst: ${aaWorst.model}/$${aaWorst.cost}`);
console.log('overlap:', overlap.length ? overlap.map(([d, a]) => `${d} = ${a}`).join('; ') : '(none)');
