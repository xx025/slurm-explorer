# Slurm Explorer

[English](README.en.md) · [VS Code 扩展市场](https://marketplace.visualstudio.com/items?itemName=xx025.slurm-job-viewer)

在 VS Code 中查看 Slurm 当前任务、历史记录、分区和节点资源，并在**原生终端标签**中持续跟踪日志。支持简体中文和英文，适用于通过 Remote-SSH 连接 Slurm 登录节点，也可在已安装 Slurm 客户端的 Linux 本机运行。

## 安装与更新

### 从扩展市场安装

1. 使用 **Remote - SSH** 连接 Slurm 登录节点。
2. 按 `Ctrl+Shift+X` 打开扩展页，搜索 `@id:xx025.slurm-job-viewer`。
3. 将 **Slurm Explorer** 安装到 **SSH 主机**；如果显示 **Install in SSH: ...**，点击该按钮。
4. 点击活动栏的 **Slurm Explorer** 集群线条图标，查看任务。默认使用远端当前系统用户。

需要 VS Code 1.90 或更新版本。远端必须能运行 `squeue`、`scontrol` 和 `sacct`。扩展直接使用现有 SSH 登录权限，无需额外的 HTTP 服务或令牌。

### 更新已有扩展

在 Remote-SSH 窗口的扩展页点击 **… → Check for Extension Updates（检查扩展更新）**，更新安装在 SSH 主机上的扩展。更新后执行 **Developer: Reload Window（开发人员：重新加载窗口）**。

如果更新尚未显示，也可以从 [GitHub Releases](https://github.com/xx025/slurm-explorer/releases/latest) 下载 `.vsix`，在远端窗口执行 **Extensions: Install from VSIX...** 安装。仓库和发布附件均可公开访问。

任务视图的 **↻** 只刷新任务数据，不检查扩展版本更新。

## 当前任务与用户范围

- 当前任务按**运行中、排队中、其他**分组，显示 ID、名称、用户、状态、分区、运行时长和排队原因。
- 点击任务打开详情，查看 CPU、请求内存、GRES、申请 / 分配资源、节点、时间限制、退出码、工作目录和日志路径等可用字段。
- 点击用户图标，选择**仅自己、所有用户、指定用户**。当前任务和历史记录使用相同的用户范围。
- 点击筛选图标，按 ID、名称、用户、状态、分区等字段匹配；清空输入可恢复全部结果。
- 使用搜索图标按 ID 查找任务，支持数组任务 `123_4` 和异构任务组件 `123+1`。

任务列表默认每 30 秒自动刷新，也可点击 **↻** 手动刷新。查询失败时保留已有结果并显示错误；**Show Query Output** 可查看查询命令和诊断。

查看其他用户的任务与日志仍受 Slurm 隐私设置和文件权限约束。

## 分区与节点

Slurm 侧边栏使用 VS Code 原生的三个独立视图：**任务、分区、节点**。点击各自标题可折叠或展开，也可拖动排序、调整高度或通过视图菜单隐藏。分区和节点默认折叠，展开时加载。

- **分区**：显示状态、节点数、CPU 总数；默认分区名称后显示 `*`。点击查看时限、节点范围、允许的账户与用户组及全部控制器字段。
- **节点**：显示状态、已分配 / 总 CPU、已分配 / 总 GPU 和所属分区（例如 `GPU 2/4` 表示已分配 2 个、总共 4 个）。点击查看配置 / 已分配 / 空闲内存、CPU 负载、GPU/GRES、资源配置、分配情况和维护原因等可用字段。
- 各视图标题的 **↻** 独立刷新。可见视图按 `slurmJobs.refreshSeconds` 自动刷新；设为 `0` 可关闭自动刷新。详情页的**刷新详情**重新查询控制器。
- 分区与节点使用 `scontrol show partition/node --oneliner`（节点查询附加 `--details`），不受任务的用户范围和文字筛选影响。查询失败保留上次结果，并提供点击重试；权限和返回字段由集群决定。

GPU 数量优先读取 `CfgTRES` / `AllocTRES`，并兼容 `Gres` / `GresUsed`。缺失的数据以 `—` 显示；无 GPU 节点显示 `0/0`。数量以 Slurm 配置和分配的 GPU 资源为准，MIG 环境可能表示实例数量，不代表实时利用率。

## 左侧历史记录

任务树底部固定显示可展开的**历史**分组。首次展开时加载最近 7 天已完成、失败、取消、超时等已结束任务，并按结束时间从新到旧排列。点击历史任务即可打开详情。

- 展开历史分组即可查看；也可从命令面板执行 **Show Job History**，定位、展开并刷新该分组。
- **↻** 同时刷新当前任务和已请求过的历史记录；加载失败时，可点击分组内的提示重试。
- 自动刷新启用、任务视图可见时，已请求过的历史最多每分钟自动刷新一次。
- 用户范围和文字筛选同时作用于当前任务和历史；`slurmJobs.historyDays` 控制查询窗口。

历史来自 `sacct` 的任务分配记录。集群未启用记账、权限不足或记录已清理时，结果可能为空或显示查询错误。

## 原生终端多标签日志

点击任务旁的输出图标，或在详情页点击**跟踪标准输出 / 标准错误**，会在底部 **终端** 中打开原生标签：

```text
Slurm 14115 · stdout
Slurm 14091 · stdout
Slurm 14091 · stderr
```

不同任务、不同输出类型分别保留标签并独立跟踪；重复打开同一输出会回到已有标签。使用 VS Code 原生终端标签列表切换、重命名和关闭，关闭标签只停止该日志跟踪，不会终止 Slurm 任务。若没有看到标签列表，可在设置中启用 **Terminal › Integrated › Tabs: Enabled**。

- **跟踪频率**：每 2 秒读取新增日志，不受任务列表刷新间隔影响。
- **首次读取**：默认读取文件末尾 256 KiB，之后增量读取；`slurmJobs.logTailKB` 控制单次读取上限。
- **日志颜色**：默认按级别为完整纯文本行着色：错误红色、警告黄色、成功绿色、信息青色、调试灰色；通过 `slurmJobs.outputColors` 可关闭。程序自带的 ANSI 颜色原样保留；未完成的行和进度条立即显示，不额外着色。
- **换行和进度条**：保留 ANSI 和 `\r` 回车刷新，将普通 LF 转换为终端 CRLF，避免阶梯状换行。
- **原生交互**：支持终端的选择、复制、查找、滚动和折行。显示保留行数由 `terminal.integrated.scrollback` 控制。
- **暂停与继续**：选中日志终端，从命令面板执行 **Pause Current Output / Resume Current Output**；各标签独立暂停。
- **清空显示**：执行 **Clear Current Output**，不会修改日志文件；后续继续追加新输出。

日志终端通过扩展直接读取文件，不启动 Shell，也不接受输入执行命令。文件截断或替换后会重新读取；路径已知但文件尚未生成或暂不可读时自动重试。

### 历史任务日志

打开历史任务的输出时，扩展会按需查询 Slurm 记账中保存的 `StdOut` / `StdErr`、`WorkDir` 和 `JobIDRaw` 等字段，解析日志路径，并支持数组任务文件名。

**路径缺失时仅提示，跳过日志跟踪，不弹出文件选择框。** 路径存在时，文件仍须保留在远端主机可访问的位置，并允许当前 SSH 用户读取。旧版本 Slurm 未提供日志路径字段时，历史列表和详情仍可正常使用。

控制器明确返回空的 stderr 路径时，使用合并后的 stdout。支持 `%j`、`%A`、`%a`、`%x`、`%u` 和数字补零；需要节点或任务上下文的模板（如 `%N`、`%t`）可能无法解析。

## 中英文与设置

在任务视图的更多操作菜单或命令面板运行 **Slurm: Change Interface Language**，选择跟随 VS Code、简体中文或英文。默认中文编辑器使用简体中文，其他语言使用英文。

手动语言设置作用于任务树、详情和扩展提示；原生命令、菜单、设置与终端交互界面使用 VS Code 的显示语言。Slurm 字段、状态码、任务数据和日志正文保持原文。

建议在 **Remote Settings** 中配置：

```json
{
  "slurmJobs.language": "auto",
  "slurmJobs.user": "",
  "slurmJobs.binDirectory": "",
  "slurmJobs.refreshSeconds": 30,
  "slurmJobs.timeoutSeconds": 20,
  "slurmJobs.historyDays": 7,
  "slurmJobs.logTailKB": 256,
  "slurmJobs.outputColors": true
}
```

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `slurmJobs.language` | `auto` | `auto` 跟随 VS Code；`zh-cn` 简体中文；`en` 英文 |
| `slurmJobs.user` | 空字符串 | 使用远端系统用户；`*` 查询所有用户；也可指定用户名 |
| `slurmJobs.binDirectory` | 空字符串 | Slurm 命令所在绝对目录；留空使用扩展进程的 PATH |
| `slurmJobs.refreshSeconds` | `30` | 可见任务、分区、节点视图刷新间隔，0–3600 秒；`0` 关闭视图和历史自动刷新，不影响日志跟踪 |
| `slurmJobs.timeoutSeconds` | `20` | 单条 Slurm 查询超时，2–120 秒 |
| `slurmJobs.historyDays` | `7` | 历史及记账查找窗口，1–365 天 |
| `slurmJobs.outputColors` | `true` | 按日志级别为完整纯文本行自动着色；关闭后仍保留程序自带的 ANSI 颜色 |
| `slurmJobs.logTailKB` | `256` | 单次日志读取上限，4–4096 KiB；显示保留行数使用原生终端设置 |

## 命令速查

按 `Ctrl+Shift+P` 搜索 `Slurm`。下表使用英文命令名；中文界面会显示对应译名。

| 命令 | 用途 |
| --- | --- |
| Refresh Jobs | 刷新当前任务与已请求的历史 |
| Select User Scope | 选择仅自己、所有用户或指定用户 |
| Change Interface Language | 切换扩展界面语言 |
| Filter Jobs | 筛选当前任务和历史记录 |
| Refresh Partitions | 刷新分区列表 |
| Refresh Nodes | 刷新节点列表 |
| Show Resource Details | 查看所选分区或节点详情 |
| Show Job History | 定位、展开并刷新历史分组 |
| Find Job by ID | 按 ID 查询任务 |
| Show Job Details | 查看任务详情 |
| Follow Standard Output | 在原生终端标签中跟踪 stdout |
| Follow Standard Error | 在原生终端标签中跟踪 stderr |
| Pause Current Output | 暂停当前选中的日志终端 |
| Resume Current Output | 继续当前选中的日志终端 |
| Clear Current Output | 清空当前日志终端显示 |
| Copy Job ID | 复制任务 ID |
| Show Query Output | 查看查询命令和诊断 |

## 常见问题与限制

- **找不到 Slurm 命令**：扩展不会加载交互式 Shell 初始化文件。若 Slurm 需 `module load`，请设置 `binDirectory`，并确保扩展进程具有所需环境和库路径。
- **任务可见但日志不可读**：任务查询权限与文件读取权限分别生效。仅位于计算节点本地磁盘的日志，无法从登录节点直接跟踪。
- **日志更新慢**：扩展只能读取程序已写入文件的内容。Python 任务可使用 `python -u` 减少输出缓冲造成的延迟。
- **资源使用率**：CPU、GPU、内存等字段表示申请或分配情况；当前不提供实时 GPU 利用率、显存曲线或 step 级实际内存峰值汇总。
- 当前查询默认集群，不提供联合集群切换；扩展仅在受信任工作区启用。

## 开发与发布

使用 Node.js 22 或更新版本：

```bash
npm ci
npm test
npm run package -- --out ../slurm-explorer.vsix
```

在 VS Code 打开源码目录，按 F5 启动扩展开发窗口。真实集群只读检查可先编译，再在登录节点运行 `node test/live-check.cjs`。扩展运行时没有第三方依赖。

项目已更名为 **Slurm Explorer**，扩展 ID 继续使用 `xx025.slurm-job-viewer`，保留现有安装和更新路径。`.github/workflows/publish.yml` 使用 GitHub Actions Trusted Publishing（OIDC）发布：手动运行 `publish=false` 只检查和打包，`publish=true` 发布到市场；发布 GitHub Release 也会触发，标签必须与 `package.json` 的版本一致。

`media/icon.png` 用于扩展市场和扩展列表，`media/icon.svg` 为可编辑源文件；`media/slurm.svg` 用于活动栏。
