import * as vscode from "vscode";
import { SlurmClient } from "./slurm";

/** Cluster snapshots are read-only and never replace the user's working script. */
export class JobScripts implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly changes = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changes.event;
  private readonly contents = new Map<string, string>();
  private readonly pending = new Map<string, Promise<string>>();
  private readonly registration: vscode.Disposable;
  private readonly closed: vscode.Disposable;
  private disposed = false;

  constructor(private readonly client: Pick<SlurmClient, "batchScript">) {
    this.registration = vscode.workspace.registerTextDocumentContentProvider("slurm-script", this);
    this.closed = vscode.workspace.onDidCloseTextDocument(document => {
      if (document.uri.scheme === "slurm-script") { this.contents.delete(document.uri.toString()); }
    });
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? "";
  }

  async open(id: string, focus: () => boolean = () => true): Promise<void> {
    if (this.disposed) { return; }
    let request = this.pending.get(id);
    if (!request) {
      request = this.client.batchScript(id).finally(() => { this.pending.delete(id); });
      this.pending.set(id, request);
    }
    const text = await request;
    if (this.disposed) { return; }
    const uri = vscode.Uri.from({ scheme: "slurm-script", path: `/slurm-${id}.sh` });
    const key = uri.toString();
    const previous = this.contents.get(key);
    this.contents.set(key, text);
    if (previous !== undefined && previous !== text) { this.changes.fire(uri); }
    const document = await vscode.workspace.openTextDocument(uri);
    if (!this.disposed && focus()) { await vscode.window.showTextDocument(document, { preview: false }); }
  }

  dispose(): void {
    this.disposed = true;
    this.closed.dispose(); this.registration.dispose(); this.changes.dispose();
    this.contents.clear(); this.pending.clear();
  }
}
