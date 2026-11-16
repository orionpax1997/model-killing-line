// gen-html.mjs — 把 Vibe Code Bench（编码能力）+ Artificial Analysis 两套图表/表格组装成单文件 index.html
//
// 页面结构：AA 图表 + AA 表格 ｜ 编码能力（Vals AI Vibe Code Bench）图表 + 表格
//   （各自独立，AA 在上），最后只有一块联合解读：脚本只留 <div id="llm-obs"> 占位，
//   文案由 LLM 用 --obs 注入（不自动生成）。
// 两个 SVG 的 id 分别重写为 chart-code / chart-gen（避免重复 id），
//   tooltip/表格各绑各的卡片，logo 共用一份 LOGO_MAP。
//
// 编码榜身份键 = model（fetch-vc 已把同模型的多 harness run 折叠成最高分那次，
//   harness 不进任何展示面），图上圈 / 表格行 / tooltip 三态都按 model 判定。
// 终端智能榜（Vals AI Terminal-Bench 4.0）与它同源同构，同样一行一个模型、6 列表格、
//   Duration / Test 当效率维；只是 Y 叫 Score、zone 阈值 40%/$10。
//
// 两张「订阅套餐」榜（CommandCode Max 10× / OpenCode Go）是同一种形态：X = 每月可跑请求数
//   （log 轴，向右＝更能跑），Y = 智力，表格 4 列（# / Model / 智力 / 次月），🔪 徽标 = 在
//   右上 Pareto 阶梯上。两者共用 renderCallTable()（族分块 / 免费置顶 / 待更新排序 / 徽标一套
//   代码），差异只有「待更新的 Contributor 给不给 🔪」（dealBadgeAlways）和链接来源。
//
// 可选：--with-top-missing（或 MKL_INCLUDE_TOP_MISSING=1）会把 OpenRouter Top 20 里
//   "用了但还没上双榜"的模型嵌进表格：
//   - 「上一代」型（hy4-preview / deepseek-v4-flash-0423 / muse-spark-1.3-contributor / ...）：
//     黄色（🆕 待更新）行，挂在 VC/AA 上对应锚点行的正上方；
//   - 纯免费型（Laguna S 2.1 (free) 等）：青色（🆓 免费）行，放两张表的最顶部。
//   需要 top-missing.json（find-top-missing.mjs 生成）。
//
// 用法: node scripts/gen-html.mjs [--dir <dir>] [--out <index.html>] [--with-top-missing] [--obs <html文件|->]
//   默认读写系统临时目录: os.tmpdir()/model-killing-line/（可用 MKL_DIR 环境变量覆盖目录）
//   依赖 vc-data.json + vc-chart.svg（fetch-vc/render-vc）与 aa-data.json + aa-chart.svg（fetch-aa/render-aa）都已生成。
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logoFileOf, logoFileOfRow, logoUriOf } from './logos.mjs';
import { aaLink, dsLink, vcLink, tbLink, normalizeSlug } from './openrouter.mjs';

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

for (const f of ['vc-data.json', 'vc-chart.svg', 'aa-data.json', 'aa-chart.svg']) {
  if (!existsSync(path.join(DIR, f))) {
    console.error(`missing ${path.join(DIR, f)} — 先跑 fetch-vc → fetch-aa → render-vc → render-aa`);
    process.exit(1);
  }
}
// 终端智能（Vals AI Terminal-Bench 4.0）第三个榜为可选：tb-data.json + tb-chart.svg 都存在才启用
const HAS_TB = existsSync(path.join(DIR, 'tb-data.json')) && existsSync(path.join(DIR, 'tb-chart.svg'));
if (!HAS_TB) console.log('Vals TB: tb-data.json/tb-chart.svg 未找到，跳过「终端智能」榜（跑 fetch-tb → render-tb 可启用）');
// CommandCode 榜（Max 10× 每月可跑请求数 × AA Index）第四个榜为可选：plans-data.json + plans-chart.svg
const HAS_PLANS = existsSync(path.join(DIR, 'plans-data.json')) && existsSync(path.join(DIR, 'plans-chart.svg'));
if (!HAS_PLANS) console.log('Plans: plans-data.json/plans-chart.svg 未找到，跳过「CommandCode」榜（跑 fetch-plans → render-plans 可启用）');
// OpenCode Go 榜（Go $10/月 官方估算请求数 × AA Index）第五个榜为可选：go-data.json + go-chart.svg
const HAS_GO = existsSync(path.join(DIR, 'go-data.json')) && existsSync(path.join(DIR, 'go-chart.svg'));
if (!HAS_GO) console.log('Go: go-data.json/go-chart.svg 未找到，跳过「OpenCode Go」榜（跑 fetch-go → render-go 可启用）');

// 编码榜身份键 = model（一行一个模型；harness 已在 fetch-vc 折叠掉）
const vcUid = (r) => r.model;
const vcRows = JSON.parse(readFileSync(path.join(DIR, 'vc-data.json'), 'utf8')).map((r) => ({ ...r, k: vcUid(r) }));
const aaRows = JSON.parse(readFileSync(path.join(DIR, 'aa-data.json'), 'utf8'));
const plansData = HAS_PLANS ? JSON.parse(readFileSync(path.join(DIR, 'plans-data.json'), 'utf8')) : null;
const plansRows = plansData?.rows ?? [];
const goData = HAS_GO ? JSON.parse(readFileSync(path.join(DIR, 'go-data.json'), 'utf8')) : null;
const goRows = goData?.rows ?? [];

rmSync(path.join(DIR, 'logos'), { recursive: true, force: true });

