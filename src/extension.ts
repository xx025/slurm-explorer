import * as vscode from "vscode";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { Job, JobDetails, escapeHtml, groupFor, validateJobId } from "./model";
import { Settings, SlurmClient } from "./slurm";
import { createTranslator, errorMessage, resolveLanguage } from "./i18n";
import { HistoryStore } from "./history";
import { JobOutput } from "./output";
import { ClusterViews } from "./cluster";

type Group = { kind: "group"; label: string; jobs: Job[] };
type JobNode = { kind: "job"; job: Job };
type HistoryGroup = { kind: "history" };
type HistoryJobNode = { kind: "historyJob"; details: JobDetails };
type HistoryStatus = { kind: "historyStatus"; status: "loading" | "error" | "empty" };
type Node = Group | JobNode | HistoryGroup | HistoryJobNode | HistoryStatus;
type JobInput = JobNode | HistoryJobNode | string;

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("slurmJobs");
}

function language() {
  return resolveLanguage(config().get<string>("language", "auto"), vscode.env.language);
}

function t(text: string, ...values: (string | number)[]): string {
  return createTranslator(language())(text, ...values);
}

function locale(): string { return language() === "zh-cn" ? "zh-CN" : "en"; }
function userLabel(user = settings().user): string { return user === "*" ? t("All users") : user; }

function settings(): Settings {
  return {
    user: config().get<string>("user", "").trim() || os.userInfo().username,
    binDirectory: config().get<string>("binDirectory", "").trim(),
    timeoutSeconds: config().get<number>("timeoutSeconds", 20),
    historyDays: config().get<number>("historyDays", 7)
  };
}

