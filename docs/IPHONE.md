# 在 iPhone 上使用拾账（主屏幕 App + 电脑主库同步）

## 工作方式

```
iPhone 主屏幕「拾账」 ──Tailscale 加密──▶ 电脑上的网站（npm run start:private）
         │                                        │
   本机离线副本                              电脑主库 ~/GleanbookData/ledger.json
```

- 电脑上的主库是唯一的账本。电脑浏览器和 iPhone 记的账都汇总到这里，两边看到的是同一本。
- 每台设备都保留一份离线副本：连不上电脑时照常记账，顶栏显示“未连电脑 · N 条待同步”，连上后自动合并（打开 App、回到前台、记账后，以及每 30 秒）。
- 主库文件夹：默认是用户目录下的 `GleanbookData`（如 `C:\Users\你的用户名\GleanbookData`）；想放到其他盘，在项目 `.env` 写 `GLEANBOOK_DATA_DIR=D:\GleanbookData`
  - `ledger.json`：当前主库
  - `ledger.prev.json`：上一次写入前的版本
  - `backups\ledger-YYYY-MM-DD.json`：每天第一次写入前的备份，保留 60 天
- Tailscale 个人版免费，设备数不限；iPhone 与 Windows 客户端都免费。地址只有你自己登录同一账号的设备能打开，不对公网开放。

## 一、电脑端（只需做一次）

1. 安装 Tailscale for Windows：<https://tailscale.com/download/windows>，然后**登录**（未登录时 `tailscale serve` 会提示 `logged out`）：
   - Tailscale 的登录服务在海外；如果所在网络打不开登录页，可临时开启代理再登录；
   - 点任务栏右下角的 Tailscale 图标 → **Log in**，或在 PowerShell 运行 `tailscale up`，在弹出的网页里用 Google / Microsoft / Apple / GitHub 账号登录；
   - 运行 `tailscale status`，看到本机名和 `100.x.x.x` 地址即登录成功。
   - 若提示找不到 `tailscale` 命令，用完整路径，例如 `"C:\Program Files\Tailscale\tailscale.exe" up`。
2. 打开管理后台 <https://login.tailscale.com/admin/dns>：
   - 确认 **MagicDNS** 已开启；
   - 在 **HTTPS Certificates** 处点 **Enable HTTPS**。
3. 在 PowerShell 运行（让 Tailscale 把本机 8787 端口以 HTTPS 提供给你的设备，开机后自动保持）：

   ```powershell
   tailscale serve --bg 8787
   ```

   输出里的 `https://<电脑名>.<一串字母>.ts.net` 就是手机要打开的地址。以后用 `tailscale serve status` 查看，`tailscale serve --https=443 off` 关闭。

4. 启动网站：

   ```powershell
   cd <项目文件夹>
   npm run start:private
   ```

   启动日志会显示“手机（已连 Tailscale）打开 https://….ts.net”和电脑主库位置。启动脚本会自动信任这个地址；如未检测到，可在 `.env` 写 `GLEANBOOK_PUBLIC_ORIGIN=https://….ts.net`。

5. 电脑浏览器打开 <http://localhost:8787> → 点顶栏状态标签（或 设置 → 数据连接 → 多设备同步）→ 输入后端访问口令登录。**电脑浏览器里原有的账本会在第一次同步时上传，成为主库。**

### 如果电脑上同时运行 Clash Verge 等代理软件

一般可以与 Tailscale 共存。若手机连不上电脑、或 Tailscale 显示连接异常，在 Clash Verge 的「设置 → 规则 / 覆写」中加入（其他代理软件按同样思路让 Tailscale 网段直连）：

```yaml
rules:
  - IP-CIDR,100.64.0.0/10,DIRECT,no-resolve
  - DOMAIN-SUFFIX,ts.net,DIRECT
tun:
  route-exclude-address:
    - 100.64.0.0/10
```

## 二、iPhone 端

