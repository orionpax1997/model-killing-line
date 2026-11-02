---
name: model-killing-line
description: "Draws the 模型斩杀线 - Pareto-frontier scatters (Vibe Code Bench Score vs Cost/Test + Artificial Analysis Intelligence Index vs Cost per Task + Terminal-Bench 4.0 Accuracy vs Cost per Task + CommandCode Max 10× 智力 vs 每月可跑请求数) as a single-page HTML with hover tooltips, efficient-zone shades, separate charts/tables per source, and one joint 解读. Use when the user asks for a 斩杀线, Vibe Code / 编码能力 chart, AA chart, TBench/Terminal-Bench chart, CommandCode chart, or Pareto frontier of coding models. Takes no arguments - data always comes from https://www.vals.ai/benchmarks/vibe-code, https://artificialanalysis.ai/leaderboards/models, https://www.tbench.ai and https://commandcode.ai/docs/plans/max."
---

# model-killing-line

Zero-argument skill. Fetches the Vals AI Vibe Code Bench leaderboard, the Artificial
Analysis model leaderboard, (可选) the TBench / Terminal-Bench 4.0
leaderboard, and (可选) the CommandCode Max 10× plan, computes each Pareto
frontier, and emits a
single-page `index.html` with switchable sections (tab 切换，默认通用智力，
解读常驻) — chart + table per board 由脚本生成，解读由 LLM 每次实时撰写（脚本不写解读文案）；

- ① 通用智力斩杀线（数据源 Artificial Analysis）: X = Cost per Task USD (log axis),
  Y = Intelligence Index, efficient zone = Index > 35 & cost < $1
  (表格只收 Index > 20 且 Cost 有效的行).
- ② 编码能力斩杀线（数据源 Vals AI Vibe Code Bench，tab 文案「编码能力」）:
  X = Cost / Test USD (log axis，跑完一个完整建站任务的成本)，Y = Vibe Code Bench Score (%)，
  efficient zone = Score ≥ 80% & cost ≤ $5。**这张榜取代了原来的 DeepSWE**
  （DeepSWE 2026-09 之后停止更新，Vibe Code Bench 2026-10-29 仍在跑）。每行 =
  (模型 × harness) 的官方 run，**123 行全部进表格**；货真价实的身份键是
  `model + harness`（同一模型可被 OpenHands / Claude Code / Codex / Cursor CLI / …
  各跑一次，如 Claude Opus 4.8 两行、GPT 5.5 三行）——图上圈/表格徽标/tooltip
  三态统一按这个 uid 判定。页面没给 Cost 的 7 行（Beam 1.0 / Muse Spark /
  Grok Build 0.1 / Laguna M.1 / Laguna XS.2 / Nemotron 3 Ultra / SWE-1.6 Fast）
  没有 X 坐标，只进表格不进图。效率维用榜单自带的真速度 tokens ÷ duration
  （不跨榜融合，也没有 steps 概念）。前沿大圆半径按最近邻自适应（R = minDist/2 − 2，
  夹在 [8,18]），因为 DeepSeek 三代挤在 $0.36/$0.41/$0.58 会把固定 R=18 叠成一坨。
