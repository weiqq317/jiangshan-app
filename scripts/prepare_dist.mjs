#!/usr/bin/env node
/**
 * 组装 dist/：把 upstream/ 的上游静态资源复制过来，并在不修改上游文件的前提下
 * 向 dist/index.html 注入 Tauri 桥接脚本与多端适配样式。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const UPSTREAM = path.join(ROOT, 'upstream');
const DIST = path.join(ROOT, 'dist');
const AUDIO_SRC = path.join(ROOT, 'src-bridge', 'audio');
const AUDIO_MANIFEST = path.join(AUDIO_SRC, 'manifest.json');

/** 需要复制到 dist 的上游条目（geojson/ 仅含演示页与独立脚本，离线 App 不使用） */
const ITEMS_TO_COPY = [
  'index.html',
  'manifest.webmanifest',
  'llms.txt',
  'css',
  'js',
  'assets',
  'topics',
];

/** 离线环境下必然失败的外部分析脚本（CSP 为 'self'），注入前剔除 */
const EXTERNAL_ANALYTICS =
  /^[ \t]*<script[^>]*src="https:\/\/(?:events\.vercount\.one|static\.cloudflareinsights\.com)[^"]*"[^>]*>\s*<\/script>[ \t]*\r?\n?/gm;

/**
 * 自检判据：任何指向外部站点的 <script src> 在 CSP 'self' 下都会被拒绝，属离线致命项。
 * 刻意不复用 EXTERNAL_ANALYTICS —— 否则「剔除漏网」与「自检看不见」会同时发生（循环论证），
 * 例如上游改用单引号 src 时，剔除与自检会一起失效。此处只认结构特征。
 */
const EXTERNAL_SCRIPT_SRC = /<script[^>]*\bsrc\s*=\s*["']https?:\/\//gi;

/**
 * 上游 <head> 中的 Google Fonts 外链（2 个 preconnect + 2 个 stylesheet）。
 * CSP 为 style-src 'self'、font-src 回落 default-src 'self'，远程字体一律被拦截，
 * 故在 dist 阶段整段剔除，改由本地 tauri_fonts.css + assets/fonts/ 提供同族字体。
 */
const EXTERNAL_FONT_LINK =
  /^[ \t]*<link[^>]*href="https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^"]*"[^>]*>[ \t]*\r?\n?/gm;

