import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { ClusterResource, ResourceKind, escapeHtml } from "./model";
import { Translator } from "./i18n";
import { SlurmClient } from "./slurm";
import { gpuCounts } from "./gpu";

type Status = { status: "loading" | "error" | "empty" };
type ResourceNode = ClusterResource | Status;

/** Independent views keep cluster visibility separate from the selected job user. */
export class ResourceTree implements vscode.TreeDataProvider<ResourceNode>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<ResourceNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  readonly view: vscode.TreeView<ResourceNode>;
  records: ClusterResource[] = [];
  private requested = false;
  private error?: unknown;
  private pending?: Promise<void>;
  private generation = 0;
  private disposed = false;

  constructor(readonly kind: ResourceKind, private readonly load: () => Promise<ClusterResource[]>,
    private readonly t: Translator, private readonly message: (error: unknown) => string) {
    this.view = vscode.window.createTreeView(kind === "partition" ? "slurmPartitions" : "slurmNodes", {
      treeDataProvider: this
    });
    this.labels();
  }

  labels(): void {
    this.view.title = this.kind === "partition" ? this.t("Partitions") : this.t("Cluster nodes");
    if (this.error) {
      this.view.message = (this.records.length ? this.t("Showing previous results. ") : "") + this.message(this.error);
    }
    this.emitter.fire(undefined);
  }

  getChildren(element?: ResourceNode): ResourceNode[] {
    if (element) { return []; }
    if (!this.requested) { void this.refresh(); }
    const children: ResourceNode[] = [...this.records];
    if (this.pending) { children.push({ status: "loading" }); }
    else if (this.error) { children.push({ status: "error" }); }
    else if (!children.length) { children.push({ status: "empty" }); }
    return children;
  }

  getTreeItem(element: ResourceNode): vscode.TreeItem {
    if ("status" in element) {
      const item = new vscode.TreeItem(element.status === "loading" ? this.t("Querying Slurm…")
        : element.status === "error" ? this.t("Could not load resources. Click to retry.")
          : this.t("No resources returned."));
      item.iconPath = new vscode.ThemeIcon(element.status === "loading" ? "loading~spin"
        : element.status === "error" ? "warning" : "info");
      if (element.status === "error") {
        item.tooltip = this.message(this.error);
        item.command = { command: this.refreshCommand, title: this.t("Refresh resources") };
      }
      return item;
    }
    const f = element.fields;
    const gpu = gpuCounts(f);
    const item = new vscode.TreeItem(element.name + (f.Default === "YES" ? " *" : ""));
    item.id = `${this.kind}:${element.name}`;
    item.contextValue = `slurm${this.kind}`;
    item.iconPath = new vscode.ThemeIcon(/DOWN|DRAIN|FAIL|INVAL/.test(f.State ?? "") ? "warning"
      : this.kind === "partition" ? "server-environment" : "server");
    item.description = this.kind === "partition"
      ? this.t("{0} · {1} nodes · {2} CPUs", f.State ?? "—", f.TotalNodes ?? "—", f.TotalCPUs ?? "—")
      : this.t("{0} · CPU {1}/{2} · GPU {3}/{4} · {5}", f.State ?? "—", f.CPUAlloc ?? "—",
        f.CPUTot ?? "—", gpu.allocated ?? "—", gpu.total ?? "—", f.Partitions ?? "—");
    item.tooltip = [
      ...(this.kind === "node" ? [
        this.t("GPUs (total): {0}", gpu.total ?? "—"),
        this.t("GPUs (allocated): {0}", gpu.allocated ?? "—")
      ] : []),
      ...Object.entries(f).map(([key, value]) => `${key}: ${value}`)
    ].join("\n");
    item.command = { command: "slurm.resourceDetails", title: this.t("Resource details"), arguments: [element] };
    return item;
  }

  get refreshCommand(): string {
    return this.kind === "partition" ? "slurm.refreshPartitions" : "slurm.refreshNodes";
  }

  get failure(): unknown { return this.error; }

  refresh(): Promise<void> {
    if (this.disposed) { return Promise.resolve(); }
    if (this.pending) { return this.pending; }
    this.requested = true;
    const generation = this.generation;
    // Start the query in a microtask, after pending is assigned for tree updates.
    this.pending = Promise.resolve().then(() => this.load()).then(records => {
      if (this.disposed || generation !== this.generation) { return; }
      this.records = records;
      this.error = undefined;
      this.view.message = undefined;
    }, error => {
      if (this.disposed || generation !== this.generation) { return; }
      this.error = error;
      this.view.message = (this.records.length ? this.t("Showing previous results. ") : "") + this.message(error);
    }).finally(() => {
      if (this.disposed || generation !== this.generation) { return; }
      this.pending = undefined;
      this.emitter.fire(undefined);
    });
    this.emitter.fire(undefined);
    return this.pending;
  }

  reset(): void {
    this.generation++;
    this.pending = undefined;
    this.requested = false;
    this.records = [];
    this.error = undefined;
    this.view.message = undefined;
    this.emitter.fire(undefined);
  }

  dispose(): void {
    this.disposed = true;
    this.emitter.dispose();
    this.view.dispose();
  }
}