// ---- 二维前沿：cost 升序，y 创新高即高性价比（决定图上连线/大圆） ----
// ---- 三维 Pareto：cost↓ y↑ speed↑（speed 缺失按 -Inf，不占便宜）----
//   2D 前沿 ⊂ 3D 前沿；差集再在内部按能力×成本取一次 2D 前沿（次级线，
//   不画线只做判断）—— 线上才算「高效」标蓝，线下（被另一个蓝色在
//   能力+成本上全包围）降级为真被斩，不标蓝
// AA 效率维 = 榜单自带的 Time per Task（分钟，越短越快）→ 帕累托第三维按「越大越好」，故取负号
const numSpeed = (r) => (r.time_per_task == null ? -Infinity : -r.time_per_task);
const pareto2 = (rows, costOf, yOf, nameOf = (r) => r.model) => {
  const names = new Set();
  let best = -Infinity;
  for (const r of [...rows].sort((a, b) => costOf(a) - costOf(b))) {
    if (yOf(r) > best) { best = yOf(r); names.add(nameOf(r)); }
  }
  return names;
};
const pareto3 = (rows, costOf, yOf, speedOf, nameOf = (r) => r.model) => {
  const names = new Set();
  for (const r of rows) {
    const dominated = rows.some((o) =>
      o !== r && costOf(o) <= costOf(r) && yOf(o) >= yOf(r) && speedOf(o) >= speedOf(r) &&
      (costOf(o) < costOf(r) || yOf(o) > yOf(r) || speedOf(o) > speedOf(r)));
    if (!dominated) names.add(nameOf(r));
  }
  return names;
};
const vcFront = pareto2(vcRows.filter((r) => r.cost != null), (r) => r.cost, (r) => r.score, (r) => r.k);
const aaFront = pareto2(aaRows, (r) => r.cost, (r) => r.index);
// 终端智能榜（Vals AI Terminal-Bench 4.0）独立成榜：能力=Score，成本=Cost/Test，
// 效率=Duration/Test。与编码榜同源同构，一行一个模型，身份键就是 model
// （旧 tbench.ai 榜是 model×agent×effort 每个 run 一行，换源后不再有 effort 变体）。
const tbUid = (r) => r.model;
const tbRows = HAS_TB ? JSON.parse(readFileSync(path.join(DIR, 'tb-data.json'), 'utf8')).map((r) => ({ ...r, k: tbUid(r) })) : [];

// 表格按 score 降序（与 Vals 页面同序）；cost 缺失的行照常列出，只是没有 X 坐标不进图。
const tbTable = [...tbRows].sort((a, b) => b.score - a.score);
// 效率维 = Duration / Test（秒，越短越高效）；pareto3 第三维按「越大越好」，故取负号
const tbNumDur = (r) => (r.duration_sec == null ? -Infinity : -r.duration_sec);
const tbPlotted = tbRows.filter((r) => r.cost != null && r.cost > 0);
const tbFront = pareto2(tbPlotted, (r) => r.cost, (r) => r.score, (r) => r.k);
// CommandCode 榜：X = 官方 Requests / month（log 轴，向右＝更能跑），Y = 智力（CC 优先 / AA 兜底）。
// 请求数一律原样引用官方 Max 10× 表；自算 token 公式只作 QA，不参与坐标 / zone / Pareto。
const plansMain = plansRows.filter((r) => !r.contributor);
// MIN_STEP 必须和 render-plans.mjs 里的 paretoOf 保持一致，否则表格的 🔪 会和图上的
// 阶梯对不上（曾经图上 5 步、表格标 6 个 🔪）。改动时两边同步。
const PLANS_MIN_STEP = 0.5;
const plansFrontNames = (() => {
  const names = new Set();
  let best = -Infinity;
  for (const r of [...plansMain].sort((a, b) => b.requests_month - a.requests_month)) {
    // 必须跳过 index == null：JS 里 `null >= -Infinity` 求值为 true（null→0），不挡的话
    // 第一个待更新模型会被当成"智力 0 的新纪录"记进阶梯，表格里给它挂 🔪。
    if (r.index == null) continue;
    if (r.index >= best + PLANS_MIN_STEP) { best = r.index; names.add(r.model); }
  }
  return names;
})();
const plansFront = new Set(plansFrontNames);
const plansZone = plansRows.filter((r) => r.index >= 35 && r.requests_month >= 100000);
const plansWorst = plansRows
  .filter((r) => !plansFront.has(r.model) && !r.contributor)
  .reduce((a, b) => (a && a.index <= b.index && a.requests_month <= b.requests_month ? a : b), null);
// OpenCode Go 榜：X = 官方估算 Requests / month（log 轴，向右＝更能跑），Y = 智力（AA 单源）。
// 与 CommandCode 榜同构（同一套 Pareto 阶梯 / 4 列表格 / 右上高性价比区），差别只在口径：
// 请求数是官方**估算**（按典型用法的 token 画像）、只做 Go 一档、Y 不混 CommandCode 的分。
// MIN_STEP 必须和 render-go.mjs 的 paretoOf 保持一致，否则表格的 🔪 会和图上的阶梯对不上。
const GO_MIN_STEP = 0.5;
const goFrontNames = (() => {
  const names = new Set();
  let best = -Infinity;
  for (const r of [...goRows.filter((x) => !x.contributor)].sort((a, b) => (b.requests_month ?? -1) - (a.requests_month ?? -1))) {
    // 必须跳过 index/requests 缺失的行（免费档 requests=null；JS 里 null 会被当成 0 参与比较）
    if (r.index == null || r.requests_month == null) continue;
    if (r.index >= best + GO_MIN_STEP) { best = r.index; names.add(r.model); }
  }
  return names;
})();
const goFront = new Set(goFrontNames);
const goZone = goRows.filter((r) => r.index != null && r.requests_month != null && r.index >= 27 && r.requests_month >= 100000);
// 编码榜效率维 = 榜单自带的真速度 tokens ÷ duration（与 render-vc.mjs 同源，不跨榜融合）
// 效率维 = Duration / Test（秒，越短越高效）；pareto3 第三维按「越大越好」，故取负号
const vcNumDur = (r) => (r.duration_sec == null ? -Infinity : -r.duration_sec);
const vcPlotted = vcRows.filter((r) => r.cost != null);
console.log('vc: cost 缺失（只进表格不进图）=', (vcRows.length - vcPlotted.length), '行:', vcRows.filter((r) => r.cost == null).map((r) => r.model).join(', ') || '(none)');
const vcFast3 = new Set([...pareto3(vcPlotted, (r) => r.cost, (r) => r.score, vcNumDur, (r) => r.k)].filter((m) => !vcFront.has(m)));
const aaFast3 = new Set([...pareto3(aaRows, (r) => r.cost, (r) => r.index, numSpeed)].filter((m) => !aaFront.has(m)));
const tbFast3 = new Set([...pareto3(tbPlotted, (r) => r.cost, (r) => r.score, tbNumDur, (r) => r.k)].filter((m) => !tbFront.has(m)));
const pareto2On = (rows, names, costOf, yOf, nameOf = (r) => r.model) => pareto2(rows.filter((r) => names.has(nameOf(r))), costOf, yOf, nameOf);
const vcFast = pareto2On(vcPlotted, vcFast3, (r) => r.cost, (r) => r.score, (r) => r.k);
const aaFast = pareto2On(aaRows, aaFast3, (r) => r.cost, (r) => r.index);
const tbFast = pareto2On(tbPlotted, tbFast3, (r) => r.cost, (r) => r.score, (r) => r.k);
const vcRest = vcPlotted.filter((r) => !vcFront.has(r.k));
const aaRest = aaRows.filter((r) => !aaFront.has(r.model));
const tbRest = tbPlotted.filter((r) => !tbFront.has(r.k));
const vcCut = vcRest.filter((r) => !vcFast.has(r.k));
const aaCut = aaRest.filter((r) => !aaFast.has(r.model));
const tbCut = tbRest.filter((r) => !tbFast.has(r.k));
const vcWorst = vcCut.reduce((a, b) => (b.cost > a.cost ? b : a), vcCut[0]);
const aaWorst = aaCut.reduce((a, b) => (b.cost > a.cost ? b : a));
const tbWorst = tbCut.reduce((a, b) => (b.cost > a.cost ? b : a), tbCut[0]);
const vcZone = vcPlotted.filter((r) => r.score >= 80 && r.cost <= 5);
const aaZone = aaRows.filter((r) => r.index > 35 && r.cost < 1);
const tbZone = tbPlotted.filter((r) => r.score >= 40 && r.cost <= 10);
const vcFrontList = [...vcPlotted].sort((a, b) => a.cost - b.cost).filter((r) => vcFront.has(r.k));
const aaFrontList = [...aaRows].sort((a, b) => a.cost - b.cost).filter((r) => aaFront.has(r.model));
const tbFrontList = [...tbPlotted].sort((a, b) => a.cost - b.cost).filter((r) => tbFront.has(r.k));

