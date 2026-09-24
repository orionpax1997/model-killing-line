// find-top-missing.mjs — 从 OR Top Weekly 里挑出"用了但没 benchmark"的模型
//
// 输入：or-data.json（fetch-openrouter）、data.json（DS）、aa-data.json（AA）
// 输出：top-missing.json
//
// 三类：
//   - successors[] — 没 benchmark，但能找到一个 DS/AA 上的"上一代"作为锚点
//     （黄色放到上一行的位置）。strip 启发式剥常见后缀（contributor/flash/
//     preview/free/exp/vision/lite/...）、日期尾巴、嵌入的 .N 小版本，
//     找不到再尝试末位 -1 一代。例：muse-spark-1.3-contributor → muse-spark-1.3
//     在 AA 命中；deepseek-v4-flash-0423 → 深 v4-flash 在 DS 命中；
//     hy4-preview → 剥 preview 后再末位 -1 → hy3 在 AA 命中。
//   - free[] — 没 benchmark 且 $0/$$0 的（青色放到表格最顶部）。AA 有同名付费版
//     （如 Nemotron 3 Ultra）的归"上一代"成功，所以不会落到 free 桶。
//   - skipped[] — 没 benchmark、无上一代、又非 free 的（不渲染进表格，
//     但在日志里报告，便于人工看是不是漏写了 strip 规则）。
//
// 用法: node scripts/find-top-missing.mjs [--top N] [--out <path>]
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeSlug, dsLink, aaLink, tbLink } from './openrouter.mjs';

const DIR = process.env.MKL_DIR ?? path.join(os.tmpdir(), 'model-killing-line');
mkdirSync(DIR, { recursive: true });

const topArg = (() => {
  const i = process.argv.indexOf('--top');
  return i === -1 ? 20 : +process.argv[i + 1];
})();
const OUT = (() => {
  const i = process.argv.indexOf('--out');
  return i === -1 ? path.join(DIR, 'top-missing.json') : process.argv[i + 1];
})();

const orRows = JSON.parse(readFileSync(path.join(DIR, 'or-data.json'), 'utf8'));
const dsRows = JSON.parse(readFileSync(path.join(DIR, 'data.json'), 'utf8'));
const aaRows = JSON.parse(readFileSync(path.join(DIR, 'aa-data.json'), 'utf8'));
// TBench 3.0 独立成榜，可选：缺失时跳过 TB 维度（仅输出 DS/AA successors/free）。
const tbRows = existsSync(path.join(DIR, 'tb-data.json'))
  ? JSON.parse(readFileSync(path.join(DIR, 'tb-data.json'), 'utf8'))
  : [];

// AA 高性价比 / 高效 集合（复用 render-aa.mjs 的 2D+3D 前沿逻辑）。
// 计算结果示例：frontNames = ['GPT-5.6 Luna (max)', 'GLM-5.3-Flash', 'GPT-6 Astra (xhigh)', ...]
//              fastNames  = ['Ling 3.0 Flash', 'DeepSeek V4 Flash 0731 (max)', 'Muse Spark 1.3 (max)', ...]
// 这两集合中的模型，AA 表里都标了绿圈/蓝圈。DS 表如果缺这些（但 OR 里有），要作为 DS successor
// （board='ds'，锚点就是 AA 这个 model name）插到 DS 表里，让用户意识到"AA 已有但 DS 还没上"。
const aaByCost = [...aaRows].sort((a, b) => a.cost - b.cost);
let aaBest = -Infinity;
const aaFront = [];
for (const r of aaByCost) {
  if (r.index > aaBest) { aaBest = r.index; aaFront.push(r); }
}
const numSpeed = (r) => { const v = parseFloat(r.speed); return Number.isNaN(v) ? -Infinity : v; };
const aaFast3 = new Set(aaRows.filter((r) => !aaFront.includes(r) && !aaRows.some((o) =>
  o !== r && o.cost <= r.cost && o.index >= r.index && numSpeed(o) >= numSpeed(r) &&
  (o.cost < r.cost || o.index > r.index || numSpeed(o) > numSpeed(r))
)).map((r) => r.model));
const aaFrontNames = new Set(aaFront.map((f) => f.model));
const aaFastNames = new Set();
{
  let b2 = -Infinity;
  for (const r of aaRows.filter((r) => aaFast3.has(r.model)).sort((a, b) => a.cost - b.cost)) {
    if (r.index > b2) { b2 = r.index; aaFastNames.add(r.model); }
  }
}
// AA 已 highlight 的 model name 集合（高性价比 + 高效），归一化后查 DS 是否缺。
const aaHighlightedCanon = new Set();
for (const m of [...aaFrontNames, ...aaFastNames]) aaHighlightedCanon.add(normalizeSlug(m));

