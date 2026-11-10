# Changelog

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
