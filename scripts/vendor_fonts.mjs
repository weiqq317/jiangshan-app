#!/usr/bin/env node
/**
 * 把上游依赖的 Google Fonts 本地化到 src-bridge/fonts/，并生成 src-bridge/tauri_fonts.css。
 *
 * 背景：上游 index.html 直接 <link> 到 fonts.googleapis.com。Tauri 的 CSP 为
 * style-src 'self'、font-src 回落 default-src 'self'，因此远程字体在离线 App 中
 * 无论联网与否都会被拦截，导致 --serif-stack / --sans-stack / --calligraphy-stack
 * 全部回退到系统字体。本脚本抓取 Google 实际下发（Chrome UA → woff2）的
 * @font-face 声明与分片文件，改写为本地相对路径，实现离线自包含。
 *
 * 产物：src-bridge/fonts/*.woff2、src-bridge/tauri_fonts.css（url 指向 ../assets/fonts/）。
 * prepare_dist.mjs 会把二者分别复制到 dist/assets/fonts/ 与 dist/css/。
 *
 * 重新执行：npm run vendor:fonts（上游变更字体版本或字重时需要重跑）。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FONT_DIR = path.join(ROOT, 'src-bridge', 'fonts');
const CSS_OUT = path.join(ROOT, 'src-bridge', 'tauri_fonts.css');

/** Chrome UA：Google Fonts 只在现代 UA 下下发 woff2，否则会退化为 ttf */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** 与上游 index.html 第 307-310 行逐字对应的字体请求 */
const REQUESTS = [
  {
    name: 'noto-serif-sans-sc',
    url: 'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600;700&family=Noto+Sans+SC:wght@400;500&display=swap',
  },
  {
    name: 'ma-shan-zheng',
    url: 'https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&text=%20%26%27CDEFHJKMNPQRSTWYabcdefghilmnoprstuvxy%E4%B8%89%E4%B8%9C%E4%B8%AD%E4%BA%94%E4%BA%BA%E4%BB%A3%E5%85%83%E5%85%AD%E5%85%B1%E5%8C%97%E5%8D%81%E5%8D%8E%E5%8D%97%E5%92%8C%E5%94%90%E5%9B%BD%E5%AE%8B%E5%B1%B1%E5%BA%8F%E6%88%98%E6%97%B6%E6%98%8E%E6%99%8B%E6%9C%9D%E6%B0%91%E6%B1%89%E6%B1%9F%E6%B8%85%E7%A7%A6%E8%A5%BF%E9%9A%8B&display=swap',
  },
];

/**
 * Google 下发两种字体 URL：
 *   /s/<family>/<version>/<hash>.woff2        按 unicode-range 切分的分片
 *   /l/font?kit=<hash>&skey=…&v=v18           带 text= 参数时的按需子集（无扩展名）
 */
const FONT_URL = /https:\/\/fonts\.gstatic\.com\/[^)'"]+/g;

async function get(url, asText = false) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} ← ${url}`);
  return asText ? res.text() : Buffer.from(await res.arrayBuffer());
}

/** 分片用其原始文件名（可读、稳定）；按需子集无扩展名，按请求名 + 序号命名 */
function makeNamer() {
  const byUrl = new Map();
  const used = new Map();
  return (url, family) => {
    if (byUrl.has(url)) return byUrl.get(url);
    const tail = url.split('?')[0].split('/').pop();
    const stem = tail && tail.endsWith('.woff2') ? tail.slice(0, -6) : `${family}-subset`;
    let name = `${stem}.woff2`;
    for (let i = 2; used.has(name); i += 1) name = `${stem}-${i}.woff2`;
    used.set(name, url);
    byUrl.set(url, name);
    return name;
  };
}

async function main() {
  fs.rmSync(FONT_DIR, { recursive: true, force: true });
  fs.mkdirSync(FONT_DIR, { recursive: true });

  const nameFor = makeNamer();
  const downloaded = new Map();
  const cssParts = [];

  for (const req of REQUESTS) {
    const css = await get(req.url, true);
    const urls = [...new Set(css.match(FONT_URL) || [])];
    if (!urls.length) throw new Error(`未从 ${req.name} 的 CSS 中解析出字体文件，Google 可能改版`);

    // 串行分批下载，避免触发限流
    for (let i = 0; i < urls.length; i += 12) {
      await Promise.all(
        urls.slice(i, i + 12).map(async (u) => {
          if (downloaded.has(u)) return;
          const name = nameFor(u, req.name);
          fs.writeFileSync(path.join(FONT_DIR, name), await get(u));
          downloaded.set(u, name);
        })
      );
    }

    cssParts.push(
      `/* ${req.name} — 源：${req.url} */\n` +
        css.replace(FONT_URL, (u) => `../assets/fonts/${downloaded.get(u)}`).trim()
    );
    console.log(`[vendor_fonts] ${req.name}: ${urls.length} 个字体文件`);
  }

  const header =
    '/* 由 scripts/vendor_fonts.mjs 生成，请勿手改。\n' +
    '   Google Fonts 本地化副本：Tauri CSP 为 style-src/font-src \'self\'，远程字体一律被拦截。\n' +
    '   重新生成：npm run vendor:fonts */\n\n';

  fs.writeFileSync(CSS_OUT, header + cssParts.join('\n\n') + '\n', 'utf-8');

  const bytes = fs
    .readdirSync(FONT_DIR)
    .reduce((sum, f) => sum + fs.statSync(path.join(FONT_DIR, f)).size, 0);
  console.log(
    `[vendor_fonts] 共 ${downloaded.size} 个 woff2，合计 ${(bytes / 1024 / 1024).toFixed(2)} MB\n` +
      `[vendor_fonts] 已写出 ${path.relative(ROOT, CSS_OUT)}`
  );
}

main().catch((err) => {
  console.error(`[vendor_fonts] 失败：${err.message}`);
  process.exit(1);
});
