// fetch.mjs — 从 DeepSWE 官网首页 SSR HTML 提取 leaderboard，生成 data.json
//
// 为什么不用 JSON artifact：
//   首页实际请求的是 /artifacts/v1/leaderboard-live.json（v1 不是 v1.1），
//   但 SSR 进页面的 v1.1 表格与该 JSON 对不上（v1 JSON 是 6 月旧快照，
//   且 SSR 里 gpt-5.6-sol $6.46 等数字在任何 artifact 行里都不存在）。
//   结论：页面数字来自服务端构建时注入的更新快照，只有 SSR HTML 可信。
//   逆向链：TanStack Query queryKey ["artifact","/artifacts/v1.1/leaderboard-live.json"]
//   只是预取；首屏表格 = SSR HTML 里 role="button" 的 21 个行块。
//
// 用法: node scripts/fetch.mjs [--out <path>]
//   默认写到系统临时目录: os.tmpdir()/model-killing-line/data.json（可用 MKL_DIR 环境变量覆盖目录）
import { writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR_DEFAULT = process.env.MKL_DIR ?? path.join(os.tmpdir(), 'model-killing-line');
const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : path.join(DIR_DEFAULT, 'data.json');
mkdirSync(path.dirname(OUT), { recursive: true });

const URL = 'https://deepswe.datacurve.ai/';

const res = await fetch(URL, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; model-killing-line/1.0)' } });
if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${URL}`);
const html = await res.text();

// 每行: <div role="button" ...>...model...[effort]...PASS±CI...$cost...outTok...steps...</div>
// 行内字段顺序固定，用小而稳的正则逐个抓，不依赖 class 名（tailwind 名会变）
const rowRe = /<div role="button".*?<span class="truncate[^>]*>([^<]+)<\/span>.*?<span class="shrink-0[^>]*>\[<!-- -->([^<]+)<!-- -->\]<\/span>.*?font-medium text-foreground">(\d+)<!-- -->%.*?±<!-- -->(\d+)<!-- -->%.*?Avg cost <span[^>]*>\$([\d.]+)<\/span>.*?Out tok <span[^>]*>([\dkKm.]+)<\/span>.*?Steps <span[^>]*>(\d+)<\/span>/gs;

const rows = [];
for (const m of html.matchAll(rowRe)) {
  const [, model, effort, pass, ci, cost, outTok, steps] = m;
  rows.push({
    model: model.trim(),
    effort: effort.trim(),
    pass_rate: +pass, // 整数位，与页面显示一致
    ci_half: +ci,
    avg_cost: +cost,
    out_tok: outTok.trim(),
    steps: +steps,
  });
}

if (rows.length === 0) {
  throw new Error('no leaderboard rows parsed — page markup likely changed, re-inspect role="button" blocks');
}

// 页面 generated_at: "updated September 3, 2026" 文案
const updated = html.match(/updated\s+([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1] ?? null;

const data = rows
  .map(({ ci_half, out_tok, ...r }) => r)
  .sort((a, b) => b.pass_rate - a.pass_rate);

writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n');
console.log(`source: ${URL}  updated: ${updated}  models: ${data.length}  → ${OUT}`);
console.log('top3:', data.slice(0, 3).map((r) => `${r.model}@$${r.avg_cost}/${r.pass_rate}%`).join(', '));
