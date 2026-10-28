# 江山时序 · Chronicles of the Realm — Tauri 2.0 客户端

基于上游开源项目 [DeanChensj/jiangshan-map](https://github.com/DeanChensj/jiangshan-map) 的非侵入式封装工程：
保持上游静态源码零改动，通过 `scripts/prepare_dist.mjs` 组装 `dist/` 并注入 Tauri 原生桥接层。

## 构建

```bash
export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"   # 本机 Rust 工具链不在默认 PATH
npm install
npm run fetch:upstream    # 拉取上游 main 快照到 upstream/（不入版本库）
npm run prepare:dist      # 组装到 dist/
npm run dev               # 开发预览（tauri dev）
npm run build             # 生产打包
```

上游快照版本记录于 `upstream/.upstream-version.json`（含 commit SHA）。

## 目录说明

| 路径 | 职责 |
| --- | --- |
| `upstream/` | 上游静态源码快照（`.gitignore`，由 `fetch:upstream` 生成） |
| `scripts/` | 上游快照拉取与 `dist/` 组装注入 |
| `src-bridge/` | 前端原生桥接层与多端适配样式 |
| `src-tauri/` | Rust 后端（原生菜单、Deep Link、考据报告导出） |

## 许可与合规

- 本封装工程（含 `src-tauri/`、`src-bridge/`）以 **GPL-3.0-only** 分发，详见 [LICENSE](LICENSE)；分发二进制时必须同步公开完整构建源码。
- **数据声明**：源自 CHGIS V6（复旦大学 / 哈佛燕京学社）与 Robert M. Hartwell 历史 GIS 的州郡政区边界与疆域数据**仅限学术与非商业用途**，不得接入付费墙、商业广告或应用内购。
- **致谢**：谭其骧主编《中国历史地图集》、CHGIS、[aourednik/historical-basemaps](https://github.com/aourednik/historical-basemaps)（GPL-3.0）、Wikimedia Commons 古琴录音。
- **免责提示**：历史疆域轮廓与州郡政区边界为示意性近似，非精确现代测绘边界。
