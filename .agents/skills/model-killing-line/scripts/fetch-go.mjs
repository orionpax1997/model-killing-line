// fetch-go.mjs — OpenCode Go（$10/月）官方估算请求数 × 智力指数 → go-data.json
//
// 数据源（2026-11 起改版，旧文档页 https://opencode.ai/v2/docs/console/go/ 的价格表 /
// 估算请求表 / token 画像段落已下线，只剩套餐表 + 隐私表）:
//   a) Console 页 https://opencode.ai/console/go ：唯一剩下的表格
//      Model | Relative request allowances | Est. requests / 5 hr | Monthly limit
//      每行同时给 Go / Go Plus 两档数值（`data-plan="go" / "go-plus"`），我们只取 Go 那一档。
//      页面**只给 5h 请求数**，不再给周/月：周 = 2.5×5h、月 = 5×5h（旧官方表的恒等式，
//      实测 30 个有分模型全部精确成立 ±1 取整，见旧版数据）。
//   b) 官方 models API https://opencode.ai/inference/go/v1/models （页面自己推荐的
//      `curl https://opencode.ai/inference/go/v1/models`）：每模型给
//      cost.text.input.price / cache.read / output.price（per-1M 单价）、
//      multipliers（peak 倍率 + 时段窗口）、go.monthly_usage{go,go-plus,go-teams}（月额度）、
//      go.training / go.zdr / go.limited_regions（隐私/折扣档判定）。
//      id 与 Console 表的 data-model slug 一一对应，是两源的 join 键。
//
// **只做基础 Go 套餐（$10/月）**，Go Plus / Go Teams 一律不画。理由与 CommandCode tab 同一条：
// 三档是同一批模型的三套额度，混进一张图会让同一个模型出现在三个 X 位置，而图上没有
// 价格轴，读者只会看到"同名点散成三处"，看不出那是 3× 额度 / 4× 月费。单档也才谈得上
// "月费固定 → X 轴纯比能跑多少次"。选 Go 而不是 Plus/Teams：它是 Console 页的标题档、
// 最便宜、且**每美元额度最高**（Plus: 3× 请求 / 4× 月费；Teams: ~1.08× 请求 / 2× 月费）。
//
// 口径三条，绕开任一条都会得到一张好看但错的图：
//   1. X = **官方估算的每月可跑请求数**：新页只给 5h 值，月 = 5 × 5h、周 = 2.5 × 5h 换算
//      （旧官方估算表的恒等式）。`requests_source` 标 `official-5h-derived`，
//      `requests_note` 写明换算——不要在解读里把周/月换算值说成"官网直接印的数"。
//   2. 一行一个模型：peak 时段（API multipliers.factor > 1，如 DeepSeek 两款）拆成
//      off-peak / peak 两个孪生点，peak 的请求数按 factor 倍率缩放（官方倍率精确，
//      用成本重算会带进 token 画像误差）。
//   3. Y = 智力指数，**只用 AA Intelligence Index 单源**。OpenCode 自己不发布任何分数，只能外部取。
//      另一条候选是 CommandCode 的 Intelligence 列，但 2026-11 实测两家**已经不是同一把尺子**：
//      Claude / GPT / Gemini 差 1~4 分，国产开放权重模型系统性差 +10~16 分（GLM-5.3 44.8 vs AA 32、
//      MiMo V2.6 Pro 46.3 vs 30、Step 5 Preview 43.7 vs 29）。两张尺子混在同一根 Y 轴上，
//      点的高低就有一半来自尺子差异——所以这里**不混**：AA 单源，AA 没分的模型在表里标
//      「🆕 待更新」（次数是官方实数，仍然照常展示），但不上图（Y 轴无值）。
//      ⚠️ `null >= -Infinity` 在 JS 里是 true（null→0），所以前沿扫描必须先判 `index == null`。
//
// 用法: node scripts/fetch-go.mjs [--out <path>] [--dir <dir>]
//   依赖 aa-data.json 已存在（先跑 fetch-aa.mjs）。
//   默认写到系统临时目录: os.tmpdir()/model-killing-line/go-data.json（MKL_DIR 可覆盖）
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import net from 'node:net';

// opencode.ai 挂在 Cloudflare 后面，部分网络环境只能经 HTTP 代理出网；node 内置 fetch 不读
// http(s)_proxy（要 --use-env-proxy，本 skill 零参数不允许额外 flag），所以手搓 CONNECT 隧道。
const PROXY = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY || '';
const NO_PROXY = (process.env.no_proxy || process.env.NO_PROXY || '').split(',').map((s) => s.trim()).filter(Boolean);