/** 与上者配对的独立自检判据：只认「<link href 指向 fonts 域名」这一结构特征，故意不限定引号与属性顺序 */
const EXTERNAL_FONT_LINK_ANY =
  /<link[^>]*\bhref\s*=\s*["'][^"']*fonts\.(?:googleapis|gstatic)\.com/gi;

/**
 * 古琴音频自检判据：只认「指向 Wikimedia 媒体库的结构特征」。
 * 改写走的是 manifest.json 的逐条精确替换，两者机制不同，不构成循环论证。
 */
const REMOTE_MEDIA_URL = /https:\/\/upload\.wikimedia\.org\/[^"'\\\s]+/g;

/** 统计目录体积，便于核对产物完整性 */
function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

function main() {
  if (!fs.existsSync(path.join(UPSTREAM, 'index.html'))) {
    throw new Error('未找到 upstream/index.html，请先执行 npm run fetch:upstream');
  }

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  const copied = [];
  for (const item of ITEMS_TO_COPY) {
    const srcPath = path.join(UPSTREAM, item);
    if (!fs.existsSync(srcPath)) continue;
    fs.cpSync(srcPath, path.join(DIST, item), { recursive: true });
    copied.push(item);
  }

  fs.copyFileSync(
    path.join(ROOT, 'src-bridge', 'tauri_override.css'),
    path.join(DIST, 'css', 'tauri_override.css')
  );
  fs.copyFileSync(
    path.join(ROOT, 'src-bridge', 'tauri_fonts.css'),
    path.join(DIST, 'css', 'tauri_fonts.css')
  );
  fs.copyFileSync(
    path.join(ROOT, 'src-bridge', 'tauri_bridge.js'),
    path.join(DIST, 'js', 'tauri_bridge.js')
  );

  // Google Fonts 本地化副本（由 npm run vendor:fonts 生成），供 tauri_fonts.css 以
  // ../assets/fonts/ 相对路径引用
  fs.cpSync(
    path.join(ROOT, 'src-bridge', 'fonts'),
    path.join(DIST, 'assets', 'fonts'),
    { recursive: true }
  );

  // 古琴音频本地化（由 npm run vendor:audio 生成）。CSP 的 media-src 'self' 会拦截
  // upload.wikimedia.org，故必须把 5 首曲目落到本地并改写 lore_data.js 中的远端地址。
  // 受限网络下该目录可能缺失（仅影响曲目播放，不影响其余功能），此时跳过改写并告警。
  const hasAudio = fs.existsSync(AUDIO_MANIFEST);
  let audioCount = 0;
  let rewrittenAudio = 0;
  if (hasAudio) {
    const manifest = JSON.parse(fs.readFileSync(AUDIO_MANIFEST, 'utf-8'));
    fs.cpSync(AUDIO_SRC, path.join(DIST, 'assets', 'audio'), {
      recursive: true,
      filter: (src) => path.basename(src) !== 'manifest.json',
    });

    const lorePath = path.join(DIST, 'js', 'lore_data.js');
    let lore = fs.readFileSync(lorePath, 'utf-8');
    // 按 URL 长度降序替换：transcoded/*.mp3 与源 *.ogg 互为不同路径，降序可避免短串抢先命中
    for (const [remote, local] of Object.entries(manifest).sort(
      (a, b) => b[0].length - a[0].length
    )) {
      const hit = lore.split(remote).length - 1;
      if (hit) {
        lore = lore.split(remote).join(local);
        rewrittenAudio += hit;
      }
    }
    fs.writeFileSync(lorePath, lore, 'utf-8');
    audioCount = Object.keys(manifest).length;
  }

  const indexPath = path.join(DIST, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf-8');

  const removedAnalytics = (html.match(EXTERNAL_ANALYTICS) || []).length;
  html = html.replace(EXTERNAL_ANALYTICS, '');

  const removedFontLinks = (html.match(EXTERNAL_FONT_LINK) || []).length;
  html = html.replace(EXTERNAL_FONT_LINK, '');

  if (!html.includes('</head>') || !html.includes('</body>')) {
    throw new Error('dist/index.html 缺少 </head> 或 </body> 注入锚点，注入中止');
  }

  if (!html.includes('tauri_fonts.css')) {
    html = html.replace(
      '</head>',
      '  <link rel="stylesheet" href="css/tauri_fonts.css">\n</head>'
    );
  }

  if (!html.includes('tauri_override.css')) {
    html = html.replace(
      '</head>',
      '  <link rel="stylesheet" href="css/tauri_override.css">\n</head>'
    );
  }

  if (!html.includes('tauri_bridge.js')) {
    html = html.replace(
      '</body>',
      '  <script type="module" src="js/tauri_bridge.js"></script>\n</body>'
    );
  }

  fs.writeFileSync(indexPath, html, 'utf-8');

  // 产物自检：任一断言失败即中断构建，避免发出没有桥接层、或仍引用外部分析脚本的包。
  // 该检查同时保护本地 dev/build 与 CI（beforeBuildCommand 会走同一条路径）。
  const finalHtml = fs.readFileSync(indexPath, 'utf-8');
  const fontFiles = fs.existsSync(path.join(DIST, 'assets', 'fonts'))
    ? fs.readdirSync(path.join(DIST, 'assets', 'fonts')).filter((f) => f.endsWith('.woff2')).length
    : 0;
  const lorePath = path.join(DIST, 'js', 'lore_data.js');
  const finalLore = fs.existsSync(lorePath) ? fs.readFileSync(lorePath, 'utf-8') : '';
  const residualMedia = (finalLore.match(REMOTE_MEDIA_URL) || []).length;
  const audioFiles = fs.existsSync(path.join(DIST, 'assets', 'audio'))
    ? fs.readdirSync(path.join(DIST, 'assets', 'audio')).filter((f) =>
        /\.(mp3|ogg|m4a|wav)$/i.test(f)
      ).length
    : 0;
  const checks = [
    ['index.html 引用了桥接脚本', finalHtml.includes('js/tauri_bridge.js')],
    ['index.html 引用了适配样式', finalHtml.includes('css/tauri_override.css')],
    ['index.html 引用了本地字体样式', finalHtml.includes('css/tauri_fonts.css')],
    ['index.html 无残留外部脚本引用', (finalHtml.match(EXTERNAL_SCRIPT_SRC) || []).length === 0],
    ['index.html 无残留远程字体外链', (finalHtml.match(EXTERNAL_FONT_LINK_ANY) || []).length === 0],
    ['dist/js/tauri_bridge.js 已就位', fs.existsSync(path.join(DIST, 'js', 'tauri_bridge.js'))],
    ['dist/css/tauri_override.css 已就位', fs.existsSync(path.join(DIST, 'css', 'tauri_override.css'))],
    ['dist/css/tauri_fonts.css 已就位', fs.existsSync(path.join(DIST, 'css', 'tauri_fonts.css'))],
    [`dist/assets/fonts 字体分片已就位（${fontFiles} 个）`, fontFiles > 0],
    ['dist/js/app.js 已就位', fs.existsSync(path.join(DIST, 'js', 'app.js'))],
  ];
  // 仅在音频已完成本地化时断言：缺 manifest 属「未抓取」而非「改写失效」，
  // 由下方告警提示，避免受限网络下无法构建
  if (hasAudio) {
    checks.push(
      [`dist/assets/audio 古琴音频已就位（${audioFiles} 个）`, audioFiles === audioCount],
      [`dist/js/lore_data.js 音频地址已全部本地化（改写 ${rewrittenAudio} 处）`, rewrittenAudio > 0],
      ['dist/js/lore_data.js 无残留远程音频地址', residualMedia === 0]
    );
  }
  const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length) {
    throw new Error(`产物自检未通过：${failed.join('；')}`);
  }

  const sizeMB = (dirSize(DIST) / 1024 / 1024).toFixed(2);
  console.log(
    `[prepare_dist] 已组装 ${copied.length} 个上游条目到 dist/：${copied.join(', ')}\n` +
      `[prepare_dist] 注入 tauri_fonts.css + tauri_override.css + tauri_bridge.js\n` +
      `[prepare_dist] 剔除 ${removedAnalytics} 个外部分析脚本、${removedFontLinks} 处远程字体外链\n` +
      `[prepare_dist] 古琴音频：${
        hasAudio
          ? `已本地化 ${audioCount} 个文件、改写 ${rewrittenAudio} 处地址`
          : '未本地化（缺 src-bridge/audio/manifest.json）'
      }\n` +
      `[prepare_dist] 产物自检 ${checks.length}/${checks.length} 通过\n` +
      `[prepare_dist] dist/ 总体积 ${sizeMB} MB`
  );

  if (!hasAudio) {
    console.warn(
      '[prepare_dist] 警告：未发现古琴音频清单，5 首曲目在离线包中将无法播放。\n' +
        '               请在可访问 upload.wikimedia.org 的网络下执行 npm run vendor:audio 后重新构建。'
    );
  }
}

try {
  main();
} catch (err) {
  console.error(`[prepare_dist] 失败：${err.message}`);
  process.exit(1);
}
