// fetch-plans.mjs — CommandCode Max 10× 官方请求数 × 智力指数（CC 优先 / AA 兜底）→ plans-data.json
//
// 数据源两个：
//   1) https://commandcode.ai/docs/plans/max  —— Next.js SSR，页面里两张**真 <table>**：
//      a) 价目表 thead 含 "Max 10× credits"：Model | Input | Output | Cache Read |
//         Cache Write | Max 10× credits | Max 20× credits（84 行 = 文档说的 "all 84 models"）
//      b) 请求数估算表 thead 含 "Requests / 5 hours"：Model | 5h | week | month
//         （官方自己的估算，原样保留进 tooltip 做交叉验证，不参与绘图口径）
//   2) aa-data.json（fetch-aa.mjs 产出）—— Intelligence Index，**唯一智力数据源**。
//      只画与 AA 的交集：CommandCode 自带的 Intelligence 列虽然数值上就是 AA 的镜像
//      （实测差 ≤0.5），但混用两个源会掩盖"缺测"，所以坚持只用 AA。
//
// 口径（2026-03 修正）：**直接用官方发布的请求数**，不再自己按 token 反推。
//   早先版本用统一 token 口径重算 requests，理由是"官方表隐含的每请求 token 口径不公开，
//   跨站比较会把口径差当成性价比差"。但那张图最后收敛到**单站单 plan**（只画
//   CommandCode Max 10×），根本没有第二个站要对齐——这个理由就不成立了，而反推本身
//   反而引入了 3–11% 的系统偏差和一堆假设。官方逐模型给了 5h/周/月 三个数，直接取月列。
//   自己算的那份仍保留为 est_requests_month，只在 tooltip 里做偏差对照，不参与绘图。
//   性价比 = 官方次/月 ÷ 官方月费（$100），即"每一美元月费能买多少次请求"。
//
// 另抓 pricing-limits 页补两个官方口径（都不在 max 页里）：
//   - 全模型**混合均值**请求数（"Max 10× ~230K requests"）→ 仍解析为 plan_mix_requests
//     作为内部诊断字段，但 **UI 不用它**（混合均值的参考竖线已删，别再画回来）。
//     用来判断某个模型相对"该 plan 的典型用法"是偏贵还是偏便宜。
//   - **滚动窗口限额**（Max 10×: 5 小时 $45 / 每周 $90，月度额度 $150）→ 月度次数不是
//     随时都能跑满的，单个 5 小时窗口最多只能花掉 $45 = 月度池的 30%。
//
// 去重：多个 CommandCode 模型可能指向同一个 AA 变体（如 "Qwen 3.8 Max" 与
//   "Qwen 3.8 Max 0902" 都对应 AA 的 "Qwen3.8 Max (0902)"），保留 requests 最大的
//   那个作为代表，其余进 merged[] 供 tooltip/表格展示"合并了谁"。
//
// 用法: node scripts/fetch-plans.mjs [--out <path>] [--dir <dir>]
//   依赖 aa-data.json 已存在（先跑 fetch-aa.mjs）
//   默认写到系统临时目录: os.tmpdir()/model-killing-line/plans-data.json（MKL_DIR 可覆盖）
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import net from 'node:net';

// commandcode.ai 挂在 Cloudflare 后面，部分网络环境只能经 HTTP 代理出网；
// 而 node 内置 fetch 不读 http(s)_proxy 环境变量（要 `node --use-env-proxy`，
// 但本 skill 是零参数脚本，不能要求额外 flag）。所以这里用 node:net 手搓一个
// CONNECT 隧道：环境变量里有代理就走代理，没有就直连。只用 node stdlib。
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
const OUT = argv('--out') ?? path.join(DIR, 'plans-data.json');
const AA_PATH = path.join(DIR, 'aa-data.json');
if (!existsSync(AA_PATH)) {
  console.error(`missing ${AA_PATH} — 先跑 node scripts/fetch-aa.mjs`);
  process.exit(1);
}

const SRC = 'https://commandcode.ai/docs/plans/max';
const LIMITS_SRC = 'https://commandcode.ai/docs/resources/pricing-limits';
// Pro 页不是我们要的 plan，但它有一张**全模型**表，带 CommandCode 自家的 Intelligence 列
const PRO_SRC = 'https://commandcode.ai/docs/plans/pro';

// 仅用于 est_requests_month 的对照估算（不参与绘图，见头注释）
const TOKENS = Object.freeze({ input: 1000, cache: 50000, output: 200 });
const PLAN_NAME = 'Max 10×';

const html = await getText(SRC);
if (!html || html.length < 10000) throw new Error(`suspiciously small response (${html?.length ?? 0} bytes) for ${SRC}`);
const limitsHtml = (await getText(LIMITS_SRC)) ?? '';
if (limitsHtml.length < 10000) console.warn('pricing-limits 页抓取失败，滚动窗口限额额将缺失');
const proHtml = (await getText(PRO_SRC)) ?? '';
if (proHtml.length < 10000) console.warn('Pro 页抓取失败，CommandCode 自家 Intelligence 不可用，将全部退回 AA');