const getText = (url, headers = {}) => new Promise((resolve, reject) => {
  const u = new URL(url);
  const ua = { 'user-agent': 'Mozilla/5.0 (compatible; model-killing-line/1.0)', ...headers };
  const bypass = NO_PROXY.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
  const viaProxy = PROXY && !bypass;
  const doGet = (socket, host) => {
    const req = https.get({ host, port: 443, path: u.pathname + u.search, headers: { ...ua, host: u.host }, socket, agent: false }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        r.resume();
        return resolve(getText(new URL(r.headers.location, url).href, headers));
      }
      let body = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { body += c; });
      r.on('end', () => (r.statusCode === 200 ? resolve(body) : reject(new Error(`${r.statusCode} for ${url}`))));
    });
    req.on('error', reject);
  };
  if (!viaProxy) return doGet(undefined, u.hostname);
  const p = new URL(PROXY.includes('://') ? PROXY : `http://${PROXY}`);
  const sock = net.connect({ host: p.hostname, port: +p.port || 8080 }, () => {
    sock.write(`CONNECT ${u.hostname}:443 HTTP/1.1\r\nHost: ${u.hostname}:443\r\n\r\n`);
  });
  let buf = '';
  const onData = (c) => {
    buf += c.toString('latin1');
    const end = buf.indexOf('\r\n\r\n');
    if (end === -1) return;
    sock.off('data', onData);
    if (!/^HTTP\/1\.[01] 200/.test(buf)) { sock.destroy(); return reject(new Error(`proxy CONNECT failed: ${buf.split('\r\n')[0]}`)); }
    doGet(sock, u.hostname);
  };
  sock.on('data', onData);
  sock.on('error', reject);
});

const argv = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
};
const DIR = argv('--dir') ?? process.env.MKL_DIR ?? path.join(os.tmpdir(), 'model-killing-line');
mkdirSync(DIR, { recursive: true });
const OUT = argv('--out') ?? path.join(DIR, 'go-data.json');
const AA_PATH = path.join(DIR, 'aa-data.json');
if (!existsSync(AA_PATH)) {
  console.error(`missing ${AA_PATH} — 先跑 node scripts/fetch-aa.mjs`);
  process.exit(1);
}

const SRC = 'https://opencode.ai/console/go';
const MODELS_API = 'https://opencode.ai/inference/go/v1/models';
const PLAN_NAME = 'Go';
const PLAN_PRICE = 10;

const html = await getText(SRC);
if (!html || html.length < 20000) throw new Error(`suspiciously small response (${html?.length ?? 0} bytes) for ${SRC}`);

