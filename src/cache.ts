import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, rename, readdir, stat, unlink, chmod } from "node:fs/promises";
import path from "node:path";
import { JobDetails, validateJobId } from "./model";
import { logPath } from "./logs";

export type CacheKind = "stdout" | "stderr" | "script";
export interface CacheItem { savedAt: number; source: string; file?: string; bytes?: number; }
export interface CacheRecord {
  version: 1; scope: string; id: string; updatedAt: number;
  submission?: string;
  items: Partial<Record<CacheKind, CacheItem>>;
}
export interface ScriptSnapshot { record: CacheRecord; item: CacheItem; text: string; }
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const kinds: CacheKind[] = ["stdout", "stderr", "script"];

/** Store log paths only; script bodies are private, atomic, persistent snapshots. */
export class JobCache {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly root: string, private readonly scope: () => string,
    private readonly limit: () => number, private readonly report: (error: unknown) => void = () => {}) {}

  private warn(error: unknown): void { try { this.report(error); } catch { /* Diagnostics must not fail a live read. */ } }
  namespace(): string { return hash(this.scope()); }
  private directory(namespace = this.namespace()): string {
    if (!/^[a-f0-9]{64}$/.test(namespace)) { throw new Error("Invalid cache namespace"); }
    return path.join(this.root, namespace);
  }
  private filename(id: string, namespace: string): string {
    return path.join(this.directory(namespace), `${hash(validateJobId(id))}.json`);
  }
  private async record(id: string, namespace: string): Promise<CacheRecord | undefined> {
    try {
      const record: CacheRecord = JSON.parse(await readFile(this.filename(id, namespace), "utf8"));
      if (record.version !== 1 || record.id !== id || record.scope !== namespace || !record.items || !Number.isFinite(record.updatedAt)) { return; }
      for (const kind of Object.keys(record.items)) {
        const item = record.items[kind as CacheKind];
        if (!kinds.includes(kind as CacheKind) || !item || typeof item.source !== "string" || !Number.isFinite(item.savedAt)) { return; }
        if (kind === "script") {
          if (!item.file || !/^[a-f0-9]{64}-[a-f0-9]{16}\.data$/.test(item.file) || !Number.isFinite(item.bytes) || item.bytes! < 0) { return; }
        } else if (!path.isAbsolute(item.source) || item.file !== undefined) { return; }
      }
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") { this.warn(error); }
      return;
    }
  }
  async get(id: string, namespace = this.namespace()): Promise<CacheRecord | undefined> {
    await this.pending;
    return this.record(id, namespace);
  }
  async script(id: string, namespace = this.namespace()): Promise<ScriptSnapshot | undefined> {
    const record = await this.get(id, namespace), item = record?.items.script;
    if (!record || !item?.file) { return; }
    try {
      const buffer = await readFile(path.join(this.directory(namespace), item.file));
      if (buffer.length !== item.bytes) { return; }
      return { record, item, text: buffer.toString("utf8") };
    } catch (error) { this.warn(error); return; }
  }
  private update(id: string, namespace: string, change: (record: CacheRecord, directory: string) => Promise<void>): Promise<void> {
    const task = this.pending.then(async () => {
      const directory = this.directory(namespace), target = this.filename(id, namespace);
      await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700);
      const record = await this.record(id, namespace) ?? { version: 1, scope: namespace, id, updatedAt: 0, items: {} };
      const previous = record.items.script?.file;
      await change(record, directory);
      record.updatedAt = Date.now();
      const temporary = `${target}.${randomBytes(8).toString("hex")}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: "wx" });
        await rename(temporary, target);
      } finally { await unlink(temporary).catch(() => {}); }
      if (previous && previous !== record.items.script?.file) { await unlink(path.join(directory, previous)).catch(() => {}); }
      await this.prune(namespace);
    });
    // Cache errors must never prevent opening the live file or script.
    this.pending = task.catch(error => { this.warn(error); });
    return this.pending.then(() => {});
  }
  remember(details: JobDetails, namespace = this.namespace()): Promise<void> {
    return this.update(details.id, namespace, async record => {
      const oldSubmit = record.submission, newSubmit = details.fields.SubmitTime;
      if (oldSubmit && newSubmit && oldSubmit !== newSubmit) { record.items = {}; }
      if (newSubmit) { record.submission = newSubmit; }
      for (const [kind, stream] of [["stdout", "StdOut"], ["stderr", "StdErr"]] as const) {
        try { record.items[kind] = { source: logPath(details, stream), savedAt: Date.now() }; }
        catch { /* Missing accounting fields do not erase previously resolved paths. */ }
      }
    });
  }
  saveScript(id: string, text: string, namespace = this.namespace()): Promise<void> {
    return this.update(id, namespace, async (record, directory) => {
      const file = `${hash(id)}-${randomBytes(8).toString("hex")}.data`;
      await writeFile(path.join(directory, file), text, { mode: 0o600, flag: "wx" });
      record.items.script = { file, bytes: Buffer.byteLength(text), savedAt: Date.now(), source: "Slurm" };
    });
  }
  private async prune(namespace: string): Promise<void> {
    const directory = this.directory(namespace), files = await readdir(directory);
    const records: { record: CacheRecord; file: string }[] = [];
    let total = 0;
    for (const file of files) {
      const info = await stat(path.join(directory, file)).catch(() => undefined);
      if (info?.isFile()) { total += info.size; }
      if (/^[a-f0-9]{64}\.json$/.test(file)) {
        try {
          const raw = JSON.parse(await readFile(path.join(directory, file), "utf8"));
          const record = await this.record(raw.id, namespace);
          if (record) { records.push({ record, file }); }
        } catch { /* Keep other snapshots usable. */ }
      }
    }
    const referenced = new Set(records.flatMap(({ record, file }) => [file, record.items.script?.file].filter((file): file is string => !!file)));
    for (const file of files.filter(file => !referenced.has(file) && /^[a-f0-9]{64}(?:-[a-f0-9]{16}\.data|\.json\.[a-f0-9]{16}\.tmp)$/.test(file))) {
      const info = await stat(path.join(directory, file)).catch(() => undefined);
      if (info?.isFile() && Date.now() - info.mtimeMs > 300000) {
        await unlink(path.join(directory, file)).catch(() => {}); total -= info.size;
      }
    }
    for (const { record, file } of records.sort((a, b) => a.record.updatedAt - b.record.updatedAt)) {
      if (total <= this.limit()) { break; }
      for (const name of [file, record.items.script?.file].filter((file): file is string => !!file)) {
        const filename = path.join(directory, name), info = await stat(filename).catch(() => undefined);
        await unlink(filename).catch(() => {}); total -= info?.size ?? 0;
      }
    }
  }
  clear(): Promise<void> {
    const directory = this.directory();
    const task = this.pending.then(async () => {
      const files = await readdir(directory).catch(() => []);
      for (const file of files.filter(file => /^[a-f0-9]{64}(?:-[a-f0-9]{16}\.data|\.json(?:\.[a-f0-9]{16}\.tmp)?)$/.test(file))) {
        await unlink(path.join(directory, file));
      }
    });
    this.pending = task.catch(error => { this.warn(error); });
    return task;
  }
}
