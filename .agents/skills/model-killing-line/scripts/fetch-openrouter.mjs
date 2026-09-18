// fetch-openrouter.mjs — 从 OpenRouter Top Weekly 抓取本周热门文本模型
//
// 为什么不解析 SSR HTML：OpenRouter 的 /models 页面是 Next.js 客户端渲染，
//   SSR HTML 里没有模型表格，只有"load more"骨架和一堆 favicon。
//   真正的数据走 /api/frontend/v1/models/find?order=top-weekly，response
//   已经是按"近 7 天处理 token 数"服务端排序好了，top 30 一把抓下来。
//   analytics 块按 model_permaslug 给出每天的 prompt/completion tokens，
//   累加即得到页面显示的"周 tokens"（页面数字 ≈ analytics 总和，差一天的
//   忽略不计——OpenRouter 自己也只展示这个数字）。
//
// 用法: node scripts/fetch-openrouter.mjs [--top N] [--out <path>]
//   默认 top 30，写到 os.tmpdir()/model-killing-line/or-data.json（MKL_DIR 可覆盖）
import { writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = process.env.MKL_DIR ?? path.join(os.tmpdir(), 'model-killing-line');
mkdirSync(DIR, { recursive: true });

const topArg = (() => {
  const i = process.argv.indexOf('--top');
  return i === -1 ? 30 : +process.argv[i + 1];
})();
const OUT = (() => {
  const i = process.argv.indexOf('--out');
  return i === -1 ? path.join(DIR, 'or-data.json') : process.argv[i + 1];
})();

const URL = 'https://openrouter.ai/api/frontend/v1/models/find?order=top-weekly&input_modalities=text';

const res = await fetch(URL, {
  headers: {
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'accept': 'application/json',
    'origin': 'https://openrouter.ai',
    'referer': 'https://openrouter.ai/models?input_modalities=text&order=top-weekly',
  },
});
if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${URL}`);
const body = await res.json();
const models = body?.data?.models ?? [];
const analytics = body?.data?.analytics ?? {};
if (models.length === 0) throw new Error('no models in /find response — payload shape changed');

// 累加 analytics → 周 token 总数（页面也是这么算的）
const weeklyByPermaslug = new Map();
for (const a of Object.values(analytics)) {
  const key = a.model_permaslug;
  weeklyByPermaslug.set(key, (weeklyByPermaslug.get(key) ?? 0) + (a.total_prompt_tokens ?? 0) + (a.total_completion_tokens ?? 0));
}

const out = [];
for (let i = 0; i < Math.min(topArg, models.length); i++) {
  const m = models[i];
  if (!(m.input_modalities ?? []).includes('text')) continue;
  const pricing = m.endpoint?.pricing ?? {};
  const promptPerToken = parseFloat(pricing.prompt ?? '0');
  const completionPerToken = parseFloat(pricing.completion ?? '0');
  const permaslug = m.permaslug ?? m.slug;
  out.push({
    rank: i + 1,
    name: m.name,
    short_name: m.short_name,
    provider: m.author,
    provider_display: m.author_display_name,
    slug: m.slug.split('/')[1], // 去掉 org 前缀，留模型 slug 给归一化用
    permaslug,
    input_price: promptPerToken * 1e6,    // USD per 1M tokens
    output_price: completionPerToken * 1e6,
    context_length: m.context_length ?? 0,
    is_free: m.endpoint?.is_free ?? (promptPerToken === 0 && completionPerToken === 0),
    weekly_tokens: weeklyByPermaslug.get(permaslug) ?? 0,
    created_at: m.created_at ?? null,
  });
  if (out.length >= topArg) break;
}

writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`source: ${URL}  parsed: ${models.length}  kept(text): ${out.length}  → ${OUT}`);
console.log('top3:', out.slice(0, 3).map((r) => `#${r.rank} ${r.short_name} ($${r.input_price}/$${r.output_price}, ctx=${r.context_length}, is_free=${r.is_free})`).join(' | '));
