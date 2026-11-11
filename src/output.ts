import * as vscode from "vscode";
import { stat } from "node:fs/promises";
import { JobDetails } from "./model";
import { UserError } from "./i18n";
import { logPath } from "./logs";

/** Open the real log so editor features and log-language extensions can apply. */
export class JobOutput implements vscode.Disposable {
  private disposed = false;

  async open(details: JobDetails, stream: "StdOut" | "StdErr", focus: () => boolean = () => true): Promise<void> {
    if (this.disposed) { return; }
    await this.openFile(logPath(details, stream), focus);
  }

  async openFile(filename: string, focus: () => boolean = () => true): Promise<void> {
    if (this.disposed) { return; }
    // Reject pipes and devices before asking the editor to read their contents.
    if (!(await stat(filename)).isFile()) { throw new UserError("Log preview supports regular files only."); }
    if (this.disposed) { return; }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filename));
    if (this.disposed || !focus()) { return; }
    await vscode.window.showTextDocument(document, { preview: false });
  }

  dispose(): void { this.disposed = true; }
}
