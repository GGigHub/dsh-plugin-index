# dsh-plugin-index

> ⚠️ **本项目不接受 Pull Request 与 Issue**，仅作只读分发。如需改动请 fork 后自行维护；社区插件请直接提交到你自己的仓库。

DeepSeek Harness 的社区插件索引：按 GitHub 星标浏览带 `dsh-plugin` topic 的仓库，并在 web profile 里安装 / 更新 / 修复 / 卸载。

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

- **市场**：GitHub `topic:dsh-plugin`，按星标降序；Search API 分页拉取，最多 1000 条，面板每页 50 条。
- **刷新**：重新请求 GitHub（绕过 15 分钟缓存）。
- **安装**：只接受 `github:owner/repo`。
- **更新**：`dsh plugin update <package-name>`。
- **修复**：对已装规格再执行 `add`（`github:` 或已记录的本地 `link:`）。
- **卸载**：只用 profile 里已解析的 package name；卸前会确认。

装、更、修、卸成功后都要重启 DSH，新插件才会加载。

## 环境变量

| 变量                            | 作用                                                             |
| ------------------------------- | ---------------------------------------------------------------- |
| `GITHUB_TOKEN` / `GH_TOKEN` | 提高 GitHub Search 限额（未登录约 60 次/小时）                   |
| `DSH_HOME`                    | Harness 主目录，默认`~/.dsh`                                   |
| `DSH_PROFILE`                 | 操作的 profile，默认`web`                                      |
| `DSH_CHECKOUT`                | 源码树根目录（需含`apps/cli`）。PATH 上没有 `dsh` 时才会用到 |

查找 CLI 的顺序：`DSH_CHECKOUT` → PATH 上的 `dsh` → 从 `cwd` / `argv` 向上找含 `apps/cli` 的源码树。找到 `dsh` 就直接调用；只有源码树才用 `pnpm dsh`。

## 作为组合包

`package.json` 声明 `dsh.bundle.patch`，`cordis.patch.yml` 插入 `@dsh-external/dsh-plugin-index`。这是官方 out-of-tree 组合包形态；没有 `dsh.bundle` 的仓库会出现在市场上，但 `dsh plugin add` 只会把它当成普通依赖。

## 许可证

MIT
