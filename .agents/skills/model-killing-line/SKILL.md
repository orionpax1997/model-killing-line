---
name: model-killing-line
description: "Draws the 模型斩杀线 - dual Pareto-frontier scatters (DeepSWE PASS@1 vs Avg Cost + Artificial Analysis Intelligence Index vs Cost per Task) as a single-page HTML with hover tooltips, efficient-zone shades, separate charts/tables per source, and one joint 解读. Use when the user asks for a 斩杀线, DeepSWE chart, AA chart, or Pareto frontier of coding models. Takes no arguments - data always comes from https://deepswe.datacurve.ai/ and https://artificialanalysis.ai/leaderboards/models."
---

# model-killing-line

Zero-argument skill. Fetches the DeepSWE leaderboard and the Artificial
Analysis model leaderboard, computes each Pareto frontier, and emits a
single-page `index.html` with two switchable sections (tab 切换，默认通用智力，
解读常驻) — chart + table per board 由脚本生成，解读由 LLM 每次实时撰写（脚本不写解读文案）,

- ① 通用智力斩杀线（数据源 Artificial Analysis）: X = Cost per Task USD (log axis),
  Y = Intelligence Index, efficient zone = Index > 35 & cost < $1
  (表格只收 Index > 20 且 Cost 有效的行).
- ② 长程编码能力斩杀线（数据源 DeepSWE）: X = Avg Cost per task (log axis), Y = PASS@1,
  efficient zone = PASS@1 ≥ 50% & cost ≤ $2.5.
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
node .pi/skills/model-killing-line/scripts/fetch-openrouter.mjs   # → $TMPDIR/model-killing-line/or-data.json (Top 30 from OpenRouter Top Weekly, text modality) — 可选
node .pi/skills/model-killing-line/scripts/find-top-missing.mjs   # → $TMPDIR/model-killing-line/top-missing.json (OR Top 20 里没上双榜的模型) — 可选
node .pi/skills/model-killing-line/scripts/render.mjs             # → $TMPDIR/model-killing-line/chart.svg (logos inlined as data URIs)
node .pi/skills/model-killing-line/scripts/render-aa.mjs          # → $TMPDIR/model-killing-line/aa-chart.svg
node .pi/skills/model-killing-line/scripts/gen-html.mjs [--with-top-missing]  # → $TMPDIR/model-killing-line/index.html (单文件 HTML；带 --with-top-missing 才注入 OR Top 缺失行；解读区只留 #llm-obs 空位)
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
  (log x 0.01~10, y 20~55, zone Index > 35 & < $1, `data-creator` /
  `data-index` attributes, same-base-name single label + collision-aware callouts,
  efficient 高效点描蓝圈同上）。

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
- `gen-html.mjs`: inlines both SVGs (`chart-deepswe` + `chart-aa`) +
  both JSONs + shared `LOGO_MAP` into `index.html`: two independent
  chart+table sections, one joint 解读卡片（见下「解读：LLM 实时撰写」——
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

## Thresholds (edit in render.mjs, never ask the user)

- `ZONE_COST` / `ZONE_PASS` (`2.5` / `50`): efficient-zone rectangle.
- `xMin` / `xMax` (`0.1` / `30`), `yMin` / `yMax` (`30` / `80`): axis ranges.
- `LOGO_RING` (`#487265`): uniform green ring around all logo badges
  (frontier + dots + tooltip); effort colors are no longer used for rings.
  `effortColor()` is kept only for the no-logo fallback dots.

## Completion criteria

- `fetch.mjs` prints `models: 21`. Any other count means the leaderboard
  changed shape — inspect before continuing.
- `fetch-aa.mjs` prints `trs: ~305, kept: ~79`. `kept` drifting means the
  table markup or filter yield changed — inspect before continuing.
- `render.mjs` prints frontier points; the count matches Pareto-optimal rows.
- Hovering any dot in `index.html` shows a card with that dot's lab logo,
  model name, PASS@1, and cost.
- `logos/` (27 files, ~464KB, designarena `model-logos`, resized to 128px)
  ships with the skill and is inlined at build time; nothing is copied to
  the output dir. Logo mapping lives in `logoFileOf()` in
  `scripts/logos.mjs` (case-insensitive prefix match, e.g. `gpt-` → OpenAI
  logo); add a line there when new labs appear.