// AA highlight 中 DS 完全没出现的 entry—— 这些要在 DS 表里加一条「待更新」行，
// 表明"AA 认为这是个不错的模型，但 DS 还没度量过它"。不依赖 OR Top 是否有这个模型（OR 上
// Claude Fable 5.1 不在 Top 30，但 AA highlight 是独立信号）。
//
// 去重规则（canonical base 去变体）：同一个 model 的多个 effort 变体只留一条
// —— 同一 canon 只保留一个 AA display name（优先 sort 后 cost 更低的）。
// 例：`Muse Spark 1.3 (xhigh)` / `Muse Spark 1.3 (max)` 都在 AA 前沿进而只留一个。
const aaHighlightedMissingOnDs = [];
const dsCanonSet = new Set(dsRows.map((r) => normalizeSlug(dsLink(r.model).slug)));
const seenCanon = new Set();
for (const m of [...aaFrontNames, ...aaFastNames].sort()) {
  const canon = normalizeSlug(m);
  if (dsCanonSet.has(canon) || seenCanon.has(canon)) continue;
  seenCanon.add(canon);
  // 同一个 canon 如果带括号 effort 后缀就不要多个变体：只挑一个显示名（sort 后
  // 第一个，即 effort 名最小的，xhigh < max 所以 xhigh 优先）。
  aaHighlightedMissingOnDs.push({ model: m, canon, fast: aaFastNames.has(m), front: aaFrontNames.has(m) });
}

// 归一化键 → "上一代"模型定位。
//
// 重要：OR 每个模型有自己的 detail page（slug = path），同 slug = 同模型（不论
// OR 给它起了多少营销别名，比如 DeepSeek V4 Flash 0423 / 0731 / 0813 都是
// slug=deepseek-v4-flash / deepseek-v4-flash-0731 / deepseek-v4-flash-0813 各
// 自的独立页面）。所以这里用 OR 自己的 `slug` 作为 canonical key，不再用
// normalizeSlug(short_name)——后者会把 `0423` 误当成"上一代/下一代"版本号，造
// 成同一模型的多个别名被当几个不同模型处理。
//
// DS 已经是小写 slug，但部分 DS 名跟 OR 实际 slug 不一致（例：DS `deepseek-v4-flash`
// 实际指向 OR 的 `deepseek-v4-flash-0731`），统一进 `dsSlugAliases` 展开成 alias
// 集合后再匹配。AA 用 display name 归一化（剥 `(max)` 等 effort 后缀），同名多
// effort 时按 index 降序保留最显眼的一个当锚点（tooltip/表格里指向它）。
const dsBySlug = new Map(dsRows.map((r) => [r.model, r]));
const aaByCanon = new Map();
for (const r of aaRows) {
  const k = normalizeSlug(r.model);
  const cur = aaByCanon.get(k);
  if (!cur || r.index > cur.index) aaByCanon.set(k, r);
}
// DS 显示名 → 它实际可能的 OR slug 集合（用 dsLink 出来的 finalSlug 作为 alias）。
const dsSlugAliases = (model) => {
  const finalSlug = dsLink(model).slug;
  return new Set([model, finalSlug]);
};
const dsHas = (slug) => {
  for (const r of dsRows) if (dsSlugAliases(r.model).has(slug)) return true;
  return false;
};
// findPredecessor 中间选 cand 时也要按 alias 集判断（这样 hy4 末位 -1 后能在 AA
// 里找到 DeepSeek V4 Pro 那种 DS alias 是 deepseek-v4-pro-0813 的 row）。
const dsFind = (slug) => {
  for (const r of dsRows) if (dsSlugAliases(r.model).has(slug)) return r;
  return null;
};
const aaFind = (slug) => aaByCanon.get(slug) ?? null;
// TBench 同理：按 canon key 查表，返回首个匹配 row（可能有多个 effort/agent 变体）。
const tbByCanon = new Map();
for (const r of tbRows) {
  const k = normalizeSlug(r.model);
  if (!tbByCanon.has(k)) tbByCanon.set(k, r);
}
const tbHas = (slug) => tbByCanon.has(slug);
const tbFind = (slug) => tbByCanon.get(slug) ?? null;