class JobTree implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  jobs: Job[] = [];
  filter = "";
  readonly historyRoot: HistoryGroup = { kind: "history" };
  readonly history: HistoryStore;
  historyRequested = false;

  constructor(client: SlurmClient) {
    this.history = new HistoryStore(() => client.history(), () => this.emitter.fire(undefined));
  }

  update(jobs: Job[]): void { this.jobs = jobs; this.emitter.fire(undefined); }
  setFilter(value: string): void { this.filter = value; this.emitter.fire(undefined); }

  private historyRecords(): JobDetails[] {
    const active = new Set(this.jobs.map(job => job.id));
    const needle = this.filter.toLowerCase();
    return this.history.records.filter(record => !active.has(record.id) && (!needle ||
      [record.id, record.fields.JobName, record.fields.User, record.fields.State, record.fields.Partition]
        .some(value => value?.toLowerCase().includes(needle))));
  }

  refreshHistory(force = false): Promise<void> {
    if (!this.historyRequested) { return Promise.resolve(); }
    return this.history.load(force);
  }

  resetHistory(): void {
    this.history.reset();
    void this.refreshHistory();
  }

  getTreeItem(element: Node): vscode.TreeItem {
    if (element.kind === "history") {
      const count = this.history.loaded ? ` (${this.historyRecords().length})` : "";
      const item = new vscode.TreeItem(`${t("History")}${count}`, vscode.TreeItemCollapsibleState.Collapsed);
      item.id = "group:History";
      item.iconPath = new vscode.ThemeIcon("history");
      item.contextValue = "slurmHistory";
      item.description = t("Last {0} days", settings().historyDays);
      item.tooltip = t("Finished jobs · {0} · last {1} days", userLabel(), settings().historyDays);
      return item;
    }
    if (element.kind === "historyStatus") {
      const label = element.status === "loading" ? t("Loading history…")
        : element.status === "error" ? t("Could not load history. Click to retry.")
          : this.filter ? t("No jobs match the current filter.") : t("No finished jobs in this time window.");
      const item = new vscode.TreeItem(label);
      item.id = "history:status";
      item.iconPath = new vscode.ThemeIcon(element.status === "loading" ? "loading~spin" : element.status === "error" ? "warning" : "info");
      if (element.status === "error") {
        item.tooltip = message(this.history.error);
        item.command = { command: "slurm.history", title: t("Retry history") };
      }
      return item;
    }
    if (element.kind === "historyJob") {
      const { id, fields } = element.details;
      const item = new vscode.TreeItem(`${id}  ${fields.JobName}`);
      item.id = `historyJob:${id}`;
      item.description = `${fields.User} · ${fields.State} · ${fields.Partition} · ${fields.Elapsed}`;
      item.contextValue = "slurmJob";
      item.command = { command: "slurm.details", title: t("Show Job Details"), arguments: [element] };
      item.iconPath = new vscode.ThemeIcon(fields.State.startsWith("COMPLETED") ? "pass" : "circle-slash");
      item.tooltip = [
        t("Job: {0} ({1})", id, fields.JobName), t("User: {0}", fields.User),
        t("State: {0}", fields.State), t("Partition: {0}", fields.Partition),
        t("Start: {0} · End: {1} · Exit: {2}", fields.Start, fields.End, fields.ExitCode)
      ].join("\n");
      return item;
    }
    if (element.kind === "group") {
      const item = new vscode.TreeItem(`${t(element.label)} (${element.jobs.length})`, vscode.TreeItemCollapsibleState.Expanded);
      item.id = `group:${element.label}`;
      return item;
    }
    const job = element.job;
    const item = new vscode.TreeItem(`${job.id}  ${job.name}`);
    item.id = `job:${job.id}`;
    item.description = `${job.user} · ${job.state} · ${job.elapsed} · ${job.partition}`;
    item.contextValue = "slurmJob";
    item.command = { command: "slurm.details", title: t("Show Job Details"), arguments: [element] };
    const icon = groupFor(job.state) === "Running" ? "play-circle" : groupFor(job.state) === "Pending" ? "clock" : "circle-outline";
    item.iconPath = new vscode.ThemeIcon(icon);
    item.tooltip = [
      t("Job: {0} ({1})", job.id, job.name), t("User: {0}", job.user), t("State: {0}", job.state),
      t("Partition: {0}", job.partition), t("Elapsed / limit: {0} / {1}", job.elapsed, job.timeLimit),
      t("CPUs: {0} · Nodes: {1}", job.cpus, job.nodes), t("Requested minimum memory: {0}", job.memory),
      t("GRES: {0}", job.resources), t("Nodes / pending reason: {0}", job.reason)
    ].join("\n");
    return item;
  }

  getChildren(element?: Node): Node[] {
    if (element?.kind === "history") {
      this.historyRequested = true;
      if (!this.history.loaded && !this.history.loading) { void this.history.load(); }
      if (this.history.error) { return [{ kind: "historyStatus", status: "error" }]; }
      const records = this.historyRecords();
      const children: Node[] = records.map(details => ({ kind: "historyJob", details }));
      if (this.history.loading) { children.push({ kind: "historyStatus", status: "loading" }); }
      if (!children.length) { children.push({ kind: "historyStatus", status: "empty" }); }
      return children;
    }
    if (element?.kind === "job" || element?.kind === "historyJob" || element?.kind === "historyStatus") { return []; }
    if (element?.kind === "group") { return element.jobs.map(job => ({ kind: "job", job })); }
    const needle = this.filter.toLowerCase();
    const jobs = this.jobs.filter(job => !needle || [
      job.id, job.name, job.state, job.partition, job.user, job.reason
    ].some(value => value.toLowerCase().includes(needle)));
    const groups: Node[] = ["Running", "Pending", "Other"].map(label => ({
      kind: "group" as const, label, jobs: jobs.filter(job => groupFor(job.state) === label)
    })).filter(group => group.jobs.length);
    return [...groups, this.historyRoot];
  }

  getParent(element: Node): Node | undefined {
    if (element.kind === "historyJob" || element.kind === "historyStatus") { return this.historyRoot; }
    return undefined;
  }

  dispose(): void { this.history.dispose(); this.emitter.dispose(); }
}

function message(error: unknown): string { return errorMessage(error, t); }

