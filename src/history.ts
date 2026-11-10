import { JobDetails } from "./model";

const finishedStates = new Set([
  "BOOT_FAIL", "CANCELLED", "COMPLETED", "DEADLINE", "FAILED", "NODE_FAIL",
  "OUT_OF_MEMORY", "PREEMPTED", "REVOKED", "SPECIAL_EXIT", "TIMEOUT"
]);

export function finishedHistory(records: JobDetails[]): JobDetails[] {
  const sorted = records.filter(record => finishedStates.has((record.fields.State ?? "").split(/[ +]/)[0]))
    .sort((a, b) => {
      const time = (record: JobDetails) => {
        const value = record.fields.End || record.fields.Start || "";
        return /^\d{4}-/.test(value) ? value : "";
      };
      return time(b).localeCompare(time(a)) || b.id.localeCompare(a.id, "en", { numeric: true });
    });
  const seen = new Set<string>();
  return sorted.filter(record => {
    if (seen.has(record.id)) { return false; }
    seen.add(record.id);
    return true;
  });
}

export class HistoryStore {
  records: JobDetails[] = [];
  loaded = false;
  loading = false;
  error: unknown;
  loadedAt = 0;
  private generation = 0;
  private pending: Promise<void> | undefined;
  private disposed = false;

  constructor(private readonly fetch: () => Promise<JobDetails[]>, private readonly changed: () => void) {}

  reset(): void {
    this.generation++;
    this.pending = undefined;
    this.records = [];
    this.loaded = false;
    this.loading = false;
    this.error = undefined;
    this.loadedAt = 0;
    this.changed();
  }

  load(force = false): Promise<void> {
    if (this.disposed) { return Promise.resolve(); }
    if (this.pending) { return this.pending; }
    if (this.loaded && !force) { return Promise.resolve(); }
    const generation = this.generation;
    this.loading = true;
    this.error = undefined;
    this.changed();
    this.pending = Promise.resolve().then(() => this.fetch()).then(records => {
      if (this.disposed || generation !== this.generation) { return; }
      this.records = finishedHistory(records);
      this.loaded = true;
      this.loadedAt = Date.now();
    }, error => {
      if (this.disposed || generation !== this.generation) { return; }
      this.error = error;
      this.loaded = true;
      this.loadedAt = Date.now();
    }).finally(() => {
      if (this.disposed || generation !== this.generation) { return; }
      this.pending = undefined;
      this.loading = false;
      this.changed();
    });
    return this.pending;
  }

  dispose(): void { this.disposed = true; this.generation++; }
}
