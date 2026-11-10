import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { JobDetails, escapeHtml } from "./model";
import { Translator } from "./i18n";
import { logPath } from "./logs";
import { LogCursor } from "./follow";

export class JobOutput implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private details?: JobDetails;
  private stream: "StdOut" | "StdErr" = "StdOut";
  private cursor?: LogCursor;
  private text = "";
  private status = "";
  private paused = false;
  private disposed = false;
  private generation = 0;
  private pending = new Set<LogCursor>();
  private receiver?: vscode.Disposable;
  private timer: NodeJS.Timeout;

  constructor(private readonly t: Translator, private readonly message: (error: unknown) => string,
    private readonly maxBytes: () => number) {
    this.timer = setInterval(() => { void this.poll(); }, 2000);
  }

  async follow(details: JobDetails, stream: "StdOut" | "StdErr"): Promise<void> {
    if (this.disposed) { return; }
    // Resolve first so a missing path does not replace an existing valid session.
    const filename = logPath(details, stream);
    this.generation++;
    this.details = details;
    this.stream = stream;
    this.cursor = new LogCursor(filename, this.maxBytes());
    this.text = "";
    this.status = "";
    this.paused = false;
    this.render();
    await vscode.commands.executeCommand("slurmLogOutput.focus");
    await this.poll();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.receiver?.dispose();
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    this.receiver = view.webview.onDidReceiveMessage(async data => {
      if (!data || typeof data !== "object" || this.disposed) { return; }
      if (data.action === "ready") { this.send(); }
      else if (data.action === "pause") { this.paused = !this.paused; this.send(); if (!this.paused) { await this.poll(); } }
      else if (data.action === "clear") { this.text = ""; this.send(); }
      else if (data.action === "stop") {
        this.generation++; this.cursor = undefined; this.details = undefined;
        this.text = ""; this.status = ""; this.render();
      } else if (data.action === "stream" && this.details && (data.stream === "StdOut" || data.stream === "StdErr")) {
        try { await this.follow(this.details, data.stream); }
        catch (error) { this.status = this.message(error); this.send(); }
      }
    });
    view.onDidDispose(() => { if (this.view === view) { this.view = undefined; this.receiver?.dispose(); } });
    this.render();
  }

  async poll(): Promise<void> {
    const cursor = this.cursor;
    if (!cursor || this.paused || this.disposed || this.pending.has(cursor)) { return; }
    this.pending.add(cursor);
    const generation = this.generation;
    try {
      const result = await cursor.read();
      if (this.disposed || this.generation !== generation) { return; }
      if (result.reset) { this.text = ""; }
      if (result.skipped) { this.text = `${this.t("[Showing the last {0} KiB]", this.maxBytes() / 1024)}\n`; }
      this.text = (this.text + result.text).slice(-this.maxBytes()).replace(/^[\uDC00-\uDFFF]/, "");
      this.status = this.t("Following · updated {0}", new Date().toLocaleTimeString());
      this.send();
    } catch (error) {
      if (!this.disposed && this.generation === generation) {
        this.status = `${this.message(error)} · ${this.t("Retrying automatically…")}`;
        this.send();
      }
    } finally { this.pending.delete(cursor); }
  }

  private send(): void {
    void this.view?.webview.postMessage({
      text: this.text, status: this.paused ? this.t("Paused") : this.status,
      paused: this.paused, stream: this.stream,
      pauseLabel: this.paused ? this.t("Resume") : this.t("Pause"),
      title: this.details ? this.t("Job {0}", this.details.id) : this.t("No job selected"),
      filename: this.cursor?.filename ?? "", active: !!this.cursor
    });
  }

  render(): void {
    if (!this.view) { return; }
    const nonce = randomBytes(18).toString("base64");
    const e = (text: string) => escapeHtml(this.t(text));
    this.view.webview.html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
body{margin:0;padding:8px 12px;color:var(--vscode-foreground);background:var(--vscode-panel-background);font-family:var(--vscode-font-family);display:flex;flex-direction:column;height:calc(100vh - 16px);box-sizing:border-box}
header{display:flex;align-items:center;gap:10px;flex-wrap:wrap}button,select{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-panel-border);padding:4px 8px}button,select,label{cursor:pointer}button:focus-visible,select:focus-visible{outline:1px solid var(--vscode-focusBorder)}
#path,#status{font-size:12px;color:var(--vscode-descriptionForeground);overflow-wrap:anywhere;margin-top:5px}
#log{flex:1;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size);user-select:text;margin-bottom:0}
</style></head><body><header><strong id="title"></strong>
<select id="stream" aria-label="${e("Output stream")}"><option value="StdOut">${e("Standard output")}</option><option value="StdErr">${e("Standard error")}</option></select>
<button id="pause">${e("Pause")}</button><button id="clear">${e("Clear")}</button><button id="stop">${e("Stop following")}</button>
<label><input type="checkbox" id="scroll" checked>${e("Auto-scroll")}</label></header>
<div id="path"></div><div id="status"></div><pre id="log"></pre>
<script nonce="${nonce}">
const api=acquireVsCodeApi(),get=id=>document.getElementById(id);
const saved=api.getState();if(saved)get('scroll').checked=saved.scroll!==false;
get('scroll').onchange=()=>api.setState({scroll:get('scroll').checked});
for(const action of ['pause','clear','stop'])get(action).onclick=()=>api.postMessage({action});
get('stream').onchange=()=>api.postMessage({action:'stream',stream:get('stream').value});
window.addEventListener('message',({data})=>{
const log=get('log'),top=log.scrollTop;log.textContent=data.text;
get('title').textContent=data.title;get('path').textContent=data.filename;get('status').textContent=data.status;
get('pause').textContent=data.pauseLabel;get('stream').value=data.stream;
for(const id of ['pause','stream','clear','stop'])get(id).disabled=!data.active;
if(!data.active)log.textContent=${JSON.stringify(this.t("Open stdout or stderr from a job to follow its output here."))};
log.scrollTop=get('scroll').checked?log.scrollHeight:top;
});api.postMessage({action:'ready'});
</script></body></html>`;
  }

  dispose(): void {
    this.disposed = true; this.generation++; clearInterval(this.timer);
    this.receiver?.dispose(); this.view = undefined; this.cursor = undefined;
  }
}
