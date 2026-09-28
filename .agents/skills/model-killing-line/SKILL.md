---
name: model-killing-line
description: "Draws the 模型斩杀线 - Pareto-frontier scatters (DeepSWE PASS@1 vs Avg Cost + Artificial Analysis Intelligence Index vs Cost per Task + Terminal-Bench 4.0 Accuracy vs Cost per Task + CommandCode Max 10× 智力 vs 每月可跑请求数) as a single-page HTML with hover tooltips, efficient-zone shades, separate charts/tables per source, and one joint 解读. Use when the user asks for a 斩杀线, DeepSWE chart, AA chart, TBench/Terminal-Bench chart, CommandCode chart, or Pareto frontier of coding models. Takes no arguments - data always comes from https://deepswe.datacurve.ai/, https://artificialanalysis.ai/leaderboards/models, https://www.tbench.ai and https://commandcode.ai/docs/plans/max."
---

# model-killing-line

Zero-argument skill. Fetches the DeepSWE leaderboard, the Artificial
Analysis model leaderboard, (可选) the TBench / Terminal-Bench 4.0
leaderboard, and (可选) the CommandCode Max 10× plan, computes each Pareto
frontier, and emits a
single-page `index.html` with switchable sections (tab 切换，默认通用智力，
解读常驻) — chart + table per board 由脚本生成，解读由 LLM 每次实时撰写（脚本不写解读文案）,

- ① 通用智力斩杀线（数据源 Artificial Analysis）: X = Cost per Task USD (log axis),
  Y = Intelligence Index, efficient zone = Index > 35 & cost < $1
  (表格只收 Index > 20 且 Cost 有效的行).
- ② 长程编码能力斩杀线（数据源 DeepSWE）: X = Avg Cost per task (log axis), Y = PASS@1,
  efficient zone = PASS@1 ≥ 50% & cost ≤ $2.5.
- ③ 终端智能斩杀线（数据源 TBench, Terminal-Bench 4.0 官方榜, 可选）: X = Cost per Task USD
  (log axis, total_cost_usd ÷ n_trials —— 页面 COST 列是整次 run 总成本，没有平均成本列；
  为使 X 轴与 DeepSWE 的 Avg Cost per task / AA 的 Cost per Task 跨榜可比，用折算的任务单价，
  表格里则按页面口径原样展示总成本), Y = Accuracy %, efficient zone = Accuracy ≥ 40 &
  cost ≤ $10。每行 = (模型 × agent × reasoning_effort) 的官方 run，27 行；带 tb-data.json +
  tb-chart.svg 时 gen-html 自动启用第三个 tab；缺这两个文件则保持双榜页面不报错。
  表格按用户要求展示**全部 effort 变体（27 行）**：按 accuracy 降序 + competition 排名（同分同号
  跳号，如 57.88% 四行并列 2/2/2/2 后跳到 6；tbench.ai 页面默认每模型只留最佳变体，
  即模型级 rank 1..15 含 13/13/15）、COST 统一为每任务平均花费（总成本 ÷ n_trials，与斩杀线
  X 轴同口径；总成本按页面的 k 缩写格式仍在 tooltip 里，$3267→$3.3k）、Accuracy 带 ±CI、
  含 Released（实为评测日期）列。**斩杀线前沿与表格同用全变体口径**：同模型同榜的多个
  effort 档全部参与 Pareto（如 GPT-6 Astra 的 low→max 整条性价比线占住前沿），
  表格的 alive/⚡ 标记与之三态一致（故 GLM-5.3 这类模型级 rank 5 也可能因被
  Astra low/high 更便宜更强地压制而不在斩杀线上）。
  效率维用 Run 平均 token 流速 total_tokens ÷ (avg_trial_duration_sec × n_trials)。
- ④ CommandCode 斩杀线（数据源 CommandCode 官方文档，可选）: X = Max 10× 官方
  `Requests / month`（log 轴，向右＝更能跑），Y = 智力指数。右上方高性价比区 =
  智力 ≥ 35 且 ≥ 100K 次/月。**只做 Max 10×**——OpenCode / Pro plan 的请求数、
  Max 20× 的额度都不能混进来（口径不同，混了图就没意义）。详见下面
  「CommandCode tab 的口径与过滤规则」一节，那一节是本 tab 的行为契约，改动前先读。
