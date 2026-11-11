import * as vscode from "vscode";
import { SlurmClient } from "./slurm";
import { JobCache } from "./cache";

/** Cluster snapshots are read-only and never replace the user's working script. */
export class JobScripts implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly changes = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changes.event;
  private readonly contents = new Map<string, string>();
  private readonly pending = new Map<string, Promise<string>>();
  private readonly registration: vscode.Disposable;
  private readonly closed: vscode.Disposable;
  private disposed = false;

  constructor(private readonly client: Pick<SlurmClient, "batchScript">, private readonly options: {
    cache?: JobCache; enabled?: () => boolean; generation?: () => number; onCached?: (id: string, savedAt: number) => void;
  } = {}) {
    this.registration = vscode.workspace.registerTextDocumentContentProvider("slurm-script", this);
    this.closed = vscode.workspace.onDidCloseTextDocument(document => {
      if (document.uri.scheme === "slurm-script") { this.contents.delete(document.uri.toString()); }
    });
  }
  private enabled(): boolean { return !!this.options.cache && (this.options.enabled?.() ?? true); }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const memory = this.contents.get(uri.toString());
    if (memory !== undefined) { return memory; }
    const match = /^\/([a-f0-9]{64})\/slurm-(\d+(?:_\d+)?(?:\+\d+)?)(?:-cached)?\.sh$/.exec(uri.path);
    if (match && this.enabled()) { return (await this.options.cache!.script(match[2], match[1]))?.text ?? ""; }
    return "";
  }

  private fetch(id: string, namespace: string): Promise<string> {
    const key = `${namespace}:${id}`;
    const generation = this.options.generation?.();
    let request = this.pending.get(key);
    if (!request) {
      request = this.client.batchScript(id).then(async text => {
        if (!this.disposed && this.enabled() && generation === this.options.generation?.()) { await this.options.cache!.saveScript(id, text, namespace); }
        return text;
      }).finally(() => { this.pending.delete(key); });
      this.pending.set(key, request);
    }
    return request;
  }

  async prefetch(id: string): Promise<void> {
    if (this.disposed || !this.enabled()) { return; }
    const namespace = this.options.cache!.namespace();
    if (await this.options.cache!.script(id, namespace)) { return; }
    await this.fetch(id, namespace);
  }

  async open(id: string, focus: () => boolean = () => true): Promise<void> {
    if (this.disposed) { return; }
    const namespace = this.options.cache?.namespace() ?? "live";
    let text: string, savedAt: number | undefined;
    try { text = await this.fetch(id, namespace); }
    catch (error) {
      const snapshot = this.enabled() ? await this.options.cache!.script(id, namespace) : undefined;
      if (!snapshot) { throw error; }
      text = snapshot.text; savedAt = snapshot.item.savedAt;
    }
    if (this.disposed) { return; }
    const uri = vscode.Uri.from({ scheme: "slurm-script", path: `/${namespace}/slurm-${id}.sh` });
    const key = uri.toString(), previous = this.contents.get(key);
    this.contents.set(key, text);
    if (previous !== undefined && previous !== text) { this.changes.fire(uri); }
    const document = await vscode.workspace.openTextDocument(uri);
    if (!this.disposed && focus()) {
      await vscode.window.showTextDocument(document, { preview: false });
      if (savedAt !== undefined) { this.options.onCached?.(id, savedAt); }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.closed.dispose(); this.registration.dispose(); this.changes.dispose();
    this.contents.clear(); this.pending.clear();
  }
}
