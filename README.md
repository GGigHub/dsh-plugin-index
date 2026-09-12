# dsh-plugin-index

> ⚠️ **本项目不接受 Pull Request 与 Issue**，仅作只读分发。如需改动请 fork 后自行维护；社区插件请直接提交到你自己的仓库。

DeepSeek Harness 的社区插件索引：按 GitHub 星标浏览带 `dsh-plugin` topic 的仓库，并在 web profile 里安装 / 更新 / 修复 / 卸载。

> **风险提示**：本列表是社区仓库索引，**所有插件均未检查木马、病毒或恶意代码**。请自行 clone Git 仓库、审查源码后再决定是否安装。一键安装不会替你做安全审计，风险自负。

左侧栏 Settings 上方会出现「插件」按钮。官方设置页里的「插件列表」是只读的 Loader 清单（当前挂了哪些 fiber）；本包补的是市场发现和生命周期，两者不互相替代。

仓库已带构建好的 `lib/`，`dsh plugin add github:...` **不需要** `prepare` 或 pnpm `allowBuilds`。

## 安装

需要已能运行的 DSH web（`dsh` 在 PATH 上，或源码树里能跑 `pnpm dsh`）。

```sh
dsh plugin --profile web add github:GGigHub/dsh-plugin-index
```

重启 DSH 后，打开左侧栏「插件」。

卸载：

```sh
dsh plugin --profile web remove @dsh-external/dsh-plugin-index
```

然后重启。不要在面板里卸载本包自身（按钮已隐藏，API 也会拒绝）。

## 用法

- **市场**：GitHub `topic:dsh-plugin archived:false`，按星标降序；Search API 分页拉取，最多 1000 条，面板每页 50 条。首屏先返回第 1 页（或本地缓存），后台补全后自动更新。
- **维护**：按仓库最后一次 git push（`pushed_at`）以 7 天为粒度分层。市场默认只显示 **近 4 周** 有活动的插件（本周 / 2 周内 / 4 周内 / 8 周内 / 含停滞）。卡片显示「本周更新 / n 周前」和本地具体时间（如 `2026-03-10 14:32`）。超过 1 周标「可能落后」，超过 4 周标「可能停更」；已安装列表不过滤，只打标。归档仓不进市场。旧缓存没有 push 时间时不会被藏，点「刷新」后才会按周分层。这不是 DSH 兼容性检测。
- **分类**：市场与已安装按功能打多标签（界面 / 桌面 / 主题 / 技能 / 用量 / 视觉 / 浏览器 / MCP / 工具 / 渠道 / 记忆 / 会话 / 安全 / 模型 / 市场）。同一插件可以同时属于多类，点芯片看「含该标签」的列表。优先认仓库 topic `dsh-category-*`，否则用名称、描述和其它 topic 匹配；没有任何信号的归入「其他」。
- **搜索**：在已加载的目录上本地过滤（仓库名 / 描述 / spec / 分类）；清空输入即可回到全量列表。
- **刷新**：重新请求 GitHub（绕过 15 分钟缓存）；搜索关键词不参与服务端过滤。
- **安装**：只接受 `github:owner/repo`（装的是仓库**根目录**）。列表内插件均标「未审计」；点击安装前会弹出风险确认。点击后进入「安装中」队列（串行执行），可看状态、耗时与日志；进行中或失败可取消，成功项在下次打开「安装中」列表时清除。已知需装子目录的仓库会禁用市场「安装」，请走手动流程。建议先 clone 仓库、自行审查，再决定是否安装。
- **更新 / 修复 / 卸载**：队列进行中会禁用，避免和安装同时改 profile。
- **安装说明 / 复制安装命令**：当插件显示「未入 bundles」或已知需装子目录时出现。前者打开 README 并在底部日志写出步骤；后者把手动安装命令复制到剪贴板（未知子目录时是带 `<子目录>` 的模板）。命令使用当前 `DSH_PROFILE`（默认 `web`）。

装、更、修、卸成功后都要重启 DSH，新插件才会加载。

### 「未入 bundles」是什么

市场只能 `add github:owner/repo`，对应仓库根包。若根目录的 `package.json` **没有** `dsh.bundle`，`dsh plugin add` 仍会装进 profile 依赖，但**不会**写入 `dsh.profile.bundles`，重启后通常也不会作为插件层加载。面板会标「未入 bundles」（普通依赖）。

常见原因：系列仓 / monorepo，真正可装的皮肤或插件在子目录（例如 `maid-atelier/`）。这时应：

1. 在「已安装」里卸载误装的根包（若已装）。
2. 点 **安装说明** 看 README，或 **复制安装命令** 到终端执行（clone 后 `dsh plugin add` 指向子目录）。
3. 重启 DSH。

对已知仓库（如 `Small-tailqwq/dsh-deep-whale` → `maid-atelier`）会给出可直接复制的命令；其它仓则给出带 `<子目录>` 占位符的模板，需对照作者 README 替换。

## 环境变量

| 变量                            | 作用                                                             |
| ------------------------------- | ---------------------------------------------------------------- |
| `GITHUB_TOKEN` / `GH_TOKEN` | 提高 GitHub Search 限额（未登录约 60 次/小时）                   |
| `DSH_HTTPS_PROXY` / `DSH_HTTP_PROXY` | 安装时优先使用的代理；未设置时会尝试常见本机端口（7890 等），并补齐 `NODE_USE_ENV_PROXY` |
| `DSH_HOME`                    | Harness 主目录，默认`~/.dsh`                                   |
| `DSH_PROFILE`                 | 操作的 profile，默认`web`                                      |
| `DSH_CHECKOUT`                | 源码树根目录（需含`apps/cli`）。PATH 上没有 `dsh` 时才会用到 |

查找 CLI 的顺序：PATH 上的 `dsh` → `DSH_CHECKOUT` / 从 `cwd` / `argv` 向上找含 `apps/cli` 的源码树。找到 `dsh` 就直接调用；只有源码树才用 `pnpm dsh`。

## 作为组合包

`package.json` 声明 `dsh.bundle.patch`，`cordis.patch.yml` 插入 `@dsh-external/dsh-plugin-index`。这是官方 out-of-tree 组合包形态；没有 `dsh.bundle` 的仓库会出现在市场上，但 `dsh plugin add` 只会把它当成普通依赖。

本仓库已加上 GitHub topic `dsh-plugin`（官方发现约定）和 `dsh-category-market`（本索引的分类约定）。GitHub Search 索引可能有延迟，面板点「刷新」后才会出现在市场里。

若你维护的是「一个仓库多个可装包」，想让市场一键可用：把可装包放到独立仓库，或让仓库根目录本身声明 `dsh.bundle`。否则用户只能按上面的手动流程装子目录。

想出现在对应分类下，给仓库加上一个或多个 `dsh-category-theme|memory|usage|skill|security|channel|ui|tool|provider|vision|browser|desktop|mcp|market|session` topic。没有该 topic 时，索引会按名称和描述打多标签。

## 许可证

MIT
