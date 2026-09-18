// fuse.mjs — 跨榜归一化融合（纯字符串计算，无网络）
//
// 两个榜模型名写法不同（DeepSWE 小写 slug `gpt-6-astra`，AA 带 effort 后缀
// `GPT-5.6 Luna (max)`），归一键 = openrouter.mjs 的 normalizeSlug，
// 同一模型两榜归一后是同一个 key（如 `gpt-6-astra`）。
// 本模块做两件事：
//   1. DS → AA 效率融合：给每条 DS 行找 AA 同名的 Tokens/s，再结合 DS 自身 Steps
//      算复合效率 E = Tokens/s ÷ Steps（单步越快、步数越少 → E 越大越高效）。
//      同归一键的 AA 变体中优先取 effort 相同的（整词匹配，`high` 不会误命中
//      `xhigh`）；无 effort 匹配则取同名最快；AA 无同名则记缺失（-Inf，不占便宜）。
//      DS 蓝色（高效）用复合效率 E 算，steps 与 speed 在 tooltip/表格里照常展示。
//   2. 精确重合：双榜前沿按归一键求交集，是"同一模型"（不再是约等于）。
//
// 融合用的 AA 行与页面是同一份 aa-data.json（Index>20 且 Cost 有效的过滤后集合）。
//
// 用法: import { buildAaIndex, fusedSpeed, canonKey } from './fuse.mjs';
import { normalizeSlug } from './openrouter.mjs';

/** 归一键：两榜同一模型 → 同一 key */
export const canonKey = (name) => normalizeSlug(name);

/** AA speed 格（'--'/空）→ -Infinity，不占便宜 */
export const aaSpeedNum = (v) => {
  const n = parseFloat(v);
  return Number.isNaN(n) ? -Infinity : n;
};

/** key → AA 行数组 */
export const buildAaIndex = (aaRows) => {
  const m = new Map();
  for (const r of aaRows) {
    const k = canonKey(r.model);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
};

/** 括号里的 effort token（如 `(max with fallback)` → ['max','with','fallback']；无括号 → []） */
const parenTokens = (model) => {
  const mm = model.toLowerCase().match(/\((.*?)\)/);
  if (!mm) return [];
  return mm[1].split(/[^a-z0-9]+/).filter(Boolean);
};

const maxBy = (arr, f) => arr.reduce((a, b) => (f(b) > f(a) ? b : a));

/**
 * DS 行的融合速度。返回 { num（计算用，缺失=-Inf）, text（展示）, matched（命中的 AA 变体名）, kind }，
 * kind: 'effort'（同 effort 命中）/ 'fallback'（同名最快）/ 'none'（AA 无同名）。
 * 注意：速度只是原材料，DS 高效判断用下面的 fusedEff（复合效率），不要直接拿 num 当效率。
 */
/**
 * DS 行的复合效率 E = 融合 Tokens/s ÷ Steps（越大越高效，-Inf 兜底）。
 * speed 缺失（AA 无同名）或 steps 缺失/≤0 → -Inf，不占便宜。
 * 返回 { num（计算用）, speed（融合速度 num）, steps, text（展示用 `116 tok/s ÷ 123 steps`）}。
 */
export const fusedEff = (dsRow, aaIndex) => {
  const sp = fusedSpeed(dsRow, aaIndex);
  const st = +dsRow.steps;
  if (!Number.isFinite(sp.num) || !(st > 0)) return { num: -Infinity, speed: sp.num, steps: st, text: `${sp.text} ÷ ${dsRow.steps ?? '—'}` };
  return { num: sp.num / st, speed: sp.num, steps: st, text: `${sp.text} ÷ ${st}` };
};

export const fusedSpeed = (dsRow, aaIndex) => {
  const cands = aaIndex.get(canonKey(dsRow.model)) ?? [];
  if (!cands.length) return { num: -Infinity, text: '—', matched: null, kind: 'none' };
  const want = (dsRow.effort ?? '').toLowerCase();
  const effortHit = cands.filter((c) => parenTokens(c.model).includes(want));
  const pool = effortHit.length ? effortHit : cands;
  const pick = maxBy(pool, (c) => aaSpeedNum(c.speed));
  return {
    num: aaSpeedNum(pick.speed),
    text: String(pick.speed),
    matched: pick.model,
    kind: effortHit.length ? 'effort' : 'fallback',
  };
};