function renderDetails(details: JobDetails): string {
  const escape = escapeHtml;
  const fields = details.fields;
  const nonce = randomBytes(18).toString("base64");
  const summary: [string, string[]][] = [
    ["State", ["JobState", "State"]], ["User", ["UserId", "User"]],
    ["Partition", ["Partition"]], ["Pending reason", ["Reason"]],
    ["Run time", ["RunTime", "Elapsed"]], ["Time limit", ["TimeLimit", "Timelimit"]],
    ["CPUs", ["NumCPUs", "AllocCPUS"]], ["Nodes", ["NumNodes", "NNodes"]],
    ["Requested memory / node", ["MinMemoryNode"]], ["Requested memory / CPU", ["MinMemoryCPU"]],
    ["Requested memory (c=CPU, n=node)", ["ReqMem"]],
    ["Requested resources", ["ReqTRES"]], ["Allocated resources", ["AllocTRES", "TRES"]],
    ["GRES / node", ["TresPerNode", "Gres"]], ["Node list", ["NodeList"]],
    ["Submit time", ["SubmitTime"]], ["Start time", ["StartTime", "Start"]],
    ["End time", ["EndTime", "End"]], ["Exit code", ["ExitCode"]],
    ["Working directory", ["WorkDir"]], ["Command", ["Command"]],
    ["Standard output", ["StdOut"]], ["Standard error", ["StdErr"]]
  ];
  const rows = summary.map(([label, keys]) => {
    let value = keys.map(key => fields[key]).find(value => value !== undefined && value !== "");
    if (label === "Standard error" && fields.StdErr === "" && fields.StdOut && details.source === "scontrol") {
      value = t("{0} (merged into stdout)", fields.StdOut);
    }
    return value === undefined ? "" : `<tr><th>${escape(t(label))}</th><td>${escape(value)}</td></tr>`;
  }).join("");
  const all = Object.entries(fields).map(([key, value]) => `<tr><th>${escape(key)}</th><td>${escape(value)}</td></tr>`).join("");
  return `<!DOCTYPE html>
<html lang="${language()}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:24px;max-width:1100px;margin:auto}
h1{font-size:24px;font-weight:600;margin-bottom:6px} .meta{color:var(--vscode-descriptionForeground);margin:8px 0 20px}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px}
button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:1px solid transparent;padding:7px 13px;cursor:pointer}
button:hover{background:var(--vscode-button-hoverBackground)}button:focus-visible{outline:1px solid var(--vscode-focusBorder)}
table{width:100%;border-collapse:collapse;margin-bottom:24px}th,td{border-bottom:1px solid var(--vscode-panel-border);padding:10px 8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
th{width:210px;font-weight:500;color:var(--vscode-descriptionForeground)}td{white-space:pre-wrap}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--vscode-textCodeBlock-background);padding:16px}
summary{cursor:pointer;padding:12px 0}.note{color:var(--vscode-descriptionForeground);line-height:1.6}
@media(max-width:540px){body{padding:12px}th{width:125px}}
</style></head><body>
<h1>${escape(t("Job {0}", details.id))} · ${escape(fields.JobName || "")}</h1>
<p class="meta">${escape(details.source)} · ${escape(new Date().toLocaleString(locale()))}</p>
<div class="actions"><button data-action="refresh">${escape(t("Refresh details"))}</button><button data-action="stdout">${escape(t("Open stdout"))}</button><button data-action="stderr">${escape(t("Open stderr"))}</button></div>
<table aria-label="${escape(t("Job details"))}">${rows}</table>
<p class="note">${escape(t("Resource fields describe the request or allocation. Live GPU utilization and actual memory usage require additional cluster accounting or monitoring."))}
${details.source === "sacct" ? escape(t("This job was loaded from accounting. Controller-only fields such as log paths may be unavailable.")) : ""}</p>
<details><summary>${escape(t("All fields"))}</summary><table>${all}</table></details>
<details><summary>${escape(t("Raw {0} output", details.source))}</summary><pre>${escape(details.raw)}</pre></details>
<script nonce="${nonce}">const api=acquireVsCodeApi();document.querySelectorAll('button[data-action]').forEach(button=>button.addEventListener('click',()=>api.postMessage({action:button.dataset.action})));</script>
</body></html>`;
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Slurm Explorer");
  const client = new SlurmClient(settings, text => output.appendLine(`[${new Date().toISOString()}] ${text}`));
  const tree = new JobTree(client);
  const view = vscode.window.createTreeView("slurmJobs", { treeDataProvider: tree, showCollapseAll: true });
  const cluster = new ClusterViews(client, t, language, message);
  const jobOutput = new JobOutput();
  const panels = new Map<string, vscode.WebviewPanel>();
  const panelDetails = new Map<string, JobDetails>();
  let pendingRefresh: Promise<void> | undefined;
  let refreshAgain = false;
  let timer: NodeJS.Timeout | undefined;
  let disposed = false;
  let logRequest = 0;
  context.subscriptions.push(output, tree, view, jobOutput, cluster,
  );

  async function refresh(force = false): Promise<void> {
    if (pendingRefresh) {
      if (force) { refreshAgain = true; }
      return pendingRefresh;
    }
    pendingRefresh = (async () => {
      do {
        refreshAgain = false;
        const requestedUser = settings().user;
        view.title = t("Jobs");
        view.message = t("Querying Slurm…");
        try {
          const jobs = await client.queue();
          if (disposed) { return; }
          if (requestedUser !== settings().user) { refreshAgain = true; continue; }
          tree.update(jobs);
          await vscode.commands.executeCommand("setContext", "slurm.hasJobs", jobs.length > 0);
          view.message = t("{0} · {1} jobs · {2}", userLabel(requestedUser), jobs.length, new Date().toLocaleTimeString(locale()))
            + (tree.filter ? t(" · filter: {0}", tree.filter) : "");
        } catch (error) {
          if (disposed) { return; }
          if (requestedUser !== settings().user) { refreshAgain = true; continue; }
          view.message = `${tree.jobs.length ? t("Showing previous results. ") : ""}${message(error)}`;
        }
      } while (refreshAgain && !disposed);
    })().finally(() => {
      pendingRefresh = undefined;
      if (refreshAgain && !disposed) { void refresh(); }
    });
    return pendingRefresh;
  }

  async function chooseId(input?: JobInput): Promise<string | undefined> {
    if (typeof input === "string") { return validateJobId(input); }
    if (input?.kind === "job") { return validateJobId(input.job.id); }
    if (input?.kind === "historyJob") { return validateJobId(input.details.id); }
    const value = await vscode.window.showInputBox({
      title: t("Find Slurm job"), prompt: t("Job ID, array element (123_4), or heterogeneous component (123+1)"),
      validateInput: value => { try { validateJobId(value); return undefined; } catch (error) { return message(error); } }
    });
    return value === undefined ? undefined : validateJobId(value);
  }

  async function openLog(id: string, stream: "StdOut" | "StdErr", known?: JobDetails): Promise<void> {
    const request = ++logRequest;
    const details = await client.logDetails(id, known);
    if (disposed) { return; }
    await jobOutput.open(details, stream, () => request === logRequest);
  }

  async function showDetails(id: string, known?: JobDetails): Promise<void> {
    const existing = panels.get(id);
    if (existing) { existing.reveal(); return; }
    const details = known ?? await client.details(id);
    if (disposed) { return; }
    // Concurrent clicks may have opened the same job while querying.
    const opened = panels.get(id);
    if (opened) { opened.reveal(); return; }
    const panel = vscode.window.createWebviewPanel("slurmDetails", `Slurm ${id}`, vscode.ViewColumn.Active, {
      enableScripts: true, localResourceRoots: [], retainContextWhenHidden: false
    });
    panels.set(id, panel);
    let current = details;
    let busy = false;
    let closed = false;
    panelDetails.set(id, details);
    panel.webview.html = renderDetails(details);
    const receiver = panel.webview.onDidReceiveMessage(async (data: unknown) => {
      if (!data || typeof data !== "object" || !("action" in data) || busy || closed) { return; }
      busy = true;
      try {
        if (data.action === "refresh") {
          current = await client.details(id);
          if (!closed) { panelDetails.set(id, current); panel.webview.html = renderDetails(current); }
        } else if (data.action === "stdout") { await openLog(id, "StdOut", current); }
        else if (data.action === "stderr") { await openLog(id, "StdErr", current); }
      } catch (error) { void vscode.window.showErrorMessage(message(error)); }
      finally { busy = false; }
    });
    panel.onDidDispose(() => { closed = true; receiver.dispose(); panels.delete(id); panelDetails.delete(id); });
  }

  function register(name: string, action: (input?: JobInput) => unknown): void {
    context.subscriptions.push(vscode.commands.registerCommand(name, async (input?: JobInput) => {
      try { await action(input); } catch (error) { void vscode.window.showErrorMessage(message(error)); }
    }));
  }

  register("slurm.refresh", async () => {
    await Promise.all([refresh(), tree.refreshHistory(true), cluster.refreshVisible()]);
  });
  register("slurm.output", () => output.show());
  register("slurm.selectUser", async () => {
    const ownUser = os.userInfo().username;
    const configured = config().get<string>("user", "").trim();
    const picked = await vscode.window.showQuickPick([
      { label: t("Only me ({0})", ownUser), value: "", description: configured === "" || configured === ownUser ? "$(check)" : "" },
      { label: t("All users"), value: "*", description: configured === "*" ? "$(check)" : "" },
      { label: t("Specified user…"), value: "custom", description: configured && configured !== "*" && configured !== ownUser ? configured : "" }
    ], { title: t("Choose whose jobs to show"), placeHolder: t("The queue and history use this user scope.") });
    if (!picked) { return; }
    let value = picked.value;
    if (value === "custom") {
      const input = await vscode.window.showInputBox({
        title: t("Slurm username"), prompt: t("Enter one Slurm username, or * for all users."),
        value: configured === "*" ? "" : configured,
        validateInput: text => /^[^\s,\x00-\x1f\x7f]+$/.test(text.trim())
          ? undefined : t("Enter a username without spaces, commas or control characters.")
      });
      if (input === undefined) { return; }
      value = input.trim();
    }
    await config().update("user", value, vscode.ConfigurationTarget.Global);
    await refresh();
  });
  register("slurm.language", async () => {
    const picked = await vscode.window.showQuickPick([
      { label: t("Follow VS Code"), value: "auto" },
      { label: "简体中文", value: "zh-cn" },
      { label: "English", value: "en" }
    ], { title: t("Choose interface language"), placeHolder: t("Native command and settings labels follow the VS Code display language.") });
    if (picked) { await config().update("language", picked.value, vscode.ConfigurationTarget.Global); }
  });
  register("slurm.filter", async () => {
    const value = await vscode.window.showInputBox({
      title: t("Filter Slurm jobs"), value: tree.filter,
      prompt: t("Match job ID, name, state, partition, user or pending reason. Clear to show all.")
    });
    if (value !== undefined) { tree.setFilter(value.trim()); await refresh(); }
  });
  register("slurm.details", async input => {
    const id = await chooseId(input);
    if (id) { await showDetails(id, typeof input === "object" && input.kind === "historyJob" ? input.details : undefined); }
  });
  register("slurm.lookup", async () => { const id = await chooseId(); if (id) { await showDetails(id); } });
  register("slurm.stdout", async input => {
    const id = await chooseId(input);
    if (id) { await openLog(id, "StdOut", typeof input === "object" && input.kind === "historyJob" ? input.details : undefined); }
  });
  register("slurm.stderr", async input => {
    const id = await chooseId(input);
    if (id) { await openLog(id, "StdErr", typeof input === "object" && input.kind === "historyJob" ? input.details : undefined); }
  });
  register("slurm.copyId", async input => { const id = await chooseId(input); if (id) { await vscode.env.clipboard.writeText(id); } });
  register("slurm.history", async () => {
    tree.historyRequested = true;
    await vscode.commands.executeCommand("slurmJobs.focus");
    const loading = tree.history.load(true);
    await view.reveal(tree.historyRoot, { expand: true, select: false, focus: true });
    await loading;
  });

  function configureTimer(): void {
    if (timer) { clearInterval(timer); }
    const seconds = config().get<number>("refreshSeconds", 30);
    if (seconds > 0) {
      timer = setInterval(() => {
        void cluster.refreshVisible();
        if (view.visible) {
          void refresh();
          if (Date.now() - tree.history.loadedAt >= 60000) { void tree.refreshHistory(true); }
        }
      }, seconds * 1000);
    }
  }
  context.subscriptions.push(
    view.onDidChangeVisibility(event => { if (event.visible) { void refresh(); } }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration("slurmJobs")) {
        if (event.affectsConfiguration("slurmJobs.user")) {
          tree.update([]);
          void vscode.commands.executeCommand("setContext", "slurm.hasJobs", false);
        }
        if (event.affectsConfiguration("slurmJobs.user") || event.affectsConfiguration("slurmJobs.historyDays")) {
          tree.resetHistory();
        }
        if (event.affectsConfiguration("slurmJobs.language")) {
          cluster.labels();
          tree.update(tree.jobs);
          for (const [id, panel] of panels) {
            const details = panelDetails.get(id);
            if (details) { panel.webview.html = renderDetails(details); }
          }
        }
        if (event.affectsConfiguration("slurmJobs.binDirectory")) { cluster.reset(); }
        configureTimer();
        void refresh(true);
      }
    }),
    { dispose: () => {
      disposed = true;
      if (timer) { clearInterval(timer); }
      for (const panel of [...panels.values()]) { panel.dispose(); }
    } }
  );
  configureTimer();
  void refresh();
  void cluster.refreshVisible();
}
