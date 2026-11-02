// fetch-vc.mjs — 从 Vals AI 的 Vibe Code Bench 榜单 SSR HTML 提取 leaderboard，生成 vc-data.json
//
// 为什么换掉 DeepSWE：DeepSWE 首页从 2026-09 起就没再更新（最后一版 updated September 3, 2026），
// 而 Vals AI 的 Vibe Code Bench 是同一个"长程/端到端编码"语义但持续在跑的榜（2026-10-29 更新，
// 123 行）。两者都是「成本 × 完成度」，所以 X/Y 轴语义可以平移：Avg Cost per task → Cost / Test，
// PASS@1 → Score。
//
// 为什么抓 SSR HTML：页面没有任何公开 JSON API（Next.js SSR 直出 <table>），
// 表格在 <table aria-labelledby="benchmark-leaderboard-title"> 里，列顺序固定：
//   Rank | Model(<a href="/models/<org>_<slug>">) | Harness | Score | Cost / Test | Tokens / Test | Duration / Test
// 逐 <tr> 抓 <td>/<th> 文本即可，不依赖 class 名（tailwind 名会变）。
//
// 用法: node scripts/fetch-vc.mjs [--out <path>]
//   默认写到系统临时目录: os.tmpdir()/model-killing-line/vc-data.json（可用 MKL_DIR 环境变量覆盖目录）
import { writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR_DEFAULT = process.env.MKL_DIR ?? path.join(os.tmpdir(), 'model-killing-line');
const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : path.join(DIR_DEFAULT, 'vc-data.json');
mkdirSync(path.dirname(OUT), { recursive: true });

const URL = 'https://www.vals.ai/benchmarks/vibe-code';

const res = await fetch(URL, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; model-killing-line/1.0)' } });
if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${URL}`);
const html = await res.text();

const start = html.indexOf('<table aria-labelledby="benchmark-leaderboard-title">');
if (start === -1) throw new Error('leaderboard <table> not found — page markup likely changed, re-inspect');
const table = html.slice(start, html.indexOf('</table>', start) + '</table>'.length);

const stripTags = (s) => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#x27;/g, "'").trim();

/** '$31.25' → 31.25；'-' / '' → null */
const parseCost = (s) => {
  const m = stripTags(s).replace(/[$,]/g, '').match(/^([\d.]+)$/);
  return m ? +m[1] : null;
};

/** '116.97m' / '857.70k' / '1.16m' → 数字；'-' → null（页面单位：m=百万 token，k=千） */
const parseTokens = (s) => {
  const m = stripTags(s).match(/^([\d.]+)([km])?$/i);
  if (!m) return null;
  const mult = m[2]?.toLowerCase() === 'm' ? 1e6 : m[2]?.toLowerCase() === 'k' ? 1e3 : 1;
  return +(+(m[1]) * mult).toFixed(0);
};

/** '1h01m' / '37m28s' / '2h53m' / '8h40m' → 秒；'-' → null */
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
  // 效率维：自身 tokens ÷ 自身 duration（不跨榜融合，页面自带真速度）
  const speed = tokens != null && duration_sec > 0 ? +(tokens / duration_sec).toFixed(0) : null;
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
    speed,
    org: href ? href.split('_')[0].toLowerCase() : null,
    slug: href ? href.split('_').slice(1).join('_') : null,
    url: href ? `https://www.vals.ai/models/${href}` : null,
  });
}

if (rows.length === 0) {
  throw new Error('no leaderboard rows parsed — page markup likely changed, re-inspect the <table> block');
}

// 页面顶部的 "Updated 10/29/2026" 文案
const updated = html.match(/Updated\s+(\d{2}\/\d{2}\/\d{4})/)?.[1] ?? null;

const data = rows.sort((a, b) => b.score - a.score);
const noCost = data.filter((r) => r.cost == null).length;

writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n');
console.log(`source: ${URL}  updated: ${updated}  rows: ${data.length} (cost 缺失 ${noCost} 行，只进表格不进图)  → ${OUT}`);
console.log('top3:', data.slice(0, 3).map((r) => `${r.model}@$${r.cost}/${r.score}%`).join(', '));
