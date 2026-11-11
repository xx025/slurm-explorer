# Changelog

## 0.6.4

- Persist resolved stdout / stderr paths and complete Slurm batch scripts across extension restarts; never copy log contents into the cache.
- Fall back to saved log paths and script snapshots when Slurm metadata or script retrieval fails, with saved-time notifications.
- Capture paths and scripts when opening details or logs, and make bounded background captures for observed jobs owned by the login user. Keep history listing behavior unchanged.
- Add a configurable 64 MiB cache limit, oldest-entry cleanup, connection isolation and a command to clear saved paths and scripts.
- Make English the default README and retain Simplified Chinese documentation.

## 0.6.3

- Add View Batch Script to job details, job context menus and the command palette. Open the controller-stored submission script as a read-only editor document; reuse tabs and refresh on reopen.
- Fall back to sacct --batch-script for historical records, with explicit unavailable / permission diagnostics when scripts are not retained.
- Add Slurm tab icons to job details with separate light and dark theme assets.
- Verify script retrieval over SSH against a running job and the unavailable historical-script fallback.

## 0.6.2

- Open actual stdout / stderr files in persistent VS Code editor tabs, including resolved historical log paths and merged streams.
- Let native editor features and log-highlighting extensions handle display, colors and file updates.
- Remove pseudoterminal log following, generated ANSI colors, pause / resume / clear commands, and terminal-only settings.
- Keep delayed log requests from stealing focus after a newer click or extension disposal.

## 0.6.1

- Show allocated / total GPU counts in node rows, tooltips and details, with TRES and GRES fallback parsing.
- Preserve unknown GPU metadata, handle mixed models and device indices, and avoid counting aggregate and typed TRES twice.
- Simplify the Slurm icon to nine outline nodes, removing the small lettering and peripheral blocks.

## 0.6.0

- Rename the project and extension display name to Slurm Explorer, keeping the extension ID xx025.slurm-job-viewer for existing users.

- Add independent partition and node views with resource summaries, details, manual refresh, visible-view polling and Chinese / English labels.
- Query cluster resources through scontrol without applying the job user filter.

- Remove the history button from the view toolbar; retain the sidebar History group and command.
- Color complete plain log lines by severity, with an outputColors setting; preserve native ANSI and immediate progress updates.
- Redesign activity bar and Marketplace icons around the Slurm stepped node array and outlined SLURM lettering.

## 0.5.4

- Separate the icon into two distinct layers: the Slurm cluster and lettering above, and a large eye in its own lower band.

## 0.5.3

- Restyle the Marketplace icon with blue cluster blocks, black SLURM lettering and a small eye detail on a white background.

## 0.5.2

- Use an eye and prominent SLURM lettering for the Marketplace icon, with a matching eye icon in the activity bar.

## 0.5.1

- Rewrite Chinese and English documentation with matching installation, update, history, native terminal log, settings and command guides.
- Add a Marketplace and extension-list icon with prominent SLURM lettering and connected cluster nodes.

## 0.5.0

- Follow each job / stream in a native VS Code terminal tab; retain independent followers and reuse existing tabs.
- Preserve progress carriage returns and ANSI, and normalize bare LF to CRLF for correct terminal line breaks.
- Enrich historical log metadata from accounting when supported; report missing paths without a manual file prompt.
- Add commands to pause, resume and clear the selected output terminal.

## 0.4.0

- Follow stdout / stderr in a dedicated bottom Slurm Output panel, updating every 2 seconds.
- Add pause / resume, stream selection, clear, stop, and auto-scroll controls in English and Chinese.
- Read bounded increments, handle UTF-8 boundaries, truncation and rotation, and retry unavailable logs.

## 0.3.0

- Moved job history into an expandable group in the left sidebar.
- Open historical job details directly from the tree instead of a search picker.
- Show finished jobs in reverse completion order and hide active queue jobs.
- Added lazy history loading, empty states and inline retry after accounting errors.
- Keep sidebar history synchronized with user scope, filters and interface language.

## 0.2.1

- Set the Marketplace publisher to xx025.
- Added a GitHub Actions workflow for trusted publishing with OIDC.
- Added a build-only workflow mode to validate packages before publishing.
- Updated the packaging tool to support trusted publishing.

## 0.2.0

- Added a user scope selector for own, all and specified user jobs.
- Show job owners in queue and history rows.
- Added Chinese and English localization for native labels, details, prompts and log previews.
- Added automatic language detection and a manual language selector.
- Refresh open details and logs after changing the language.
- Prevent results from an older user scope from replacing a newer selection.

## 0.1.0

- Added Remote-SSH workspace extension with grouped Slurm queue view.
- Added job details, array job expansion, history search and ID lookup.
- Added bounded, read-only stdout / stderr previews.
- Added configurable polling, query timeout and binary directory.