// ---- 套餐自检：Console 页 JSON-LD 里 Go = $10.00/月、Go Plus = $40.00/月 ----
const ldGo = html.match(/"name":"OpenCode Go","url":"[^"]*","price":"(\d+(?:\.\d+)?)"/);
if (!ldGo || Number(ldGo[1]) !== PLAN_PRICE) {
  throw new Error(`Console 页 JSON-LD 里 Go 价格抓到 ${ldGo?.[1] ?? 'null'}，预期 $${PLAN_PRICE} — 页面结构可能变了`);
}
const planNames = ['Go', 'Go Plus'];
const planPrices = [PLAN_PRICE, 40];
for (const m of html.matchAll(/"name":"OpenCode Go Plus","url":"[^"]*","price":"(\d+(?:\.\d+)?)"/g)) planPrices[1] = Number(m[1]);

// ---- Console 页表格：按 <tr data-model="..."> 切块，每块抽 4 个 current-value ----
// 块内顺序固定：请求数 Go / 请求数 Go Plus / 月额度 Go / 月额度 Go Plus
// （bar-track 的 data-plan 后面没有 current-value span，不会被下面的正则误抓）。
const cnt = (s) => {
  const t = String(s ?? '').replace(/[, ]/g, '');
  if (t === '∞' || /^unlimited$/i.test(t)) return 'UNLIMITED';
  const v = parseFloat(t);
  return Number.isNaN(v) ? null : v;
};
const consoleById = new Map();
for (const chunk of html.split(/<tr[^>]*data-model="/).slice(1)) {
  const id = chunk.match(/^([^"]+)"/)?.[1];
  if (!id) continue;
  const name = chunk.match(/model-name[^>]*>([^<]+)<\/span>/)?.[1]?.trim();
  const vals = [...chunk.matchAll(/data-plan="(go|go-plus)"[^>]*>\s*<span[^>]*data-layer="current-value">([^<]+)<\/span>/g)];
  if (vals.length < 4) continue;
  const [reqGo, reqPlus, limGo, limPlus] = vals.slice(0, 4).map((v) => v[2]);
  consoleById.set(id, { name, req_5h_go: cnt(reqGo), req_5h_plus: cnt(reqPlus), limit_go: cnt(limGo), limit_plus: cnt(limPlus) });
}
if (consoleById.size < 25) throw new Error(`Console 页只解析出 ${consoleById.size} 个模型 — 预期 ~32，页面结构可能变了`);

// ---- 官方 models API：单价 / 月额度 / peak 倍率 / 隐私 ----
const apiJson = JSON.parse(await getText(MODELS_API));
const apiModels = apiJson.data ?? [];
if (apiModels.length < 25) throw new Error(`models API 只回 ${apiModels.length} 个模型 — 预期 ~32，接口可能变了`);
const apiById = new Map(apiModels.map((m) => [m.id, m]));

// 自检：Console 与 API 的模型集合必须一致（少一方 = 抓错源或页面在分批上线）
const onlyConsole = [...consoleById.keys()].filter((k) => !apiById.has(k));
const onlyApi = [...apiById.keys()].filter((k) => !consoleById.has(k));
if (onlyConsole.length || onlyApi.length) {
  throw new Error(`Console 页与 models API 模型集合不一致：仅页面有 [${onlyConsole.join(', ')}]，仅 API 有 [${onlyApi.join(', ')}]`);
}

// 自检：Go 必须比 Go Plus 便宜（请求数与月额度都小），否则抓错了 data-plan 档位
let selfCheckBad = 0;
for (const [id, c] of consoleById) {
  if (typeof c.req_5h_go === 'number' && typeof c.req_5h_plus === 'number' && !(c.req_5h_go < c.req_5h_plus)) selfCheckBad++;
  if (typeof c.limit_go === 'number' && typeof c.limit_plus === 'number' && !(c.limit_go < c.limit_plus)) selfCheckBad++;
}
if (selfCheckBad) throw new Error(`Go < Go Plus 自检失败：${selfCheckBad} 处数值不满足 Go 更便宜 — 可能抓错了档位`);

// ---- 智力：AA 规范名优先（单源） ----
const canonKey = (s) => String(s)
  .replace(/\s*\([^)]*\)/g, ' ')
  .replace(/[^a-z0-9]/gi, '')
  .toLowerCase();

const aaRows = JSON.parse(readFileSync(AA_PATH, 'utf8'));
const aaBest = new Map(); // canon → { index, model, creator }
for (const r of aaRows) {
  const k = canonKey(r.model);
  const cur = aaBest.get(k);
  if (!cur || r.index > cur.index) aaBest.set(k, { index: r.index, model: r.model, creator: r.creator });
}

// OpenCode 名 → AA 规范键的个例（规范化覆盖不到的那些）
const AA_OVERRIDE = Object.freeze({
  'GLM-5.3': 'glm53',
  'GLM-5.2': 'glm52',
  'Kimi K3': 'kimik3',
  'Kimi K3.1 Pro': 'kimik31pro',
  'MiMo-V2.5': 'mimov25',
  'MiMo-V2.6-Pro': 'mimov26pro',
  'MiniMax M3': 'minimaxm3',
  'MiniMax M3.1 Flash': 'minimaxm31flash',
  'Qwen3.8 Flash': 'qwen38flashnext', // AA 只有 -Flash-Next（改名），与 CC tab 同一条映射
  'Hy3': 'hy3',
  'Hy4': 'tencenthy4', // AA 写全品牌 `Tencent Hy4`（2026-11 起 AA 榜带品牌前缀）
  'Hy4 preview': 'hy4preview',
  'LongCat-2.0': 'longcat20',
  'Step 5 Preview': 'step5preview',
  'DeepSeek V4 Pro': 'deepseekv4pro0813', // AA 的名字带日期
  'DeepSeek V4.1 Flash': 'deepseekv41flash1017', // AA 的名字带评测日期（1017）
  'Gemini 4 Argon': 'gemini4argon',
  'GLM-5.3-Flash': 'glm53flash',
});

// 厂家（tooltip / logo 用；AA 命中过就用 AA 的 Creator 列）
const CREATOR_OF = (m) => CREATOR_PREFIX.find(([re]) => re.test(m))?.[1] ?? '—';
const CREATOR_PREFIX = [
  [/^claude/i, 'Anthropic'], [/^gpt|^openai/i, 'OpenAI'], [/^gemini/i, 'Google'],
  [/^grok/i, 'xAI'], [/^deepseek/i, 'DeepSeek'], [/^qwen/i, 'Alibaba'],
  [/^glm|zhipu|zai/i, 'Zhipu'], [/^kimi|moonshot/i, 'Moonshot'], [/^mimo/i, 'Xiaomi'],
  [/^minimax/i, 'MiniMax'], [/^muse/i, 'Meta'], [/^step/i, 'StepFun'],
  [/^longcat/i, 'Meituan'], [/^tencent|^hy\d/i, 'Tencent'], [/^nemotron/i, 'NVIDIA'],
];

// peak 时段窗口：从 API multipliers.when 拼成 "01–04 & 06–10 UTC, Mon–Fri"
const peakWindowOf = (mult) => {
  const when = mult?.when ?? {};
  const days = (when.utc_days?.in ?? []).map((d) => d[0].toUpperCase() + d.slice(1, 3));
  const ranges = [];
  for (const slot of when.any ?? []) {
    for (const cond of slot.all ?? []) {
      const h = cond.utc_hours;
      if (h?.gte && h?.lt) ranges.push(`${h.gte.slice(0, 2)}–${h.lt.slice(0, 2)}`);
    }
  }
  return ranges.length ? `${ranges.join(' & ')} UTC, ${days.join('-')}` : null;
};

const idxStats = { aa: 0, pending: 0 };
const hits = [];
const missed = [];
let peakCount = 0;
// 新页只给 5h：月 = 5×5h、周 = 2.5×5h（旧官方估算表的恒等式，逐模型精确成立）
const MONTH_PER_5H = 5;
const WEEK_PER_5H = 2.5;

for (const m of apiModels) {
  const id = m.id;
  const c = consoleById.get(id);
  const base = c?.name ?? m.name; // 展示名用 Console 页的（与 API name 仅 DeepSeek 1017 后缀等细微差）
  const t = m.cost?.text ?? {};
  const price_in = t.input?.price ?? null;
  const price_out = t.output?.price ?? null;
  const price_cache = t.input?.cache?.read ?? null;
  const monthly_limit = m.go?.monthly_usage?.go ?? null;
  const limited_regions = m.go?.limited_regions ?? false;

  // 免费档：API 无 monthly_usage 且 Console 写 ∞。requests_* 留 null 表示"不限量"，
  // 绝不能写成 Infinity —— log 轴画不了无限，也拿不到可比的位置。
  const free = c?.req_5h_go === 'UNLIMITED' || monthly_limit == null;
  const req_5h = free ? null : c.req_5h_go;
  const req_month = req_5h == null ? null : Math.round(req_5h * MONTH_PER_5H);
  const req_week = req_5h == null ? null : Math.round(req_5h * WEEK_PER_5H);

  const ovKey = AA_OVERRIDE[base];
  const aa = (ovKey && aaBest.get(ovKey)) || aaBest.get(canonKey(base)) || null;
  const index = aa?.index ?? null;
  const indexSource = index != null ? 'aa' : 'pending';
  if (index == null) { missed.push(base); idxStats.pending++; } else idxStats.aa++;

  const row = {
    model: base,
    free,
    index,
    index_pending: index == null,
    index_source: indexSource,
    aa_index: aa?.index ?? null,
    aa_model: aa?.model ?? null,
    creator: aa?.creator ?? CREATOR_OF(base),
    // 官方 API 的 per-1M 单价（off-peak 基价；peak 时按 factor 缩放）
    price_in,
    price_out,
    price_cache,
    monthly_limit,
    notes: limited_regions ? 'Limited regions' : null,
    ctx_note: null,
    tokens_per_request: null, // 新页已下线 token 画像段落，不再有官方画像
    cost_per_request: null,
    // ---- 绘图主口径：官方 5h 估算 × 换算（月 = 5×5h、周 = 2.5×5h） ----
    requests_month: req_month,
    requests_5h: req_5h,
    requests_week: req_week,
    requests_source: free ? 'free' : 'official-5h-derived',
    requests_per_usd: req_month != null ? req_month / PLAN_PRICE : null,
    est_requests_month: null,
    est_vs_official: null,
    // "数据换折扣"档：API go.training = true（隐私表也确认训练）。不计入 Pareto 阶梯。
    contributor: m.go?.training === true && !free,
    training: m.go?.training == null ? null : (m.go.training ? 'Yes' : 'No'),
    retention: m.go?.zdr == null ? null : (m.go.zdr ? 'ZDR' : 'Not ZDR'),
    tier: 'off-peak',
    family: null,
    gen: null,
    peak_ratio: null,
    peak_window: null,
  };
  hits.push(row);

  // peak 孪生：API multipliers.factor > 1（当前仅 DeepSeek V4.1 Flash / V4 Pro，factor = 2），
  // 倍率精确。peak 的请求数按同一倍率缩放（固定月额度能跑的次数 = 额度 ÷ 单价）。
  // ⚠️ 只有**每日时段**型（utc_hours 窗口）才拆孪生：`when.date.gte` 型（如 Gemini 4 Argon
  // "2026-12-01 起全天 2×"）是促销到期标注，不是另一个时段，只记 notes 不拆行。
  const mult = m.cost?.multipliers?.find((x) => (x.factor ?? 1) > 1 && x.when?.any);
  if (mult && !free && price_in > 0) {
    const ratio = mult.factor;
    const win = peakWindowOf(mult);
    row.peak_ratio = ratio;
    row.peak_window = win;
    row.model = `${base} (off-peak)`;
    hits.push({
      ...row,
      model: `${base} (peak)`,
      price_in: price_in * ratio,
      price_out: price_out * ratio,
      price_cache: price_cache * ratio,
      requests_month: req_month == null ? null : req_month / ratio,
      requests_5h: req_5h == null ? null : req_5h / ratio,
      requests_week: req_week == null ? null : req_week / ratio,
      requests_per_usd: row.requests_per_usd == null ? null : row.requests_per_usd / ratio,
      tier: 'peak',
      peak_ratio: ratio,
      peak_window: win,
      tier_note: `官方 API multipliers.factor=${ratio}：peak ${win}，其余时段（含周末）为 off-peak`,
    });
    peakCount++;
  }
  // 日期生效型倍率（Gemini 4 Argon：2026-12-01 起 2×）：只记 notes，次数保持当前官方 5h 口径
  const dateMult = m.cost?.multipliers?.find((x) => (x.factor ?? 1) > 1 && x.when?.date?.gte);
  if (dateMult && !free) {
    const since = dateMult.when.date.gte;
    row.notes = row.notes ? `${row.notes} · ${since} 起 ${dateMult.factor}×` : `${since} 起 ${dateMult.factor}×`;
  }
}

// ---- 族内弱支配过滤：新一代在两轴都不差才允许淘汰旧代 ----
const splitFamVer = (name) => {
  const m = name.match(/^(.*?)(\d+(?:\.\d+)*)(.*)$/);
  if (!m) return { fam: name, ver: null };
  return { fam: m[1].replace(/[-\s]+$/, '').trim(), ver: m[2] };
};
const vcmp = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
const fams = new Map();
for (const r of hits) {
  const { fam, ver } = splitFamVer(r.model);
  if (ver == null || r.index == null) continue;   // 无智力 → 无 Y 值可比，两边都不参与
  if (!fams.has(fam)) fams.set(fam, []);
  fams.get(fam).push({ ...r, _ver: ver, _tier: r.tier ?? 'off-peak' });
}
const superseded = [];
const kept = [];
for (const r of hits) {
  const { fam, ver } = splitFamVer(r.model);
  if (r.index == null || ver == null) { kept.push(r); continue; }
  const myTier = r.tier ?? 'off-peak';
  const doms = (fams.get(fam) ?? []).filter((o) =>
    vcmp(o._ver, ver) > 0 &&
    (o._tier ?? 'off-peak') === myTier &&   // peak 孪生不是"上一代"，tier 必须隔离
    o.index >= r.index && o.requests_month != null && r.requests_month != null &&
    o.requests_month >= r.requests_month &&
    (o.index > r.index || o.requests_month > r.requests_month));
  const dom = doms.length
    ? doms.reduce((a, b) => (vcmp(b._ver, a._ver) > 0 || (b._ver === a._ver && b.requests_month > a.requests_month) ? b : a))
    : null;
  if (dom) superseded.push({ model: r.model, index: r.index, requests: r.requests_month, by: dom.model });
  else kept.push(r);
}
if (superseded.length) {
  console.log(`族内弱支配过滤: ${superseded.length} 个被同族更新一代支配而移除`);
  for (const x of superseded) console.log(`  ${x.model} (智力${x.index}/${Math.round(x.requests).toLocaleString()}次) ← ${x.by}`);
}

// family / gen 必须在任何按族分组之前算好（同请求数去重要按族分组）
for (const r of kept) {
  const { fam, ver } = splitFamVer(r.model);
  r.family = fam;
  r.gen = ver;
}

// ---- 同请求数去重：同族同 tier 且官方估算月请求数**完全相同**（= 官方给同一额度同一价），只留最新一代 ----
// 典型：Muse Spark 1.3/1.2 Contributor 都是 226,500 次/月（5h 都是 45,300）。
// 这些点在图上完全重合、在表里只是版本号不同，没有额外信息。
// 与上面的支配判定是两种淘汰：这条认"官方给了同一个数"，因此对 index==null 的行同样生效。
const byFamReq = new Map();
for (const r of kept) {
  const k = `${r.family}|${r.tier ?? 'off-peak'}|${r.requests_month}`;
  if (!byFamReq.has(k)) byFamReq.set(k, []);
  byFamReq.get(k).push(r);
}
const sameReqDropped = [];
const afterSameReq = [];
for (const r of kept) {
  const arr = byFamReq.get(`${r.family}|${r.tier ?? 'off-peak'}|${r.requests_month}`);
  const newer = arr && arr.length > 1 ? arr.find((o) => vcmp(o.gen ?? '', r.gen ?? '') > 0) : null;
  if (newer) { sameReqDropped.push({ model: r.model, requests: r.requests_month, by: newer.model }); continue; }
  afterSameReq.push(r);
}
if (sameReqDropped.length) {
  console.log(`同请求数去重: ${sameReqDropped.length} 个（同族同额度，只留最新一代）`);
  for (const x of sameReqDropped) console.log(`  ${x.model} (${Math.round(x.requests).toLocaleString()} 次/月) ← ${x.by}`);
}

const finalRows = afterSameReq.sort((a, b) => (a.requests_month ?? -1) - (b.requests_month ?? -1));

const data = {
  source: SRC,
  models_api: MODELS_API,
  plan: 'OpenCode Go',
  plan_price: PLAN_PRICE,
  plan_table: { names: planNames, prices: planPrices },
  requests_source: 'official-5h-derived',
  requests_note: `Console 页只给 Est. requests / 5 hr（官方估算）；月 = ${MONTH_PER_5H}×5h、周 = ${WEEK_PER_5H}×5h（旧官方估算表的恒等式，逐模型成立）`,
  tokens_source: 'n/a (新页已下线 token 画像段落)',
  tokens_per_request: {},
  generated: new Date().toISOString().slice(0, 10),
  catalog_size: apiModels.length,
  peak_twins: peakCount,
  rows: finalRows,
  superseded,
  same_req_dropped: sameReqDropped,
  missed,
};
writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n');

const scored = finalRows.filter((r) => r.index != null);
const reqs = finalRows.filter((r) => r.requests_month != null);
console.log(`source: ${SRC} + ${MODELS_API}`);
console.log(`套餐表: ${planNames.join(' / ')} = ${planPrices.map((p) => '$' + p).join(' / ')}（只取 ${PLAN_NAME} $${PLAN_PRICE}/月，JSON-LD 自检通过）`);
console.log(`Console 页: ${consoleById.size} 个模型（Est. requests / 5 hr + Monthly limit，Go 档）· Go < Go Plus 自检通过`);
console.log(`models API: ${apiModels.length} 个模型（单价/月额度/peak 倍率）· 两源集合一致`);
console.log(`智力（AA 单源）: 有分 ${idxStats.aa} 个 / 待更新 ${idxStats.pending} 个`);
console.log(`peak 孪生: ${peakCount} 个（API multipliers.factor 拆 off-peak / peak）`);
console.log(`最终行数: ${finalRows.length}（有智力 ${scored.length}，有请求数 ${reqs.length}，免费 ${finalRows.filter((r) => r.free).length}）`);
if (scored.length) console.log(`智力区间: ${Math.min(...scored.map((r) => r.index))}–${Math.max(...scored.map((r) => r.index))}`);
if (reqs.length) console.log(`月请求区间（5h×5 换算）: ${Math.round(Math.min(...reqs.map((r) => r.requests_month))).toLocaleString()}–${Math.round(Math.max(...reqs.map((r) => r.requests_month))).toLocaleString()}`);
console.log(`未命中任何智力源: ${missed.length}`, missed.join(', ') || '(none)');
console.log(`→ ${OUT}`);