- ③ 终端智能斩杀线（数据源 TBench, Terminal-Bench 4.0 官方榜, 可选）: X = Cost per Task USD
  (log axis, total_cost_usd ÷ n_trials —— 页面 COST 列是整次 run 总成本，没有平均成本列；
  为使 X 轴与 Vibe Code Bench 的 Cost / Test / AA 的 Cost per Task 跨榜可比，用折算的任务单价，
  表格里则按页面口径原样展示总成本), Y = Accuracy %, efficient zone = Accuracy ≥ 40 &
  cost ≤ $10。每行 = (模型 × agent × reasoning_effort) 的官方 run，35 行；带 tb-data.json +
  tb-chart.svg 时 gen-html 自动启用第三个 tab；缺这两个文件则保持双榜页面不报错。
  表格按用户要求展示**全部 effort 变体（35 行）**：按 accuracy 降序 + competition 排名（同分同号
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
node .agents/skills/model-killing-line/scripts/fetch-vc.mjs            # → $TMPDIR/model-killing-line/vc-data.json (~123 rows, Vals AI Vibe Code Bench)
node .agents/skills/model-killing-line/scripts/fetch-aa.mjs           # → $TMPDIR/model-killing-line/aa-data.json (~62 rows, AA)
node .agents/skills/model-killing-line/scripts/fetch-tb.mjs            # → $TMPDIR/model-killing-line/tb-data.json (35 rows, Terminal-Bench 4.0) — 可选
node .agents/skills/model-killing-line/scripts/fetch-openrouter.mjs   # → $TMPDIR/model-killing-line/or-data.json (Top 30 from OpenRouter Top Weekly, text modality) — 可选
node .agents/skills/model-killing-line/scripts/fetch-plans.mjs         # → $TMPDIR/model-killing-line/plans-data.json (CommandCode Max 10×) — 可选
node .agents/skills/model-killing-line/scripts/find-top-missing.mjs   # → $TMPDIR/model-killing-line/top-missing.json (OR Top 20 里没上双榜的模型) — 可选
node .agents/skills/model-killing-line/scripts/render-vc.mjs          # → $TMPDIR/model-killing-line/vc-chart.svg (logos inlined as data URIs)
node .agents/skills/model-killing-line/scripts/render-aa.mjs          # → $TMPDIR/model-killing-line/aa-chart.svg
node .agents/skills/model-killing-line/scripts/render-tb.mjs          # → $TMPDIR/model-killing-line/tb-chart.svg — 可选（和 fetch-tb 成对）
node .agents/skills/model-killing-line/scripts/render-plans.mjs       # → $TMPDIR/model-killing-line/plans-chart.svg — 可选（和 fetch-plans 成对）
node .agents/skills/model-killing-line/scripts/gen-html.mjs [--with-top-missing]  # → $TMPDIR/model-killing-line/index.html (单文件 HTML；存在 tb-data.json + tb-chart.svg 时自动加「终端智能」tab，存在 plans-data.json + plans-chart.svg 时再自动加「CommandCode」tab；带 --with-top-missing 才注入 OR Top 缺失行；解读区只留 #llm-obs 空位)
# LLM 看完本轮数据后自由撰写解读 HTML 片段，存文件后注入：
node .agents/skills/model-killing-line/scripts/gen-html.mjs [--with-top-missing] --obs /tmp/mkl-obs.html  # --obs <html文件|->（- 从 stdin 读；MKL_OBS 传路径亦可）
node .agents/skills/model-killing-line/scripts/open.mjs               # auto-open index.html in default browser
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

- `fetch-vc.mjs`: GETs https://www.vals.ai/benchmarks/vibe-code 的 SSR HTML，在
  `<table aria-labelledby="benchmark-leaderboard-title">` 里逐 `<tr>` 抓 7 列
  （Rank / Model+详情页 href / Harness / Score / Cost / Test / Tokens / Test / Duration / Test）。
  每行输出 `{rank, model, harness, score, cost(缺失 null), tokens, tokens_disp,
  duration_sec, duration_disp, speed(tokens÷duration, 缺失 null), org, slug, url}`。
  org 与 slug 来自详情页路径 `/models/<org>_<slug>`（如 `anthropic_claude-sonnet-5-5`），
  用来拼 OpenRouter 链接，比按名字前缀猜准。Throws when zero rows parse — 页面改版
  （列顺序/表格容器变更）时看文件头的列约定。页面顶部还有 `Updated MM/DD/YYYY` 文案，
  脚本会打印出来（当前 10/29/2026）。
