// fetch-tb.mjs — 从 tbench.ai（Terminal-Bench 4.0 官方榜）SSR HTML 提取 leaderboard，生成 tb-data.json
//
// 页面 https://www.tbench.ai/ 是 Next.js SSR：全量数据以 RSC flight payload 内联在
// <script>self.__next_f.push([1,"..."])</script> 里，形如 {"leaderboard":{...},"rows":[...]}。
// 没有公开 JSON API（hub.harborframework.com 探测均 404），RSC payload 是唯一可信来源。
//
// 每行是一个 (model × agent × reasoning_effort) 的官方 run（页面 RSC payload 的原始行，含全部 effort 变体）：
//   - accuracy = Terminal-Bench 4.0 解决率（%），即 斩杀线的 Y 轴；
//   - cost = 每任务成本 = total_cost_usd ÷ n_trials（斩杀线 X 轴。**页面没有平均成本列**，
//     页面 COST 列显示的是整个 run 的总成本 display_cost（如 "$3.3k"）；为了与 DeepSWE 的
//     Avg Cost per task / AA 的 Cost per Task 跨榜可比，X 轴用折算后的任务单价，
//     表格里则原样展示页面的一致性总成本。page 默认表格 = 每模型最佳变体、模型级重排名——
//     由 gen-html.mjs 做筛选，这里保留全部原始行）；
//   - speed = total_tokens / (avg_trial_duration_sec × n_trials)（整个 Run 的平均 token 流速，
//     含 agent 思考→生成全过程；任一字段缺失 → null，渲染时按 -Inf 不占便宜）。
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

const URL = 'https://www.tbench.ai/';

const res = await fetch(URL, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; model-killing-line/1.0)' } });
if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${URL}`);
const html = await res.text();

// 取出包含 leaderboard rows 的那一段 RSC payload。
// push 行形如 self.__next_f.push([1,"<escaped>"])：<escaped> 里除 RSC 哨兵引号外全部转义，
// 哨兵 `"` 的前一字符不是反斜杠；push 尾巴的 ")" 不属 JSON 数组，用 (?=\)) 只预览不消费。
// 数组元素 [1, <字符串>] 整体是合法 JSON：JSON.parse 一次还原 \"、\n、\uXXXX 等转义。
const PUSH_RE = /self\.__next_f\.push\((\[1,"[\s\S]*?[^\\]"\])(?=\))/g;
let payload = null;
for (const m of html.matchAll(PUSH_RE)) {
  let s;
  try {
    const arr = JSON.parse(m[1]);
    if (typeof arr[1] === 'string') s = arr[1];
  } catch { /* not a well-formed payload line */ }
  if (s && s.includes('"leaderboard"') && s.includes('"rows"') && s.includes('model_display')) {
    payload = s;
    break;
  }
}
if (!payload) throw new Error('no RSC payload with leaderboard rows — tbench.ai markup likely changed');

// payload 里找 {"leaderboard": 起的 JSON 对象（括号配平截取），对象形如 {"leaderboard":{...},"rows":[...]}
const start = payload.indexOf('{"leaderboard"');
if (start === -1) throw new Error('"leaderboard" key not found in payload — page structure changed');
let depth = 0, end = -1;
for (let i = start; i < payload.length; i++) {
  if (payload[i] === '{') depth++;
  else if (payload[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
if (end === -1) throw new Error('unbalanced JSON in payload — page structure changed');

const data = JSON.parse(payload.slice(start, end));
const lb = data.leaderboard;
const rows = data.rows;
if (!lb || !Array.isArray(rows) || rows.length === 0) {
  throw new Error('no leaderboard rows parsed — tbench.ai markup likely changed');
}

const stripDisp = (s) => typeof s === 'string' ? s.replace(/\*\*/g, '').replace(/Â/g, '').replace(/^\$+/, '$').trim() : '';

const outRows = rows.map((row) => {
  const md = row.metadata;
  const m = row.metrics;
  const trials = +row.n_trials || +m.n_trials || 0;
  const dur = +m.avg_trial_duration_sec || 0;
  const speed = (dur > 0 && trials > 0 && +m.total_tokens > 0)
    ? Math.round(+m.total_tokens / (dur * trials))
    : null;
  return {
    rank: row.rank,
    model: md.model_display.label,
    agent: md.agent_display.label,
    effort: md.reasoning_effort ?? null,
    accuracy: m.accuracy,
    accuracy_ci: m.accuracy_ci95_half_width ?? null,
    accuracy_disp: stripDisp(m.display_accuracy), // 页面渲染后的 "58.2% ± 2.8%"（去 ** 与 Â 乱码）
    cost: trials > 0 ? +(+m.total_cost_usd / trials).toFixed(2) : null, // 每任务成本（X 轴）
    total_cost_usd: m.total_cost_usd,
    // 页面 COST 列 = 总成本的千单位缩写（$3267 → $3.3k，$346.67 → $0.3k）；
    // 表格/斩杀线口径 = 每任务平均花费 = 总成本 ÷ n_trials（页面无此列，是我们折算的）
    cost_disp: (trials > 0) ? `$${(+m.total_cost_usd / trials).toFixed(2)}` : null, // 平均花费（表格 Cost 列）
    cost_total_disp: `$${(m.total_cost_usd / 1000).toFixed(1)}k`, // 总成本（页面格式，tooltip 引用）
    n_trials: trials,
    total_tokens: m.total_tokens,
    display_total_tokens: m.display_total_tokens ?? `${m.total_tokens}`,
    avg_trial_duration_sec: m.avg_trial_duration_sec ?? null,
    pass_at_2: m.pass_at_2 ?? null,
    pass_at_5: m.pass_at_5 ?? null,
    speed,
    date: md.display_date ?? md.date ?? null, // 页面 RELEASE DATE 列（实际是评测日期）
    model_url: md.model_display.url,
    agent_url: md.agent_display.url,
    model_org: md.model_org.label,
    agent_org: md.agent_org.label,
  };
});

writeFileSync(OUT, JSON.stringify(outRows, null, 1) + '\n');
console.log(`source: ${URL}  title: ${lb.title}  rows: ${outRows.length}  → ${OUT}`);
console.log('top5:', outRows.slice(0, 5).map((r) => `${r.model}/${r.effort}/acc=${r.accuracy}%/$${r.cost}`).join(', '));