export function renderResource(resource: ClusterResource, t: Translator, language: string): string {
  const escape = escapeHtml;
  const nonce = randomBytes(18).toString("base64");
  const f = resource.fields;
  const gpu = gpuCounts(f);
  const gpuRows = resource.kind === "node" ? [
    `<tr><th>${escape(t("GPUs (total)"))}</th><td>${gpu.total ?? "—"}</td></tr>`,
    `<tr><th>${escape(t("GPUs (allocated)"))}</th><td>${gpu.allocated ?? "—"}</td></tr>`
  ].join("") : "";
  const summary: [string, string[]][] = resource.kind === "partition" ? [
    ["State", ["State"]], ["Default partition", ["Default"]], ["Nodes", ["TotalNodes"]],
    ["CPUs", ["TotalCPUs"]], ["Time limit", ["MaxTime"]], ["Node list", ["Nodes"]],
    ["Allowed accounts", ["AllowAccounts"]], ["Allowed groups", ["AllowGroups"]],
    ["Available resources", ["TRES"]]
  ] : [
    ["State", ["State"]], ["Partitions", ["Partitions"]], ["CPUs", ["CPUTot"]],
    ["Allocated CPUs", ["CPUAlloc"]], ["CPU load", ["CPULoad"]],
    ["Configured memory (MB)", ["RealMemory"]], ["Allocated memory (MB)", ["AllocMem"]],
    ["Free memory (MB)", ["FreeMem"]], ["GRES / node", ["Gres"]],
    ["Available resources", ["CfgTRES"]], ["Allocated resources", ["AllocTRES"]],
    ["Active features", ["ActiveFeatures"]], ["Reason", ["Reason"]]
  ];
  const rows = summary.map(([label, keys]) => {
    const value = keys.map(key => f[key]).find(value => value !== undefined);
    return value === undefined ? "" : `<tr><th>${escape(t(label))}</th><td>${escape(value)}</td></tr>`;
  }).join("");
  const all = Object.entries(f).map(([key, value]) => `<tr><th>${escape(key)}</th><td>${escape(value)}</td></tr>`).join("");
  return `<!DOCTYPE html><html lang="${escape(language)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:24px;max-width:1100px;margin:auto}
h1{font-size:24px}table{border-collapse:collapse;width:100%;margin:20px 0}th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--vscode-panel-border);vertical-align:top;overflow-wrap:anywhere}
th{width:30%;color:var(--vscode-descriptionForeground)}button{color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;padding:7px 12px;cursor:pointer}
pre{white-space:pre-wrap;overflow-wrap:anywhere}.meta{color:var(--vscode-descriptionForeground)}
</style></head><body><h1>${escape(resource.name)}</h1>
<p class="meta">${escape(resource.kind === "partition" ? t("Partition") : t("Cluster node"))}</p>
<button id="refresh">${escape(t("Refresh details"))}</button><table>${gpuRows}${rows}</table>
<details><summary>${escape(t("All fields"))}</summary><table>${all}</table></details>
<details><summary>${escape(t("Raw {0} output", "scontrol"))}</summary><pre>${escape(resource.raw)}</pre></details>
<script nonce="${nonce}">const api=acquireVsCodeApi();document.getElementById('refresh').addEventListener('click',()=>api.postMessage({action:'refresh'}));</script>
</body></html>`;
}

