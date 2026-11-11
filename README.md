# Slurm Explorer

[简体中文](README.zh-CN.md) · [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=xx025.slurm-explorer)

View active Slurm jobs, accounting history, partitions and node resources in VS Code, and open logs in **file editor tabs**. Supports English and Simplified Chinese. Use it through Remote-SSH on a Slurm login node, or locally on Linux with Slurm clients installed.

## Install and update

### Install from the Marketplace

1. Connect to a Slurm login node using **Remote - SSH**.
2. Press `Ctrl+Shift+X` and search for `@id:xx025.slurm-explorer`.
3. Install **Slurm Explorer** on the **SSH host**. If you see **Install in SSH: ...**, select it.
4. Open the **Slurm Explorer** cluster outline icon in the activity bar. The remote OS user is selected by default.

Requires VS Code 1.90 or newer. The remote host must be able to run `squeue`, `scontrol` and `sacct`. The extension uses your existing SSH permissions; no additional HTTP service or token is needed.

### Migrate from the old extension ID

Starting with 0.6.7, the extension ID is `xx025.slurm-explorer`. If you installed `xx025.slurm-job-viewer`, disable the old extension, install the new ID on the same host, and open Slurm Explorer once before uninstalling the old extension. Marketplace updates do not move installations between IDs. Existing `slurmJobs.*` settings remain compatible. On first activation with caching enabled, saved log paths and batch scripts are copied from the old extension storage on the same host if the new cache does not already exist. The old cache is retained; log contents are never copied.

### Update an existing installation

In the Remote-SSH window, open the Extensions view and choose **… → Check for Extension Updates**. Update the copy installed on the SSH host, then run **Developer: Reload Window**.

