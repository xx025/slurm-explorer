import * as vscode from "vscode";
import { JobDetails } from "./model";
import { Translator } from "./i18n";
import { logPath } from "./logs";
import { LogCursor } from "./follow";

/** A pseudoterminal writes to the native terminal without starting a shell. */
interface Session {
  key: string;
  terminal: vscode.Terminal;
  cursor: LogCursor;
  writer: vscode.EventEmitter<string>;
  opened: boolean;
  paused: boolean;
  pending?: Promise<void>;
  error: string;
  lastCR: boolean;
}

/** Bare LF needs CR in a pseudoterminal; existing CRLF and progress CR stay intact. */
export function terminalNewlines(text: string, previousCR = false): { text: string; lastCR: boolean } {
  let result = "";
  for (const char of text) {
    result += char === "\n" && !previousCR ? "\r\n" : char;
    previousCR = char === "\r";
  }
  return { text: result, lastCR: previousCR };
}

export class JobOutput implements vscode.Disposable {
  private readonly sessions = new Map<string, Session>();
  private disposed = false;
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly t: Translator, private readonly message: (error: unknown) => string,
    private readonly maxBytes: () => number) {
    this.timer = setInterval(() => { void this.poll(); }, 2000);
  }

  async follow(details: JobDetails, stream: "StdOut" | "StdErr", focus = true): Promise<void> {
    if (this.disposed) { return; }
    const filename = logPath(details, stream);
    const key = JSON.stringify([details.id, stream, filename]);
    let session = this.sessions.get(key);
    if (!session) {
      const writer = new vscode.EventEmitter<string>();
      // VS Code opens the pseudoterminal asynchronously, after createTerminal returns.
      const terminal = vscode.window.createTerminal({
        name: `Slurm ${details.id} · ${stream === "StdOut" ? "stdout" : "stderr"}`,
        iconPath: new vscode.ThemeIcon("output"),
        pty: {
          onDidWrite: writer.event,
          open: () => {
            const current = this.sessions.get(key);
            if (!current || this.disposed) { return; }
            current.opened = true;
            this.write(current, `${this.t("File: {0}", filename)}\n\n`);
            void this.read(current);
          },
          close: () => {
            const current = this.sessions.get(key);
            if (current) { this.sessions.delete(key); current.writer.dispose(); }
          }
        }
      });
      session = { key, terminal, writer, cursor: new LogCursor(filename, this.maxBytes()),
        opened: false, paused: false, error: "", lastCR: false };
      this.sessions.set(key, session);
    }
    if (focus) { session.terminal.show(); }
    await this.read(session);
  }

  private write(session: Session, text: string): void {
    const converted = terminalNewlines(text, session.lastCR);
    session.lastCR = converted.lastCR;
    session.writer.fire(converted.text);
  }

  async poll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map(session => this.read(session)));
  }

  private read(session: Session): Promise<void> {
    if (!session.opened || session.paused || this.disposed) { return Promise.resolve(); }
    if (session.pending) { return session.pending; }
    session.pending = this.readContents(session).finally(() => { session.pending = undefined; });
    return session.pending;
  }

  private async readContents(session: Session): Promise<void> {
    try {
      const result = await session.cursor.read();
      if (this.disposed || this.sessions.get(session.key) !== session) { return; }
      if (result.reset) { session.lastCR = false; }
      if (result.skipped) { this.write(session, `${this.t("[Showing the last {0} KiB]", this.maxBytes() / 1024)}\n`); }
      if (session.error) { this.write(session, "\n"); session.error = ""; }
      this.write(session, result.text);
    } catch (error) {
      if (this.disposed || this.sessions.get(session.key) !== session) { return; }
      const text = this.message(error);
      if (session.error !== text) {
        session.error = text;
        this.write(session, `\n${text}\n${this.t("Retrying automatically…")}\n`);
      }
    }
  }

  pause(paused: boolean): void {
    const session = [...this.sessions.values()].find(item => item.terminal === vscode.window.activeTerminal);
    if (!session) { return; }
    session.paused = paused;
    if (!paused) { void this.read(session); }
  }

  clear(): void {
    const session = [...this.sessions.values()].find(item => item.terminal === vscode.window.activeTerminal);
    if (session) { session.lastCR = false; session.writer.fire("\x1b[2J\x1b[3J\x1b[H"); }
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.timer);
    const sessions = [...this.sessions.values()]; this.sessions.clear();
    for (const session of sessions) { session.terminal.dispose(); session.writer.dispose(); }
  }
}
