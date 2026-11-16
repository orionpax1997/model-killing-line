// fetch-go.mjs — OpenCode Go（$10/月）官方估算请求数 × 智力指数 → go-data.json
//
// 数据源：https://opencode.ai/v2/docs/console/go/  —— Astro SSR，页面里全是**真 <table>**。
// 同一页把三个套餐（Go / Go Plus / Go Teams）的表格**全部**渲染进 DOM（前端 tab 只是显示/隐藏），
// 所以每类表在 HTML 里各出现 3 次，顺序固定 = Go → Go Plus → Go Teams：
//   a) 套餐表        Plan | Price | Included usage                        （3 行）
//   b) 价格表（×3）  Model | Input | Output | Cached Read | Cached Write | Monthly limit
//   c) 估算请求表（×3）Model | Requests per 5 hours | Requests per week | Requests per month
//   d) 隐私表        Model | Model training | Data retention
//   e) 末尾的 token 口径段落（"Grok 4.7 — 390 input, 32,500 cached, 120 output tokens per request"）
//
// **只做基础 Go 套餐（$10/月）**，Go Plus / Go Teams 一律不画。理由与 CommandCode tab 同一条：
// 三档是同一批模型的三套额度，混进一张图会让同一个模型出现在三个 X 位置，而图上没有
// 价格轴，读者只会看到"同名点散成三处"，看不出那是 3× 额度 / 4× 月费。单档也才谈得上
// "月费固定 → X 轴纯比能跑多少次"。选 Go 而不是 Plus/Teams：它是文档页的标题档、最便宜、
// 且**每美元额度最高**（Plus: 3× 请求 / 4× 月费；Teams: ~1.08× 请求 / 2× 月费）。
//
// 口径三条，绕开任一条都会得到一张好看但错的图：
//   1. X = **官方估算的 Requests per month**，原样引用。页面自己写明这是按"典型 Go 用法"
//      的 token 画像估出来的（画像逐模型列在页尾，本脚本也抓下来存 tokens_per_request）。
//      自算值（monthly_limit ÷ 每请求成本）只留 est_requests_month / est_vs_official 做 QA——
//      实测和官方估算是 99%~100% 吻合，正好用来验"抓对了哪张表"（见下面的表序自检）。
//   2. 一行一个模型：价格表把同一模型按**上下文档位**（`(≤ 512K tokens)` / `(> 512K tokens)`）
//      和 **peak 时段**（`(Off-Peak)` / `(Peak)`）拆成了多行，必须折叠：
//      · 上下文档位 → 只留低价档（`≤`）那一行，估算请求数本来就是按低价档的 token 画像算的；
//      · peak 时段 → 拆成 off-peak / peak 两个孪生点，peak 的请求数按 `peak_in ÷ off_in`
//        倍率缩放（官方两行都给真价，倍率是精确的；用成本重算会带进 token 画像误差）。
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

const SRC = 'https://opencode.ai/v2/docs/console/go/';
const PLAN_NAME = 'Go';
const PLAN_PRICE = 10;

const html = await getText(SRC);
if (!html || html.length < 20000) throw new Error(`suspiciously small response (${html?.length ?? 0} bytes) for ${SRC}`);

const strip = (s) => s
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

/** 全页所有 <table> → [{ header, rows }]（rows 已去掉表头行） */
const allTables = [];
for (const m of html.matchAll(/<table[^>]*>(.*?)<\/table>/gs)) {
  const rows = [];
  for (const tr of m[1].matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)) {
    const cells = [...tr[1].matchAll(/<t[hd][^>]*>(.*?)<\/t[hd]>/gs)].map((c) => strip(c[1]));
    if (cells.length) rows.push(cells);
  }
  if (rows.length) allTables.push({ header: rows[0], rows: rows.slice(1) });
}
const byHeader = (pred) => allTables.filter((t) => pred(t.header));