// ---- 跨榜重合：同一归一键（openrouter.mjs normalizeSlug）即同一模型，不再是约等于 ----
//   VC 前沿名 → AA 同键的前沿变体（取 index 最高者展示）
const aaFrontByKey = new Map();
for (const m of aaFront) {
  const k = normalizeSlug(m);
  if (!aaFrontByKey.has(k)) aaFrontByKey.set(k, []);
  aaFrontByKey.get(k).push(m);
}
for (const arr of aaFrontByKey.values()) arr.sort((a, b) => aaRows.find((r) => r.model === b).index - aaRows.find((r) => r.model === a).index);
const overlap = [...new Set(vcFrontList.map((r) => r.model))].map((d) => [d, (aaFrontByKey.get(normalizeSlug(d)) ?? [])[0]]).filter(([, a]) => a);

// ---- SVG 内联（重写 id，避免同页重复） ----
const prepSvg = (file, id) => readFileSync(path.join(DIR, file), 'utf8')
  .replace(/<\?xml[^?]*\?>\s*/g, '').trim()
  .replace('id="chart"', `id="${id}"`);
const vcSvg = prepSvg('vc-chart.svg', 'chart-code');
const aaSvg = prepSvg('aa-chart.svg', 'chart-gen');
const tbSvg = HAS_TB ? prepSvg('tb-chart.svg', 'chart-tb') : '';
const plansSvg = HAS_PLANS ? prepSvg('plans-chart.svg', 'chart-plans') : '';
const goSvg = HAS_GO ? prepSvg('go-chart.svg', 'chart-go') : '';

const usedFiles = [...new Set([...vcRows, ...aaRows, ...tbRows, ...plansRows, ...goRows]
  .map((r) => logoFileOfRow(r) ?? (r.aa_model ? logoFileOf(r.aa_model) : null)).filter(Boolean))];
const LOGO_MAP = Object.fromEntries(usedFiles.map((f) => [f, logoUriOf(f)]));

// ---- 模型名归一化 → OpenRouter 详情页链接（精确命中拼详情页，
//   OR 无详情页的回退搜索页；见 openrouter.mjs，构建期算好注入页面） ----
const VC_LINK = Object.fromEntries(vcRows.map((r) => [r.k, vcLink(r.model, r.org).url]));
const AA_LINK = Object.fromEntries(aaRows.map((r) => [r.model, aaLink(r.base ?? r.model, r.creator).url]));
const TB_LINK = Object.fromEntries(tbRows.map((r) => [r.model, tbLink(r.model, r.org).url]));
// OpenCode Go 榜：peak/off-peak 孪生名带后缀，拼链接前先剥掉（否则同一款模型两个点指向两个 URL）
const GO_BASE = (m) => String(m).replace(/\s*\((?:off-)?peak\)$/i, '');
const GO_LINK = Object.fromEntries(goRows.map((r) => [r.model, dsLink(GO_BASE(r.model)).url]));
const orMiss = [...new Set([...Object.values(VC_LINK), ...Object.values(AA_LINK), ...Object.values(TB_LINK), ...Object.values(GO_LINK)])]
  .filter((u) => u.includes('/models?q='));
if (orMiss.length) console.log('openrouter fallback(search):', orMiss.length, 'models');

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

// 解读文案不由脚本生成：LLM 读 data.json/aa-data.json/top-missing.json + 终端
// 打印的前沿/高效区/最惨名单，自由撰写 HTML 片段后经 --obs 注入 #llm-obs
// （--obs <文件> 或 --obs - 从 stdin 读；也可用 MKL_OBS 环境变量传文件路径）。