- 解读只有一块: 由 LLM 每次实时根据最新数据自由撰写，脚本不生成解读文案，只提供数据。

Frontier models render as logo circles with callout labels, everyone else
as small dots, efficient zone shaded top-left. Every dot shows a hover
tooltip with its model name.

All artifacts go to the OS temp dir (`os.tmpdir()/model-killing-line/`,
overridable via `MKL_DIR` env var) — never the repo. The final `index.html`
is auto-opened in the system default browser via `open.mjs`.

## The core loop (run from anywhere; outputs go to the OS temp dir)

```bash
node .pi/skills/model-killing-line/scripts/fetch.mjs              # → $TMPDIR/model-killing-line/data.json (~21 rows, DeepSWE)
node .pi/skills/model-killing-line/scripts/fetch-aa.mjs           # → $TMPDIR/model-killing-line/aa-data.json (~79 rows, AA)
node .pi/skills/model-killing-line/scripts/fetch-tb.mjs            # → $TMPDIR/model-killing-line/tb-data.json (27 rows, Terminal-Bench 4.0) — 可选
node .pi/skills/model-killing-line/scripts/fetch-openrouter.mjs   # → $TMPDIR/model-killing-line/or-data.json (Top 30 from OpenRouter Top Weekly, text modality) — 可选
node .pi/skills/model-killing-line/scripts/fetch-plans.mjs         # → $TMPDIR/model-killing-line/plans-data.json (CommandCode Max 10×) — 可选
node .pi/skills/model-killing-line/scripts/find-top-missing.mjs   # → $TMPDIR/model-killing-line/top-missing.json (OR Top 20 里没上双榜的模型) — 可选
node .pi/skills/model-killing-line/scripts/render.mjs             # → $TMPDIR/model-killing-line/chart.svg (logos inlined as data URIs)
node .pi/skills/model-killing-line/scripts/render-aa.mjs          # → $TMPDIR/model-killing-line/aa-chart.svg
node .pi/skills/model-killing-line/scripts/render-tb.mjs          # → $TMPDIR/model-killing-line/tb-chart.svg — 可选（和 fetch-tb 成对）
node .pi/skills/model-killing-line/scripts/render-plans.mjs       # → $TMPDIR/model-killing-line/plans-chart.svg — 可选（和 fetch-plans 成对）
node .pi/skills/model-killing-line/scripts/gen-html.mjs [--with-top-missing]  # → $TMPDIR/model-killing-line/index.html (单文件 HTML；存在 tb-data.json + tb-chart.svg 时自动加「终端智能」tab，存在 plans-data.json + plans-chart.svg 时再自动加「CommandCode」tab；带 --with-top-missing 才注入 OR Top 缺失行；解读区只留 #llm-obs 空位)
# LLM 看完本轮数据后自由撰写解读 HTML 片段，存文件后注入：
node .pi/skills/model-killing-line/scripts/gen-html.mjs [--with-top-missing] --obs /tmp/mkl-obs.html  # --obs <html文件|->（- 从 stdin 读；MKL_OBS 传路径亦可）
node .pi/skills/model-killing-line/scripts/open.mjs               # auto-open index.html in default browser
```

`$TMPDIR/model-killing-line` = `os.tmpdir()/model-killing-line` (i.e.
`/tmp/model-killing-line` on Linux/macOS). Set `MKL_DIR` env var to override.
`open.mjs` uses `open` (macOS) / `cmd start` (Windows) / `xdg-open` (Linux)
and falls back to printing the `file://` path when no GUI browser exists.
Optionally verify headlessly before calling it done:

```bash
agent-browser open file://"$(node -e "console.log(require('os').tmpdir())")"/model-killing-line/index.html
```

No parameters on any step. Thresholds live in the scripts, not in arguments —
see below. The scripts read/write via cwd and need only node stdlib.

## What each script does

- `fetch.mjs`: GETs the DeepSWE homepage SSR HTML and parses the 21
  `role="button"` leaderboard rows (model, effort, PASS@1, avg cost, steps).
  Throws when zero rows parse — that means the page markup changed and the
  row regex needs re-inspection. Why SSR HTML and not the JSON artifact is
  documented in the script header.