// 单元格里的数字：`$0.15` → [0.15]，`$4.00 $2.00`（划线原价 + 折扣价）→ [4, 2]，
// `-` / `Free` → []。**取最后一个**就是生效价：促销行永远把原价写在前面。
const numsIn = (cell) => (String(cell ?? '').match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
const last = (arr) => (arr.length ? arr[arr.length - 1] : null);

// ---- a) 套餐表：确认 Go = $10/月 ----
const planTbl = byHeader((h) => h[0] === 'Plan')[0];
if (!planTbl) throw new Error('plan table not found — 页面结构可能变了（找表头 Plan | Price | Included usage）');
const goPlanRow = planTbl.rows.find((r) => (r[0] ?? '').trim() === PLAN_NAME);
const planPrice = last(numsIn(goPlanRow?.[1]));
if (planPrice !== PLAN_PRICE) throw new Error(`plan ${PLAN_NAME} 价格抓到 ${planPrice}，预期 $${PLAN_PRICE} — 套餐表结构可能变了`);
const planNames = planTbl.rows.map((r) => (r[0] ?? '').trim()).filter(Boolean);
const planPrices = planTbl.rows.map((r) => last(numsIn(r[1])));

// ---- b) 价格表 ×3 / c) 估算请求表 ×3：DOM 顺序固定 Go → Go Plus → Go Teams ----
const priceTables = byHeader((h) => h[0] === 'Model' && h.includes('Input') && h.includes('Monthly limit'));
const reqTables = byHeader((h) => h[0] === 'Model' && h.includes('Requests per month'));
if (priceTables.length < 3) throw new Error(`价格表只有 ${priceTables.length} 张，预期 3 张（Go / Go Plus / Go Teams）`);
if (reqTables.length < 3) throw new Error(`估算请求表只有 ${reqTables.length} 张，预期 3 张（Go / Go Plus / Go Teams）`);

// 表序自检：Go 是**额度最小**的那张（$60/$15 档）。三张表的中位数月额度按 Go < Teams < Plus
// 排（$20 vs $65 vs $120 median 量级），只要第一张不是最小的，就说明页面把 tab 顺序改了——
// 这时不能静默取 [0]，否则整张图会变成 Go Plus 的额度配上 Go 的口径说明。
const medianLimit = (t) => {
  const v = t.rows.map((r) => last(numsIn(r[5]))).filter((x) => x != null).sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
};
const limitMedians = priceTables.map(medianLimit);
if (!(limitMedians[0] < limitMedians[1] && limitMedians[0] < limitMedians[2])) {
  throw new Error(`价格表顺序自检失败（月额度中位数 ${limitMedians.join('/')}）—— 第一张不是额度最小的 Go 档，页面 tab 顺序可能变了`);
}
const priceTbl = priceTables[0];
const reqTbl = reqTables[0];

// ---- 模型名拆解：剥掉上下文档位 / peak / 促销备注 ----
const parseName = (raw) => {
  const notes = [...String(raw).matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim());
  const base = String(raw).replace(/\s*\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const peakNote = notes.find((n) => /peak/i.test(n)) ?? null;
  const ctxNote = notes.find((n) => /[≤>]/.test(n)) ?? null;
  const other = notes.filter((n) => n !== peakNote && n !== ctxNote);
  const tier = peakNote ? (/off-?peak/i.test(peakNote) ? 'off-peak' : 'peak') : null;
  return { base, tier, ctxNote, other };
};

// 价格表 → 每个 base 一条：上下文档位保留第一行（低价档），peak 行单独留着做孪生
const priceByBase = new Map();
for (const c of priceTbl.rows) {
  const [rawModel, inS, outS, cacheS, , limitS] = c;
  if (!rawModel) continue;
  const { base, tier, ctxNote, other } = parseName(rawModel);
  if (!priceByBase.has(base)) priceByBase.set(base, []);
  priceByBase.get(base).push({
    raw: rawModel,
    tier: tier ?? 'off-peak',
    ctx_note: ctxNote,
    notes: other,
    price_in: last(numsIn(inS)),
    price_out: last(numsIn(outS)),
    price_cache: last(numsIn(cacheS)),
    monthly_limit: last(numsIn(limitS)),
  });
}
if (priceByBase.size < 25) throw new Error(`价格表只折叠出 ${priceByBase.size} 个模型 — 预期 ~31，页面结构可能变了`);

// 估算请求表 → base → {5h, week, month}；'Unlimited' 用哨兵 'UNLIMITED'（不能混成 Infinity/0）
const reqByBase = new Map();
for (const [rawModel, h5, w, m] of reqTbl.rows) {
  if (!rawModel) continue;
  const { base } = parseName(rawModel);
  const cnt = (s) => {
    const t = String(s ?? '').replace(/[, ]/g, '');
    if (/^unlimited$/i.test(t)) return 'UNLIMITED';
    if (/^free$/i.test(t)) return 'FREE';
    const v = parseFloat(t);
    return Number.isNaN(v) ? null : v;
  };
  reqByBase.set(base, { req_5h: cnt(h5), req_week: cnt(w), req_month: cnt(m) });
}
if (reqByBase.size < 25) throw new Error(`估算请求表只 ${reqByBase.size} 行 — 预期 ~31，页面结构可能变了`);

// ---- d) 隐私表：训练条款（判断"数据换折扣"档，同时是 Contributor 的交叉验证）----
const privacyTbl = byHeader((h) => h[1] === 'Model training')[0];
const trainingOf = new Map();
const retentionOf = new Map();
if (privacyTbl) {
  for (const [m, train, ret] of privacyTbl.rows) {
    if (!m) continue;
    const { base } = parseName(m);
    trainingOf.set(base, (train ?? '').trim());
    retentionOf.set(base, (ret ?? '').trim());
  }
}

// ---- e) 页尾 token 口径（官方自己给的"每请求多少 token"画像，只做 QA / 参考）----
// 形如 "Grok 4.7 — 390 input, 32,500 cached, 120 output tokens per request"；
// 也有合并写法 "GLM-5.3/5.2 — 700 input, ..."（斜杠两边共享同一份画像）。
const tokensPerRequest = new Map();
const pageText = strip(html);
for (const m of pageText.matchAll(/([A-Za-z0-9][A-Za-z0-9 .\-/]*?)\s*—\s*([\d,]+) input,\s*([\d,]+) cached,\s*([\d,]+) output tokens per request/g)) {
  const n = (s) => Number(String(s).replace(/,/g, ''));
  for (const nm of m[1].split('/')) {
    const k = nm.trim();
    if (k) tokensPerRequest.set(k, { input: n(m[2]), cache: n(m[3]), output: n(m[4]) });
  }
}

// ---- 智力：AA 规范名优先 → CommandCode 镜像兜底 ----
const canonKey = (s) => String(s)
  .replace(/\s*\([^)]*\)/g, ' ')
  .replace(/[^a-z0-9]/gi, '')
  .toLowerCase();

const aaRows = JSON.parse(readFileSync(AA_PATH, 'utf8'));
const aaBest = new Map(); // canon → { index, model, creator, variant }
for (const r of aaRows) {
  const k = canonKey(r.model);
  const cur = aaBest.get(k);
  if (!cur || r.index > cur.index) {
    aaBest.set(k, { index: r.index, model: r.model, creator: r.creator, variant: r.model.replace(/\s*\([^)]*\)\s*$/, '') });
  }
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
  'Hy4': 'hy4',
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

const idxStats = { aa: 0, pending: 0 };
const hits = [];
const missed = [];
let peakCount = 0;
for (const [base, entries] of priceByBase) {
  // 上层：上下文档位取第一行（低价档）；peak/off-peak 里取 off-peak 作为主行
  const rep = entries.find((e) => e.tier === 'off-peak') ?? entries[0];
  const peak = entries.find((e) => e.tier === 'peak') ?? null;
  const off = reqByBase.get(base) ?? null;

  // 智力：AA 单源（override 优先，其次规范化）
  const ovKey = AA_OVERRIDE[base];
  const aa = (ovKey && aaBest.get(ovKey)) || aaBest.get(canonKey(base)) || null;
  const index = aa?.index ?? null;
  const indexSource = index != null ? 'aa' : 'pending';
  if (index == null) { missed.push(base); idxStats.pending++; } else idxStats.aa++;

  // 免费档：官方请求列写 Unlimited（价格列也是 Free）。requests_month 留 null 表示"不限量"，
  // 绝不能写成 Infinity —— log 轴画不了无限，也拿不到可比的位置。
  const free = off?.req_month === 'UNLIMITED';
  const tokens = tokensPerRequest.get(base) ?? null;
  // 自算每请求成本：优先用**官方 token 画像**；页面没给画像的模型（Gemini 4 Argon 等）留空
  const cost = tokens && rep.price_in != null && rep.price_out != null && rep.price_cache != null
    ? (tokens.input * rep.price_in + tokens.cache * rep.price_cache + tokens.output * rep.price_out) / 1e6
    : null;
  const est = cost && rep.monthly_limit ? rep.monthly_limit / cost : null;

  const row = {
    model: base,
    free,
    index,
    index_pending: index == null,
    index_source: indexSource,
    aa_index: aa?.index ?? null,
    aa_model: aa?.model ?? null,
    creator: aa?.creator ?? CREATOR_OF(base),
    // 官方价格表的"折后生效价"（Gemini 4 Argon 的 50% off 已取折后值）
    price_in: rep.price_in,
    price_out: rep.price_out,
    price_cache: rep.price_cache,
    monthly_limit: rep.monthly_limit,
    notes: rep.notes.length ? rep.notes.join(' · ') : null,
    ctx_note: rep.ctx_note ?? entries.map((e) => e.ctx_note).find(Boolean) ?? null,
    tokens_per_request: tokens,
    cost_per_request: cost,
    // ---- 绘图主口径：官方估算请求数 ----
    requests_month: free ? null : (off?.req_month ?? null),
    requests_5h: free ? null : (off?.req_5h ?? null),
    requests_week: free ? null : (off?.req_week ?? null),
    requests_source: free ? 'free' : 'official-estimate',
    requests_per_usd: off?.req_month && Number.isFinite(off.req_month) ? off.req_month / PLAN_PRICE : null,
    // ---- 仅 QA：官方月额度 ÷ 官方 token 画像算出的每请求成本 ----
    est_requests_month: est,
    est_vs_official: est != null && off?.req_month ? est / off.req_month : null,
    // "数据换折扣"档：名字带 Contributor（隐私表也确认训练 = Yes）。不计入 Pareto 阶梯。
    contributor: /contributor/i.test(base) && !free,
    training: trainingOf.get(base) ?? null,
    retention: retentionOf.get(base) ?? null,
    tier: rep.tier,
    family: null,
    gen: null,
    peak_ratio: null,
    peak_window: null,
  };
  // 命名/备注类的信息漏进 tooltip 会破坏"两行硬数据"规格，所以折扣、限时这些都只留在数据里
  hits.push(row);

  // peak 孪生：官方两行真实价格都在表里，倍率 = peak_in ÷ off_in（精确），
  // 请求数按同一倍率缩放（固定月额度能跑的次数 = 额度 ÷ 单价）。cache 通常同倍率。
  if (peak && rep.price_in > 0 && peak.price_in > 0) {
    const ratio = peak.price_in / rep.price_in;
    if (ratio > 1.001) {
      const label = 'DeepSeek V4.1 Flash / V4 Pro 官方文档：peak 01:00–04:00 & 06:00–10:00 UTC，周一至周五，其余时段（含周末）为 off-peak';
      hits[hits.length - 1].peak_ratio = ratio;
      hits[hits.length - 1].peak_window = '01–04 & 06–10 UTC, Mon–Fri';
      hits.push({
        ...row,
        model: `${base} (peak)`,
        price_in: peak.price_in,
        price_out: peak.price_out,
        price_cache: peak.price_cache,
        requests_month: row.requests_month == null ? null : row.requests_month / ratio,
        requests_5h: row.requests_5h == null ? null : row.requests_5h / ratio,
        requests_week: row.requests_week == null ? null : row.requests_week / ratio,
        requests_per_usd: row.requests_per_usd == null ? null : row.requests_per_usd / ratio,
        cost_per_request: row.cost_per_request == null ? null : row.cost_per_request * ratio,
        est_requests_month: row.est_requests_month == null ? null : row.est_requests_month / ratio,
        tier: 'peak',
        peak_ratio: ratio,
        peak_window: row.peak_window,
        tier_note: label,
      });
      hits[hits.length - 2].model = `${base} (off-peak)`;
      peakCount++;
    }
  }
}

// ---- 表序自检（口径）：官方估算 vs 自算应在 95%~105% 内，否则说明抓错了表（比如拿了 Go Plus）----
const ratios = hits.map((r) => r.est_vs_official).filter((x) => x != null);
const medRatio = ratios.length ? [...ratios].sort((a, b) => a - b)[Math.floor(ratios.length / 2)] : null;

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
// 典型：MiMo-V2.6-Flash 与 MiMo-V2.5 都是 150,400 次/月（单价也一样）、
// MiMo-V2.6-Pro 与 MiMo-V2.5-Pro 都是 16,300、Muse Spark 1.3/1.2 Contributor 都是 226,600。
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
  plan: 'OpenCode Go',
  plan_price: PLAN_PRICE,
  plan_table: { names: planNames, prices: planPrices },
  requests_source: 'official-estimate',
  requests_note: '官方 "Estimated requests" 表（按典型 Go 用法的 token 画像估算），原样引用',
  tokens_source: 'official (页尾 token 画像)',
  tokens_per_request: Object.fromEntries(tokensPerRequest),
  generated: new Date().toISOString().slice(0, 10),
  catalog_size: priceByBase.size,
  peak_twins: peakCount,
  rows: finalRows,
  superseded,
  same_req_dropped: sameReqDropped,
  missed,
};
writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n');