const strip = (s) => s
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

/** 抓一张 <table>：thead 文本含 needle 时返回行数组（每行 = 字符串数组） */
const tableWhere = (needle, src = html) => {
  for (const m of src.matchAll(/<table[^>]*>(.*?)<\/table>/gs)) {
    const inner = m[1];
    if (!inner.includes(needle)) continue;
    const rows = [];
    for (const tr of inner.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)) {
      const cells = [...tr[1].matchAll(/<t[hd][^>]*>(.*?)<\/t[hd]>/gs)].map((c) => strip(c[1]));
      if (cells.length) rows.push(cells);
    }
    return rows;
  }
  return null;
};

const money = (s) => {
  const t = s.replace(/[$,]/g, '').trim();
  if (t === '' || t === '-' || t === '—') return null;
  const v = parseFloat(t);
  return Number.isNaN(v) ? null : v;
};
const count = (s) => {
  const t = s.replace(/[, ]/g, '');
  if (/^unlimited$/i.test(t)) return Infinity;
  // 官方给免费档写的是 "Free"（请求表 Requests 三列 + 价格表 credits 列都是），
  // 不是数字也不是 "unlimited"。原来只认 unlimited，于是这些行 count() 返回 null、
  // 再被下面的 credit_10x == null 一起丢掉——CommandCode 上 4 个真·免费模型整批消失。
  // 用哨兵字符串 'FREE' 标记，后面单独走分支；绝不能混成 0 或 Infinity。
  if (/^free$/i.test(t)) return 'FREE';
  const v = parseFloat(t);
  return Number.isNaN(v) ? null : v;
};
/** 计数文本 → 数值，支持 "487,000" / "~230K requests" / "1.2M" 这类带修饰的写法 */
const countLoose = (s) => {
  const t = String(s ?? '').replace(/[,~ ]/g, '');
  const m = t.match(/^([\d.]+)\s*([KMB]?)/i);
  if (!m) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9, '': 1 }[(m[2] || '').toUpperCase()];
  if (mult == null) return null;
  return parseFloat(m[1]) * mult;
};

// ---- a) 价目表 ----
const priceRows = tableWhere('Max 10× credits');
if (!priceRows) throw new Error('price table not found — 页面结构可能变了（找含 "Max 10× credits" 的 <table>）');
const head = priceRows[0];
const priceBody = priceRows.slice(1);
const catalog = [];
for (const c of priceBody) {
  const [model, inS, outS, cacheS, cwS, cr10S, cr20S] = c;
  if (!model) continue;
  catalog.push({
    model,
    price_in: money(inS),
    price_out: money(outS),
    price_cache: money(cacheS),
    price_cache_write: money(cwS),
    credit_10x: money(cr10S),
    credit_20x: money(cr20S),
  });
}
if (catalog.length < 50) throw new Error(`price table only ${catalog.length} rows — 预期 ~84，页面结构可能变了`);

// ---- b) 官方请求数估算表（**主数据源**）----
const reqTable = tableWhere('Requests / 5 hours');
const officialReq = new Map();
if (reqTable) {
  for (const c of reqTable.slice(1)) {
    const [model, h5, w, m] = c;
    if (!model) continue;
    officialReq.set(model, { req_5h: count(h5), req_week: count(w), req_month: count(m) });
  }
}
if (officialReq.size < 50) throw new Error(`official request table only ${officialReq.size} rows — 预期 ~84，页面结构可能变了`);

// ---- c) pricing-limits 页：plan 混合均值请求数（仅诊断，UI 不用）+ 滚动窗口限额 ----
const PLAN_ROW = (tbl) => tbl?.slice(1).find((r) => (r[0] ?? '').trim() === PLAN_NAME) ?? null;
const planRow = PLAN_ROW(tableWhere('Included LLM Usage', limitsHtml));
const winRow = PLAN_ROW(tableWhere('5-hour limit', limitsHtml));
const planPrice = planRow ? money(planRow[1]) : null;              // $100
const planCredits = planRow ? money(planRow[2]) : null;            // $150
const planMixRequests = planRow ? countLoose(planRow[3]) : null;   // "~230K requests" 这类要走 countLoose
const win5h = winRow ? money(winRow[3]) : null;                    // $45
const winWeek = winRow ? money(winRow[4]) : null;                  // $90
// 混合均值的原始文本（"~230K requests"）。只留 plan_mix_label/plan_mix_requests 做内部
// 诊断，UI 侧一律不引用——参考竖线已删。
const planMixLabel = planRow ? (planRow[3] ?? '').trim() : null;

// ---- AA 智力指数：按规范名归一，同名多 effort 变体取 index 最高 ----
const canonKey = (s) => s
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