If the update is not listed yet, download a `.vsix` from [GitHub Releases](https://github.com/xx025/slurm-explorer/releases/latest) and run **Extensions: Install from VSIX...** in the remote window. The repository and release assets are publicly accessible.

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
- **Nodes:** state, allocated / total CPUs, allocated / total GPUs and partition membership (`GPU 2/4` means 2 allocated out of 4 total). Open a node for configured / allocated / free memory, CPU load, GPU/GRES, configured and allocated resources, and maintenance reasons when available.
- Each view has its own **↻** button. Visible views refresh using `slurmJobs.refreshSeconds`; set it to `0` to disable automatic refresh. **Refresh details** queries the controller again.
- Resource views use `scontrol show partition/node --oneliner` (with `--details` for nodes), independently of the job user scope and text filter. Failed queries retain previous results and offer click-to-retry. Cluster permissions determine visibility and available fields.

GPU counts prefer `CfgTRES` / `AllocTRES`, with `Gres` / `GresUsed` fallbacks. Unknown values display as `—`; CPU-only nodes show `0/0`. Counts follow Slurm configuration and allocations, including configured MIG instances, rather than live utilization.

## Sidebar history

A persistent, expandable **History** group appears below active jobs. Expanding it for the first time loads finished jobs from the last 7 days, including completed, failed, cancelled and timed-out jobs, ordered by end time from newest to oldest. Select a historical job to open its details.

- Expand the History group directly, or run **Show Job History** from the command palette to locate, expand and refresh it.
- **↻** refreshes the queue and previously requested history. Select the inline error item to retry a failed history query.
- With automatic refresh enabled and the job view visible, previously requested history refreshes at most once per minute.
- User scope and the text filter apply to both active jobs and history. `slurmJobs.historyDays` controls the lookback window.

History comes from `sacct` allocation records. Disabled accounting, insufficient permissions or purged records can produce empty results or query errors.

## File editor logs

Use a job's output icon or the **Open stdout / Open stderr** buttons in its details to open the actual log file in the VS Code editor. Logs use persistent tabs rather than preview tabs. Opening the same file reuses its document; stderr merged into stdout opens the same file.

- Use native editor search, selection, copy, wrapping and split views. File contents remain unchanged without generated color escapes.
- VS Code handles external file changes. The extension no longer polls logs or provides terminal auto-scroll, pause or clear actions. The editor opens the full file; VS Code handles large-file limits.
- For highlighting, install **Log File Highlighter** (`emilast.LogFileHighlighter`). For `.out` / `.err` files, select **Log** in the status-bar language selector or configure filename associations:

```json
{
  "files.associations": {
    "slurm-*.out": "log",
    "slurm-*.err": "log"
  }
}
```

Add patterns for custom log filenames as needed. Slurm Explorer does not install other extensions or change file associations automatically.

Missing or unreadable files show an error. Open again once the file is available. Files must be accessible from the extension host; Remote-SSH opens remote files.

### Historical job logs

Opening historical output queries accounting on demand for retained fields such as `StdOut` / `StdErr`, `WorkDir` and `JobIDRaw`, resolves the path and supports array-job filename patterns.

**Missing paths fall back to saved paths when available; otherwise an error is reported without a file picker.** When a path exists, the file must still be present on a filesystem accessible from the remote host and readable by the SSH user. Older Slurm versions without log path fields can still display normal history and details.

An explicitly empty controller stderr path uses the merged stdout file. Supported patterns include `%j`, `%A`, `%a`, `%x`, `%u` and numeric padding. Patterns requiring node or task context, such as `%N` or `%t`, may remain unresolved.

## View the submitted batch script

Select **View batch script** in job details, right-click an active or historical job and choose **View Batch Script**, or run **Slurm: View Batch Script** from the command palette and enter a job ID.

The extension uses `scontrol write batch_script <job_id> -` to retrieve the controller-stored submission script and opens it in a read-only `slurm-<job_id>.sh` editor tab. It never executes the script or reads / overwrites a later-edited working copy. Reopening fetches the snapshot again and reuses the same tab. Job, partition and node detail tabs use a Slurm icon with light and dark theme variants.

This is the script submitted to Slurm. If a submission tool rendered a template first, its rendered content appears here. Shell variables, command substitutions and runtime-generated commands remain unexpanded.

If the controller no longer retains the script, the extension tries `sacct --batch-script --jobs=<job_id> --noheader`. Historical scripts require `AccountingStoreFlags=job_script` and a retained record within `slurmJobs.historyDays`. Interactive jobs, denied access, missing scripts and purged records produce explicit errors. Slurm permissions still control script access.

## Cached log paths and batch scripts

Persistent caching is enabled by default and survives VS Code reloads and restarts. **Only log paths are cached; log contents are never copied. Submitted Slurm scripts are cached in full.**

- Opening job details or logs saves resolved absolute stdout / stderr paths and attempts to capture the submitted script in the background. Successfully viewing a script also saves it.
- Each queue refresh processes up to 3 observed jobs owned by the login user in the background. Other users' jobs are not bulk-captured. Attempts for the same job are at least 5 minutes apart; disabling view auto-refresh does not introduce separate queue polling.
- Opening a log queries its current path first. If that lookup fails, the saved path opens the original file in the editor. The file must still exist and be readable; a path cache cannot recover a deleted log.
- Viewing a script queries Slurm first. If both controller and accounting retrieval fail, the saved full script opens read-only and a notification shows when it was saved.
- **History listing, lookback days, ordering and filtering are unchanged.** There is no extra cached-job list. Paths or scripts never captured before records were purged cannot be recovered later.

The cache resides in the extension's persistent storage, on the remote host when using Remote-SSH. It is isolated by host, login and Slurm binary directory, with `0700` directories and `0600` files. The default limit is **64 MiB**; oldest job cache entries are removed when the limit is exceeded.

Use `slurmJobs.cacheEnabled` to enable / disable caching and `slurmJobs.cacheMaxMB` to change the limit. Run **Slurm: Clear Cached Paths and Scripts** from the command palette to clear this connection's cache. Original log files and Slurm jobs remain intact.

## Languages and settings

Run **Slurm: Change Interface Language** from the command palette or the job view's More Actions menu to select Follow VS Code, Simplified Chinese or English. Chinese editor locales default to Simplified Chinese; other locales default to English.

The manual language setting applies to the tree, details and extension messages. Native commands, menus, settings and editor interactions follow VS Code's display language. Slurm fields, state codes, job data and log contents retain their original text.

Configure these in **Remote Settings**:

```json
{
  "slurmJobs.language": "auto",
  "slurmJobs.user": "",
  "slurmJobs.binDirectory": "",
  "slurmJobs.refreshSeconds": 30,
  "slurmJobs.timeoutSeconds": 20,
  "slurmJobs.historyDays": 7,
  "slurmJobs.cacheEnabled": true,
  "slurmJobs.cacheMaxMB": 64
}
```

| Setting | Default | Description |
| --- | --- | --- |
| `slurmJobs.language` | `auto` | `auto` follows VS Code; `zh-cn` selects Simplified Chinese; `en` selects English |
| `slurmJobs.user` | Empty | Remote OS user; `*` selects all users; a username selects that user |
| `slurmJobs.binDirectory` | Empty | Absolute directory containing Slurm commands; empty uses the extension host PATH |
| `slurmJobs.refreshSeconds` | `30` | Visible job / partition / node view refresh interval, 0–3600 seconds; `0` disables view / history auto-refresh without affecting editor file updates |
| `slurmJobs.timeoutSeconds` | `20` | Timeout per Slurm query, 2–120 seconds |
| `slurmJobs.historyDays` | `7` | Accounting history and lookup window, 1–365 days |
| `slurmJobs.cacheEnabled` | `true` | Persist log paths and full submitted scripts, never log contents |
| `slurmJobs.cacheMaxMB` | `64` | Per-connection cache limit in MiB; evict oldest entries when exceeded |

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
| Open Standard Output File | Open stdout in the file editor |
| Open Standard Error File | Open stderr in the file editor |
| View Batch Script | Open Slurm’s stored submission script in a read-only editor |
| Clear Cached Paths and Scripts | Clear saved paths and scripts for this connection |
| Copy Job ID | Copy a job ID |
| Show Query Output | View query commands and diagnostics |

## Troubleshooting and limitations

- **Slurm commands are not found:** the extension does not load interactive shell initialization scripts. If Slurm requires `module load`, configure `binDirectory` and provide the extension process with the required environment and library paths.
- **Jobs are visible but logs are unreadable:** scheduler visibility and file access are separate permissions. Logs stored only on a compute node's local disk cannot be opened directly from the login node.
- **Delayed logs:** the editor can only display content the application has written to the file. Python jobs can use `python -u` to reduce buffering delays.
- **Resource utilization:** CPU, GPU and memory fields describe requests or allocations. Live GPU utilization, VRAM charts and job-step actual memory peak aggregation are not included.
- The extension queries the default cluster, does not offer federated cluster selection, and requires a trusted workspace.

## Development and publishing

Use Node.js 22 or newer:

```bash
npm ci
npm test
npm run package -- --out ../slurm-explorer.vsix
```

Open the source directory in VS Code and press F5 to launch the extension development host. For a read-only live check, compile first and run `node test/live-check.cjs` on a login node. The extension has no third-party runtime dependencies.

The project and extension are named **Slurm Explorer**, with extension ID `xx025.slurm-explorer`. `.github/workflows/publish.yml` uses GitHub Actions Trusted Publishing (OIDC). Manual `publish=false` runs validate and package; `publish=true` publishes to the Marketplace. Publishing a GitHub Release also triggers publication; its tag must match the `package.json` version.

`media/icon.png` is the Marketplace / extension-list icon, `media/icon.svg` is its editable source, and `media/slurm.svg` is the activity-bar icon.
