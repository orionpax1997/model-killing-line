// fetch-aa.mjs — 从 Artificial Analysis 模型榜 SSR HTML 提取 leaderboard，生成 aa-data.json
//
// 页面 https://artificialanalysis.ai/leaderboards/models 是 Next.js SSR，
// 首屏 <table><tbody> 里直接带全量 <tr>（202 行）。
//
// ⚠️ 2026-11 站点改版：表格列从 9 列变成 **7 列**（Creator / Tokens-per-second 两列没了）：
//   Model | Intelligence Index | Cost per Task USD | Time per Task (min) | First Answer Token (s)
//         | Context Window | Further Analysis
//   - Creator 列没了 → 改从模型名 cell 里的 lab logo <img alt="Anthropic"> 抓（更准，AA 自己标的）；
//   - Speed 列默认展示 **Time per Task Minutes**（跑完一个任务要几分钟，越短越快），
//     tok/s 那一列（outputSpeed）只在页面里作为可切换列存在，SSR 不渲染 → 拿不到，
//     所以效率维改用「Time per Task（分钟，越短越好）」，与 Vals 两张榜的 Duration / Test 同口径。
//   - 模型名拆成「主名 + effort 变体」：主名在 div 里，effort 变体在灰色 span 里
//     （`Claude Fable 5.2` + `Max, Default Fallback`）。输出时 model = "主名 (变体)"，
//     base / variant 另存字段；normalizeSlug 剥括号后仍是主名，OR 链接照旧能命中。
//
// 无需浏览器，直接 GET 解析即可。没有公开 JSON API（旧的 /api/v2/data/* 已于 2026-11-04 下线，
// 新的 /api/v2/language/models* 需要 API key），所以 SSR HTML 是唯一可信来源。
//
// 过滤规则：Intelligence Index > 20 且 Cost per Task 有效（> 0，log 轴画不了 0 / 免费档）。
// Index 格子里可能带 *（页面标注的预估值），解析时只取数字，另存 estimated 标记。
//
// 用法: node scripts/fetch-aa.mjs [--out <path>]
//   默认写到系统临时目录: os.tmpdir()/model-killing-line/aa-data.json（可用 MKL_DIR 环境变量覆盖目录）
import { writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR_DEFAULT = process.env.MKL_DIR ?? path.join(os.tmpdir(), 'model-killing-line');
const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : path.join(DIR_DEFAULT, 'aa-data.json');
mkdirSync(path.dirname(OUT), { recursive: true });

const URL = 'https://artificialanalysis.ai/leaderboards/models';

const res = await fetch(URL, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; model-killing-line/1.0)' } });
if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${URL}`);
const html = await res.text();

const tbody = html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'));
if (!tbody) throw new Error('no <tbody> found — page markup likely changed');

const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const trs = [...tbody.matchAll(/<tr.*?>(.*?)<\/tr>/gs)].map((m) => m[1]);
if (trs.length === 0) throw new Error('no <tr> rows parsed — page markup likely changed');

const rows = [];
for (const tr of trs) {
  const tds = [...tr.matchAll(/<td.*?>(.*?)<\/td>/gs)].map((m) => m[1]);
  // 期望 7 列：Model | Index | Cost/Task | Time/Task(min) | First Answer Token(s) | Context | Further
  if (tds.length !== 7) {
    throw new Error(`unexpected column count ${tds.length} (expected 7) — AA 表格又改版了，` +
      `先看本文件头的列约定再改解析（HTML 已存到 /tmp/aa-debug.html）`);
  }
  const first = tds[0];
  // Creator：模型名 cell 里的 lab logo <img alt="Anthropic" src="/img/logos/anthropic.svg">
  const creator = (first.match(/<img[^>]*alt="([^"]*)"/) ?? [])[1] ?? '';
  // effort 变体：灰色 span（font-normal text-neutral-500）
  const variantRaw = (first.match(/<span[^>]*class="[^"]*text-neutral-500[^"]*"[^>]*>([\s\S]*?)<\/span>/) ?? [])[1] ?? '';
  const variant = strip(variantRaw);
  // 主名：去掉变体 span 与 chevron svg 之后的纯文本
  const base = strip(first.replace(/<span[\s\S]*?<\/span>/g, ' ').replace(/<svg[\s\S]*?<\/svg>/g, ' '));
  if (!base) continue;

  const cells = tds.map(strip);
  const indexRaw = cells[1];
  const costRaw = cells[2];
  const index = parseFloat(indexRaw.replace(/[^0-9.]/g, ''));
  if (Number.isNaN(index)) continue;                 // Index '--' 的行没有分数
  if (index <= 20) continue;                          // Intelligence Index > 20
  const costTrim = costRaw.trim();
  if (!costTrim.startsWith('$')) continue;            // Cost 缺失（'--'）跳过
  const cost = parseFloat(costTrim.replace(/[$,]/g, ''));
  if (!(cost > 0)) continue;                          // $0.00 免费档画不了 log 轴

  const timeRaw = cells[3];                           // Time per Task (min)
  const timePerTask = timeRaw && timeRaw !== '--' ? parseFloat(timeRaw.replace(/[^0-9.]/g, '')) : null;
  const latencyRaw = cells[4];                       // First Answer Token (s)
  const latency = latencyRaw && latencyRaw !== '--' ? parseFloat(latencyRaw.replace(/[^0-9.]/g, '')) : null;
  const context = cells[5] || '';

  rows.push({
    model: variant ? `${base} (${variant})` : base,
    base,
    variant,
    creator,
    context,
    index,
    estimated: indexRaw.includes('*'),
    cost,
    time_per_task: Number.isNaN(timePerTask) ? null : timePerTask,
    latency: Number.isNaN(latency) ? null : latency,
  });
}

if (rows.length === 0) {
  throw new Error('no rows after filter — table markup likely changed, re-inspect <tbody> cells');
}

rows.sort((a, b) => b.index - a.index);

writeFileSync(OUT, JSON.stringify(rows, null, 1) + '\n');
console.log(`source: ${URL}  trs: ${trs.length}  kept(Index>20 & Cost有效): ${rows.length}  → ${OUT}`);
console.log('top3:', rows.slice(0, 3).map((r) => `${r.model}/${r.index}/$${r.cost}`).join(', '));
console.log('Time/Task 缺失:', rows.filter((r) => r.time_per_task == null).length, '行');
