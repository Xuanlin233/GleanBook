# 安全说明

## 报告漏洞

请不要在公开 Issue 中披露安全问题。请通过 GitHub 仓库的 **Security → Report a vulnerability**（私密漏洞报告）联系维护者，并附上复现步骤与影响范围。

## 设计边界

- 本项目面向**个人自托管**：单用户、单实例后端，网站口令用于保护本机后端的私人接口。
- 推荐只在本机或私有网络（如 Tailscale）中访问；如需公网部署，请务必使用 HTTPS、强随机口令，并阅读 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。
- OKX 集成只接受**仅 Read 权限**的 API Key，带交易或提币权限的 Key 会被拒绝；所有请求均为 GET。
- 凭证保存在系统自带的密钥存储中：Windows 用 DPAPI（当前用户范围），macOS 用登录钥匙串，Linux 用 Secret Service（`secret-tool`）。密钥只经标准输入传给这些系统工具，不出现在命令行参数里。能以你的系统账户身份运行程序的人理论上可以读取，请保持系统安全。
- 账本、主库文件与 JSON 备份未加密，请依靠设备锁与可信存储保护。
