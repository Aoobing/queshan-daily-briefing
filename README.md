# 确山县每日早报（云端版）

每天北京时间 **07:15** 自动获取确山县天气与穿衣建议、双子座与白羊座运势，并通过 **PushPlus** 推送到微信。

## 组成

| 文件 | 说明 |
|---|---|
| `briefing.js` | 主脚本，纯 Node 18+，零第三方依赖 |
| `.github/workflows/daily-briefing.yml` | GitHub Actions 定时工作流 |

## 数据来源

- 天气：Open-Meteo（确山县约 32.802, 114.026，时区 Asia/Shanghai）
- 运势：星座屋
- 推送：PushPlus → 微信

## 配置

在仓库 **Settings → Secrets and variables → Actions** 中新增密钥：

- `PUSHPLUS_TOKEN`：PushPlus 用户 token

## 手动运行

在 Actions 页面选择 `Queshan Daily Briefing` → **Run workflow**。

本地预览（不发送）：

```bash
node briefing.js --dry-run
```

本地真实发送（标题标注「云端测试」）：

```bash
PUSHPLUS_TOKEN=xxxx node briefing.js --test
```

## 说明

- GitHub Actions 的 `schedule` 使用 UTC：`15 23 * * *` = 北京时间次日 07:15。
- GitHub 定时任务在高峰期可能延迟数分钟到十几分钟，属正常现象。
- 星座屋服务器使用旧式 TLS 重协商，脚本已显式开启 `SSL_OP_LEGACY_SERVER_CONNECT` 兼容。
- 公开仓库连续 60 天无提交会被 GitHub 停用定时工作流，工作流内含每 30 天自动写入 .keepalive 的保活步骤。
