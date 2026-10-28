# 第三方数据、素材与开源协议声明

本文件随《江山时序》桌面客户端（Tauri 封装）一同分发，用于保留上游工程
[DeanChensj/jiangshan-map](https://github.com/DeanChensj/jiangshan-map) 的致谢与数据来源声明。
上游快照的 commit SHA 记录于 CI 构建产物的 Release 说明中。

## 数据来源

- **历史疆域与政区参考**：谭其骧主编《中国历史地图集》、**CHGIS**（哈佛燕京学社与复旦大学中国历史地理信息系统）、**Robert M. Hartwell** 历史 GIS 数据集，以及
  [aourednik/historical-basemaps](https://github.com/aourednik/historical-basemaps)（GPL-3.0）。
- **现代省界参考**：DataV GeoAtlas 开放行政边界数据。
- **古琴雅乐录音**：Wikimedia Commons 公有领域古琴录音（《流水》《平沙落雁》《阳关三叠》《醉渔唱晚》《酒狂》）。

## 字体

- **Noto Serif SC / Noto Sans SC / Ma Shan Zheng**：Google Fonts，采用 SIL Open Font License 1.1。
  桌面客户端以本地化副本形式随包分发（`assets/fonts/`），以满足离线运行与内容安全策略要求。

## 开源协议

- 本工程采用 **GPL-3.0-only**，详见 [LICENSE](./LICENSE)。Copyright © 2026 DeanChensj。
- **例外**：源自 CHGIS V6 与 Hartwell China Historical GIS 的府州郡政区边界及战国疆域数据，
  仍受其原始条款约束（**仅限学术、非商业用途**），不适用 GPL-3.0。
- 本客户端不含付费墙、广告或内购。

## 免责提示

地图中的**历史疆域轮廓与州郡政区边界为示意性近似**，旨在直观呈现各时期大致统治与管辖范围，
**非精确现代测绘边界**，不可用于任何测绘、领土主张或法律用途。
