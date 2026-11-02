// openrouter.mjs — 模型名归一化 + OpenRouter 详情页链接
//
// 背景：AA 榜模型名带 effort 后缀（`GPT-5.6 Luna (max)`、`Claude Opus 5 (high)`…），
//   Vals AI 榜是「品牌全名 + org 前缀」（`Claude Sonnet 5.5` / `anthropic_claude-sonnet-5-5`），
//   CommandCode 榜是 `MiMo V2.6 Flash` 这种空格名，都不能直接拼 URL。
//   OpenRouter 详情页形如 https://openrouter.ai/<org>/<slug>（如 meta/muse-spark-1.3），
//   本模块做两件事：归一化（去括号后缀 → 小写 hyphen slug）+ 按 creator/前缀/页面路径定 org。
//
// 链接策略：
//   - 能精确命中的拼详情页（已用 curl 逐个验证 title 非软 404，见下 OVERrides/SEARCH_ONLY 注释）；
//   - 命中不了的（如 `Quasar 438B`、`Qwen3.8-Flash-Next` 在 OR 无详情页）回退到
//     https://openrouter.ai/models?q=<name> 搜索页，保证每个模型名都可点。
//
// 用法: import { normalizeSlug, aaLink, dsLink } from './openrouter.mjs';
const normKey = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** 去括号 effort 后缀 → 小写 hyphen slug（保留版本号里的点） */
export const normalizeSlug = (name) => {
  let s = name.toLowerCase().replace(/\(.*?\)/g, ' ');
  s = s.replace(/\binstant\b/g, ' '); // `GPT-5.5 Instant (June 2026)` → `gpt-5.5`
  return s.replace(/[^a-z0-9.]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
};

// AA creator（fetch-aa 抓到的 Creator 列）→ OpenRouter org
const CREATOR_TO_ORG = new Map(Object.entries({
  'openai': 'openai',
  'google': 'google',
  'anthropic': 'anthropic',
  'deepseek': 'deepseek',
  'z ai': 'z-ai',
  'kimi': 'moonshotai',
  'moonshotai': 'moonshotai',
  'spacexai': 'x-ai',
  'x-ai': 'x-ai',
  'alibaba': 'qwen',
  'meta': 'meta',
  'nvidia': 'nvidia',
  'thinking machines': 'thinkingmachines',
  'tencent': 'tencent',
  'xiaomi': 'xiaomi',
  'minimax': 'minimax',
  'inclusionai': 'inclusionai',
}));

// DeepSWE 榜无 creator 列，按模型前缀推 org（与 logos.mjs 的前缀映射同构）
// （fetch.mjs 已被 fetch-vc.mjs 取代，dsLink 只剩 CommandCode 榜的 PLANS_LINK 在用）
const PREFIX_TO_ORG = [
  ['gpt-', 'openai'],
  ['gemini', 'google'],
  ['claude', 'anthropic'],
  ['glm-', 'z-ai'],
  ['kimi', 'moonshotai'],
  ['grok', 'x-ai'],
  ['qwen', 'qwen'],
  ['muse', 'meta'],
  ['deepseek', 'deepseek'],
  ['mimo-', 'xiaomi'],
  ['minimax', 'minimax'],
  ['hy3', 'tencent'],
  ['inkling', 'thinkingmachines'],
  ['nemotron', 'nvidia'],
];

// 归一化后仍与 OR 实际 slug 有出入的个例（curl 验证过右侧 200 且 title 正常）
const SLUG_OVERRIDE = {
  'deepseek-v4-flash-vision': 'deepseek-v4-flash-vision-exp',
  // OR 上只有版本化 slug（API 返回 canonical_slug `nvidia/nemotron-3-ultra-550b-a55b-20260604`），短 slug 是软 404
  'nemotron-3-ultra': 'nemotron-3-ultra-550b-a55b',
  // DS 简写名 → OR 实际带日期 slug 的手动映射（DS 的 `deepseek-v4-flash` 对应 OR 上
  // 原版创建于 0731 的 entry；`deepseek-v4-pro` 对应 0813 的 entry。这种 DS→OR 加日期的
  // 方向无法用 strip 启发式归一化，只能 dict）。AA 的 normalizeSlug 输出是
  // `deepseek-v4-flash-0731`/`deepseek-v4-pro-0813`（本身带日期），不会命中下面两条 key。
  'deepseek-v4-flash': 'deepseek-v4-flash-0731',
  'deepseek-v4-pro': 'deepseek-v4-pro-0813',
  // Vals AI（Vibe Code Bench）的 slug 与 OR 实际 id 的出入（已用 https://openrouter.ai/api/v1/models
  // 的 452 个 id 逐个核对；核对不上的模型统一走搜索页，不猜详情页）
  'mistral-large-4': 'mistral-large-4-0',
  'mistral-medium-3.5': 'mistral-medium-3-5',
  'qwen3.8-max': 'qwen3.8-max-0902',
  'qwen3.8-max-0902': 'qwen3.8-max-0902',
  'beam-1.0': 'beam-1.0-501b-a23b',
  // 带评测日期的老版本（OR 只保留 -preview 后缀的 entry）
  'gemini-3-flash': 'gemini-3-flash-preview',
  // vals 的 `Muse Spark 1.3 Max` 在 OR 上只有基础版详情页（max 是同一页的 effort 变体）
  'muse-spark-1.3-max': 'muse-spark-1.3',
};
// OR 无详情页（打开是软 404，title 只有 `OpenRouter`），只能走搜索页
const SEARCH_ONLY = new Set(['qwen3.8-flash-next', 'quasar-438b']);

const searchUrl = (name) => `https://openrouter.ai/models?q=${encodeURIComponent(name)}`;

const build = (displayName, slug, org) => {
  const finalSlug = SLUG_OVERRIDE[slug] ?? slug;
  if (!org || SEARCH_ONLY.has(finalSlug)) {
    return { slug: finalSlug, url: searchUrl(displayName), exact: false };
  }
  return { slug: finalSlug, url: `https://openrouter.ai/${org}/${finalSlug}`, exact: true };
};

/** AA 行：aaLink(model, creator)，如 ('Muse Spark 1.3 (max)', 'Meta') → meta/muse-spark-1.3 */
export const aaLink = (model, creator) =>
  build(model, normalizeSlug(model), CREATOR_TO_ORG.get(normKey(creator ?? '')) ?? null);

/** TBench 行：tbLink(model, model_org)。TB 的 model 名不带前缀（如 'Fable 5.1'、'Opus 5'），
 *  model_org 来自 fetch-tb 的 model_org 字段（'Anthropic'/'OpenAI'/'xAI'/'Google'/'Z.ai'…），
 *  与 AA 的 Creator 列同义，直接复用 aaLink 的归一化/映射即可。 */
export const tbLink = (model, model_org) => aaLink(model, model_org);

// Vals AI 详情页路径里的 org 前缀 → OpenRouter org。核对不上的（devin/ant 等 OR 侧
// 没有同名 org 的）故意不写 → build() 拿到 null org，自动回退搜索页。
const VALS_ORG_TO_OR = new Map(Object.entries({
  anthropic: 'anthropic',
  google: 'google',
  openai: 'openai',
  deepseek: 'deepseek',
  meta: 'meta',
  xiaomi: 'xiaomi',
  kimi: 'moonshotai',
  zai: 'z-ai',
  alibaba: 'qwen',
  ant: 'inclusionai',
  minimax: 'minimax',
  stepfun: 'stepfun',
  nvidia: 'nvidia',
  thinkingmachines: 'thinkingmachines',
  inception: 'inception',
  fireworks: 'fireworks',
  reflection: 'reflection',
  mistralai: 'mistralai',
  grok: 'x-ai',
  cursor: 'cursor',
  poolside: 'poolside',
  baseten: 'baseten',
  tencent: 'tencent',
}));

/** Vals AI（Vibe Code Bench）行：vcLink(model, org)，org 取自详情页路径 `/models/<org>_<slug>`，
 *  如 ('Claude Sonnet 5.5', 'anthropic') → anthropic/claude-sonnet-5.5。
 *  没有 org（老版本数据）时回退按模型名前缀推（与 dsLink 同构）。 */
export const vcLink = (model, org) => {
  const o = VALS_ORG_TO_OR.get(String(org ?? '').toLowerCase()) ?? null;
  // OR 上 Qwen 的 id 是 `qwen3.8-27b`（品牌与版本连写），Vals/AA 写 `Qwen 3.8 27B`
  const slug = normalizeSlug(model).replace(/^qwen-/, 'qwen');
  return build(model, slug, o);
};

/** DeepSWE 行：dsLink(model)，如 'gemini-3.8-flash' → google/gemini-3.8-flash */
export const dsLink = (model) => {
  const s = model.toLowerCase();
  const org = (PREFIX_TO_ORG.find(([p]) => s.startsWith(p)) ?? [])[1] ?? null;
  return build(model, normalizeSlug(model), org);
};