// strip 启发式：从一个 OR slug 派生一组"可能的上一代"候选 slug（按优先级）。
const TRAILING_TOKENS = [
  'contributor', 'preview', 'free', 'exp', 'vision', 'lite', 'next', 'plus',
  'flash', 'fast', 'pro', 'max', 'medium', 'high', 'low', 'xhigh',
  'instruct', 'chat', 'it',
];
const anscestorCandidates = (slug) => {
  const out = new Set();
  out.add(slug);
  // 1. 剥嵌入的 .N（v4.1 → v4）
  out.add(slug.replace(/\.\d+/g, ''));
  // 2. 剥末尾的 -YYYYMMDD / -MMDD / -N（4 位数字 / 末尾纯数字）
  out.add(slug.replace(/-\d{4,}$/, ''));
  out.add(slug.replace(/-\d+$/, ''));
  out.add(slug.replace(/-\d+\.\d+$/, ''));
  // 3. 逐个剥常见后缀（递归最多 2 层）
  let cur = slug;
  for (let depth = 0; depth < 2; depth++) {
    let matched = false;
    for (const tok of TRAILING_TOKENS) {
      if (cur.endsWith('-' + tok)) {
        cur = cur.slice(0, -(tok.length + 1));
        out.add(cur);
        matched = true;
        break;
      }
    }
    if (!matched) break;
  }
  // 4. 末位 generation digit -1（hy4 → hy3；也作用于每个剥过的候选）
  for (const c of [...out]) {
    const m = c.match(/^(.*?)(\d+)$/);
    if (m) {
      const base = m[1], num = parseInt(m[2], 10);
      if (num > 0) out.add(base + (num - 1));
    }
  }
  return [...out];
};

const findPredecessor = (slug, onlyBoard) => {
  // onlyBoard 限定只在某 board 上找 predecessor（避免 DS/AA/TB 互相干扰）。
  // 不传则按 DS 优先、AA 次之、TB 末尾的原顺序。
  for (const cand of anscestorCandidates(slug)) {
    if (cand === slug) continue;
    if (onlyBoard !== 'aa' && onlyBoard !== 'tb' && dsHas(cand)) return { board: 'ds', key: cand };
    if (onlyBoard !== 'ds' && onlyBoard !== 'tb') {
      const aa = aaFind(cand);
      if (aa) return { board: 'aa', key: aa.model };
    }
    if (onlyBoard !== 'ds' && onlyBoard !== 'aa') {
      const tb = tbFind(cand);
      if (tb) return { board: 'tb', key: tb.model };
    }
  }
  return null;
};

// 双榜分开判断：
//   - OR slug 同时命中 DS + AA：两榜都已 benchmark → 跳过
//   - OR slug 只命中 DS：DS 已 benchmark，但 AA 还代上 → 作为 AA successor 挂 AA 表
//     （strip 出能命中 AA 的候选作为锚点）
//   - OR slug 只命中 AA：AA 已 benchmark，但 DS 还代上 → 作为 DS successor 挂 DS 表
//   - 双榜都没直接命中：走 strip 启发式找 predecessor，命中任意 board 就作为该 board 的 successor
//   - 还找不到：is_free → free 桶；否则 skipped
// 这样 DeepSeek V4.1 Flash（slug=deepseek-v4.1-flash，AA 有 (max) 变体，DS 没这个 slug）会作为
// DS successor（锚点 deepseek-v4-flash）出现在 DS 表里；同时不会被误标为 AA 未 benchmark。
const successors = [];
const free = [];
const skipped = [];
const seen = new Set();
// 同一 canon 模型的 OR-driven successor 只留一条（去变体）；按 board 分桶避免跨榜冲突。
const seenBoardCanons = { ds: new Set(), aa: new Set(), tb: new Set() };
const markDedup = (board, canon) => {
  if (seenBoardCanons[board].has(canon)) return false;
  seenBoardCanons[board].add(canon);
  return true;
};
for (const r of orRows.slice(0, topArg)) {
  const k = r.slug; // OR 自己的规范 slug（详情页路径），多个 short_name 别名指向同一 slug = 同一模型
  if (seen.has(k)) continue;
  seen.add(k);
  const dsDirect = dsHas(k);
  const aaDirect = !!aaFind(k);
  const tbDirect = tbHas(k);
  if (dsDirect && aaDirect && tbDirect) continue; // 三榜都已 benchmark
  let pred = null;
  if (dsDirect && aaDirect && !tbDirect) pred = findPredecessor(k, 'tb'); // TB 落后
  else if (dsDirect && !aaDirect) pred = findPredecessor(k, 'aa'); // AA 落后
  else if (aaDirect && !dsDirect) pred = findPredecessor(k, 'ds'); // DS 落后
  else if (tbDirect && !dsDirect) pred = findPredecessor(k, 'ds'); // DS 落后
  else if (tbDirect && !aaDirect) pred = findPredecessor(k, 'aa'); // AA 落后
  else pred = findPredecessor(k); // 多榜都没直接命中
  const entry = {
    rank: r.rank,
    name: r.name,
    short_name: r.short_name,
    provider: r.provider_display ?? r.provider,
    slug: r.slug,
    or_key: k,
    weekly_tokens: r.weekly_tokens,
    input_price: r.input_price,
    output_price: r.output_price,
    context_length: r.context_length,
    is_free: r.is_free,
  };
  if (pred) {
    // 同一 canon 模型的 OR-driven successor 只留第一条（去变体）。
    if (!markDedup(pred.board, normalizeSlug(r.short_name))) continue;
    successors.push({ ...entry, predecessor: pred });
  } else if (r.is_free) {
    free.push(entry);
  } else {
    skipped.push(entry);
  }
}

