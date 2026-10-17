# 安全说明

## 报告漏洞

请不要在公开 Issue 中披露安全问题。请通过 GitHub 仓库的 **Security → Report a vulnerability**（私密漏洞报告）联系维护者，并附上复现步骤与影响范围。

## 设计边界

- 本项目面向**个人自托管**：单用户、单实例后端，网站口令用于保护本机后端的私人接口。
- 推荐只在本机或私有网络（如 Tailscale）中访问；如需公网部署，请务必使用 HTTPS、强随机口令，并阅读 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。
- OKX 集成只接受**仅 Read 权限**的 API Key，带交易或提币权限的 Key 会被拒绝；所有请求均为 GET。
- Windows 上的凭证用 DPAPI（当前用户范围）加密保存；能以你的 Windows 账户身份运行程序的人理论上可以解密，请保持系统安全。
- 账本、主库文件与 JSON 备份未加密，请依靠设备锁与可信存储保护。
