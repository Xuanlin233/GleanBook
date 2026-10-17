# 更新日志 / Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
Format based on Keep a Changelog; versions follow Semantic Versioning.

## [未发布 / Unreleased]

## [0.1.0] - 2026-10-17

首个开源版本。/ First open-source release.

### 功能 / Features

- 日常记账：收入、支出、转账、退款，多币种账户（CNY / USD / HKD / EUR / USDT / USDC），跨币种转账显示实际汇率与溢价；月度与分类预算。
- 投资：6 位代码公募基金正式净值（基金公司官网 → 东方财富 → 新浪，免费）、OKX 现货行情、OKX 只读 API 导入余额；移动加权平均成本与已实现 / 未实现收益。
- 自动汇率：人民币中间价，USDT / USDC 按 OKX 实际价格。
- 定投：账户或持仓作为来源，定额或定份额，精确到分钟，可跳过法定节假日。
- 订阅：到期自动记支出。
- 净资产趋势：今日分时、7 / 30 / 90 天与自定义范围。
- 多设备同步：电脑主库 + 各设备离线副本，记录级合并，主库每日备份。
- PWA：可添加到 iPhone 主屏幕离线使用；浅色 / 深色主题。
- 中英双语界面，按浏览器语言自动选择，可在设置中切换。
- 凭证加密保存：Windows DPAPI、macOS 钥匙串、Linux Secret Service（`secret-tool`）。
- 开机自动启动：Windows 启动文件夹、macOS LaunchAgent、Linux systemd 用户服务。
- `http://localhost:8787/?demo` 直接打开演示账本。

### 已知限制 / Known limitations

- macOS 钥匙串、Linux Secret Service 和对应的开机自启动已有单元测试，但尚未在真机上验证，欢迎反馈。
- 后端与启动器的终端提示、`docs/` 下的详细文档目前只有中文。
- 只接入了 OKX 一家交易所；行情、基金、节假日与汇率数据源以中国大陆为主。

[未发布 / Unreleased]: https://github.com/Xuanlin233/GleanBook/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Xuanlin233/GleanBook/releases/tag/v0.1.0