// ---- d) CommandCode 自家 Intelligence（Pro 页全模型表）----
// 该表的 Model 列是"脏"的：混着促销折扣后缀和计价备注，直接 canon 会匹配不上，必须先洗。
//   "MiMo V2.5 -98%"                                          → MiMo V2.5
//   "Grok 4.7-40%Ends September 27, 2026"                    → Grok 4.7
//   "DeepSeek V4.1 FlashOff-peak shown (17h/day) · peak ..."  → DeepSeek V4.1 Flash
//   "JevDecision model · headless (cmd -p) ..."               → Jev
//   "Pixel CanaryFree"                                        → Pixel Canary
const cleanCcName = (s) => String(s)
  .replace(/Ends\s+\w+.*$/i, '')
  .replace(/Off-peak.*$/i, '')
  .replace(/Decision model.*$/i, '')
  .replace(/-\d{1,3}%.*$/, '')
  .replace(/Free$/i, '')
  .trim();
const ccIntelTable = tableWhere('Intelligence', proHtml);
const ccIntel = new Map(); // canon → 分数（"not yet scored" 存 null）
const ccContext = new Map(); // canon → 上下文窗口（原样字符串 "1M" / "262K" / "1.1M"）
if (ccIntelTable) {
  for (const [model, context, intel] of ccIntelTable.slice(1)) {
    if (!model) continue;
    const k = canonKey(cleanCcName(model));
    const v = parseFloat(intel);
    ccIntel.set(k, Number.isNaN(v) ? null : v);
    // Context 列原样保留字符串：官方有 "1M" 和 "1.1M" 两种量级，转成数字再格式化会
    // 把 1M 显示成 "1000K"，反而不如官方写法直观。只把裸数字/异常值剔掉。
    const ctx = (context ?? '').trim();
    if (ctx && /^[\d.]+\s*[KMB]?$/i.test(ctx)) ccContext.set(k, ctx);
  }
}
// ---- Pro 页 RSC flight payload：完整的 "All plans 83" 清单 ----
// 页面 SSR 出来的 <table> 只有 76 行（默认筛选 Pro plan），Opus / Fable / Astra / Fugu
// 要等前端点了 "All plans" 才出现在 DOM 里——但它们的 intelligenceIndex 和
// contextWindow **早就在 RSC payload 里**，只是没渲染。用 <table> 解析的代价：
//   · Claude Opus 5.5 的 57.6 被漏掉 → 错误地退回 AA 兜底的 58（口径整个换了来源）
//   · Claude Opus 5 / Fable 5 / Fugu Ultra 被标成「🆕 待更新」
//   · 6 个模型的 Context 整列是空的
// 所以 RSC 为主、<table> 为回退，且 RSC 在后覆盖。
const PRO_RSC = (() => {
  const txt = proHtml.replace(/\\"/g, '"');
  const out = [];
  let i = 0;
  while ((i = txt.indexOf('{"slug":', i)) >= 0) {
    // 平衡括号找对象结尾：对象里有嵌套的 tiers/deal/caps，且字符串里可能有 } 或 {
    let depth = 0, inStr = false, esc = false, j = i, closed = false;
    for (; j < txt.length; j++) {
      const c = txt[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (!depth) { j++; closed = true; break; } }
    }
    if (closed) {
      // "$undefined" 是 React Server Components 序列化 undefined 的标记，当 null 处理
      try { const o = JSON.parse(txt.slice(i, j).replace(/"\$undefined"/g, 'null')); if (o?.name) out.push(o); } catch { /* payload 里混有非模型对象，忽略 */ }
    }
    i = j;
  }
  return out;
})();

// contextWindow 是数字（1050000），官方表格显示 1.1M。跟着官方口径格式化：
// 整百万不带小数，非整百万保留 1 位。不这么做会出现 "1000000" 或 "1050K" 这种反直觉写法。
const fmtContext = (n) => {
  if (n == null || !Number.isFinite(n)) return null;
  // 先 +toFixed(1) 折回数字再拼 "M"：1048576 → "1.0" → 1 → "1M"，官方就是这么写的。
  // 直接拼字符串会同时出现 1M 和 1.0M 两种写法。
  if (n >= 1e6) return String(+(n / 1e6).toFixed(1)) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(n);
};
for (const o of PRO_RSC) {
  const k = canonKey(cleanCcName(o.name));
  if (o.intelligenceIndex != null) ccIntel.set(k, o.intelligenceIndex);
  const c = fmtContext(o.contextWindow);
  if (c) ccContext.set(k, c);
}

const ccScored = [...ccIntel.values()].filter((v) => v != null).length;

// ---- peak 时段价（Pro 页 Intelligence 表的 Model 列里内嵌）----
// Max 页价格表**只给 off-peak 价**，但 Pro 页的 Model 列形如：
//   "DeepSeek V4.1 FlashOff-peak shown (17h/day) · peak $0.30 / $1.20 01–04 & 06–10 UTC, Mon–Fri"
// 也就是 peak 只有 input/output 两个价，cache 没给。peak 时段 = 01–04 & 06–10 UTC、周一~五
// （7h × 5d = 35h/周），其余时间是 off-peak。
// 官方请求数是**按 off-peak 价**给的，所以画一个 peak 点必须自己推：价格整体乘以同一个倍率 r，
// 固定 credits 能跑的请求数就精确地变成 1/r。这里用 r = peak_in / off_peak_in，
// 不走"credits/自算成本"那条路——那条会引入 token 口径误差（实测自算比官方低 1%~11%），
// 而倍率缩放是精确的。
// window 用 $ 锚定抓 peak 价之后的全部尾巴。原来写成 `([^|]*?)(?:Mon|Tue|…)` 想省掉分隔符，
// 结果把 "Mon" 自己吞了，tooltip 里只剩 "01–04 & 06–10 UTC," 少了星期几。
const PEAK_RE = /peak\s*\$([\d.]+)\s*\/\s*\$([\d.]+)([\s\S]*)$/i;
const PEAK_WINDOW_DEFAULT = '01–04 & 06–10 UTC, Mon–Fri';
const ccPeak = new Map(); // canon → { ratio, window }
if (ccIntelTable) {
  for (const [model] of ccIntelTable.slice(1)) {
    if (!model || !/off-peak/i.test(model)) continue;
    const m = PEAK_RE.exec(model);
    if (!m) continue;
    ccPeak.set(canonKey(cleanCcName(model)), {
      peak_in: parseFloat(m[1]),
      peak_out: parseFloat(m[2]),
      window: (m[3] || '').trim() || PEAK_WINDOW_DEFAULT,
    });
  }
}
// CC 的 Intelligence 表没有 Creator 列，纯 CC 命中的模型得自己认厂牌（只用于 tooltip）
const CREATOR_PREFIX = [
  [/^claude/i, 'Anthropic'], [/^gpt|^openai/i, 'OpenAI'], [/^gemini/i, 'Google'],
  [/^grok/i, 'xAI'], [/^deepseek/i, 'DeepSeek'], [/^qwen/i, 'Alibaba'],
  [/^glm|zhipu|zai/i, 'Zhipu'], [/^kimi|moonshot/i, 'Moonshot'], [/^mimo/i, 'Xiaomi'],
  [/^minimax/i, 'MiniMax'], [/^muse/i, 'Meta'], [/^step/i, 'StepFun'],
  [/^longcat/i, 'Meituan'], [/^tencent|hy\d/i, 'Tencent'], [/^nemotron/i, 'NVIDIA'],
  [/^seed|bytedance/i, 'ByteDance'], [/^ernie|baidu/i, 'Baidu'], [/^minimax/i, 'MiniMax'],
  [/^jpmorgan|space bunny|pixel canary|laguna|^ling|fugu|quasar|apodex|inkling|jev/i, '—'],
];
const CREATOR_OF = (m) => CREATOR_PREFIX.find(([re]) => re.test(m))?.[1] ?? '—';
if (ccIntel.size < 40) throw new Error(`CC Intelligence 表只 ${ccIntel.size} 行 — 预期 ~75，Pro 页结构可能变了`);

// CommandCode 名 → AA 规范键。规范化回退能覆盖大多数，两家命名不一致的在这里显式列出。
const SLUG_OVERRIDE = Object.freeze({
  'Tencent Hy3': 'hy3',
  'Kimi K3': 'kimik3',
  'GLM-5.3 Flash': 'glm53flash',
  'GLM-5.3': 'glm53',
  'GLM-5.2': 'glm52',
  'GLM-5.1': 'glm51',
  'DeepSeek V4 Pro (latest)': 'deepseekv4pro0813', // CC 的 "(latest)" = AA 的 "V4 Pro 0813"
  'DeepSeek V4 Flash (latest)': 'deepseekv4flashvision',
  'DeepSeek V4 Flash Vision (exp)': 'deepseekv4flashvision',
  'DeepSeek V4.1 Flash': 'deepseekv41flash',
  'Qwen 3.8 Max': 'qwen38max',
  'Qwen 3.8 Max 0902': 'qwen38max',
  'Qwen 3.8 Flash': 'qwen38flashnext',
  'Qwen 3.8 Omni Flash': 'qwen38flashnext',
  'Qwen 3.8 27B': 'qwen3827b',
  'Qwen 3.7 Plus': 'qwen37plus',
  'MiMo V2.6 Pro': 'mimov26pro',
  'MiMo V2.6 Flash': 'mimov26flash',
  'MiMo V2.5 Pro': 'mimov25pro',
  'MiniMax M3': 'minimaxm3',
  'Grok 4.7': 'grok47',
  'Grok 4.6': 'grok46',
  'GPT-6 Luna': 'gpt6luna',
  'GPT-6 Sol': 'gpt6sol',
  'GPT-6 Astra': 'gpt6astra',
  'GPT-5.6 Terra': 'gpt56terra',
  'Muse Spark 1.3': 'musespark13',
  'Muse Spark 1.3 Contributor': 'musespark13', // 同权重，Contributor 只是折扣档
  'Claude Opus 5.5': 'claudeopus55',
  'Claude Fable 5.1': 'claudefable51',
  'Claude Sonnet 5': 'claudesonnet5',
  'Gemini 3.8 Flash': 'gemini38flash',
  'Gemini 3.5 Flash Lite': 'gemini35flashlite',
  'Kimi K2.7 Code': 'kimik27code',
  'Step 5 Preview': 'step5preview',
  'Nemotron 3 Ultra': 'nemotron3ultra',
  'Qwen 3.6 Plus': 'qwen36plus',
  'Qwen 3.7 Max': 'qwen37max',
  'Kimi K2.6': 'kimik26',
  'MiniMax M2.7': 'minimaxm27',
  'LongCat 2.0': 'longcat20',
  'Qwen 3.6 Max Preview': 'qwen36maxpreview',
  'Gemini 3.1 Pro Preview': 'gemini31propreview',
});
// 映射存疑、需要人看一眼的（tooltip/表格会标 ⚠）
const SLUG_SUSPECT = new Set([
  'DeepSeek V4 Flash (latest)',   // AA 只实测了 Vision 变体，纯文本 Flash 借用该分数
  'Qwen 3.8 Flash',               // 疑似对应 AA 的 Qwen3.8-Flash-Next（换代/改名）
  'Qwen 3.8 Omni Flash',          // 同上
  'Muse Spark 1.3 Contributor',   // 同权重不同折扣档
  'DeepSeek V4 Flash Vision (exp)',
]);

// ---- 交集 + 统一口径重算 ----
const hits = [];
const missed = [];
// 智力口径（2026-03 起）：**CommandCode 自家 Intelligence 优先，AA 兜底**。
//   理由：CC 分数和 plan 的请求数同源、同一张榜单自洽；且 CC 覆盖 60 个模型、比 AA 的 35 个
//   多得多（AA 那份榜单压根没有 GPT-5.6 Luna / GLM-5.2 / Claude Sonnet 4.6 这些），单用 AA
//   会把一批有分的模型挡在图外。两边都有时实测 |Δ| 平均 0.25、最大 0.5，是同一把尺子
//   （CC 保留 1 位小数，AA 取整），所以混用不会引入系统性偏移。
// index 拿不到的**不丢弃**，进 rows 并标 index_pending：官方价格表里的模型就是图的主角，
// 智力只是它的一个属性。丢掉它们等于让 CommandCode 上新但还没被评分/没进 AA 的模型从榜单
// 消失——对"该跑哪个模型"这个决策，次数列（官方数据）比智力列更有用。渲染时跳过这些点
// （Y 轴没值画不上去），表格里按前 3 个 tab 的惯例显示「🆕 待更新」。
const idxStats = { cc: 0, aa: 0, pending: 0 };
for (const c of catalog) {
  const key = SLUG_OVERRIDE[c.model] ?? canonKey(c.model);
  const aa = aaBest.get(key);
  // CC 侧只走规范化，不用 SLUG_OVERRIDE——那张表用的就是 CC 自己的名字
  const ccVal = ccIntel.get(canonKey(cleanCcName(c.model))) ?? null;
  const index = ccVal ?? aa?.index ?? null;
  if (index == null) { missed.push(c.model); idxStats.pending++; } else idxStats[ccVal != null ? 'cc' : 'aa']++;
  const off = officialReq.get(c.model);
  // 免费档：价格三项全 0 且官方请求列写 Free。requests_month 留 null 表示"不限量"，
  // 绝不能写成 Infinity —— log 轴画不了无限，而且它也拿不到可比的价格轴位置。
  const isFree = off?.req_month === 'FREE'
    && c.price_in === 0 && c.price_out === 0 && c.price_cache === 0;
  if (isFree) {
    hits.push({
      model: c.model,
      free: true,
      index,
      index_pending: index == null,
      index_source: index == null ? 'pending' : (ccVal != null ? 'cc' : 'aa'),
      cc_intel: ccVal,
      aa_index: aa?.index ?? null,
      aa_model: aa?.model ?? null,
      aa_variant: aa?.variant ?? c.model,
      creator: aa?.creator ?? CREATOR_OF(c.model),
      context: ccContext.get(canonKey(cleanCcName(c.model))) ?? null,
      price_in: 0, price_out: 0, price_cache: 0,
      credit_10x: 'Free', credit_20x: c.credit_20x,
      requests_month: null, requests_5h: null, requests_week: null,
      requests_source: 'free',
      cost_per_request: 0,
      est_requests_month: null, est_vs_official: null,
      suspect_slug: false,
      contributor: false,
    });
    idxStats.free = (idxStats.free ?? 0) + 1;
    continue;
  }
  if (c.credit_10x == null || c.price_in == null || c.price_cache == null || c.price_out == null) {
    missed.push(`${c.model} (缺价格/额度)`);
    continue;
  }
  const cost = (TOKENS.input * c.price_in + TOKENS.cache * c.price_cache + TOKENS.output * c.price_out) / 1e6;
  const est = c.credit_10x / cost; // 仅对照，不参与绘图
  if (!off?.req_month) missingOfficial.push(c.model);
  hits.push({
    model: c.model,
    index,                                        // 拿不到就是 null（index_pending）
    index_pending: index == null,
    index_source: index == null ? 'pending' : (ccVal != null ? 'cc' : 'aa'),  // Y 轴到底是谁给的，tooltip 要标
    cc_intel: ccVal,
    aa_index: aa?.index ?? null,
    aa_model: aa?.model ?? null,
    aa_variant: aa?.variant ?? c.model,
    creator: aa?.creator ?? CREATOR_OF(c.model),
    context: ccContext.get(canonKey(cleanCcName(c.model))) ?? null,
    price_in: c.price_in,
    price_out: c.price_out,
    price_cache: c.price_cache,
    credit_10x: c.credit_10x,
    credit_20x: c.credit_20x,
    premium_pool: c.credit_10x === 100, // Max 10× 的 premium 子池上限 $100（standard $150）
    cost_per_request: cost,
    // ---- 绘图主口径：官方发布的请求数 ----
    requests_month: off?.req_month ?? est,          // 官方月列；官方缺失才退回自算
    requests_5h: off?.req_5h ?? null,
    requests_week: off?.req_week ?? null,
    requests_source: off?.req_month ? 'official' : 'estimated',
    requests_per_usd: (off?.req_month ?? est) / (planPrice ?? 100), // 每 $1 月费换多少次请求
    // ---- 仅对照：自己按统一 token 口径算的版本 ----
    est_requests_month: est,
    est_vs_official: off?.req_month ? est / off.req_month : null,
    // 映射存疑是"CC 名 → AA 名"这层映射的问题；走 CC 自家分数时压根没这层映射
    suspect_slug: ccVal == null && SLUG_SUSPECT.has(c.model),
    contributor: /contributor/i.test(c.model),
  });
}

// ---- 去重：同一 AA 变体保留 requests 最大的，其余记进 merged ----
const missingOfficial = [];
const groups = new Map();
for (const h of hits) {
  const k = h.aa_variant;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(h);
}
const rows = [];
const merged = [];
for (const [, arr] of groups) {
  arr.sort((a, b) => b.requests_month - a.requests_month);
  const keep = arr[0];
  if (arr.length > 1) merged.push(...arr.slice(1).map((x) => ({ model: x.model, into: keep.model, aa_variant: keep.aa_variant })));
  rows.push(keep);
}

// ---- peak 时段孪生行：把有 peak 价的模型拆成 off-peak / peak 两个条目 ----
// 官方请求数是按 off-peak 价给的；peak 时段（Pro 页：01–04 & 06–10 UTC、周一~五，35h/周）
// 价格整体乘 r，固定 credits 能跑的请求数就变成 1/r。这里用 r = peak_in / off_peak_in 做**倍率缩放**，
// 不走"credits ÷ 自算成本"——那条会带进 token 口径误差（实测自算比官方低 1%~11%），倍率缩放是精确的。
// 官方没给 peak 的 cache 价，按 input 的同一倍率缩放（实测 4 个 DeepSeek 的 in/out 都是精确 2×）。
// 注意 requests_5h / requests_week 也一并缩放：这是"整月都当 peak 打"的**保守**值，
// 真实值介于 off-peak 和它之间（peak 只占 35h/周）。
const peakTwins = [];
for (const r of rows.slice()) {
  const pk = ccPeak.get(r.aa_variant ? canonKey(cleanCcName(r.aa_variant)) : canonKey(r.model));
  const pkAlt = ccPeak.get(canonKey(cleanCcName(r.model)));
  const info = pk ?? pkAlt;
  if (!info || !r.price_in) continue;
  const ratio = info.peak_in / r.price_in;
  if (!(ratio > 1.001) || !Number.isFinite(ratio)) continue;   // 只处理真的更贵的
  r.tier = 'off-peak';
  // 两个孪生都带时段后缀，否则表格里并排两行同名、只有次数差一倍，看不出是两条不同的口径。
  // 半角括号是用户给定的写法，peak 行跟着一起统一。
  // baseName 必须先存：r.model 马上要改成 (off-peak) 版本，peak 孪生要从**原始名**派生，
  // 否则会拼出 "DeepSeek V4.1 Flash (off-peak) (peak)" 这种双后缀。
  const baseName = r.model;
  r.model = `${baseName} (off-peak)`;
  peakTwins.push({
    ...r,
    model: `${baseName} (peak)`,
    tier: 'peak',
    price_in: r.price_in * ratio,
    price_out: r.price_out * ratio,
    price_cache: r.price_cache * ratio,
    requests_month: r.requests_month / ratio,
    requests_5h: r.requests_5h == null ? null : r.requests_5h / ratio,
    requests_week: r.requests_week == null ? null : r.requests_week / ratio,
    requests_per_usd: r.requests_per_usd / ratio,
    cost_per_request: r.cost_per_request * ratio,
    peak_ratio: ratio,
    peak_window: info.window || PEAK_WINDOW_DEFAULT,
  });
  r.peak_ratio = ratio;
  r.peak_window = info.window || PEAK_WINDOW_DEFAULT;
  r.has_peak = true;
}
rows.push(...peakTwins);
if (peakTwins.length) {
  console.log(`peak 时段孪生: ${peakTwins.length} 个（官方只给 off-peak 价，按倍率 ${[...new Set(peakTwins.map((x) => x.peak_ratio))].join('/')} 拆出 peak 点）`);
  for (const x of peakTwins) console.log(`  ${x.model}  ${Math.round(x.requests_month).toLocaleString()} 次/月（off-peak 的 1/${x.peak_ratio}）· peak ${x.peak_window}`);
}
rows.sort((a, b) => a.requests_month - b.requests_month);

// ---- 代际过滤：同一族只留新一代，且必须"支配"才淘汰 ----
// 起因：Muse Spark 1.2 Contributor 和 1.3 Contributor 在官方表里次数完全相同（682K），
// 智力 1.3 更高，画两个点纯属重复。但**不能**简单按版本号取最大——那样会误杀档次：
//   DeepSeek V4 Pro（36 智力/74K 次）是唯一的 Pro 档，V4.1 只有 Flash，按版本号它会被删；
//   MiniMax M2.5（22.8/79K 次）比 M3（29.2/44K 次）次数更多，按版本号也会被删。
// 所以规则是"新一代要在**两个轴上都不差**，才允许淘汰老一代"，本质是把 Pareto 支配关系
// 限定在族内使用。副作用正好是想要的：真正的取舍点（更聪明但更贵 / 更便宜但更笨）全部保留。
const splitFamVer = (name) => {
  const m = name.match(/^(.*?)(\d+(?:\.\d+)*)(.*)$/);
  if (!m) return { fam: name, ver: null };
  return { fam: m[1].replace(/[-\s]+$/, '').trim(), ver: m[2] };
};
const vcmp = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
const fams = new Map();
for (const r of rows) {
  const { fam, ver } = splitFamVer(r.model);
  if (ver == null || r.index == null) continue;   // 无智力：无 Y 值可比较，两边都不参与
  if (!fams.has(fam)) fams.set(fam, []);
  fams.get(fam).push({ ...r, _fam: fam, _ver: ver, _tier: r.tier ?? 'off-peak' });
}
const superseded = [];
const kept = [];
for (const r of rows) {
  if (r.index == null) { kept.push(r); continue; }   // 待更新的不进代际判定
  const mine = splitFamVer(r.model);
  // 同族里有没有"更新一代、且两轴都不差"的模型？有的话这个就被它支配了
  // 支配者可能自己也被更新一代支配（Grok 4.5 ← 4.6 ← 4.7）。取版本号最高的那一个当"by"，
  // 这样提示里指的是最终留在图上的模型，而不是一个中间态。
  // tier 隔离：off-peak 和它的 peak 孪生是**同一款模型的两个时段**，不是两个档次。
  // peak 价更高 → 次数必然更少，如果允许跨 tier 比较，off-peak 会把 peak 当成"被支配的旧代"删掉。
  const myTier = r.tier ?? 'off-peak';
  const doms = mine.ver == null ? [] : (fams.get(mine.fam) ?? []).filter((o) =>
    vcmp(o._ver, mine.ver) > 0 &&
    (o._tier ?? 'off-peak') === myTier &&
    o.index >= r.index && o.requests_month >= r.requests_month &&
    (o.index > r.index || o.requests_month > r.requests_month));
  const dom = doms.length
    ? doms.reduce((a, b) => (vcmp(b._ver, a._ver) > 0 || (b._ver === a._ver && b.requests_month > a.requests_month) ? b : a))
    : null;
  if (dom) superseded.push({ model: r.model, index: r.index, requests: r.requests_month, by: dom.model });
  else kept.push(r);
}
if (superseded.length) {
  console.log(`代际过滤: ${superseded.length} 个被同族更新一代支配而移除`);
  for (const x of superseded) console.log(`  ${x.model} (智力${x.index}/${Math.round(x.requests).toLocaleString()}次) ← ${x.by}`);
}
// family/gen 要在任何按族分组的逻辑之前算好——下面的同请求数去重要按族分组，
// 顺序反了会拿到一堆 undefined 当族名，静默什么都不删。
for (const r of kept) {
  const { fam, ver } = splitFamVer(r.model);
  r.family = fam;
  r.gen = ver;
}

// ---- 同请求数去重：同族里官方月请求数**完全相同**（等价于官方给了同一个价）的多代，只留最新 ----
// Claude Opus 4.6 / 4.7 / 4.8 / 5 的官方月请求数都是 2,990（单价同为 $5/$25/$0.5），
// 四点在图上完全重合、表格里是四行一模一样的数，除了版本号没有任何区别信息 → 只留 Opus 5。
// 这和上面的支配判定是**两种**淘汰，别混：
//   支配判定比"谁在智力+次数两轴都不差"，需要智力可比，所以对 index==null 的模型无效；
//   这条只认"官方给了同一个数"，因此对还没评分的模型照样适用。
// 同代（gen 相同）的两个模型请求数撞了不动——那是同代不同档次，撞数只是巧合。
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
  const newer = arr.length > 1 ? arr.find((o) => vcmp(o.gen ?? '', r.gen ?? '') > 0) : null;
  if (newer) { sameReqDropped.push({ model: r.model, requests: r.requests_month, by: newer.model }); continue; }
  afterSameReq.push(r);
}
if (sameReqDropped.length) {
  console.log(`同请求数去重: ${sameReqDropped.length} 个（同族同价，只留最新一代）`);
  for (const x of sameReqDropped) console.log(`  ${x.model} (${Math.round(x.requests).toLocaleString()} 次/月) ← ${x.by}`);
}

