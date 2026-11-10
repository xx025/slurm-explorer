# Slurm Job Viewer

View Slurm queues, job details, accounting history and log previews in VS Code.

Download the installable package from [GitHub Releases](https://github.com/xx025/slurm-job-viewer/releases/latest).

## Installation

1. Connect to a Slurm login node using **Remote - SSH**.
2. Run **Extensions: Install from VSIX...** and select `slurm-job-viewer-0.5.0.vsix`.
3. Ensure the extension is installed on the SSH host.
4. Open **Slurm** from the activity bar.

The extension runs `squeue`, `scontrol` and `sacct` on the extension host. These commands must be available there. If needed, configure their absolute directory using `slurmJobs.binDirectory`.

## User scope

Click the user icon above the job list, or run **Slurm: Select User Scope**:

- **Only me**: query the remote OS user.
- **All users**: query jobs visible to your current account.
- **Specified user**: enter a Slurm username.

The selected scope applies to both the queue and accounting history. Each job row includes its owner. You can also search by owner using the text filter.

Cluster privacy settings and filesystem permissions still apply. The extension uses your existing login permissions.

## Chinese and English

The task list, tooltips, job details, dialogs and log preview labels follow the VS Code display language by default. Chinese editor locales use Simplified Chinese; other locales use English.

Run **Slurm: Change Interface Language** from the command palette or the view's More Actions menu to choose:

- Follow VS Code (`auto`)
- 简体中文 (`zh-cn`)
- English (`en`)

Open job details update when this setting changes. Native command, menu, welcome and settings labels follow the VS Code display language. Slurm field names, state codes, scheduler diagnostics, job data and log contents retain the cluster's original text.

## Features

- Jobs grouped into Running, Pending and Other.
- A persistent History group below the active jobs, with finished jobs ordered by completion time.
- Owner, state, partition, elapsed time, CPU count, requested memory and GRES.
- Detailed resource allocations, pending reason, nodes, working directory, command and timestamps.
- Job ID lookup, expanded array tasks and heterogeneous components.
- Accounting history, including exit codes and start/end times.
- Open historical details directly from the sidebar. The history toolbar action expands and refreshes this group instead of opening a picker.
- Read-only stdout and stderr previews, bounded to the file tail.
- Automatic queue refresh and independent live log following in native terminal tabs.

## Settings

Configure these in the remote settings:

```json
{
  "slurmJobs.user": "",
  "slurmJobs.language": "auto",
  "slurmJobs.binDirectory": "",
  "slurmJobs.refreshSeconds": 30,
  "slurmJobs.timeoutSeconds": 20,
  "slurmJobs.historyDays": 7,
  "slurmJobs.logTailKB": 256
}
```

An empty user uses the remote OS username; `*` selects all users. Set the refresh interval to `0` to disable automatic refresh.

History loads when first expanded. The Refresh action reloads it, and accounting errors can be retried inside the tree. Previously requested history refreshes automatically at most once per minute while the job view is visible. User scope, language and the text filter apply to both active jobs and history.

## Limitations

Job details use `scontrol` with a fallback to `sacct` after the controller releases the job. Accounting-only records may lack log paths. Logs must be accessible from the extension host.

Resource fields show requested or allocated resources. Live GPU utilization, VRAM charts and job-step memory peaks are not included.

The extension queries the default cluster and does not load interactive shell initialization scripts. It requires a trusted workspace.

## Development

Use Node.js 22 or newer:

```bash
npm ci
npm test
npm run package -- --out ../slurm-job-viewer-0.5.0.vsix
```

Open the source directory in VS Code and press F5 to launch the extension development host. For a read-only live backend check on a Slurm login node, compile first and run `node test/live-check.cjs`.

## Marketplace publishing

The publisher is `xx025` and the extension ID is `xx025.slurm-job-viewer`.

Create a GitHub Actions Trusted Publishing policy with:

| Field | Value |
| --- | --- |
| Policy name | `slurm-job-viewer-release` |
| Repository owner | `xx025` |
| Repository | `slurm-job-viewer` |
| Workflow | `publish.yml` |
| Environment | Leave empty |

The workflow is `.github/workflows/publish.yml`. Manual runs with `publish=false` only test, package and upload the build artifact. Set `publish=true` to publish with OIDC. Publishing a GitHub Release also triggers Marketplace publishing; its tag must match the package version, such as `v0.5.0`.

## Native terminal log tabs

Open a job's stdout / stderr to create a native terminal tab such as `Slurm 14115 · stdout`. Different tasks and streams keep separate tabs; reopening the same output reuses its tab. Use the native terminal tab list to switch, rename or close. Closing a tab stops only its log follower and does not cancel the Slurm job.

New output is read every 2 seconds, initially tailing up to 256 KiB (`slurmJobs.logTailKB`). Display retention uses `terminal.integrated.scrollback`. ANSI and progress carriage returns are preserved; bare LF becomes CRLF to avoid staircase line breaks. Native selection, copy, find, scrolling and reflow apply.

Select a log terminal and run `Slurm: Pause Current Output`, `Resume Current Output`, or `Clear Current Output` from the command palette. Each tab follows independently. No shell is started and terminal input does not execute commands.

Opening a historical log queries accounting for stored StdOut / StdErr, WorkDir and JobIDRaw, including array filename patterns. Missing paths are reported without a file picker. Files must remain readable on the remote host; missing or temporarily unavailable files retry automatically. Application buffering can delay writes; Python jobs can use `python -u`.