export class ClusterViews implements vscode.Disposable {
  readonly trees: ResourceTree[];
  private readonly disposables: vscode.Disposable[] = [];
  private readonly panels = new Map<string, { panel: vscode.WebviewPanel; resource: ClusterResource }>();
  private disposed = false;

  constructor(client: SlurmClient, private readonly t: Translator, private readonly language: () => string,
    private readonly message: (error: unknown) => string, private readonly extensionUri: vscode.Uri) {
    this.trees = (["partition", "node"] as const).map(kind =>
      new ResourceTree(kind, () => client.resources(kind), t, message));
    for (const tree of this.trees) {
      this.disposables.push(
        vscode.commands.registerCommand(tree.refreshCommand, () => tree.refresh()),
        tree.view.onDidChangeVisibility(event => { if (event.visible) { void tree.refresh(); } })
      );
    }
    this.disposables.push(vscode.commands.registerCommand("slurm.resourceDetails", (resource: ClusterResource) => {
      if (resource && this.trees.some(tree => tree.kind === resource.kind && tree.records.includes(resource))) {
        this.show(resource);
      }
    }));
  }

  private show(resource: ClusterResource): void {
    const key = `${resource.kind}:${resource.name}`;
    const existing = this.panels.get(key);
    if (existing) { existing.panel.reveal(); return; }
    const panel = vscode.window.createWebviewPanel("slurmResourceDetails", `Slurm · ${resource.name}`,
      vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [] });
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "media", "slurm-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "media", "slurm.svg")
    };
    const entry = { panel, resource };
    this.panels.set(key, entry);
    panel.webview.html = renderResource(resource, this.t, this.language());
    let busy = false;
    let closed = false;
    const receiver = panel.webview.onDidReceiveMessage(async (data: unknown) => {
      if (closed || busy || !data || typeof data !== "object" || !("action" in data) || data.action !== "refresh") { return; }
      busy = true;
      try {
        const tree = this.trees.find(tree => tree.kind === resource.kind)!;
        await tree.refresh();
        if (closed || this.disposed) { return; }
        if (tree.failure) { void vscode.window.showErrorMessage(this.message(tree.failure)); return; }
        const latest = tree.records.find(item => item.name === resource.name);
        if (latest) {
          entry.resource = latest;
          panel.webview.html = renderResource(latest, this.t, this.language());
        } else { void vscode.window.showErrorMessage(this.t("This resource is no longer available.")); }
      } finally { busy = false; }
    });
    panel.onDidDispose(() => { closed = true; receiver.dispose(); this.panels.delete(key); });
  }

  async refreshVisible(): Promise<void> {
    await Promise.all(this.trees.filter(tree => tree.view.visible).map(tree => tree.refresh()));
  }

  labels(): void {
    for (const tree of this.trees) { tree.labels(); }
    for (const { panel, resource } of this.panels.values()) {
      panel.webview.html = renderResource(resource, this.t, this.language());
    }
  }

  reset(): void {
    for (const tree of this.trees) { tree.reset(); }
    for (const { panel } of [...this.panels.values()]) { panel.dispose(); }
    void this.refreshVisible();
  }

  dispose(): void {
    this.disposed = true;
    for (const item of this.disposables) { item.dispose(); }
    for (const tree of this.trees) { tree.dispose(); }
    for (const { panel } of [...this.panels.values()]) { panel.dispose(); }
  }
}