- `render.mjs`: sorts by cost, takes record-high pass rates as the Pareto
  frontier, draws the SVG (log x-axis, dashed connector, top-left efficient
  rectangle, lab-logo circles + callouts, per-dot `data-*` attributes). Logs
  the frontier points on every run. Lab logos come from skill-bundled
  `logos/` via `scripts/logos.mjs` and are inlined as base64 data URIs —
  `chart.svg` is a single file, no sidecar folder. Every model with a mapped
  logo renders as a logo badge only (frontier: R18 + thick green ring;
  non-frontier: R8 + thin green ring) — no separate fill dots. Models without a
  mapped logo fall back to fill dots / letter logos (`logoOf`).
  Fast tradeoff points（3D 差集 + 次级线，见下）描蓝色圈 (`#1971c2`，
  图例 `efficient model`)，tooltip 带蓝色 ⚡徽标。效率维是复合效率
  E = AA 融合 Tokens/s ÷ DS 自身 Steps（`fuse.mjs` 的 `fusedEff`，`data-speed`/
  `data-speed-from` 照常展示融合速度与命中变体）。
- `fetch-aa.mjs`: GETs the Artificial Analysis leaderboard SSR HTML and
  parses the `<tbody>` rows (model, context, creator, index, cost, speed,
  latency, total). Keeps only Intelligence Index > 20 with non-empty cost.
  No JSON API exists for the Cost column — SSR HTML is the only source.
