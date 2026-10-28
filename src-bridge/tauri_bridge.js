/**
 * 江山时序 Tauri 2.0 原生桥接层
 *
 * 与上游 js/app.js 暴露的 window.atlasAPI 对接，实现：
 *   - 原生菜单 / Deep Link (jiangshan://) 触发的地图跳转
 *   - 考据报告 JSON 本地导出
 *   - 上游 index.html 中 deanchen.me 绝对深链 → 应用内参数跳转
 *   - 移动端触觉反馈
 *
 * 注意：上游 window.atlasAPI 在 DOMContentLoaded 回调中才挂载（js/app.js），
 * 本脚本以 type="module" 在解析后、DOMContentLoaded 前执行，因此必须惰性读取。
 */
(function initTauriBridge() {
  // 仅在 Tauri 容器环境中激活
  if (!window.__TAURI_INTERNALS__) return;

  const invoke = (cmd, args = {}) => window.__TAURI_INTERNALS__.invoke(cmd, args);
  const api = () => window.atlasAPI;

  // 注入顶部窗口拖拽条（仅 macOS 需要）。
  // 拖拽由 Tauri 注入的 drag.js 驱动：它监听 data-tauri-drag-region 属性并调用
  // plugin:window|start_dragging；WKWebView 不实现 Chromium 的 -webkit-app-region，
  // 因此该属性才是 macOS 上真正生效的开关。
  // 仅在 macOS 注入：titleBarStyle / hiddenTitle 是 macOS 专属配置，Windows / Linux
  // 上会被静默忽略并保留原生标题栏；此时再叠一条 28px 透明拖拽条会形成双层标题栏，
  // 并吞掉该区域内的点击。
  const isMacOS = /Macintosh|Mac OS X/i.test(navigator.userAgent);
  if (isMacOS) {
    const dragBar = document.createElement('div');
    dragBar.className = 'tauri-drag-region';
    dragBar.setAttribute('data-tauri-drag-region', '');
    document.body.appendChild(dragBar);
  }

  // 检测移动端环境并挂载安全区域类名
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    document.body.classList.add('tauri-mobile');
  }

  // 1. 监听来自 Rust 原生菜单或 Deep Link (jiangshan://) 的跳转事件
  window.addEventListener('tauri://navigate-atlas', (e) => {
    const payload = e.detail;
    if (!payload) return;

    if (payload.mode === 'locate' && payload.place && api()) {
      api().locate({
        year: payload.year ?? 741,
        place: payload.place,
        zoom: payload.zoom,
      });
    } else if (payload.urlParams) {
      // 切换到指定人物行迹 (?person=sushi) 或开启寻址挑战 (?year=-121&quiz=locate)
      window.location.search = payload.urlParams;
    }
  });

  // 2. 监听原生菜单「导出当前视野历史地理元数据」指令
  window.addEventListener('tauri://export-current-inspection', async () => {
    if (!api()) return;
    const params = new URLSearchParams(window.location.search);
    const year = Number(params.get('year')) || 741;
    const place = params.get('place') || '长安';

    const report = api().inspect({ year, place });
    await invoke('save_inspection_report', {
      filename: `jiangshan_${place}_${year}.json`,
      content: JSON.stringify(report, null, 2),
    });
  });

  // 3. 上游 index.html 内的 deanchen.me 绝对深链 → 转为应用内参数跳转（离线可用）
  document.addEventListener(
    'click',
    (e) => {
      const anchor = e.target && e.target.closest && e.target.closest('a[href]');
      if (!anchor) return;

      let url;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch (_) {
        return;
      }
      if (url.hostname !== 'deanchen.me') return;

      const keep = ['year', 'place', 'person', 'journey', 'stop', 'trace', 'lang', 'quiz', 'hover'];
      const sp = new URLSearchParams();
      keep.forEach((key) => {
        if (url.searchParams.has(key)) sp.set(key, url.searchParams.get(key));
      });
      if (![...sp.keys()].length) return;

      e.preventDefault();
      window.location.search = `?${sp.toString()}`;
    },
    true
  );

  // 4. 移动端触觉反馈增强：点击控件、时间轴事件节点或古城/关隘节点时触发微震动
  // 选择器取自上游真实 DOM：事件节点为 style.css:998 的 .milestone-pin，
  // 古城/关隘为 style.css:1526 的 .settlement-node（两者均由 js/app.js 动态创建）。
  if (isMobile) {
    document.addEventListener(
      'pointerdown',
      (e) => {
        const target =
          e.target.closest && e.target.closest('button, .milestone-pin, .settlement-node');
        if (target) {
          invoke('plugin:haptics|impact_feedback', { style: 'light' }).catch(() => {});
        }
      },
      { passive: true }
    );
  }

  console.log('[Tauri Bridge] 江山时序原生增强层已就绪，已绑定 window.atlasAPI');
})();
