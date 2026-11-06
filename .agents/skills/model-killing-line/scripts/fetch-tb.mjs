// fetch-tb.mjs — 从 Vals AI 的 Terminal-Bench 4.0 榜单 SSR HTML 提取 leaderboard，生成 tb-data.json
//
// 为什么换掉 tbench.ai：tbench.ai 官方榜是「每 run 一次的总成本」，X 轴只能拿
// total_cost_usd ÷ n_trials 折算任务单价，还混着 agent × reasoning_effort 多档变体；
// Vals AI 的 Terminal-Bench 4.0 榜（https://www.vals.ai/benchmarks/terminal-bench-4，
// 2026-11-05 更新，61 行）与同一站的 Vibe Code Bench 完全同构，直接给
// Cost / Test / Tokens / Test / Duration / Test，跟编码能力榜、AA 的 Cost per Task
// 是同一个口径，跨榜可比且不需要任何折算。
//
// 输出口径：**一行一个模型**。页面表格在
// <table aria-labelledby="benchmark-leaderboard-title"> 里，列顺序固定：
//   Rank | Model(<a href="/models/<org>_<slug>">) | Harness | Score | Cost / Test | Tokens / Test | Duration / Test
// 目前 61 行全是 Mini-SWE-agent，harness 不进任何展示面（表格/图/tooltip），
// 但保留同模型多 harness 的折叠逻辑（score 最高、同分更便宜），防止页面以后加新 run。
// 效率维用页面自带的 Duration / Test（跑完一个终端任务要多久，越短越好），不自己算 tok/s。
//
// 为什么抓 SSR HTML：页面没有公开 JSON API（Astro SSR 直出 <table>，同一份数据也以
// 序列化的 props 内联给前端图表组件），表格列稳定，逐 <tr> 抓 <td>/<th> 文本即可，
// 不依赖 class 名（tailwind 名会变）。
//
// 用法: node scripts/fetch-tb.mjs [--out <path>]
//   默认写到系统临时目录: os.tmpdir()/model-killing-line/tb-data.json（可用 MKL_DIR 环境变量覆盖目录）
import { writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR_DEFAULT = process.env.MKL_DIR ?? path.join(os.tmpdir(), 'model-killing-line');
const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : path.join(DIR_DEFAULT, 'tb-data.json');
mkdirSync(path.dirname(OUT), { recursive: true });

const URL = 'https://www.vals.ai/benchmarks/terminal-bench-4';

const res = await fetch(URL, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; model-killing-line/1.0)' } });
if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${URL}`);
const html = await res.text();

const start = html.indexOf('<table aria-labelledby="benchmark-leaderboard-title">');
if (start === -1) throw new Error('leaderboard <table> not found — page markup likely changed, re-inspect');
const table = html.slice(start, html.indexOf('</table>', start) + '</table>'.length);

const stripTags = (s) => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#x27;/g, "'").trim();

/** '$13.20' → 13.20；'-' / '' → null */
const parseCost = (s) => {
  const m = stripTags(s).replace(/[$,]/g, '').match(/^([\d.]+)$/);
  return m ? +m[1] : null;
};

/** '28.27m' / '3.01m' → 数字；'-' → null（页面单位：m=百万 token，k=千） */
const parseTokens = (s) => {
  const m = stripTags(s).match(/^([\d.]+)([km])?$/i);
  if (!m) return null;
  const mult = m[2]?.toLowerCase() === 'm' ? 1e6 : m[2]?.toLowerCase() === 'k' ? 1e3 : 1;
  return +(+(m[1]) * mult).toFixed(0);
};

/** '1h04m' / '49m21s' / '2h42m' → 秒；'-' → null */
const parseDuration = (s) => {
  const t = stripTags(s);
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m || t === '') return null;
  const [h, mi, sec] = [+(m[1] ?? 0), +(m[2] ?? 0), +(m[3] ?? 0)];
  return h * 3600 + mi * 60 + sec;
};

const rows = [];
for (const rm of table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
  const tr = rm[1];
  if (!tr.includes('<td>')) continue; // 跳过表头行（全是 <th scope="col">）
  const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => c[1]);
  if (cells.length < 7) continue;
  const href = tr.match(/href="\/models\/([^"]+)"/)?.[1] ?? null;
  const model = stripTags(cells[1]);
  const score = +(stripTags(cells[3]).replace('%', ''));
  const cost = parseCost(cells[4]);
  const tokens = parseTokens(cells[5]);
  const duration_sec = parseDuration(cells[6]);
  rows.push({
    rank: +stripTags(cells[0]),
    model,
    harness: stripTags(cells[2]),
    score,
    cost,
    tokens,
    tokens_disp: stripTags(cells[5]),
    duration_sec,
    duration_disp: stripTags(cells[6]),
    org: href ? href.split('_')[0].toLowerCase() : null,
    slug: href ? href.split('_').slice(1).join('_') : null,
    url: href ? `https://www.vals.ai/models/${href}` : null,
  });
}

if (rows.length === 0) {
  throw new Error('no leaderboard rows parsed — page markup likely changed, re-inspect the <table> block');
}

// 页面顶部的 "Updated 11/5/2026" 文案（月/日可能是一位）
const updated = html.match(/Updated\s+(\d{1,2}\/\d{1,2}\/\d{4})/)?.[1] ?? null;

// 一行一个模型：若 Vals 以后把同一模型挂到不同 harness 上重复跑，只留最好的一次
// （score 最高，同分取更便宜），harness 不进展示面。当前 61 行全是 Mini-SWE-agent，
// 这一步是空操作。
const byModel = new Map();
for (const r of rows) {
  const prev = byModel.get(r.model);
  if (!prev) {
    byModel.set(r.model, { ...r, runs: [r.harness] });
    continue;
  }
  prev.runs.push(r.harness);
  const better = r.score > prev.score || (r.score === prev.score && (r.cost ?? Infinity) < (prev.cost ?? Infinity));
  if (better) byModel.set(r.model, { ...r, runs: prev.runs });
}
const folded = [...byModel.values()].filter((r) => r.runs.length > 1);
const data = [...byModel.values()].sort((a, b) => b.score - a.score);
const noCost = data.filter((r) => r.cost == null).length;

writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n');
console.log(`source: ${URL}  updated: ${updated}  rows: ${data.length} (cost 缺失 ${noCost} 行，只进表格不进图)  → ${OUT}`);
if (folded.length) console.log('多 harness 折叠（保留最高分 run）:', folded.map((r) => `${r.model}[${r.runs.join('+')}→${r.harness}]`).join(', '));
console.log('top3:', data.slice(0, 3).map((r) => `${r.model}@$${r.cost}/${r.score}%`).join(', '));
