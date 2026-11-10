# Slurm Job Viewer

[简体中文](README.md) · [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=xx025.slurm-job-viewer)

View active Slurm jobs, accounting history, partitions and node resources in VS Code, and follow logs in **native terminal tabs**. Supports English and Simplified Chinese. Use it through Remote-SSH on a Slurm login node, or locally on Linux with Slurm clients installed.

## Install and update

### Install from the Marketplace

1. Connect to a Slurm login node using **Remote - SSH**.
2. Press `Ctrl+Shift+X` and search for `@id:xx025.slurm-job-viewer`.
3. Install **Slurm Job Viewer** on the **SSH host**. If you see **Install in SSH: ...**, select it.
4. Open the **Slurm** cluster outline icon in the activity bar. The remote OS user is selected by default.

Requires VS Code 1.90 or newer. The remote host must be able to run `squeue`, `scontrol` and `sacct`. The extension uses your existing SSH permissions; no additional HTTP service or token is needed.

### Update an existing installation

In the Remote-SSH window, open the Extensions view and choose **… → Check for Extension Updates**. Update the copy installed on the SSH host, then run **Developer: Reload Window**.

If the update is not listed yet, download a `.vsix` from [GitHub Releases](https://github.com/xx025/slurm-job-viewer/releases/latest) and run **Extensions: Install from VSIX...** in the remote window. The repository and release assets are publicly accessible.

The job view's **↻** button refreshes job data; extension updates are checked separately.

## Active jobs and user scope

- Active jobs are grouped into **Running, Pending and Other**, with ID, name, owner, state, partition, elapsed time and pending reason.
- Open a job to see available fields for CPU, requested memory, GRES, requested / allocated resources, nodes, time limit, exit code, working directory and log paths.
- Use the user icon to select **Only me, All users or Specified user**. The queue and history share the selected scope.
- Use the filter icon to match ID, name, owner, state, partition and other supported fields. Clear the input to restore all results.
- Use the search icon to find a job by ID, including array elements such as `123_4` and heterogeneous components such as `123+1`.

The queue refreshes every 30 seconds by default. Select **↻** for a manual refresh. Failed queries retain previous results and display an error; **Show Query Output** provides query commands and diagnostics.

Slurm privacy settings and filesystem permissions still apply when viewing other users' jobs and logs.

## Partitions and nodes

The Slurm sidebar uses three independent native VS Code views: **Jobs, Partitions and Nodes**. Select a view header to collapse or expand it; drag to reorder, resize it, or hide it through the view menu. Partitions and Nodes start collapsed and load when expanded.

- **Partitions:** state, node count and total CPUs; the default partition has a `*` suffix. Open a partition for time limits, node ranges, allowed accounts / groups and all controller fields.
- **Nodes:** state, allocated / total CPUs and partition membership. Open a node for configured / allocated / free memory, CPU load, GPU/GRES, configured and allocated resources, and maintenance reasons when available.
- Each view has its own **↻** button. Visible views refresh using `slurmJobs.refreshSeconds`; set it to `0` to disable automatic refresh. **Refresh details** queries the controller again.
- Resource views use `scontrol show partition/node --oneliner`, independently of the job user scope and text filter. Failed queries retain previous results and offer click-to-retry. Cluster permissions determine visibility and available fields.

## Sidebar history

A persistent, expandable **History** group appears below active jobs. Expanding it for the first time loads finished jobs from the last 7 days, including completed, failed, cancelled and timed-out jobs, ordered by end time from newest to oldest. Select a historical job to open its details.

- Expand the History group directly, or run **Show Job History** from the command palette to locate, expand and refresh it.
- **↻** refreshes the queue and previously requested history. Select the inline error item to retry a failed history query.
- With automatic refresh enabled and the job view visible, previously requested history refreshes at most once per minute.
- User scope and the text filter apply to both active jobs and history. `slurmJobs.historyDays` controls the lookback window.

History comes from `sacct` allocation records. Disabled accounting, insufficient permissions or purged records can produce empty results or query errors.

## Native terminal log tabs

Use a job's output icon or the **Open stdout / Open stderr** buttons in its details to open a native tab in the bottom **Terminal** panel:

```text
Slurm 14115 · stdout
Slurm 14091 · stdout
Slurm 14091 · stderr
```

Different jobs and output streams retain separate tabs and independent followers. Reopening the same output reuses its tab. Use the native terminal tab list to switch, rename or close tabs. Closing a tab stops only that log follower and does not cancel the Slurm job. If the list is hidden, enable **Terminal › Integrated › Tabs: Enabled** in settings.

- **Follow interval:** read new content every 2 seconds, independently of queue refresh.
- **Initial read:** tail up to 256 KiB by default, then read increments. `slurmJobs.logTailKB` limits each read.
- **Log colors:** complete plain lines are colored by level: errors red, warnings yellow, success green, info cyan and debug gray. Disable this with `slurmJobs.outputColors`. Original ANSI colors pass through unchanged; partial lines and progress updates display immediately without added colors.
- **Line breaks and progress:** preserve ANSI and `\r` progress updates; normalize bare LF to terminal CRLF to avoid staircase line breaks.
- **Native interaction:** use terminal selection, copy, find, scrolling and reflow. `terminal.integrated.scrollback` controls retained display lines.
- **Pause and resume:** select a log terminal and run **Pause Current Output / Resume Current Output** from the command palette. Tabs pause independently.
- **Clear display:** run **Clear Current Output** without modifying the log file. Future output continues to append.

The extension reads files directly without starting a shell or executing terminal input. Truncation and replacement restart reading. Known paths that do not exist yet, or are temporarily unreadable, retry automatically.

### Historical job logs

Opening historical output queries accounting on demand for retained fields such as `StdOut` / `StdErr`, `WorkDir` and `JobIDRaw`, resolves the path and supports array-job filename patterns.

**Missing paths are reported and log following is skipped without a file picker.** When a path exists, the file must still be present on a filesystem accessible from the remote host and readable by the SSH user. Older Slurm versions without log path fields can still display normal history and details.

An explicitly empty controller stderr path uses the merged stdout file. Supported patterns include `%j`, `%A`, `%a`, `%x`, `%u` and numeric padding. Patterns requiring node or task context, such as `%N` or `%t`, may remain unresolved.

## Languages and settings

Run **Slurm: Change Interface Language** from the command palette or the job view's More Actions menu to select Follow VS Code, Simplified Chinese or English. Chinese editor locales default to Simplified Chinese; other locales default to English.

The manual language setting applies to the tree, details and extension messages. Native commands, menus, settings and terminal interactions follow VS Code's display language. Slurm fields, state codes, job data and log contents retain their original text.

Configure these in **Remote Settings**:

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

| Setting | Default | Description |
| --- | --- | --- |
| `slurmJobs.language` | `auto` | `auto` follows VS Code; `zh-cn` selects Simplified Chinese; `en` selects English |
| `slurmJobs.user` | Empty | Remote OS user; `*` selects all users; a username selects that user |
| `slurmJobs.binDirectory` | Empty | Absolute directory containing Slurm commands; empty uses the extension host PATH |
| `slurmJobs.refreshSeconds` | `30` | Visible job / partition / node view refresh interval, 0–3600 seconds; `0` disables view / history auto-refresh without affecting log followers |
| `slurmJobs.timeoutSeconds` | `20` | Timeout per Slurm query, 2–120 seconds |
| `slurmJobs.historyDays` | `7` | Accounting history and lookup window, 1–365 days |
| `slurmJobs.outputColors` | `true` | Automatically color complete plain log lines by level; original ANSI colors remain when disabled |
| `slurmJobs.logTailKB` | `256` | Maximum per log read, 4–4096 KiB; display retention uses native terminal settings |

## Command reference

Press `Ctrl+Shift+P` and search for `Slurm`. Names below are English; Chinese VS Code displays their translations.

| Command | Purpose |
| --- | --- |
| Refresh Jobs | Refresh the queue and previously requested history |
| Select User Scope | Choose own, all or a specified user's jobs |
| Change Interface Language | Choose the extension interface language |
| Filter Jobs | Filter active jobs and history |
| Refresh Partitions | Refresh the partition list |
| Refresh Nodes | Refresh the node list |
| Show Resource Details | Inspect a selected partition or node |
| Show Job History | Locate, expand and refresh sidebar history |
| Find Job by ID | Look up a job by ID |
| Show Job Details | Open job details |
| Follow Standard Output | Follow stdout in a native terminal tab |
| Follow Standard Error | Follow stderr in a native terminal tab |
| Pause Current Output | Pause the selected log terminal |
| Resume Current Output | Resume the selected log terminal |
| Clear Current Output | Clear the selected log terminal display |
| Copy Job ID | Copy a job ID |
| Show Query Output | View query commands and diagnostics |

## Troubleshooting and limitations

- **Slurm commands are not found:** the extension does not load interactive shell initialization scripts. If Slurm requires `module load`, configure `binDirectory` and provide the extension process with the required environment and library paths.
- **Jobs are visible but logs are unreadable:** scheduler visibility and file access are separate permissions. Logs stored only on a compute node's local disk cannot be followed directly from the login node.
- **Delayed logs:** the extension reads only content the application has written to the file. Python jobs can use `python -u` to reduce buffering delays.
- **Resource utilization:** CPU, GPU and memory fields describe requests or allocations. Live GPU utilization, VRAM charts and job-step actual memory peak aggregation are not included.
- The extension queries the default cluster, does not offer federated cluster selection, and requires a trusted workspace.

## Development and publishing

Use Node.js 22 or newer:

```bash
npm ci
npm test
npm run package -- --out ../slurm-job-viewer.vsix
```

Open the source directory in VS Code and press F5 to launch the extension development host. For a read-only live check, compile first and run `node test/live-check.cjs` on a login node. The extension has no third-party runtime dependencies.

The extension ID is `xx025.slurm-job-viewer`. `.github/workflows/publish.yml` uses GitHub Actions Trusted Publishing (OIDC). Manual `publish=false` runs validate and package; `publish=true` publishes to the Marketplace. Publishing a GitHub Release also triggers publication; its tag must match the `package.json` version.

`media/icon.png` is the Marketplace / extension-list icon, `media/icon.svg` is its editable source, and `media/slurm.svg` is the activity-bar icon.