- `render-vc.mjs`: 结构同 `render-aa.mjs`（自适应 log x 轴、碰撞感知 callout、透明 hit-area、
  `data-*` 驱动 tooltip），但：
  · 身份键 = `model + harness`（uid），前沿/⚡/表格三态一致；
  · 效率维 = 榜单自带真速度 `tokens ÷ duration`（不跨榜融合，`data-speed` 直接就是 tok/s）；
  · 只画 cost 有效的行（7 行无 cost 的只进表格）；
  · **前沿大圆半径自适应**：R = 最近邻距离/2 − 2，夹在 [8,18]（DeepSeek 三代挤在
    $0.36/$0.41/$0.58，固定 R=18 会重叠 50%+ 把一个点完全盖住）。圆仍画在真实坐标上，
    **不推开**（斩杀线的语义就是真实位置），只缩半径 + 多裁一个 clipPath 尺寸；
  · 画布顶部留 72px（而不是 50px）抬头空间：80~92% 那段太密，气泡只能往点上方放；
  · callout 盒子比 AA 小一号（10px 字 / 18px 高）+ 两轮布局（先严格不压小圆点，
    再放宽允许盖背景点，但永不得压其他前沿大圆/已放盒子/标题）。标签按 `labeled:`
    日志核对：未放下的会列出来（圆点仍在，hover 看名字）。
- `fetch-aa.mjs`: GETs the Artificial Analysis leaderboard SSR HTML and
  parses the `<tbody>` rows (model, context, creator, index, cost, speed,
  latency, total). Keeps only Intelligence Index > 20 with non-empty cost.
  No JSON API exists for the Cost column — SSR HTML is the only source.
