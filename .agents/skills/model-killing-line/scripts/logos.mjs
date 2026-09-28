// logos.mjs — skill 自带 lab logo（designarena model-logos，见 ../logos/）
//
// 模型 → logo 文件名的前缀映射 + data URI 内联。输出物（chart.svg / index.html）
// 均为单文件：图片以 base64 data URI 直接嵌入，不再需要输出目录下的 logos/ 文件夹。
// 未命中映射的模型返回 null，调用方回退到字母 logo（render.mjs 的 logoOf）。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOGO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'logos');

export const logoFileOf = (m) => {
  // 分隔符先归一化：三家给同一个模型的写法不一样——
  //   MiMo  V2.6 Flash (CommandCode)  |  MiMo-V2.6  (AA)
  //   Tencent Hy3   (CommandCode)    |  hy3        (TB)
  // 直接 startsWith('mimo-') / startsWith('hy3') 就会漏掉 CommandCode 那一侧，
  // 表现为同一模型在 AA tab 有 logo、在 CommandCode tab 退化成实心小圆点。
  // 所以把空格/连字符/下划线都压成 '-' 再匹配前缀，规则本身保持可读。
  const s = m.toLowerCase().replace(/[\s_]+/g, '-');
  if (s.startsWith('gpt-')) return 'chatgptlogo.png';
  if (s.startsWith('gemini')) return 'gemini-sparkle.png';
  if (s.startsWith('claude')) return 'anthropic-1.svg';
  if (s.startsWith('glm-')) return 'zai-org.svg';
  if (s.startsWith('kimi')) return 'moonshot.png';
  if (s.startsWith('grok')) return 'grokLogoTransparent.svg';
  if (s.startsWith('qwen')) return 'qwenlogo.png';
  if (s.startsWith('deepseek')) return 'deepseek-transparent.png';
  if (s.startsWith('muse')) return 'metalogo.png';
  if (s.startsWith('mimo-')) return 'xiaomi-logo.png';
  if (s.startsWith('minimax')) return 'minimax.png';
  if (s.startsWith('hy3') || s.startsWith('tencent-hy')) return 'tencent.png';
  if (s.startsWith('inkling')) return 'thinkingmachines-logo.png';
  if (s.startsWith('nemotron')) return 'nvidialogo.png';
  if (s.startsWith('step')) return 'stepfun.png';
  return null;
};

// TBench 榜的模型名不带品牌前缀（`Fable 5.1` / `Opus 5` / `GLM-5.3`…），
// 但有 model_org 列——按 org 选 logo 更可靠；DS/AA 行没有 model_org，回退到上方前缀匹配。
export const ORG_LOGO_FILE = Object.freeze({
  'OpenAI': 'chatgptlogo.png',
  'Anthropic': 'anthropic-1.svg',
  'Google': 'gemini-sparkle.png',
  'Z.ai': 'zai-org.svg',
  'xAI': 'grokLogoTransparent.svg',
});

/** 榜单行 → logo 文件名：有 model_org 先用 org 映射，否则按模型名前缀匹配 */
export const logoFileOfRow = (row) =>
  (row.model_org && ORG_LOGO_FILE[row.model_org]) || logoFileOf(row.model);

const MIME = { '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

const cache = new Map();
export const logoUriOf = (file) => {
  if (!cache.has(file)) {
    const buf = readFileSync(path.join(LOGO_DIR, file));
    const mime = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    cache.set(file, `data:${mime};base64,${buf.toString('base64')}`);
  }
  return cache.get(file);
};

/** 模型名 → 内联 data URI（无映射时返回 null） */
export const logoUriForModel = (m) => {
  const f = logoFileOf(m);
  return f ? logoUriOf(f) : null;
};