const finalRows = afterSameReq.sort((a, b) => a.requests_month - b.requests_month);

const data = {
  source: SRC,
  plan: 'CommandCode Max 10×',
  price_month: 100,
  credit_standard: 150,
  credit_premium: 100,
  // 绘图主口径：官方请求数（self-estimate 仅留作对照）
  requests_source: 'official',
  est_tokens_per_request: TOKENS,
  plan_name: PLAN_NAME,
  plan_price: planPrice,
  plan_credits: planCredits,
  plan_mix_requests: planMixRequests,
  plan_mix_label: planMixLabel,
  rolling_window: { five_hour: win5h, weekly: winWeek },
  generated: new Date().toISOString().slice(0, 10),
  catalog_size: catalog.length,
  aa_intersection_raw: hits.length,
  rows: finalRows,
  merged,
  superseded,
  same_req_dropped: sameReqDropped,
  missed,
};
writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n');

console.log(`source: ${SRC}`);
console.log(`price table rows: ${catalog.length} (thead: ${head.filter(Boolean).join(' | ')})`);
console.log(`official request table: ${officialReq.size} rows (主口径)`);
console.log(`plan ${PLAN_NAME}: $${planPrice}/mo, credits $${planCredits}, 混合均值 ${planMixLabel ?? '—'}, 滚动窗口 5h $${win5h ?? '—'} / 周 $${winWeek ?? '—'}`);
if (missingOfficial.length) console.log(`⚠ AA 交集里 ${missingOfficial.length} 个模型官方无请求数（退回自算）: ${missingOfficial.join(', ')}`);
console.log(`CC Intelligence 表: ${ccIntel.size} 行（有分 ${ccScored}，not-yet-scored ${ccIntel.size - ccScored}） · AA 规范模型: ${aaBest.size}`);
console.log(`智力来源: CC ${idxStats.cc} 个 / AA 兜底 ${idxStats.aa} 个`);
console.log(`交集(去重前): ${hits.length} → AA 变体去重后: ${rows.length} → 代际过滤后: ${finalRows.length}`);
console.log(`merged into representative: ${merged.length}`, merged.map((m) => `${m.model}→${m.into}`).join(', ') || '(none)');
console.log(`未命中 AA: ${missed.length}`, missed.join(', ') || '(none)');
const scored = finalRows.filter((r) => r.index != null);
console.log(`智力区间: ${Math.min(...scored.map((r) => r.index))}–${Math.max(...scored.map((r) => r.index))}`);
console.log(`月请求区间（官方）: ${Math.round(Math.min(...finalRows.map((r) => r.requests_month))).toLocaleString()}–${Math.round(Math.max(...rows.map((r) => r.requests_month))).toLocaleString()}`);
const ratios = finalRows.map((r) => r.est_vs_official).filter((x) => x != null);
if (ratios.length) console.log(`自算 vs 官方偏差: ${(Math.min(...ratios) * 100).toFixed(0)}%–${(Math.max(...ratios) * 100).toFixed(0)}%（仅供参考，绘图用官方值）`);
console.log(`→ ${OUT}`);