1. App Store 安装 **Tailscale**（免费，iOS 15 及以上），用与电脑**同一个账号**登录，允许添加 VPN 配置，打开开关。
2. 用 **Safari** 打开电脑启动日志里的 `https://….ts.net` 地址。
3. 点底部 **分享** → **添加到主屏幕** → 名称保持“拾账” → **添加**。
4. **从主屏幕图标打开**拾账（不要继续在 Safari 里用：主屏幕 App 与 Safari 的存储是分开的）。
5. 点顶栏“登录后同步” → 输入后端访问口令 → **登录并同步**。电脑主库里的账会立即出现，登录 30 天有效。

## 开机自动启动（可选）

希望登录 Windows 后网站自动运行、手机随时能同步时：

1. 先手动运行一次 `npm run start:private`，输入并保存 OKX 只读凭证与网站访问口令；
2. 在项目文件夹运行 `npm run autostart:on`。

之后每次登录 Windows，任务栏会出现最小化的“拾账 · 网站后端”窗口，网站随之运行，不需要输入任何内容。

- 如果你使用 Clash Verge / Mihomo 等代理软件，启动脚本会先等它的 TUN 网卡或系统代理就绪（最多 3 分钟），再连接 OKX；连不上时每 5 秒重试，最多 2 分钟，之后网站照常运行。未安装 Clash Verge 时不等待，直接启动。
- 运行中切换代理的 TUN / 系统代理模式会被自动识别，不用重启。
- **不要关闭这个窗口**，关闭即停止网站；重新启动运行 `npm run start:private`。
- 关闭开机自动启动：运行 `npm run autostart:off`，或在 任务管理器 → 启动应用 中禁用“拾账 Gleanbook 网站后端”。

## 日常使用

- **电脑**：网站运行期间，电脑浏览器打开 <http://localhost:8787>。电脑关机、睡眠或网站未运行时，手机照常离线记账，下次连上自动同步。
- **iPhone**：Tailscale 保持开启即可，记账即同步。
- **iPhone 需要使用其他 VPN 或代理 App 时**：iOS 同一时间只能开一个 VPN，开启其他 VPN 会断开 Tailscale。此时照常记账，顶栏显示“未连电脑 · N 条待同步”；切回 Tailscale 并打开拾账即自动合并。
- 行情、基金净值、汇率、OKX 持仓都由电脑后端获取，手机连上电脑时才会更新。

## 同步规则

- 不同记录：两边的修改全部保留。
- 同一条记录两边都改：以后修改的为准（按各自设备上的修改时间）。
- 一边删除、一边修改：删除优先。
- 会让账本出错的修改（例如两边同时卖出导致持仓为负）不会写入主库，页面提示原因。
- 定投每期、订阅扣款、每日快照在各设备生成的编号相同，合并后不会重复。
- 外观主题与“今日”分时曲线各设备独立，不同步。
- “清空当前账本”会同步到主库和其他设备。需要回到某天的版本时：先在电脑上按 Ctrl+C 关闭网站，把 `<主库文件夹>\backups\ledger-日期.json` 复制并覆盖 `<主库文件夹>\ledger.json`，再启动网站；各设备下次同步即变成该版本。

## 常见问题

| 现象                            | 处理                                                                                                                                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 手机打不开 `.ts.net` 地址       | 手机 Tailscale 是否开启；电脑是否运行 `npm run start:private`；电脑上 `tailscale serve status` 是否有 8787                                                                                                           |
| 顶栏一直“登录后同步”            | 在这台设备上输入一次后端访问口令（主屏幕 App 与 Safari 要分别登录）                                                                                                                                                  |
| 忘记后端访问口令                | 电脑运行 `npm run forget:okx`，再运行 `npm run start:private` 重新设置（需重新输入 OKX 密钥），各设备重新登录                                                                                                        |
| 提示“N 条修改与电脑主库冲突”    | 冲突的修改未写入，以主库为准；按提示原因在任一设备重新修改                                                                                                                                                           |
| 读取 OKX 持仓提示超时或请求失败 | 运行 `npm run diagnose:okx:private`：用已保存的只读密钥逐个检测接口，只显示状态和耗时。都正常说明是当时网络波动（热点、代理切换），稍后重试；某一行持续异常时，可在仓库 Issue 中附上该行（只含状态与耗时，不含密钥） |
| 添加到主屏幕后没有离线缓存      | 必须通过 `https://….ts.net` 打开后再添加；`http://` 局域网地址在 iOS 上不能离线                                                                                                                                      |