- `render-aa.mjs`: same structure as `render-vc.mjs` but for AA data
  (log x 基础域 0.01~10、y 基础域 20~55——**数据超界 / 大量空白时坐标轴自适应**：
  x 按 log 刻度阶梯 `[0.01,0.02,0.05,0.1,0.2,0.5,1,2,5,10,15,20,50,100]` 取
  「比数据最小成本更低一档的刻度」为左边界（数据 0.07 起时轴不再从 $0.01 起，
  否则左侧 1/4 画布是空的）、「覆盖最大成本的下一档刻度」为右边界
  （基础域 $10 封顶会把 $10~13 的模型画到右边框外）；y 上界 = `数据 max + 2`
  再扩到 5 的整数倍（留出前沿大圆 R18+外圈的位置，避免 59 分的点露出画布顶部），
  下界 = `min(20, 数据 min 向下扩到 5 的整数倍)`；x tick 由同一阶梯按域内筛选生成，
  y 刻度随之生成到新上界；
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
- `render-tb.mjs`: same structure as `render-vc.mjs`/`render-aa.mjs` but for TBench data
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

三维语义（能力 × 成本 × 效率）：2D 前沿（绿，🔪高性价比）只看能力+成本；
效率维三张榜各自用自带真速度（Vibe Code Bench = tokens÷duration，AA = 自带 Tokens/s，
TB = run 平均 tok/s），**不再做跟 AA 融合的复合效率**（DeepSWE 的 steps 口径随榜一起下线了）。
叠加效率后仍无人能全包围的，再在内部按能力×成本取一次次级 2D 前沿
（不画线只判断）：线上才算高效（蓝，⚡），次级线下
（被另一个蓝色全包围）降级真被斩。剩下才是真被斩（无色）。
表格行/图上圈/tooltip/解读全部三态一致；`worst` 只从真被斩里取。
编码表列：`# / Model / Harness / Score / Cost/Test / Tokens/Test / Duration / Tokens/s`
（Cost 缺失行显示 —，但仍然列在表里）。跨榜重合用 `normalizeSlug` 作归一键直接比
（不再经过 fuse.mjs）。
- `openrouter.mjs`: 模型名归一化 + OpenRouter 详情页链接（`normalizeSlug` 去括号
  effort 后缀 → 小写 hyphen slug；`aaLink(model, creator)` 按 AA 的 Creator 列定 org，
  `vcLink(model, org)` 按 Vals 详情页路径里的 org 前缀定 org（`VALS_ORG_TO_OR`），
  `tbLink` = `aaLink`，`dsLink` 只剩 CommandCode 那张表在用；个例进 `SLUG_OVERRIDE`，
  OR 无详情页的进 `SEARCH_ONLY` 回退搜索页）。新增模型先 curl 验 title 非软 404
  再进映射（Vibe Code Bench 那批是用 https://openrouter.ai/api/v1/models 的
  id 清单逐个核对的，19 个已下架/未上 OR 的老模型会走搜索页）。
- `gen-html.mjs`: inlines the SVGs (`chart-code` ← vc-chart.svg + `chart-gen` ← aa-chart.svg,
  以及存在 tb-chart.svg
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
  编码榜/AA 对应上一代行正上方；纯免费型（Laguna S 2.1 (free) 等）青底
  （🆓 免费）行置顶两张表。其它无上一代又非免费的会进 skipped
  名单（控制台报告，不渲染到表）。
- `fetch-openrouter.mjs`: GETs `/api/frontend/v1/models/find?order=top-weekly
  &input_modalities=text`（不需要 agent-browser），response 已是服务端按
  "近 7 天处理 token 数"排序好的结果。analytics 块按 `model_permaslug`
  给每天 prompt/completion tokens，累加即得到页面显示的周 tokens
  （页面数字 ≈ 累加和，差 1 天的忽略）。输出 `or-data.json`，每行
  `{rank, name, short_name, provider, slug, input_price, output_price,
  context_length, is_free, weekly_tokens, created_at}`。
- `find-top-missing.mjs`: 读 `or-data.json` + `vc-data.json` + `aa-data.json`，
  从 OR Top 20 里挑出"用了但还没上双榜"的模型，**双榜分开判断**：
  - OR slug 同时命中 VC + AA（按各自命名规则，VC 用 `normalizeSlug(vcLink().slug)`
    即品牌全名归一化 + `SLUG_OVERRIDE` 兜底、AA 用 `normalizeSlug` 剥
    `(max)/(xhigh)/...` effort 后缀匹配）→ 双榜都已 benchmark，跳过
  - OR slug 只命中 VC：VC 已 benchmark，AA 落后 → 走 `findPredecessor(k, 'aa')` 找 AA successor
  - OR slug 只命中 AA：AA 已 benchmark，VC 落后 → 走 `findPredecessor(k, 'vc')` 找 VC successor
    （例：`DeepSeek V4.1 Flash` slug=`deepseek-v4.1-flash`，AA 有 `(max)` 变体视为同 benchmark，
    编码榜没这个 slug → strip `.1` 后命中 `deepseek-v4-flash`，挂编码表此行上方）
  - 双榜都没直接命中：走 strip 启发式找 predecessor，命中哪 board 就挂哪 board
  - 还找不到：is_free → free 桶；否则 skipped
  - **额外入口（AA highlight → 编码榜缺失）**：复用 render-aa 的 2D+3D 前沿逻辑
    算出 AA 的高性价比 + 高效集合（`frontNames ∪ fastNames`），**两条独立路径**：
    - OR 上有的：OR `normalizeSlug(short_name)` 直接命中 AA highlight canon（不做
      额外后缀剥除，避免把 `ling-3.0-flash-fin` 和 `ling-3.0-flash` 误判为同一个）
      且编码榜里没这个 slug → 作为 VC successor 注入，锚点 key = AA 规范键。
      例：`Ling 3.0 Flash Fin (free)` 的 canon 是 `ling-3.0-flash-fin`，与
      `ling-3.0-flash` 不匹配，不进这里。
    - OR 上没有的：AA highlight 集合里某条不在编码榜里、不在 OR 里、但 AA 本身有
      记录（这是 AA 独立信号，如 `Claude Fable 5.1 (xhigh with fallback)`
      不在 OR Top 30）→ 作为 VC successor 注入，via 标 `'aa-highlight-no-or'`。
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
  （`VC_ROWS` / `AA_ROWS` / `TM_SUCCESSORS` / `TM_FREE` 四个 JSON 常量 + 控制台
  打印的前沿/高效区/最惨名单）。解读卡片里只留一个空位
  `<div id="llm-obs">`（或等价占位），不写任何分析文字。
- 每次跑完管线后，由 LLM（调用本 skill 的 agent）在本轮对话里实时自由撰写解读：
  打开 `index.html`（或直接读 `$TMPDIR/model-killing-line/` 下的
  `vc-data.json` / `aa-data.json` / `top-missing.json` + 终端输出的前沿名单），
  看完本轮数据后自由发挥，写成 HTML 片段（可用 `<ul class="obs">` + `<li>`，
  模型名想链 OpenRouter 可用页面内联的链接，样式类 `.obs a` 已就绪），存文件后用
  `gen-html.mjs --obs <文件>` 注入 `#llm-obs`，再展示/截图给用户。
- 唯一要求：基于本轮实际数据现看现写，不得复用上一轮的解读内容；
  开头第一条固定为 📌 太长不看，用非常精简的一句话按成本优先 / 效率优先 / 能力优先各给一个选择；**三个选择都从 AA 榜取**（详见下面「解读撰写原则」第 1 条），之后条数句式自由发挥。

### 解读撰写原则（Agent 必读的视角提示词）

每次撰写解读前必须把以下五条原则作为强制上下文阅读，不能跳过：

1. **推荐一律从 AA 榜选，📌 太长不看也不例外**。四榜数据时效不一致：AA Intelligence
   Index 每日更新，是唯一有"最新信号"的源；编码榜（Vibe Code Bench，数周）和
   TBench 4.0（终端智能，数月）重评测成本高，实测档往往比当下新一代落后一代。
   **📌 太长不看的三个选择（成本优先 / 效率优先 / 能力优先）必须全部取自 AA 榜**
   （AA 的 Index + Cost per Task + Tokens/s 三个字段就够定档），并在括号里标注
   编码榜 / TB 的实测档作为佐证（"编码榜实测 88.9%"），而不是用编码榜 / TB 的数字当
   推荐依据。例如成本优先给 `GPT-6.1 Sol (medium)`（AA 46 分 / $0.36）而不是
   `DeepSeek V4.1 Flash`（编码榜 84.74% / $0.41 的唯一前沿便宜档）——后者在 AA 上只有
   `DeepSeek V4.1 Flash 1017 (max)` 的 32 分，拿它定档就是拿慢榜压快榜。
2. **缺测 ≠ 短板**。编码榜 / TB 暂未实测的"新一代"模型（即页面里挂 `📊 仅 AA 实测`
   徽标的 `unbench-succ` 行）应理解为 "按 AA 实测 + 代际推测的候选"，而不是
   "不推荐" / "待更新" / "缺测 = 短板"。新一代模型通常强于上一代，所以这些候选
   应该被放进选型池而不是排除。解读里必须明确点出"对应的上一代"
   （如 GPT-6 Luna → GPT-5.6 Luna、Claude Opus 5.5 → Claude Opus 5、
   MiMo-V2.6-Pro → DeepSeek V4 Pro），并给出推测涨幅（如"编码榜推测 ≥ 67%"）。
3. **避免暗示短板的措辞**。禁用 "暂缺" / "待更新" / "短板" / "缺测 = 不推荐"
   等暗示模型不行的措辞；改用 "未实测（按代际推测 ≥ 前代 X）"。📌 太长不看
   一行也要按这个视角写：被推荐的应该是"AA Index X + 推测 ≥ 上一代编码榜/TB 数据"
   的组合，而不是"编码榜/TB 缺测所以搁置"。
4. **OR Top Weekly 流量信号独立成段**。OpenRouter Top Weekly 的周用量是 production
   data 的代理信号 — 流量大但 AA 上还没有 Index 的模型（典型是 `Hy4 preview`，
   以及每轮都要重新看的一批新模型；具体量级一律读本轮 `or-data.json` 的
   `weekly_tokens`，**不要引用上一轮的旧数字**）是"benchmark 滞后于生产采用"的典型
   案例，解读里要单独成段提及（与"仅 AA 实测"段区分开）。
5. **引用徽标 / 集合状态前先核对 render 输出**。`render-*.mjs` 每次会打印
   `frontier points` / `efficient` / `zone` 名单，解读里的 🔪 / ⚡ / 📊 说法必须与那
   三个名单一致。已踩过的坑：**AA 榜的 2D 前沿与 ⚡ 高效圈交集常常为空**（前沿只看
   能力×成本，⚡ 是 3D 差集），所以"某点在前沿上又套着 ⚡"这种话要先把两个名字
   都在两份名单里查到才能写；查不到就只写其中一个。同理编码榜的 ⚡ 是**榜单自带
   tokens÷duration**（不是 AA 的 Tokens/s，也不是「单位成本产出」），拿 AA speed 解释
   编码榜的 ⚡ 同样会错；另外编码榜的 ⚡ 名单里同一模型可能出现在不同 harness 上，写的时候
   带上 harness。

不允许出现：把 `unbench-succ` 行说成"短板" / "候选但暂不可用"；把"新一代模型
缺测"说成"不推荐"；用编码榜/TB 的缺测率来评价 AA 上的高 Index 模型；**用编码榜 / TB 的
数字给 📌 太长不看 定档**（推荐理由的 X / Y 必须是 AA 的 Index 与 Cost per Task）。

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

## Thresholds (edit in the render script, never ask the user)

- render-vc.mjs: `ZONE_COST` / `ZONE_SCORE` (`5` / `80`): Vibe Code Bench 高性价比区
  （x 上限 $5、y 下限 80%）。x 轴按 `X_LADDER` 阶梯自适应（当前数据 $0.07~$57.92 →
  轴域 $0.05~$100），y 轴 `0 ~ max(100, 数据 max+2 扩到 5 的倍数)`。
- render-aa.mjs: `ZONE_COST` / `ZONE_INDEX` (`1` / `35`).
- render-tb.mjs: `ZONE_COST` / `ZONE_ACC` (`10` / `40`), `xMin`/`xMax` (`0.5`/`50`),
  `yMin`/`yMax` (`0`/`70`): TBench efficient-zone rectangle + axis ranges.
- `LOGO_RING` (`#487265`): uniform green ring around all logo badges
  (frontier + dots + tooltip); effort colors are no longer used for rings.
  `effortColor()` is kept only for the no-logo fallback dots.

## Completion criteria

- `fetch-vc.mjs` prints `rows: ~123 (cost 缺失 ~7 行…)` + `updated: MM/DD/YYYY`。
  行数或 cost 缺失数的量级变了 = Vals 页面改版（列顺序 / 表格容器），先看文件头
  的列约定再改。`updated` 太久没动说明这个榜也开始停更了，要在解读里说清楚。
- `fetch-aa.mjs` prints `trs: ~277, kept: ~62`. `kept` drifting means the
  table markup or filter yield changed — inspect before continuing.
- `fetch-tb.mjs` prints `rows: ~35`（Terminal-Bench 4.0）。任何其它数目说明
  leaderboard 形状变了 — 重新检查 RSC payload 解析。
- `render-vc.mjs` prints frontier points + `labeled:` + `efficient:`；前沿数必须等于
  Pareto-optimal 行数（按 model+harness 计），`labeled:` 里若出现「未放下 …」说明
  气泡位置不够，圆点仍在（hover 可看名字），可考虑再加大 padT 或补候选位。
- Hovering any dot in `index.html` shows a card with that dot's lab logo,
  model name, score, cost and tokens/duration/speed.
- `logos/` (27 files, ~464KB, designarena `model-logos`, resized to 128px)
  ships with the skill and is inlined at build time; nothing is copied to
  the output dir. Logo mapping lives in `logoFileOf()` in
  `scripts/logos.mjs` (case-insensitive prefix match on a **separator-normalized**
  name, e.g. `gpt-` → OpenAI logo); add a line there when new labs appear.
  归一化不是洁癖：三家写同一个模型的方式不同（`MiMo V2.6 Flash` in CommandCode vs
  `MiMo-V2.6` in AA；`Tencent Hy3` vs `hy3`），不先把空格/下划线压成 `-` 就会表现为
  「同一模型在 A tab 有 logo、在 B tab 退化成小圆点」。改完跑一遍 14 条老前缀的回归。
  `logos/` 里没有对应文件的（LongCat / Fugu / Jev）会回退到字母 logo。