// AA highlight missing from DS or TB (regardless of OR presence):
// Reuse `successors` structure but with via='aa-highlight-no-or' so gen-html can
// render the AA display name directly (not the OR short_name).
// Use the AA row's own creator → OR org mapping (aaLink) to get a real detail URL.
const hlHm = []; // { board: 'ds'|'tb', entry, ... }
// 对每个 AA-highlight AA canon，产出三个 board 中缺失者：每 canon + 每 board 只留一条
// （OR-driven successor 优先，这里是补齐 OR 独立的）。
// OR-driven successor 已报过的 canon+board 这里跳过（例：`DeepSeek V4.1 Flash (max)`
// 与 OR-driven `DeepSeek V4.1 Flash` 同属 deepseek-v4.1-flash → DS 只留 OR 那条）。
const buildHlEntry = (a, board) => {
  const orMatch = orRows.find((r) => normalizeSlug(r.short_name) === a.canon);
  const aaRow = aaRows.find((r) => normalizeSlug(r.model) === a.canon && (a.fast ? r.model === a.model : true));
  const link = aaLink(a.model, aaRow?.creator);
  const providerOrg = (link.url.match(/^https:\/\/openrouter\.ai\/([^/]+)\//) || [])[1] || 'unknown';
  // 锚点：canon 经 strip 启发式找上一代（如 claude-fable-5.1 → claude-fable-5）。
  // 找不到才用 canon 本身（gen-html 会插表底并在 title 注明）。
  const anchor = findPredecessor(a.canon, board);
  return {
    rank: orMatch?.rank ?? null,
    name: a.model,
    short_name: a.model,
    provider: providerOrg,
    slug: link.slug,
    or_key: a.canon,
    weekly_tokens: orMatch?.weekly_tokens ?? 0,
    input_price: orMatch?.input_price ?? aaRow?.cost ?? null,
    output_price: orMatch?.output_price ?? aaRow?.cost ?? null,
    context_length: orMatch?.context_length ?? null,
    is_free: orMatch?.is_free ?? false,
    aa_index: aaRow?.index ?? null,
    aa_speed: aaRow?.speed ?? null,
    predecessor: { board, key: anchor ? anchor.key : a.canon, via: 'aa-highlight-no-or', kind: a.fast ? 'fast' : 'front' },
  };
};
for (const board of ['ds', 'tb']) {
  if (board === 'tb' && tbRows.length === 0) continue;
  for (const a of aaHighlightedMissingOnDs) {
    // AA highlight 中这条 AA canon 在该 board 是否缺失（已在 successor 中报过的也跳过）
    if (board === 'ds' && dsCanonSet.has(a.canon)) continue;
    if (board === 'tb' && tbHas(a.canon)) continue;
    if (seenBoardCanons[board].has(a.canon)) continue;
    seenBoardCanons[board].add(a.canon);
    hlHm.push(buildHlEntry(a, board));
  }
}
const allSuccessors = [...successors, ...hlHm];

// Extra pass: AA high-cost-effective / high-efficiency but DS missing + OR is used.
// Inserted as DS successor (yellow), anchored on the AA model name.
//
// Match rule (strict): the OR model must be the SAME underlying model as an AA
// highlight entry (just different effort/variant), NOT a different version with a
// shared base name. So for AA canon `ling-3.0-flash`, we accept `ling-3.0-flash`
// and `ling-3.0-flash-<effort>`, but NOT `ling-3.0-flash-fin` (different model).
//
// To check, normalize OR short_name, then strip trailing effort-like tokens one
// at a time and check if the resulting canonical key equals ANY AA highlight
// canon (prefix equality is NOT enough — that would over-match siblings).
//
// Example:
//   AA efficient `Claude Fable 5.1 (xhigh with fallback)` -> canon `claude-fable-5.1`
//   OR `Claude Fable 5.1 (xhigh)` short_name -> normalize -> `claude-fable-5.1`
//   (effort stripped via normalizeSlug already). Direct match.
//
// Example rejected:
//   AA `ling-3.0-flash` highlight, OR `Ling 3.0 Flash Fin (free)` -> canon
//   `ling-3.0-flash-fin` (different model). No match.
const AA_EFFORT_LIKE_TOKENS = ['max', 'xhigh', 'high', 'medium', 'low', 'instant', 'free'];
const orCanonAfterEffortStrip = (s) => {
  let cur = s;
  for (let i = 0; i < 3; i++) {
    let matched = false;
    for (const tok of AA_EFFORT_LIKE_TOKENS) {
      if (cur.endsWith('-' + tok)) { cur = cur.slice(0, -(tok.length + 1)); matched = true; break; }
    }
    if (!matched) break;
  }
  return cur;
};
const seenSucc = new Set(successors.map((s) => s.or_key));
for (const r of orRows.slice(0, topArg)) {
  const k = r.slug;
  if (seenSucc.has(k)) continue;
  // DS already has this OR model under some alias (e.g. via dsLink override).
  const dsDirect = dsHas(k);
  const tbDirect = tbHas(k);
  if (dsDirect && tbDirect) continue;
  const orCanon = normalizeSlug(r.short_name);
  // Direct hit (most common: OR short_name like `Claude Fable 5.1 (xhigh)`
  // normalizes to `claude-fable-5.1` which equals AA highlight canon).
  let aaHit = aaHighlightedCanon.has(orCanon) ? orCanon : null;
  // Effort-stripped hit: OR has `Claude Sonnet 5 (high with fallback)` style
  // where the parens contain extra words not matched by normalizeSlug's
  // single-pass `(.*?)` strip. We try a 3-iteration strip.
  if (!aaHit) {
    const orEffortStripped = orCanonAfterEffortStrip(orCanon);
    aaHit = aaHighlightedCanon.has(orEffortStripped) ? orEffortStripped : null;
  }
  const orEntry = {
    rank: r.rank,
    name: r.name,
    short_name: r.short_name,
    provider: r.provider_display ?? r.provider,
    slug: r.slug,
    or_key: k,
    weekly_tokens: r.weekly_tokens,
    input_price: r.input_price,
    output_price: r.output_price,
    context_length: r.context_length,
    is_free: r.is_free,
  };
  // DS 落后但 TB 不缺 → 只补 DS
  if (!dsDirect && aaHit) {
    if (markDedup('ds', normalizeSlug(r.short_name))) {
      successors.push({ ...orEntry, predecessor: { board: 'ds', key: aaHit, via: 'aa-highlight' } });
      console.log(`  🆕 (AA high) ${r.short_name} -> ds:missing  (precursor AA: ${aaHit})`);
    }
  }
  // TB 落后（不管 DS 是不是也有）：如果 TB 有 AA highlight canon 当锚点也补 TB。
  // 注意 dsSlugAliases 跟 TB 没什么关系，这里直接复用 aaHit。
  if (!tbDirect && aaHit) {
    if (markDedup('tb', normalizeSlug(r.short_name))) {
      successors.push({ ...orEntry, predecessor: { board: 'tb', key: aaHit, via: 'aa-highlight' } });
      console.log(`  🆕 (AA high) ${r.short_name} -> tb:missing  (precursor AA: ${aaHit})`);
    }
  }
}

writeFileSync(OUT, JSON.stringify({ successors: allSuccessors, free, skipped, top: topArg, or_count: orRows.length }, null, 1) + '\n');
console.log(`or top${topArg}: ${orRows.slice(0, topArg).length} | successors: ${successors.length} | free: ${free.length} | skipped: ${skipped.length}  → ${OUT}`);
for (const s of successors) console.log(`  🆕 ${s.short_name} → ${s.predecessor.board}:${s.predecessor.key}`);
for (const s of hlHm) console.log(`  🆕 (AA highlight, ${s.predecessor.board} 缺) ${s.short_name} → ${s.predecessor.board}:missing  (AA ${s.predecessor.kind})`);
for (const f of free) console.log(`  🆓 ${f.short_name} (${(f.weekly_tokens / 1e12).toFixed(2)}T/wk)`);
for (const s of skipped) console.log(`  ⚠️  skipped (no pred, not free): ${s.short_name}`);
