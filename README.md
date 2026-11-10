# Slurm Job Viewer

在 VS Code 侧边栏查看 Slurm 任务、详情、历史记录和日志。适用于通过 Remote-SSH 连接 Slurm 登录节点的工作方式，也可以在安装了 Slurm 客户端的 Linux 本机运行。

安装包请从 [GitHub Releases](https://github.com/xx025/slurm-job-viewer/releases/latest) 下载。

## 安装与连接

1. 在 VS Code 安装 **Remote - SSH**，连接你的 Slurm 登录节点，例如 `node42`。
2. 在远端窗口执行 **Extensions: Install from VSIX...**，选择 `slurm-job-viewer-0.2.1.vsix`。
3. 确认扩展安装在 **SSH 主机**上。如果扩展列表显示 **Install in SSH: ...**，点击该按钮。
4. 点击左侧服务器图标 **Slurm**。默认展示远端当前系统用户的任务。

扩展在远端执行 `squeue`、`scontrol`、`sacct`，不需要配置额外的 HTTP 服务或令牌。SSH 登录、跳板机和认证由 Remote-SSH 管理。请确认在远端终端中这些命令可以正常执行。

## 功能

- 支持中文和英文，默认跟随 VS Code 显示语言。
- 工具栏提供“选择用户范围”，可以切换仅自己、所有用户、指定用户；任务列表和历史记录共用所选范围。
- 任务按 Running / Pending / Other 分组。
- 显示任务 ID、名称、用户、状态、分区、运行时长、时间限制、CPU、请求内存、GRES 和排队原因。
- 点击任务打开详情，包含申请/分配资源、节点、退出码、工作目录、启动命令和日志路径。
- 工具栏筛选任务，支持任务 ID、名称、状态、用户、分区和排队原因。
- 使用历史按钮查看最近七天的记账记录；可以在设置中修改时间窗口。
- 按 ID 查找任务，支持数组任务 `123_4` 和异构任务组件 `123+1`。
- 打开 stdout / stderr 的只读尾部预览，默认最多读取末尾 256 KiB。
- 控制器返回空的 stderr 路径时，按照批处理任务默认行为打开合并后的 stdout 日志。
- 可见任务列表和已打开日志默认每 30 秒刷新；详情页点击按钮刷新。
- 查询失败时保留已有任务并显示错误信息；同时提供查询输出通道。

## 常用命令

在命令面板搜索 `Slurm:`：

| 命令 | 用途 |
| --- | --- |
| Refresh Jobs | 刷新任务列表和已打开日志 |
| Select User Scope / 选择用户范围 | 切换仅自己、所有用户或指定用户 |
| Change Interface Language / 切换界面语言 | 跟随 VS Code、简体中文或 English |
| Filter Jobs | 筛选当前任务；清空输入恢复全部 |
| Show Job History | 查看配置窗口内的历史任务 |
| Find Job by ID | 查询指定任务 |
| Open Standard Output / Error | 选择任务并打开日志 |
| Show Query Output | 查看查询命令和错误信息 |

## 设置

建议在 **Remote Settings** 中配置：

```json
{
  "slurmJobs.language": "auto",
  "slurmJobs.user": "",
  "slurmJobs.binDirectory": "",
  "slurmJobs.refreshSeconds": 30,
  "slurmJobs.timeoutSeconds": 20,
  "slurmJobs.historyDays": 7,
  "slurmJobs.logTailKB": 256
}
```

| 设置 | 说明 |
| --- | --- |
| `language` | `auto` 跟随 VS Code；`zh-cn` 简体中文；`en` 英文 |
| `user` | 空字符串使用远端系统用户；`*` 查询所有用户；也可指定 Slurm 用户名 |
| `binDirectory` | Slurm 命令所在绝对目录，例如 `/opt/slurm/bin`；留空使用扩展进程的 PATH |
| `refreshSeconds` | 刷新间隔；设为 `0` 关闭自动刷新 |
| `timeoutSeconds` | 每条 Slurm 命令的最大等待时间 |
| `historyDays` | 历史记录和已离开控制器任务的查找窗口 |
| `logTailKB` | 日志尾部预览大小，范围 4–4096 KiB |

## 查看其他用户和切换语言

点击任务栏顶部的用户图标，选择 **所有用户**，即可查看当前账号有权看到的各用户任务；也可以选择 **指定用户** 输入用户名。任务行和历史列表会显示所属用户。

通过视图右上角的更多操作菜单，或命令面板的 **Slurm: 切换界面语言 / Change Interface Language**，选择跟随 VS Code、简体中文或英文。切换后，已打开的详情页和日志预览也会更新。原生命令、菜单和设置名称使用 VS Code 的显示语言；手动语言设置影响任务树、详情、提示和日志预览。Slurm 返回的任务状态码、字段原名、排队原因和日志正文保留原文。

查看其他人的任务和日志仍使用当前 SSH 登录账号的权限。集群启用了 `PrivateData` 等访问限制，或日志文件没有读取权限时，插件会显示查询结果或权限错误，不会提升权限。

## 数据和使用限制

- 任务列表来自 `squeue`，详情优先来自 `scontrol show job`。任务离开控制器后，按 ID 查找会回退到 `sacct`。
- 历史详情来自 `sacct` 的任务分配记录，包含状态、退出码和分配资源。第一版不汇总 step 级别的实际资源峰值。
- GPU 数量和内存字段描述申请或分配情况。GPU 利用率、显存曲线和实时内存监控不在第一版范围内。
- 日志必须能从扩展所在主机访问；只存在于计算节点本地磁盘的文件不能直接预览。
- 历史任务通常没有可查询的 stdout / stderr 路径；这种情况下请直接打开已知日志文件。
- 支持常见日志模板 `%j`、`%A`、`%a`、`%x`、`%u` 和数字补零。需要节点或任务上下文的 `%N`、`%t` 等模板会提示手动打开解析后的文件。
- Slurm 记账未启用、权限限制或历史已清理时，历史查询可能返回空结果或错误。
- 扩展不会加载交互式 shell 初始化文件。如果 Slurm 只能在执行 `module load` 后使用，请配置 `binDirectory`，并确保扩展进程具有所需的库路径和 Slurm 环境。
- 当前版本查询默认集群，不提供联合集群切换。
- 仅在受信任工作区启用。

## 开发与打包

使用 Node.js 22 或更新版本：

```bash
npm ci
npm test
npm run package -- --out ../slurm-job-viewer-0.2.1.vsix
```

运行 `npm run compile` 后，在 VS Code 打开源码目录，按 F5 启动扩展开发窗口。使用 Remote-SSH 在登录节点打开源码目录，可以直接调试真实 Slurm 查询。

扩展运行时没有第三方依赖；安装包只包含编译后的代码、图标、清单和文档。

## 市场发布

Marketplace Publisher ID 为 `xx025`，对应扩展 ID 为 `xx025.slurm-job-viewer`。

在发布者的 Trusted Publishing 页面创建 GitHub Actions 策略：

| 字段 | 值 |
| --- | --- |
| Policy name | `slurm-job-viewer-release` |
| Repository owner | `xx025` |
| Repository | `slurm-job-viewer` |
| Workflow | `publish.yml` |
| Environment | 留空 |

工作流位于 `.github/workflows/publish.yml`。手动运行时，`publish=false` 只测试、打包并上传构建附件；`publish=true` 使用 OIDC 发布到市场。正式发布 GitHub Release 时也会触发市场发布，Release 标签必须与 `package.json` 的版本匹配，例如 `v0.2.1`。

English documentation is included as `README.en.md`.
