# dsh-staged-loader

Start the DSH desktop profile with the core bundles only. Enable the third-party
bundles after the page is ready, one by one. Show the progress in the
bottom-right corner.

## 为什么需要它

DSH 桌面端在宿主进程发送 `ready` 之前不显示主窗口。宿主必须等全部插件激活
完成后才发送 `ready`。实测数据（Windows，热缓存）：

| 项目 | 时间 |
| --- | --- |
| 8 个核心 bundle | 2.6 s |
| 11 个三方 bundle | 6.9 s |
| 渲染层（14.6 MB 客户端 JS） | 4.0 s |
| 合计 | 13.5 s，冷启动 20–40 s |

其中 dsh-ops 约 2.3 s、dsh-im 约 2.1 s，两者占三方耗时的 64%。

本插件把三方 bundle 从启动路径上移走：

1. 启动时 profile 只列核心 bundle，界面在 4–5 s 内出现。
2. 页面就绪后，逐个调用 `pluginManager.setBundleEnabled(name, true)` 启用三方 bundle。
3. 右下角卡片显示当前进度。启用完成后卡片自动消失。
4. 正常退出时，把核心列表写回 profile manifest，下次启动仍然快。

## 安装

```bash
dsh plugin add ./dsh-staged-loader
```

或安装打包文件：

```bash
npm pack
dsh plugin add ./guojinpeng-dsh-staged-loader-0.1.0.tgz
```

安装后第一次启动仍是全量加载（manifest 里还是完整列表）。退出后 manifest
只剩核心 bundle，从第二次启动开始变快。

## 工作方式

- `apply` 等待 `startDelayMs`，再等 `loader.await()` 返回（启动期组合已稳定）。
- 读取 `pluginManager.listBundles()`，选出本插件管理的 bundle：已安装、来自
  profile、不是核心 `@deepseek-ai/*`、不是本插件、不在 `keep` 中。
- 其中尚未启用的，逐个调用 `pluginManager.setBundleEnabled(name, true)`。
  运行期热组合，不需要重启。
- 退出时 `ctx.effect` 的清理函数把这些 bundle 从 `dsh.profile.bundles` 中移除。
  下次启动只加载核心 bundle。

插件不修改已安装的 DSH 代码，只用公开服务 `pluginManager`、`webServer`、
`connection`、`profileContext`、`loader`。

第一次启动时所有 bundle 都已启用，本插件不启用任何 bundle，只负责记录管理
范围。退出后 manifest 变成核心列表，第二次启动开始变快。

## 配置

路径：`$DSH_HOME/guojinpeng/dsh-staged-loader/config.json`（默认 `~/.dsh/...`）。
文件不存在时，插件写入默认值。

```json
{
  "enabled": true,
  "startDelayMs": 1500,
  "waitForBootMs": 60000,
  "batchSize": 2,
  "batchPauseMs": 200,
  "keep": [],
  "defer": []
}
```

| 字段 | 说明 |
| --- | --- |
| `enabled` | `false` 时只注册状态接口，不启用任何 bundle。 |
| `startDelayMs` | `apply` 之后等多久开始。默认 1500 ms。 |
| `waitForBootMs` | 等 `loader.await()` 的上限。超时后继续。 |
| `batchSize` | 每启用几个 bundle 暂停一次。默认 2。 |
| `batchPauseMs` | 批次之间的暂停。默认 200 ms。 |
| `keep` | 不由本插件管理的 bundle 名。 |
| `defer` | 显式指定本插件管理的 bundle 名。非空时忽略默认规则。 |

默认规则：已安装、来自 profile、不以 `@deepseek-ai/` 开头、不是本插件、
不在 `keep` 中的 bundle 都由本插件管理。

## 状态接口

`GET /guojinpeng/dsh-staged-loader/status` 返回当前进度：

```json
{
  "running": true,
  "total": 11,
  "done": 4,
  "current": "dsh-ops",
  "error": null,
  "items": [{ "name": "dsh-ops", "state": "ready", "ms": 2300, "message": "" }],
  "now": 1762848000000
}
```

`state` 取值：`pending`、`loading`、`ready`、`restart`、`failed`。
接口与桌面端同源，走 `connection.requestRejection` 的鉴权。

## 限制

- 延后的 bundle 在启用前不可用。依赖 `dsh-ops`（bash 工具）或
  `billion-context`（上下文压缩）的会话，要等进度走完。
- 同一时刻只跑一次。再次启动前需要退出应用。
- 崩溃或强制结束进程时不会写回 manifest。下次启动仍是全量，但不会出错。
- 延后的 bundle 若要求重启（`restartReason`），卡片显示"需重启"，本次不生效。

## 开发

```bash
node --test tests/*.test.js
```

## 许可

MIT
