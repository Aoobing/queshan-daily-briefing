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

## 补跑机制

GitHub Actions 的 `schedule` 只是「尽力而为」。实测 2026-10-20 的计划任务
（07:15）直到 **09:48** 才开始运行，延迟超过 2 小时。因此工作流配置了 4 个时间点：

| UTC | 北京时间 | 作用 |
|---|---|---|
| `15 23 * * *` | 07:15 | 正点 |
| `45 23 * * *` | 07:45 | 补跑 1 |
| `15 0 * * *` | 08:15 | 补跑 2 |
| `45 0 * * *` | 08:45 | 补跑 3 |

成功发送后会提交 `sent-state.json`（记录当天日期），后面的时间点读到当天已发送就直接跳过，
因此正常不会重复推送，只有前一次失败时才由补跑点接手。`concurrency` 保证同一时刻只有一个实例运行。

## 说明

- GitHub Actions 的 `schedule` 使用 UTC：`15 23 * * *` = 北京时间次日 07:15。
- GitHub 定时任务在高峰期可能延迟数分钟到数小时，属于平台行为，脚本无法控制。
- 想要准点送达：本机计划任务（07:15，开机时）+ 云端（关机兜底）双通道运行。
- 星座屋服务器使用旧式 TLS 重协商，脚本已显式开启 `SSL_OP_LEGACY_SERVER_CONNECT` 兼容。
- 公开仓库连续 60 天无提交会被 GitHub 停用定时工作流，工作流内含每 30 天自动写入 .keepalive 的保活步骤。