// 通用 unbench 行内 HTML（VC 7 列 / AA 7 列）。
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
    if (m.aa_time != null) bits.push(`${m.aa_time} min/任务`);
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
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>模型斩杀线：通用智力 × 编码能力${HAS_TB ? ' × 终端智能' : ''}${HAS_PLANS ? ' × CommandCode' : ''}${HAS_GO ? ' × OpenCode Go' : ''}</title>
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
/* CommandCode 免费档：青底，和前 3 个 tab 的 🆓 免费行同一套视觉语言 */
tr.free { background: #e7f2f7; }
tbody tr.free[data-url]:hover { background:#d5e8f1; }
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
  .model .tag-deal { background: #c98415; }
    .model .tag-warn2 { background: #8a8a8a; }
</style>
</head>
<body>
<div class="wrap">
  <h1>🔪 模型斩杀线：通用智力 × 编码能力${HAS_TB ? ' × 终端智能' : ''}${HAS_PLANS ? ' × CommandCode' : ''}${HAS_GO ? ' × OpenCode Go' : ''}</h1>
  <div class="stale" id="stale-tip">⚠️ 数据已过期（生成于 <span id="stale-date">${GEN_DATE}</span>，距今超过 15 天），模型迭代较快请获取最新报告。</div>
  <div class="sub">${[HAS_TB || HAS_PLANS ? (HAS_TB && HAS_PLANS ? '四榜' : '三榜') : '双榜'].slice(0, 0)}Pareto 前沿 · 通用智力 ${aaRows.length} 模型 / 编码能力 ${vcRows.length} 模型${HAS_TB ? ` / 终端智能 ${tbRows.length} 模型` : ''}${HAS_PLANS ? ` / CommandCode ${plansRows.length} 模型` : ''}${HAS_GO ? ` / OpenCode Go ${goRows.length} 模型` : ''}${WITH_TOP_MISSING ? ` / 叠加 OpenRouter Top 20 模型` : ''}</div>

  <div class="tabs" role="tablist">
    <button class="tab active" data-board="board-gen" role="tab" aria-selected="true">通用智力</button>
    <button class="tab" data-board="board-code" role="tab" aria-selected="false">编码能力</button>
    ${HAS_TB ? `<button class="tab" data-board="board-tb" role="tab" aria-selected="false">终端智能</button>` : ''}
    ${HAS_PLANS ? `<button class="tab" data-board="board-plans" role="tab" aria-selected="false">CommandCode</button>` : ''}
    ${HAS_GO ? `<button class="tab" data-board="board-go" role="tab" aria-selected="false">OpenCode Go</button>` : ''}
  </div>

  <div class="board" id="board-gen">
  <div class="card chart-box" id="card-gen">
    ${aaSvg}
    <div class="tooltip" id="tip-gen"></div>
  </div>

  <div class="card">
    <h2>通用智力排名</h2>
    <table>
      <thead><tr><th>#</th><th>Model</th><th>Creator</th><th class="num">Index</th><th class="num">Cost/Task</th><th class="num">Time/Task</th><th class="num">1st tok(s)</th></tr></thead>
      <tbody id="tbody-gen"></tbody>
    </table>
  </div>
  </div>

  <div class="board hidden" id="board-code">
  <div class="card chart-box" id="card-code">
    ${vcSvg}
    <div class="tooltip" id="tip-code"></div>
  </div>

  <div class="card">
    <h2>编码能力排名（Vibe Code Bench）</h2>
    <table>
      <thead><tr><th>#</th><th>Model</th><th class="num">Score</th><th class="num">Cost/Test</th><th class="num">Tokens/Test</th><th class="num">Duration</th></tr></thead>
      <tbody id="tbody-code"></tbody>
    </table>
  </div>
  </div>

  ${HAS_TB ? `
  <div class="board hidden" id="board-tb">
  <div class="card chart-box" id="card-tb">
    ${tbSvg}
    <div class="tooltip" id="tip-tb"></div>
  </div>

  <div class="card">
    <h2>终端智能排名（Vals AI Terminal-Bench 4.0）</h2>
    <table>
      <thead><tr><th>#</th><th>Model</th><th class="num">Score</th><th class="num">Cost/Test</th><th class="num">Tokens/Test</th><th class="num">Duration</th></tr></thead>
      <tbody id="tbody-tb"></tbody>
    </table>
  </div>
  </div>` : ''}

  ${HAS_PLANS ? `
  <div class="board hidden" id="board-plans">
  <div class="card chart-box" id="card-plans">
    ${plansSvg}
    <div class="tooltip" id="tip-plans"></div>
  </div>

  <div class="card">
    <h2>CommandCode 智力 × 调用次数</h2>
    <table>
      <thead><tr><th>#</th><th>Model</th><th class="num" title="CommandCode 自家 Intelligence 优先，取不到才用 AA 兜底">智力</th><th class="num" title="CommandCode 官方发布的每月可跑请求数（原样引用，未二次推算）">次/月</th></tr></thead>
      <tbody id="tbody-plans"></tbody>
    </table>
  </div>
  </div>` : ''}

  ${HAS_GO ? `
  <div class="board hidden" id="board-go">
  <div class="card chart-box" id="card-go">
    ${goSvg}
    <div class="tooltip" id="tip-go"></div>
  </div>

  <div class="card">
    <h2>OpenCode Go 智力 × 调用次数</h2>
    <table>
      <thead><tr><th>#</th><th>Model</th><th class="num" title="Artificial Analysis Intelligence Index（AA 单源；AA 没评分的模型标 🆕 待更新）">智力</th><th class="num" title="OpenCode Go 官方发布的每月估算请求数（按典型用法的 token 画像估算，原样引用）">次/月</th></tr></thead>
      <tbody id="tbody-go"></tbody>
    </table>
  </div>
  </div>` : ''}

  <div class="card">
    <h2>解读</h2>
    <div id="llm-obs">${OBS}</div>
  </div>

  <footer>数据来源 https://artificialanalysis.ai/leaderboards/models · https://www.vals.ai/benchmarks/vibe-code${HAS_TB ? ' · https://www.vals.ai/benchmarks/terminal-bench-4' : ''}${HAS_PLANS ? ' · https://commandcode.ai/docs/plans/max' : ''}${HAS_GO ? ' · https://opencode.ai/v2/docs/console/go' : ''}${WITH_TOP_MISSING ? ' · https://openrouter.ai/models?order=top-weekly' : ''}</footer>
  <div class="gen-date">报告生成日期 ${GEN_DATE} · 榜单数据来自第三方公开来源，仅供学习交流，不构成选型或采购建议</div>
</div>

<script>
const VC_ROWS = ${JSON.stringify(vcRows)};
const AA_ROWS = ${JSON.stringify(aaRows)};
const LOGO_MAP = ${JSON.stringify(LOGO_MAP)};
const VC_SURVIVORS = new Set(${JSON.stringify([...vcFront])});
const AA_SURVIVORS = new Set(${JSON.stringify([...aaFront])});
const VC_FAST = new Set(${JSON.stringify([...vcFast])});
const AA_FAST = new Set(${JSON.stringify([...aaFast])});
const VC_LINK = ${JSON.stringify(VC_LINK)};
const AA_LINK = ${JSON.stringify(AA_LINK)};
const TB_ROWS = ${JSON.stringify(tbRows)};
const TB_TABLE = ${JSON.stringify(tbTable)};
const TB_SURVIVORS = new Set(${JSON.stringify([...tbFront])});
const TB_FAST = new Set(${JSON.stringify([...tbFast])});
const TB_LINK = ${JSON.stringify(TB_LINK)};
const HAS_TB = ${JSON.stringify(HAS_TB)};
const HAS_PLANS = ${JSON.stringify(HAS_PLANS)};
const PLANS_ROWS = ${JSON.stringify(plansRows)};
const PLANS_SURVIVORS = new Set(${JSON.stringify([...plansFront])});
const PLANS_LINK = ${JSON.stringify(Object.fromEntries(plansRows.map((r) => [r.model, dsLink(r.model).url])))};
const HAS_GO = ${JSON.stringify(HAS_GO)};
const GO_ROWS = ${JSON.stringify(goRows)};
const GO_SURVIVORS = new Set(${JSON.stringify([...goFront])});
const GO_LINK = ${JSON.stringify(GO_LINK)};
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
    if (m.aa_time != null) bits.push(m.aa_time + ' min/任务');
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

// ---- 编码能力表格（Vals AI Vibe Code Bench，全部行按 score 降序；cost 缺失的行照常列出，Cost 列显示 —）----
{
  const tbody = document.getElementById('tbody-code');
  const trByModel = new Map(); // 用于 unbench 插入"上一代"锚点上方
  const trByCanon = new Map(); // 按 normalizeSlug(OR slug) 也建索引（AA-highlight succ 用 canon key 找锚点）
  [...VC_ROWS].sort((a,b)=>b.score-a.score).forEach((r,i)=>{
    const alive = VC_SURVIVORS.has(r.k);
    const fast = !alive && VC_FAST.has(r.k);
    const tr = document.createElement('tr');
    tr.className = alive ? 'alive' : (fast ? 'fast' : '');
    if (fast) tr.title = '高效：能力/成本被压制，但 Duration 更短（跑得更快），不是真被斩';
    tr.dataset.url = VC_LINK[r.k];
    tr.tabIndex = 0;
    tr.innerHTML = \`<td>\${i+1}</td>
      <td class="model">\${alive ? '🔪 ' : (fast ? '⚡ ' : '')}\${orA(r.model, VC_LINK[r.k])}\${alive ? ' <span class="tag">高性价比</span>' : (fast ? ' <span class="tag tag-fast">高效</span>' : '')}</td>
      <td class="num">\${r.score}%</td>
      <td class="num">\${r.cost == null ? '—' : '$' + r.cost.toFixed(2)}</td>
      <td class="num">\${r.tokens_disp || '—'}</td>
      <td class="num">\${r.duration_disp || '—'}</td>\`;
    tbody.appendChild(tr);
    if (!trByModel.has(r.model)) trByModel.set(r.model, tr);
    const canon = normalizeSlug(VC_LINK[r.k].replace(new RegExp('^https://openrouter\\.ai/[^/]+/'), ''));
    if (!trByCanon.has(canon)) trByCanon.set(canon, tr);
  });
  if (WITH_TM) {
    // 1) 上一代型：插入到对应锚点的正上方
    //    predecessor.key 可能是 VC display name（findPredecessor 出来的）、也可能是 AA canon key（AA-highlight 出来的）
    for (const s of TM_SUCCESSORS.filter((x) => x.predecessor.board === 'vc')) {
      const anchor = trByModel.get(s.predecessor.key) || trByCanon.get(s.predecessor.key);
      if (!anchor) {
        // AA highlight 但 VC 完全没这个 row（AA canon key 不在 trByCanon 里）。
        // 可能是两种原因：1) AA 独立信号（OR 上没有，via=aa-highlight-no-or），
        // 2) OR 上有但 vcLink 覆盖后还是找不到锚点。
        const tr = document.createElement('tr');
        tr.className = 'unbench-succ';
        tr.dataset.url = tmUrl(s);
        tr.tabIndex = 0;
        if (s.predecessor.via === 'aa-highlight-no-or') {
          tr.title = 'AA 高效模型「' + s.short_name + '」（Intelligence Index ' + s.aa_index + ' · $' + s.input_price.toFixed(2) + '/M · ' + (s.aa_time ?? '—') + ' min/任务），Vibe Code Bench 暂缺（锚点不在榜中）';
        } else {
          tr.title = 'OR 周用量 ' + fmtWeekly(s.weekly_tokens) + '（第 ' + s.rank + ' 名），AA 已 highlight 但 Vibe Code Bench 暂缺（推测锚点 ' + s.predecessor.key + ' 不在榜中）';
        }
        tr.innerHTML = tmCells(s, 6);
        tbody.appendChild(tr);
        continue;
      }
      const tr = document.createElement('tr');
      tr.className = 'unbench-succ';
      tr.dataset.url = tmUrl(s);
      tr.tabIndex = 0;
      if (s.predecessor.via === 'aa-highlight-no-or') {
        tr.title = 'AA 高效模型「' + s.short_name + '」（Intelligence Index ' + s.aa_index + ' · $' + s.input_price.toFixed(2) + '/M · ' + (s.aa_time ?? '—') + ' min/任务），Vibe Code Bench 暂缺；上一代疑似「' + s.predecessor.key + '」';
      } else {
        tr.title = 'OR 周用量 ' + fmtWeekly(s.weekly_tokens) + '（第 ' + s.rank + ' 名），尚未上 Vibe Code Bench；推测为上一代「' + s.predecessor.key + '」的后续';
      }
      tr.innerHTML = tmCells(s, 6);
      tbody.insertBefore(tr, anchor);
    }
    // 2) 纯免费型：按 OR 排名顺序（高位先）插到最顶部
    for (const f of [...TM_FREE].reverse()) {
      const tr = document.createElement('tr');
      tr.className = 'unbench-free';
      tr.dataset.url = tmUrl(f);
      tr.tabIndex = 0;
      tr.title = 'OR Top ' + f.rank + ' 免费模型（' + fmtWeekly(f.weekly_tokens) + '/周），双榜暂缺';
      tr.innerHTML = tmCells(f, 6);
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
    if (fast) tr.title = '高效：能力/成本被压制，但 Time / Task 更短（跑得更快），不是真被斩';
    tr.dataset.url = AA_LINK[r.model];
    tr.tabIndex = 0;
    tr.innerHTML = \`<td>\${i+1}</td>
      <td class="model">\${alive ? '🔪 ' : (fast ? '⚡ ' : '')}\${orA(r.model, AA_LINK[r.model])}\${alive ? ' <span class="tag">高性价比</span>' : (fast ? ' <span class="tag tag-fast">高效</span>' : '')}</td>
      <td>\${r.creator}</td>
      <td class="num">\${r.index}\${r.estimated ? '*' : ''}</td>
      <td class="num">$\${r.cost.toFixed(2)}</td>
      <td class="num">\${r.time_per_task == null ? '—' : r.time_per_task + ' min'}</td>
      <td class="num">\${r.latency == null ? '—' : r.latency + ' s'}</td>\`;
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

// ---- 终端智能表格（Vals AI Terminal-Bench 4.0，与编码榜同构：全部行按 score 降序，
//      cost 缺失的行照常列出、Cost/Test 列显示 —；⚡ 高效 = Duration/Test 更短）----
if (HAS_TB) {
  const tbody = document.getElementById('tbody-tb');
  const trByModel = new Map(); // 用于 unbench 插入"上一代"锚点上方
  const trByCanon = new Map(); // 按 normalizeSlug 也建索引（AA-highlight succ 用 canon key 找锚点）
  TB_TABLE.forEach((r, i) => {
    const alive = TB_SURVIVORS.has(r.k);
    const fast = !alive && TB_FAST.has(r.k);
    const tr = document.createElement('tr');
    tr.className = alive ? 'alive' : (fast ? 'fast' : '');
    if (fast) tr.title = '高效：能力/成本被压制，但 Duration / Test 更短（跑得更快），不是真被斩';
    tr.dataset.url = TB_LINK[r.model];
    tr.tabIndex = 0;
    tr.innerHTML = \`<td>\${i+1}</td>
      <td class="model">\${alive ? '🔪 ' : (fast ? '⚡ ' : '')}\${orA(r.model, TB_LINK[r.model])}\${alive ? ' <span class="tag">高性价比</span>' : (fast ? ' <span class="tag tag-fast">高效</span>' : '')}</td>
      <td class="num">\${r.score}%</td>
      <td class="num">\${r.cost == null ? '—' : '$' + r.cost.toFixed(2)}</td>
      <td class="num">\${r.tokens_disp || '—'}</td>
      <td class="num">\${r.duration_disp || '—'}</td>\`;
    tbody.appendChild(tr);
    if (!trByModel.has(r.model)) trByModel.set(r.model, tr);
    const canon = normalizeSlug(TB_LINK[r.model].replace(new RegExp('^https://openrouter\\.ai/[^/]+/'), ''));
    if (!trByCanon.has(canon)) trByCanon.set(canon, tr);
  });
  if (WITH_TM) {
    // TB 表 6 列（# / Model / Score / Cost/Test / Tokens/Test / Duration），与编码表同宽。
    // 1) 上一代型：插入到对应锚点的正上方
    for (const s of TM_SUCCESSORS.filter((x) => x.predecessor.board === 'tb')) {
      const anchor = trByModel.get(s.predecessor.key) || trByCanon.get(s.predecessor.key);
      if (!anchor) {
        // AA highlight 但 TB 完全没这个 row：插表底并在 title 注明。
        const tr = document.createElement('tr');
        tr.className = 'unbench-succ';
        tr.dataset.url = tmUrl(s);
        tr.tabIndex = 0;
        if (s.predecessor.via === 'aa-highlight-no-or') {
          tr.title = 'AA 高效模型「' + s.short_name + '」（Intelligence Index ' + s.aa_index + ' · $' + s.input_price.toFixed(2) + '/M · ' + (s.aa_time ?? '—') + ' min/任务），Vals Terminal-Bench 4.0 暂缺（锚点不在 TB 表中）';
        } else {
          tr.title = 'OR 周用量 ' + fmtWeekly(s.weekly_tokens) + '（第 ' + s.rank + ' 名），AA 已 highlight 但 Vals Terminal-Bench 4.0 暂缺（推测锚点 ' + s.predecessor.key + ' 不在 TB 表中）';
        }
        tr.innerHTML = tmCells(s, 6);
        tbody.appendChild(tr);
        continue;
      }
      const tr = document.createElement('tr');
      tr.className = 'unbench-succ';
      tr.dataset.url = tmUrl(s);
      tr.tabIndex = 0;
      if (s.predecessor.via === 'aa-highlight-no-or') {
        tr.title = 'AA 高效模型「' + s.short_name + '」（Intelligence Index ' + s.aa_index + ' · $' + s.input_price.toFixed(2) + '/M · ' + (s.aa_time ?? '—') + ' min/任务），Vals Terminal-Bench 4.0 暂缺；上一代疑似「' + s.predecessor.key + '」';
      } else {
        tr.title = 'OR 周用量 ' + fmtWeekly(s.weekly_tokens) + '（第 ' + s.rank + ' 名），尚未上 Vals Terminal-Bench 4.0；推测为上一代「' + s.predecessor.key + '」的后续';
      }
      tr.innerHTML = tmCells(s, 6);
      tbody.insertBefore(tr, anchor);
    }
    // 2) 纯免费型：按 OR 排名顺序（高位先）插到最顶部
    for (const f of [...TM_FREE].reverse()) {
      const tr = document.createElement('tr');
      tr.className = 'unbench-free';
      tr.dataset.url = tmUrl(f);
      tr.tabIndex = 0;
      tr.title = 'OR Top ' + f.rank + ' 免费模型（' + fmtWeekly(f.weekly_tokens) + '/周），三榜暂缺';
      tr.innerHTML = tmCells(f, 6);
      tbody.insertBefore(tr, tbody.firstChild);
    }
  }
}

// ---- 「订阅套餐」类表格：CommandCode Max 10× / OpenCode Go 共用 ----
// 两张表形态完全一致（X = 每月可跑请求数，Y = 智力，4 列：# / Model / 智力 / 次月），
// 所以排序 / 徽标 / 分块逻辑只写一遍，差异靠 cfg 传进来：
//   tbodyId / rows / survivors（render-* 算出的阶梯集合）/ link（model → OpenRouter URL）
function renderCallTable(cfg) {
  const tbody = document.getElementById(cfg.tbodyId);
  const ROWS = cfg.rows ?? [];
  if (!ROWS.length) return;
  const fmtK = (v) => v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1000 ? Math.round(v / 1000) + 'k' : String(Math.round(v));
  // ---- 排序：按族分块，块内新一代在上一代的上一行 ----
  // 直接按 index 降序排会散掉同族（比如 Kimi K2.7 Code 智力 25.8 会被 K2.6 的 27 压到下面，
  // 明明 K2.7 更新一代）。这里改成：
  //   块间：按族内最高智力降序（整族都没智力就按最高请求数），所以表格从上到下是"最强的家系"在前
  //   块内：gen 倒序（5.5 → 5 → 4.8 → 4.7 → 4.6），同代内再按智力降序
  //   待更新（index == null）：同块内排在有智力的之后，但**不拆散同族**——它们仍是官方
  //     价目表里的模型，次数是官方实数，只是还没人给分。丢掉等于让厂商新上的模型从榜单上
  //     凭空消失，而这个 tab 的主要价值恰恰是次数。
  const vnum = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true });
  // 免费档（官方写 Free / Unlimited）**置顶**，不进族分块。原因：它和付费档不可比——
  // requests_month 是 null，按次数排序会让它落到表底或者直接消失，但"这几个模型不要钱"
  // 恰恰是这张表最该先让人看到的信息。徽标沿用前 3 个 tab 的 🆓 免费约定。
  const FREE = ROWS.filter((r) => r.free);
  const FAM_ORDER = (() => {
    const fams = new Map();
    for (const r of ROWS) {
      if (r.free) continue;
      if (!fams.has(r.family)) fams.set(r.family, []);
      fams.get(r.family).push(r);
    }
    const blocks = [...fams.values()].map((arr) => ({
      arr,
      // 块间排序键：有智力取最高智力；整块都没智力就退到最高请求数，保证待更新的家系也有位置
      key: arr.some((r) => r.index != null) ? Math.max(...arr.map((r) => r.index ?? -Infinity)) : -1e9 + (arr[0].requests_month ?? 0) / 1e9,
    }));
    blocks.sort((a, b) => b.key - a.key);
    // FREE 必须包成 {arr} —— blocks 里每项都是 {arr, key}，下面统一 b.arr.sort()。
    // 直接把裸数组塞进数组字面量会在渲染第一行时抛 undefined.sort，整表 0 行且控制台无提示。
    return [{ arr: FREE, key: Infinity }, ...blocks].flatMap((b) =>
      b.arr.sort((x, y) =>
        (x.index == null ? 1 : 0) - (y.index == null ? 1 : 0) ||   // 有智力的先
        vnum(y.gen, x.gen) ||                                      // 新一代在上
        ((x.tier ?? 'off-peak') === (y.tier ?? 'off-peak') ? 0 :     // 同代：off-peak 在 peak 前
          (x.tier === 'peak' ? 1 : -1)) ||
        (x.index ?? 0) - (y.index ?? 0) ||                          // 同代：智力降序
        (y.requests_month ?? 0) - (x.requests_month ?? 0)));
  })();

  FAM_ORDER.forEach((r, i) => {
    const alive = cfg.survivors.has(r.model);
    const url = cfg.link[r.model] ?? cfg.link[r.model.replace(/\s*\((?:off-)?peak\)$/i, '')];
    const tr = document.createElement('tr');
    tr.dataset.url = url;
    tr.tabIndex = 0;
    // 「🔪 高性价比」＝ 在 Pareto 阶梯上（front），和前 3 个 tab 的 alive 完全同构
    // （🔪 作前缀符号 + tag 文字）。右上高性价比区（阈值在各 render 脚本里）不给徽标：
    // 它和阶梯高度重叠，单独标会把「落在区里但被支配」和「真在阶梯上」混为一谈，
    // 而这图恰恰要你看清这个差别。
    // 曾经还有「⚡ 高效」，是照搬前 3 个 tab 的 fast（"能力/成本被压制但更快，不是真被斩"）——
    // 但这两张表**没有 Tokens/s**，快慢无从谈起，那套判据在这里没有意义，所以去掉。
    // 早期还有「折扣层」和「映射存疑」，前者是 Contributor 的旧称。
    //
    // Contributor 是个例外，单独两个徽标：
    //   🔪 高性价比 —— 它两轴都是全场最好，只因为不计入主阶梯才拿不到 front；
    //                  不标就等于让表格里性价比最高的行看起来平平无奇。
    //   贡献数据 —— 说明这个价格是拿数据换来的，和「普通订阅就能拿到」不是一回事。
    // 🔪 前缀也跟着加：它虽然不在阶梯上，但确实是这张表里最值得买的一行。
    // ⚠️ 例外要不要给待更新的 Contributor 由 cfg.dealBadgeAlways 决定：
    //   CommandCode 表给（它两轴都是官方实测的最好值，只是 CommandCode 自己没给分）；
    //   OpenCode Go 表不给——那张表的智力来自 AA，Muse Spark Contributor 连 AA 都没评分，
    //   此时挂 🔪 就是拿未证实的性价比做推荐。
    const pending = r.index == null;
    const deal = r.contributor && (cfg.dealBadgeAlways === true || !pending);
    const good = alive || deal;
    tr.className = r.free ? 'free' : (good ? 'alive' : '');
    const bits = [];
    // 免费档没有智力分也不打 🆕——「未评分」和「不要钱」是两件事，同时挂两个徽标
    // 会让人以为等评分之后它就收费了。
    if (r.free) {
      bits.push(' <span class="tag tag-free">🆓 免费</span>');
      if (pending) bits.push(' <span class="tag tag-warn">🆕 待更新</span>');
    }
    else if (pending) bits.push(' <span class="tag tag-warn">🆕 待更新</span>');
    else if (alive) bits.push(' <span class="tag">🔪 高性价比</span>');
    if (deal) bits.push(' <span class="tag">🔪 高性价比</span><span class="tag">贡献数据</span>');
    // 待更新的 Contributor：只标"这价是拿数据换的"这个**可核对**的事实（灰徽标），
    // 不标 🔪 —— 没有智力分时"高性价比"是没被证实的结论。
    if (r.contributor && pending) bits.push(' <span class="tag tag-warn2">数据换折扣</span>');
    tr.title = r.contributor ? '数据换折扣档（用提示词/补全换折扣价）· 不计入 Pareto 阶梯' : '';
    tr.innerHTML = \`<td>\${i+1}</td>
      <td class="model">\${good ? '🔪 ' : ''}\${orA(r.model, url)}\${bits.join('')}</td>
      <td class="num">\${pending ? '—' : r.index}</td>
      <td class="num">\${r.free ? '不限量' : fmtK(r.requests_month)}</td>\`;
    tbody.appendChild(tr);
  });
}

if (HAS_PLANS) renderCallTable({ tbodyId: 'tbody-plans', rows: PLANS_ROWS, survivors: PLANS_SURVIVORS, link: PLANS_LINK, dealBadgeAlways: true });
if (HAS_GO) renderCallTable({ tbodyId: 'tbody-go', rows: GO_ROWS, survivors: GO_SURVIVORS, link: GO_LINK });

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
  return \`<div class="tip-head">\${logoImg(d)}<span><span class="tip-name">\${m.model}</span>\${m.fast ? '<span class="tip-effort" style="background:#1971c2">⚡高效</span>' : ''}</span></div>
    <div class="tip-row">Vibe Code Score: <b>\${m.score}%</b></div>
    <div class="tip-row">Cost / Test: <b>$\${(+m.cost).toFixed(2)}</b></div>
    <div class="tip-row">Tokens: <b>\${m.tokens || '—'}</b> · Duration: <b>\${m.dur || '—'}</b></div>\`;
});
bindTip('chart-gen', 'card-gen', 'tip-gen', (d) => {
  const m = d.el.dataset;
  return \`<div class="tip-head">\${logoImg(d)}<span><span class="tip-name">\${m.model}</span>\${m.fast ? '<span class="tip-effort" style="background:#1971c2">⚡高效</span>' : ''}</span></div>
    <div class="tip-row">\${m.creator} · Index: <b>\${m.index}</b> · Cost: <b>$\${(+m.cost).toFixed(2)}</b></div>
    <div class="tip-row">Time / Task: <b>\${m.time || '—'} min</b> · 首 token: <b>\${m.latency || '—'}s</b></div>\`;
});
if (HAS_TB) bindTip('chart-tb', 'card-tb', 'tip-tb', (d) => {
  const m = d.el.dataset;
  return \`<div class="tip-head">\${logoImg(d)}<span><span class="tip-name">\${m.model}</span>\${m.fast ? '<span class="tip-effort" style="background:#1971c2">⚡高效</span>' : ''}</span></div>
    <div class="tip-row">Terminal-Bench 4.0 Score: <b>\${m.score}%</b></div>
    <div class="tip-row">Cost / Test: <b>$\${(+m.cost).toFixed(2)}</b></div>
    <div class="tip-row">Tokens: <b>\${m.tokens || '—'}</b> · Duration: <b>\${m.dur || '—'}</b></div>\`;
});
if (HAS_PLANS) bindTip('chart-plans', 'card-plans', 'tip-plans', (d) => {
  const m = d.el.dataset;
  const tags = [];
  // 与表格同一套判定：front 来自 render-plans.mjs 的 paretoOf。zone（右上高性价比区）
  // 故意不给徽标，理由见表格侧注释。
  // 与表格同一套判定：Contributor 不是 front（不进主阶梯），但同样要标高性价比 + 贡献数据。
  // ⚠️ 必须显式 === '1'，不能用真值判断：SVG 的 data-* 进 dataset 全是**字符串**，
  // data-contributor="0" 读出来是 "0"，而 JS 里 "0" 是 truthy；data-front 更是只在
  // 阶梯点上出现，其余点 dataset.front 是 undefined，undefined || "0" 照样为真。
  // 那样写的结果是**每个点**都挂上 🔪 和「贡献数据」。表格侧读的是 JSON 里的真布尔，
  // 所以只有 tooltip 会错——两边的判定看起来"一样"却不同源。
  const isFront = m.front === '1';
  const isContributor = m.contributor === '1';
  if (isFront || isContributor) tags.push('<span class="tip-effort" style="background:#2f9e44">🔪 高性价比</span>');
  if (isContributor) tags.push('<span class="tip-effort" style="background:#c98415">贡献数据</span>');
  // 规格对齐 AA tab：head + 2 行硬数据，一句解释都不要。
  //   删掉的：智力来源标注（页脚已说明 CC 优先/AA 兜底）、次/$月费（= 次/月÷100，常数缩放）、
  //          单价 in/out/cache（可从次数反推）、自算对照 + 统一 token 口径（纯 QA，不参与绘图）、
  //          "AA 兜底 / AA 也有分（未采用）"（智力行已经显示了最终取值）。
  // peak 孪生点只留一行时间窗，靠模型名的「（peak）」后缀区分，不复述折算逻辑。
  return \`<div class="tip-head">\${logoImg(d)}<span><span class="tip-name">\${m.model}</span>\${tags.join('')}</span></div>
    <div class="tip-row">智力: <b>\${m.index}</b> · 官方 <b>\${(+m.req).toLocaleString()}</b> 次/月</div>
    <div class="tip-row"><b>\${(+m.reqweek).toLocaleString()}</b> 次/周 · <b>\${(+m.req5h).toLocaleString()}</b> 次/5h\${m.tier === 'peak' ? ' · peak ' + m.peakwin : ''}</div>\`;
});
if (HAS_GO) bindTip('chart-go', 'card-go', 'tip-go', (d) => {
  const m = d.el.dataset;
  const tags = [];
  // 与表格同一套判定（必顶 === '1'：SVG 的 data-* 进 dataset 全是字符串，"0" 是 truthy）
  const isFront = m.front === '1';
  const isContributor = m.contributor === '1';
  if (isFront || isContributor) tags.push('<span class="tip-effort" style="background:#2f9e44">🔪 高性价比</span>');
  if (isContributor) tags.push('<span class="tip-effort" style="background:#c98415">贡献数据</span>');
  if (m.tier === 'peak') tags.push('<span class="tip-effort" style="background:#8a8a8a">peak 时段</span>');
  // 与 CommandCode tab 同规格：head + 2 行硬数据，不写口径解释、不写单价、不写自算对照。
  // peak 孪生只靠模型名后缀 + 一行时间窗区分。
  return \`<div class="tip-head">\${logoImg(d)}<span><span class="tip-name">\${m.model}</span>\${tags.join('')}</span></div>
    <div class="tip-row">智力: <b>\${m.index}</b> · 官方估算 <b>\${(+m.req).toLocaleString()}</b> 次/月</div>
    <div class="tip-row"><b>\${(+m.reqweek).toLocaleString()}</b> 次/周 · <b>\${(+m.req5h).toLocaleString()}</b> 次/5h\${m.tier === 'peak' ? ' · peak ' + m.peakwin : ''}</div>\`;
});

</script>
</body>
</html>`;

writeFileSync(OUT, html);
console.log('index.html bytes:', html.length, '→', OUT);
console.log(`vc frontier: ${vcFront.size}/${vcPlotted.length} (plotted), zone: ${vcZone.length}, worst: ${vcWorst.model}/$${vcWorst.cost}`);
console.log(`aa frontier: ${aaFront.size}/${aaRows.length}, zone: ${aaZone.length}, worst: ${aaWorst.model}/$${aaWorst.cost}`);
console.log(`tb frontier: ${tbFront.size}/${tbPlotted.length} (plotted/${tbRows.length} rows), zone: ${tbZone.length}, worst: ${tbCut.length ? tbWorst.model + '/$' + tbWorst.cost : '(none)'}`);
console.log('overlap:', overlap.length ? overlap.map(([d, a]) => `${d} = ${a}`).join('; ') : '(none)');
if (HAS_PLANS) console.log(`plans frontier: ${plansFront.size}/${plansRows.length} (主图层, Contributor 除外), 高性价比区: ${plansZone.length}, deal layer: ${plansRows.filter((r) => r.contributor).map((r) => r.model).join(', ') || '(none)'}${plansWorst ? `, worst: ${plansWorst.model}/${plansWorst.index}` : ''}`);
if (HAS_GO) {
  const goScored = goRows.filter((r) => r.index != null && r.requests_month != null);
  console.log(`go frontier: ${goFront.size}/${goScored.length} (plotted/${goRows.length} rows), 高性价比区: ${goZone.length} (${goZone.map((r) => r.model).join(', ') || '(none)'})`);
  console.log(`go 待更新 (AA 无分, 只进表格): ${goRows.filter((r) => r.index == null).map((r) => r.model).join(', ') || '(none)'}`);
}