- `render-aa.mjs`: same structure as `render.mjs` but for AA data
  (log x 基础域 0.01~10、y 基础域 20~55——**数据超界时自适应扩展**：三图的 (min,max)
  改为 `基础域 ∩ (数据 min/max 扩到 5 的整数倍)`，避免新模型（如 Claude Opus 5.5
  IntelligenceIndex=58 > 55）被画到边框外，y 刻度随之生成到新上限；
  zone Index > 35 & < $1, `data-creator` / `data-index` 属性,
  same-base-name single label + collision-aware callouts, efficient 高效点描蓝圈同上）。
- `fetch-tb.mjs`: GETs https://www.tbench.ai/ (Terminal-Bench 4.0 官方榜) 首页 SSR
  HTML，解析内联的 Next.js RSC flight payload（`{"leaderboard":{...},"rows":[...]}`，
  无公开 JSON API；RSC 以哨兵引号结束且尾括号不属于 JSON，解析正则见文件头）。
  每行 = `{rank, model, agent, effort, accuracy, accuracy_ci, accuracy_disp(页面 "58.2% ± 2.8%"),
  cost(每任务 = total_cost_usd÷n_trials), total_cost_usd, cost_disp(每任务平均花费, 表格 Cost 列),
  cost_total_disp(总成本, 页面 k 缩写 "$3.3k", tooltip 用), display_total_tokens, date(页面 Released),
  avg_trial_duration_sec, pass_at_2/5, speed(run 平均 tok/s, 缺失 null),
  model_url/agent_url, model_org/agent_org}`。
  Throws when zero rows parse（页面改版时重新检查 RSC payload 结构）。
- `render-tb.mjs`: same structure as `render.mjs`/`render-aa.mjs` but for TBench data
  (log x 0.5~50, y 0~70, zone Accuracy ≥ 40 & cost ≤ $10, `data-agent`/`data-effort`/
  `data-acc`/`data-tokens`/`data-p2`/`data-p5` attributes + run 平均 tok/s 效率维)。
  效率维用自身 speed（不跨榜融合），3D 差集 + 次级 2D 前沿 → 高效蓝圈同 AA。
  前沿判定用全变体口径（所有 effort 档参与）。callout 用 AA 同款策略：同模型组
  （多个 effort 档）在前沿上**只标一个气泡**，锚定 accuracy 最高的档（如 GPT-6 Astra (max)），
  其余档只画圆点不弹气泡——避免 4 个 Astra 气泡挤在 y≈50-58 区互相避让后压住旁边点；
  前后端统一用 uid = model+effort+agent 判定（图上/表格/tooltip 三态一致）。
  logo 按 model_org 选（TB 模型名无品牌前缀，见 logos.mjs 的 ORG_LOGO_FILE）。
- `fetch-plans.mjs`: GETs `https://commandcode.ai/docs/plans/max`（官方
  `Requests / 5 hours / week / month` 请求表 + 价格表）和
  `https://commandcode.ai/docs/plans/pro`（CommandCode 自家的 `Intelligence` 列，
  以及**只存在于 Pro 页**的 peak 时段价）。输出的 `requests_*` 全部直接引用官方值，
  **不做二次推算**（自算 token 口径值只留作 `est_requests_month` / `est_vs_official`
  做 QA 校验，不参与坐标 / zone / Pareto）。Pro 页的脏模型名（`MiMo V2.5 -98%`、
  `Grok 4.7-40%Ends September 27, 2026`、`DeepSeek V4.1 FlashOff-peak shown …`、
  `JevDecision model …`、`Pixel CanaryFree`）由 `cleanCcName()` 清洗。
- `render-plans.mjs`: 结构同前三个，但**前沿大圆不做 de-clutter**（见下），
  `data-tier` / `data-contributor` / `data-peakwin` 属性，peak 孪生点用虚线环 +
  从 off-peak 拉细连线，Contributor 用橙色虚线大圈 + 两行标注。

- `fuse.mjs`: 跨榜归一化融合（纯字符串计算，无网络）。归一键 =
  `openrouter.mjs` 的 `normalizeSlug`（两榜同一模型 → 同一 key）。
  两用处：① DS→AA 效率融合——同键变体优先取 effort 相同的
  （整词匹配），否则取同名最快，AA 无同名记缺失（`-Inf`，不占便宜），
  再结合 DS 自身 Steps 得复合效率 E = Tokens/s ÷ Steps（`fusedEff`，
  DS 高效判断用 E，不直接用速度）；
  ② 精确重合——双榜前沿按归一键求交集，是同一模型（不再是约等于）。

三维语义（能力 × 成本 × 效率）：2D 前沿（绿，🔪高性价比）只看能力+成本；
效率维 DS 用复合效率 E = AA 融合 Tokens/s ÷ DS 自身 Steps
（越大越高效；同名优先同 effort 融合速度，无同名/无 steps → -Inf 不占便宜，
`render`/`gen-html` 每次打印 miss 名单；steps/speed 在表格与 tooltip 照常展示），
AA 榜沿用自带 Tokens/s。
叠加效率后仍无人能全包围的，再在内部按能力×成本取一次次级 2D 前沿
（不画线只判断）：线上才算高效（蓝，⚡），次级线下
（被另一个蓝色全包围）降级真被斩。剩下才是真被斩（无色）。
表格行/图上圈/tooltip/解读全部三态一致；`worst` 只从真被斩里取。
DeepSWE 表格新增 Steps + Tokens/s*（融合值，`*`=来自 AA 同名变体）列。
- `openrouter.mjs`: 模型名归一化 + OpenRouter 详情页链接（`normalizeSlug` 去括号
  effort 后缀 → 小写 hyphen slug，`aaLink(model, creator)` 按 Creator 列定 org，
  `dsLink(model)` 按前缀定 org；个例进 `SLUG_OVERRIDE`，OR 无详情页的进
  `SEARCH_ONLY` 回退搜索页）。新增模型先 curl 验 title 非软 404 再进映射。
- `gen-html.mjs`: inlines the SVGs (`chart-deepswe` + `chart-aa`, 以及存在 tb-chart.svg
  时第三个 `chart-tb`、存在 plans-chart.svg 时第四个 `chart-plans`) + all JSONs + shared
  `LOGO_MAP` into `index.html`: two (带 TB 数据则 three, 再带 CommandCode 数据则 four)
  independent chart+table sections + tabs, one joint 解读卡片（见下「解读：LLM 实时撰写」——
  脚本只在卡片里留 `<div id="llm-obs">` 空位 + 把数据以 JSON 形式内联进页面供
  LLM 读取，不生成任何解读文案，不硬编码模型名）。页头有小字生成日期
  （构建时写入）+ JS 过期判断：打开时间距生成日期超过 15 天则显示数据过期提示。Tooltips
  bound per-card via `bindTip()`. 所有模型名均可点（表格整行可点 +
  解读 + 图上气泡统一链到 OpenRouter 详情页，无详情页的回退
  搜索页；表格行 hover 加深背景、键盘回车/空格亦可打开）。
  `index.html` is fully self-contained —
  copy it anywhere, no `logos/` folder needed.
  **可选 `--with-top-missing`**（或 `MKL_INCLUDE_TOP_MISSING=1`）：若
  存在 `top-missing.json`，会把 OR Top 20 里「用了但还没上双榜」的模型
  嵌进表格——「上一代」型（hy4-preview / deepseek-v4-flash-0423 /
  muse-spark-1.3-contributor / ...）黄底（🆕 待更新）行挂在
  DS/AA 对应上一代行正上方；纯免费型（Laguna S 2.1 (free) 等）青底
  （🆓 免费）行置顶两张表。其它无上一代又非免费的会进 skipped
  名单（控制台报告，不渲染到表）。
- `fetch-openrouter.mjs`: GETs `/api/frontend/v1/models/find?order=top-weekly
  &input_modalities=text`（不需要 agent-browser），response 已是服务端按
  "近 7 天处理 token 数"排序好的结果。analytics 块按 `model_permaslug`
  给每天 prompt/completion tokens，累加即得到页面显示的周 tokens
  （页面数字 ≈ 累加和，差 1 天的忽略）。输出 `or-data.json`，每行
  `{rank, name, short_name, provider, slug, input_price, output_price,
  context_length, is_free, weekly_tokens, created_at}`。
- `find-top-missing.mjs`: 读 `or-data.json` + `data.json` + `aa-data.json`，
  从 OR Top 20 里挑出"用了但还没上双榜"的模型，**双榜分开判断**：
  - OR slug 同时命中 DS + AA（按各自命名规则，DS 直接小写 slug 匹配、AA 用
    `normalizeSlug` 剥 `(max)/(xhigh)/...` effort 后缀匹配）→ 双榜都已 benchmark，跳过
  - OR slug 只命中 DS：DS 已 benchmark，AA 落后 → 走 `findPredecessor(k, 'aa')` 找 AA successor
  - OR slug 只命中 AA：AA 已 benchmark，DS 落后 → 走 `findPredecessor(k, 'ds')` 找 DS successor
    （例：`DeepSeek V4.1 Flash` slug=`deepseek-v4.1-flash`，AA 有 `(max)` 变体视为同 benchmark，
    DS 没这个 slug → strip `.1` 后命中 DS `deepseek-v4-flash`，挂 DS 表此行上方）
  - 双榜都没直接命中：走 strip 启发式找 predecessor，命中哪 board 就挂哪 board
  - 还找不到：is_free → free 桶；否则 skipped
  - **额外入口（AA highlight → DS 缺失）**：复用 render-aa 的 2D+3D 前沿逻辑
    算出 AA 的高性价比 + 高效集合（`frontNames ∪ fastNames`），**两条独立路径**：
    - OR 上有的：OR `normalizeSlug(short_name)` 直接命中 AA highlight canon（不做
      额外后缀剥除，避免把 `ling-3.0-flash-fin` 和 `ling-3.0-flash` 误判为同一个）
      且 DS 里没这个 slug → 作为 DS successor 注入，锚点 key = AA 规范键。
      例：`Ling 3.0 Flash Fin (free)` 的 canon 是 `ling-3.0-flash-fin`，与
      `ling-3.0-flash` 不匹配，不进这里。
    - OR 上没有的：AA highlight 集合里某条不在 DS 里、不在 OR 里、但 AA 本身有
      记录（这是 AA 独立信号，如 `Claude Fable 5.1 (xhigh with fallback)`
      不在 OR Top 30）→ 作为 DS successor 注入，via 标 `'aa-highlight-no-or'`。
      gen-html `tmSubLine` 会用"AA highlight"代替"OR Top #"，`tmUrl` 用
      `aaLink(model, creator)` 拼详情页 URL。
  Strip 启发式：末位日期（`-MMDD`/`-YYYYMMDD`）、嵌入的 `.N`、常见后缀
  （contributor/preview/free/exp/vision/lite/next/plus/flash/fast/pro/...）逐个剥，
  每个候选再 `末位数字 -1`（hy4 → hy3）。输出 `top-missing.json`，
  提供 `successors[] / free[] / skipped[]`，`predecessor: {board, key, via?}` 记录锚点。
  strip 规则增例：新增模型名映射进 `TRAILING_TOKENS` 数组。
  AA-highlight 启发式增例：`AA_HIGHLIGHT_TAIL_TOKENS` 数组（fin/instant/edge/...）。
- `open.mjs`: opens `index.html` in the system default browser (platform
  `open` / `start` / `xdg-open`); never throws — prints the `file://` path
  when auto-open fails.

## 解读：LLM 实时撰写（脚本不生成解读文案）

- `gen-html.mjs` 只负责：页面结构 + 图表/表格 + 把原始数据内联进页面
  （`DS_ROWS` / `AA_ROWS` / `TM_SUCCESSORS` / `TM_FREE` 四个 JSON 常量 + 控制台
  打印的前沿/高效区/最惨名单）。解读卡片里只留一个空位
  `<div id="llm-obs">`（或等价占位），不写任何分析文字。
- 每次跑完管线后，由 LLM（调用本 skill 的 agent）在本轮对话里实时自由撰写解读：
  打开 `index.html`（或直接读 `$TMPDIR/model-killing-line/` 下的
  `data.json` / `aa-data.json` / `top-missing.json` + 终端输出的前沿名单），
  看完本轮数据后自由发挥，写成 HTML 片段（可用 `<ul class="obs">` + `<li>`，
  模型名想链 OpenRouter 可用页面内联的链接，样式类 `.obs a` 已就绪），存文件后用
  `gen-html.mjs --obs <文件>` 注入 `#llm-obs`，再展示/截图给用户。
- 唯一要求：基于本轮实际数据现看现写，不得复用上一轮的解读内容；
  开头第一条固定为 📌 太长不看，用非常精简的一句话按成本优先 / 效率优先 / 能力优先各给一个选择；之后条数句式自由发挥。

### 解读撰写原则（Agent 必读的视角提示词）

每次撰写解读前必须把以下三条原则作为强制上下文阅读，不能跳过：

1. **以 AA Intelligence Index 为主**。三榜数据时效不一致：AA Intelligence Index
   每日更新，是最有信号价值的源；DeepSWE（长程编码）和 TBench 4.0（终端智能）
   重评测成本高，更新都不勤。撰写推荐的视角应该以 AA 数据为锚，DS / TB 只作为
   "已实测档"的补充佐证，不能本末倒置用 DS/TB 的"缺测"来否定 AA 上的高 Index
   候选。
2. **缺测 ≠ 短板**。DS / TB 暂未实测的"新一代"模型（即页面里挂 `📊 仅 AA 实测`
   徽标的 `unbench-succ` 行）应理解为 "按 AA 实测 + 代际推测的候选"，而不是
   "不推荐" / "待更新" / "缺测 = 短板"。新一代模型通常强于上一代，所以这些候选
   应该被放进选型池而不是排除。解读里必须明确点出"对应的上一代"
   （如 GPT-6 Luna → GPT-5.6 Luna、Claude Opus 5.5 → Claude Opus 5、
   MiMo-V2.6-Pro → DeepSeek V4 Pro），并给出推测涨幅（如"DS 推测 ≥ 67%"）。
3. **避免暗示短板的措辞**。禁用 "暂缺" / "待更新" / "短板" / "缺测 = 不推荐"
   等暗示模型不行的措辞；改用 "未实测（按代际推测 ≥ 前代 X）"。📌 太长不看
   一行也要按这个视角写：被推荐的应该是"AA Index X + 推测 ≥ 上一代 DS/TB 数据"
   的组合，而不是"DS/TB 缺测所以搁置"。
4. **OR Top Weekly 流量信号独立成段**。OpenRouter Top Weekly 的周用量是 production
   data 的代理信号 — 流量大但 DS/AA/TB 都未实测的模型（如 DeepSeek V4.1 Flash
   18.8T/wk、Hy4 preview 13.9T/wk、GLM 5.3 Flash 19.3T/wk）是"benchmark 滞后于
   生产采用"的典型案例，解读里要单独成段提及（与"仅 AA 实测"段区分开）。

不允许出现：把 `unbench-succ` 行说成"短板" / "候选但暂不可用"；把"新一代模型
缺测"说成"不推荐"；用 DS/TB 的缺测率来评价 AA 上的高 Index 模型。

## CommandCode tab 的口径与过滤规则

这一节是 ④ tab 的**行为契约**。前三 tab 的规则大多可以照搬，这里不行——CommandCode
的官方数据有它自己的坑，绕过下面任一条会得到一张好看但错的图。

### 口径（绘图数据必须来自官方值）
- **X 轴 = 官方 `Requests / month`**（log 轴，向右＝更能跑）。`requests_5h` / `requests_week`
  也直接引用官方值。**不要用自算 token 公式反推主数据**——自算会引入 1%~11% 的偏差
  （实测比官方低）。自算值只留作 `est_requests_month` / `est_vs_official` 做 QA。
- **只做 Max 10×**。OpenCode / Pro plan 的请求数、Max 20× 的额度是另一套口径。
- **Y 轴 = 智力，CC 优先 / AA 兜底**：`index = cc_intel ?? aa_index`。CommandCode 的
  Intelligence 表有分模型 60 个，AA 规范模型只有 35 个；单用 AA 会把一批有分的模型
  挡在图外。保留 `index_source` / `cc_intel` / `aa_index` / `aa_model` 字段备查。
  CC 保留 1 位小数，AA 取整。⚠️ `null >= -Infinity` 在 JS 里是 `true`（null→0），所以
  前沿扫描必须先 `if (r.index == null) continue`，否则待更新模型会被当成「智力 0 的新纪录」。
- **高性价比区在右上**（请求数越多越好，智力越高越好）：`index ≥ 35 && requests_month ≥ 100000`。

### 过滤（按顺序，缺一不可）
1. **AA 变体去重**：同一模型的多个 AA 变体只留一个（官方请求数最多的那个）。
2. **族内弱支配过滤**（`kept` / `superseded`）：同族里新一代 `index >=` 且
   `requests >=` 上一代、至少一项严格更高，就删旧代。**不能简单「每族只留最高版本」**——
   会误删真实的取舍档位（Pro / Mini / Lite / Flash）。典型保留点：MiniMax M2.5、
   Gemini 3.1 Flash Lite、Step 3.7 Flash、Kimi K2.5、GPT-5.6 Terra。
   `index == null` 的行两边都不参与（没有 Y 值可比），既不会被删也不会删别人。
3. **同请求数去重**：同族里官方月请求数**完全相同**（= 官方给了同一个价）的多代只留最新。
   典型：Claude Opus 4.6/4.7/4.8/5 全是 2,990 次/月（同价 $5/$25/$0.5），只留 Opus 5。
   这条**对 `index == null` 的模型也生效**（支配判定对它们无效），也是它与第 2 条
   必须分开写的原因。同代（`gen` 相同）撞数不动。
4. **peak / off-peak 孪生拆分**：Pro 页 Model 列内嵌 `· peak $in / $out 01–04 & 06–10 UTC,
   Mon–Fri`。Max 页价格表**只给 off-peak 价**。有 peak 价的模型拆成两行，
   `model` 分别加 ` (off-peak)` / ` (peak)` 后缀，`requests_*` 全部 **÷ ratio**
   （ratio = peak_in ÷ off_peak_in，官方只给 in/out 两个价，cache 按同一倍率缩放）。
   **用倍率缩放而不是重算成本**——重算会带进 token 口径误差，倍率缩放是精确的。
   peak 行标 `tier: 'peak'`，支配判定与同请求数去重都必须**按 tier 隔离**
   （off-peak 会把 peak 当成「被支配的旧代」删掉）。

### Pareto 与分层
- `MIN_STEP = 0.5`：相对上一个**真正入选**的阶梯点，智力至少提升 0.5。被跳过的点
  不能抬高 `best`（否则噪声会抬高后续所有门槛）。`gen-html` 侧表格的 🔪 扫描用同一常量
  `PLANS_MIN_STEP`，保证图上阶梯数与表格 🔪 数一致。
- **Contributor 不进主 Pareto**，单独用橙色虚线圈 + 两行标注（图上文字「数据换折扣」/
  「不计入阶梯」，图例 `数据换折扣 · 不计入阶梯`）。原因：Muse Spark 1.3 Contributor
  智力 48.1 / 682K 次·月，计入会吃掉除 Claude Opus 5.5 外的所有阶梯点，5 步压成 2 步。
  机制写「数据换折扣」**不要写「5 折」**——官方价格表显示 input ≈ 常规版 1/12.5、
  output ≈ 1/21.25、cache ≈ 1/75。
- **前沿大圆不做 de-clutter**：固定画在真实坐标上，R = 15。理由：原来沿径向推开 +
  细线连回真实坐标，peak 孪生点把 `DeepSeek V4.1 Flash (off-peak)` 顶开 34px，
  一条这么长的引线会让人误读成「点其实在那儿」——而斩杀线的语义就是真实位置。
  缩小图标和去掉 de-clutter**必须一起做**：Flash(487k,38) 与 DeepSeek(385k,39.5)
  圆心距 32.7px，R=18 时两圆相交，R=15 时（2R=30）刚好不相交。callout 标签另有
  自己的碰撞布局，会自动避开真实位置的大圆。

### 表格与 UI 约束
- 表格**只有 4 列**：`#` / `Model` / `智力` / `次/月`。
- 徽标：`🔪 高性价比`（在 Pareto 阶梯上）+ `🆕 待更新`（`index == null`）；
  Contributor 例外，给 `🔪 高性价比` + `贡献数据` 两个（它两轴都是全场最好，只因不计入
  主阶梯而拿不到 front；不标会让表里性价比最高的行看起来平平无奇）。
  **不要**加「⚡ 高效」（本表没有 Tokens/s，快慢无从谈起）、**不要**露出
  「映射存疑」/「合并了 …」/ 额度池·premium 任何字样。
- `index == null` 的模型**不丢弃**，智力列显示 `—` + `🆕 待更新`。
  同族按 `family` 分块、块间按族内最高智力排、块内先放有智力的再按代际倒序
  （新一代在上一代的上一行），同代 tiebreak 放 off-peak 在 peak 前。
- **tooltip 只留 2 行硬数据**（规格对齐 AA tab 的 `chart-gen`）：head + 智力/次月 +
  次周/次5h。不要加口径解释、自算对照、AA 兜底详情。

## Thresholds (edit in render.mjs, never ask the user)

- `ZONE_COST` / `ZONE_PASS` (`2.5` / `50`): DeepSWE efficient-zone rectangle.
- render-tb.mjs: `ZONE_COST` / `ZONE_ACC` (`10` / `40`), `xMin`/`xMax` (`0.5`/`50`),
  `yMin`/`yMax` (`0`/`70`): TBench efficient-zone rectangle + axis ranges.
- `xMin` / `xMax` (`0.1` / `30`), `yMin` / `yMax` (`30` / `80`): axis ranges.
- `LOGO_RING` (`#487265`): uniform green ring around all logo badges
  (frontier + dots + tooltip); effort colors are no longer used for rings.
  `effortColor()` is kept only for the no-logo fallback dots.

## Completion criteria

- `fetch.mjs` prints `models: 21`. Any other count means the leaderboard
  changed shape — inspect before continuing.
- `fetch-aa.mjs` prints `trs: ~305, kept: ~79`. `kept` drifting means the
  table markup or filter yield changed — inspect before continuing.
- `fetch-tb.mjs` prints `rows: 27`（Terminal-Bench 4.0）。任何其它数目说明
  leaderboard 形状变了 — 重新检查 RSC payload 解析。
- `render.mjs` prints frontier points; the count matches Pareto-optimal rows.
- Hovering any dot in `index.html` shows a card with that dot's lab logo,
  model name, PASS@1, and cost.
- `logos/` (27 files, ~464KB, designarena `model-logos`, resized to 128px)
  ships with the skill and is inlined at build time; nothing is copied to
  the output dir. Logo mapping lives in `logoFileOf()` in
  `scripts/logos.mjs` (case-insensitive prefix match on a **separator-normalized**
  name, e.g. `gpt-` → OpenAI logo); add a line there when new labs appear.
  归一化不是洁癖：三家写同一个模型的方式不同（`MiMo V2.6 Flash` in CommandCode vs
  `MiMo-V2.6` in AA；`Tencent Hy3` vs `hy3`），不先把空格/下划线压成 `-` 就会表现为
  「同一模型在 A tab 有 logo、在 B tab 退化成小圆点」。改完跑一遍 14 条老前缀的回归。
  `logos/` 里没有对应文件的（LongCat / Fugu / Jev）会回退到字母 logo。