const scored = finalRows.filter((r) => r.index != null);
const reqs = finalRows.filter((r) => r.requests_month != null);
console.log(`source: ${SRC}`);
console.log(`套餐表: ${planNames.join(' / ')} = ${planPrices.map((p) => '$' + p).join(' / ')}（只取 ${PLAN_NAME} $${PLAN_PRICE}/月）`);
console.log(`价格表折叠: ${priceTbl.rows.length} 行 → ${priceByBase.size} 个模型（上下文档位取低价档，peak 拆孪生）`);
console.log(`估算请求表: ${reqTbl.rows.length} 行（主口径）· 月额度中位数 ${limitMedians.join(' / ')}（Go < Teams < Plus 顺序自检通过）`);
console.log(`智力（AA 单源）: 有分 ${idxStats.aa} 个 / 待更新 ${idxStats.pending} 个`);
console.log(`peak 孪生: ${peakCount} 个（官方按倍率拆 off-peak / peak）`);
console.log(`最终行数: ${finalRows.length}（有智力 ${scored.length}，有请求数 ${reqs.length}，免费 ${finalRows.filter((r) => r.free).length}）`);
if (scored.length) console.log(`智力区间: ${Math.min(...scored.map((r) => r.index))}–${Math.max(...scored.map((r) => r.index))}`);
if (reqs.length) console.log(`月请求区间（官方估算）: ${Math.round(Math.min(...reqs.map((r) => r.requests_month))).toLocaleString()}–${Math.round(Math.max(...reqs.map((r) => r.requests_month))).toLocaleString()}`);
if (medRatio != null) console.log(`自算 vs 官方估算（中位数）: ${(medRatio * 100).toFixed(1)}%${medRatio > 0.95 && medRatio < 1.05 ? ' ✓ 抓对了表' : ' ⚠ 偏离 5% 以上，检查是否抓错了套餐表'}`);
console.log(`未命中任何智力源: ${missed.length}`, missed.join(', ') || '(none)');
console.log(`→ ${OUT}`);
