#!/usr/bin/env node
/**
 * 把上游依赖的 Wikimedia 古琴录音本地化到 src-bridge/audio/，并生成路径清单。
 *
 * 背景：upstream/js/lore_data.js 的 GUQIN_TRACKS 直接指向 upload.wikimedia.org。
 * Tauri 的 CSP 为 media-src 'self' data: blob:，远程音频在离线 App 中一律被拦截，
 * 因此 5 首古琴曲目在桌面端完全不可用。本脚本把音频落到本地，由 prepare_dist.mjs
 * 据此改写 dist/js/lore_data.js 中的 URL。
 *
 * 产物：src-bridge/audio/*.{mp3,ogg}、src-bridge/audio/manifest.json（原始 URL → 本地相对路径）。
 *
 * 用法：
 *   npm run vendor:audio             抓取并落地
 *   npm run vendor:audio -- --dry-run  仅解析并打印映射，不联网、不写文件
 *
 * 注意：需要能访问 upload.wikimedia.org 的网络环境。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const LORE_JS = path.join(ROOT, 'upstream', 'js', 'lore_data.js');
const AUDIO_DIR = path.join(ROOT, 'src-bridge', 'audio');
const MANIFEST = path.join(AUDIO_DIR, 'manifest.json');

const DRY_RUN = process.argv.includes('--dry-run');

/** 上游 GUQIN_TRACKS 中的远程音频地址 */
const REMOTE_MEDIA = /https:\/\/upload\.wikimedia\.org\/[^"'\\\s]+/g;

const UA = 'jiangshan-app-fetch/1.0 (+https://github.com/DeanChensj/jiangshan-map)';

/** 校验落盘内容确为音频容器，避免把 HTML 错误页或代理占位页写成本地音频 */
function assertAudio(name, buf) {
  const isOgg = buf.subarray(0, 4).toString('latin1') === 'OggS';
  const isMp3 =
    buf.subarray(0, 3).toString('latin1') === 'ID3' ||
    (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
  if (!isOgg && !isMp3) {
    throw new Error(`${name} 内容不是音频（OggS/ID3 均未命中，前 8 字节：${buf.subarray(0, 8).toString('hex')}）`);
  }
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA } });
  if (!res.ok || !res.body) throw new Error(`下载失败：HTTP ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error(`下载内容为空：${url}`);
  assertAudio(path.basename(dest), buf);
  fs.writeFileSync(dest, buf);
  return buf.length;
}

/** 从上游数据文件解析出全部远程音频地址，保持首次出现顺序 */
function collectUrls() {
  if (!fs.existsSync(LORE_JS)) {
    throw new Error(`未找到 ${path.relative(ROOT, LORE_JS)}，请先执行 npm run fetch:upstream`);
  }
  return [...new Set(fs.readFileSync(LORE_JS, 'utf-8').match(REMOTE_MEDIA) || [])];
}

/** 用 URL 末段做文件名，冲突则追加序号 */
function buildMapping(urls) {
  const used = new Set();
  const mapping = {};
  for (const url of urls) {
    const tail = decodeURIComponent(url.split('/').pop() || '');
    if (!tail) throw new Error(`无法从 URL 推导文件名：${url}`);
    let name = tail;
    for (let i = 2; used.has(name); i += 1) name = `${i}-${tail}`;
    used.add(name);
    mapping[url] = `assets/audio/${name}`;
  }
  return mapping;
}

async function main() {
  const urls = collectUrls();
  if (!urls.length) {
    throw new Error('未从 lore_data.js 解析出远程音频地址，上游数据结构可能已变更');
  }
  const mapping = buildMapping(urls);

  if (DRY_RUN) {
    console.log(`[vendor_audio] dry-run：解析到 ${urls.length} 个远程音频地址`);
    for (const [url, local] of Object.entries(mapping)) {
      console.log(`  ${url}\n    → ${local}`);
    }
    return;
  }

  fs.rmSync(AUDIO_DIR, { recursive: true, force: true });
  fs.mkdirSync(AUDIO_DIR, { recursive: true });

  let total = 0;
  for (const [url, local] of Object.entries(mapping)) {
    const size = await download(url, path.join(AUDIO_DIR, path.basename(local)));
    total += size;
    console.log(`[vendor_audio] ${path.basename(local)} (${(size / 1024 / 1024).toFixed(2)} MB)`);
  }

  fs.writeFileSync(MANIFEST, `${JSON.stringify(mapping, null, 2)}\n`, 'utf-8');
  console.log(
    `[vendor_audio] 共 ${Object.keys(mapping).length} 个音频，合计 ${(total / 1024 / 1024).toFixed(2)} MB\n` +
      `[vendor_audio] 已写出 ${path.relative(ROOT, MANIFEST)}`
  );
}

main().catch((err) => {
  console.error(`[vendor_audio] 失败：${err.message}`);
  console.error('请确认可访问 upload.wikimedia.org 后重试。');
  process.exit(1);
});
