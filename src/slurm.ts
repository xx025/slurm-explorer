import { execFile } from "node:child_process";
import path from "node:path";
import { ACCOUNT_FIELDS, ClusterResource, ResourceKind, Job, JobDetails, SEPARATOR, parseAccounting, parseControl, parseQueue, parseResources, validateJobId } from "./model";
import { UserError } from "./i18n";

export interface Settings {
  user: string;
  binDirectory: string;
  timeoutSeconds: number;
  historyDays: number;
}

export type Runner = (command: string, args: string[], timeoutMs: number) => Promise<string>;

export const runCommand: Runner = (command, args, timeoutMs) => new Promise((resolve, reject) => {
  execFile(command, args, {
    timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: "utf8",
    windowsHide: true, env: { ...process.env, LC_ALL: "C" }
  }, (error, stdout, stderr) => {
    if (error) {
      const detail = (stderr || error.message).trim().slice(0, 1500);
      const failure = (error as NodeJS.ErrnoException).code === "ENOENT"
        ? new UserError("{0} was not found. Install this extension on the Slurm login node through Remote-SSH, or set slurmJobs.binDirectory.", [path.basename(command)])
        : error.killed
          ? new UserError("{0} exceeded the {1}s query timeout.", [path.basename(command), timeoutMs / 1000])
          : new UserError("{0} failed: {1}", [path.basename(command), detail]);
      reject(failure);
    } else { resolve(stdout); }
  });
});

export class SlurmClient {
  private logFields?: { directory: string; promise: Promise<Set<string>> };
  constructor(
    private readonly settings: () => Settings,
    private readonly log: (message: string) => void,
    private readonly runner: Runner = runCommand
  ) {}

  private async run(name: string, args: string[]): Promise<string> {
    const settings = this.settings();
    if (settings.binDirectory && !path.isAbsolute(settings.binDirectory)) {
      throw new UserError("slurmJobs.binDirectory must be an absolute directory.");
    }
    const executable = settings.binDirectory ? path.join(settings.binDirectory, name) : name;
    this.log(`Query: ${name} ${args.map(arg => JSON.stringify(arg)).join(" ")}`);
    try { return await this.runner(executable, args, settings.timeoutSeconds * 1000); }
    catch (error) {
      this.log(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async queue(): Promise<Job[]> {
    const format = ["%i", "%u", "%T", "%P", "%M", "%l", "%D", "%C", "%m", "%b", "%R", "%j"].join(SEPARATOR);
    const args = ["--noheader", "--array", "--states=all", `--format=${format}`];
    const user = this.settings().user;
    if (user && user !== "*") { args.push(`--user=${user}`); }
    return parseQueue(await this.run("squeue", args));
  }

  async resources(kind: ResourceKind): Promise<ClusterResource[]> {
    const args = ["show", kind, "--oneliner"];
    if (kind === "node") { args.push("--details"); }
    return parseResources(await this.run("scontrol", args), kind);
  }

  async history(id?: string): Promise<JobDetails[]> {
    const start = new Date(Date.now() - this.settings().historyDays * 86400000);
    // Slurm interprets timestamps in the login node's local timezone.
    const date = [
      start.getFullYear(), String(start.getMonth() + 1).padStart(2, "0"), String(start.getDate()).padStart(2, "0")
    ].join("-");
    const args = ["--noheader", "--parsable2", `--delimiter=${SEPARATOR}`, "--allocations", "--array", `--starttime=${date}`, `--format=${ACCOUNT_FIELDS.join(",")}`];
    if (id) { args.push(`--jobs=${validateJobId(id)}`); }
    else {
      const user = this.settings().user;
      if (user === "*") { args.push("--allusers"); }
      else if (user) { args.push(`--user=${user}`); }
    }
    return parseAccounting(await this.run("sacct", args));
  }

  async details(value: string): Promise<JobDetails> {
    const id = validateJobId(value);
    let controlError: unknown;
    try { return parseControl(await this.run("scontrol", ["show", "job", id, "--oneliner"]), id); }
    catch (error) { controlError = error; }
    try {
      const jobs = await this.history(id);
      const exact = jobs.find(job => job.id === id);
      if (exact) { return exact; }
      throw new UserError("Job {0} was not found in the configured accounting window ({1} days).", [id, this.settings().historyDays]);
    } catch (accountError) {
      throw new UserError("{0}\nAccounting fallback: {1}", [
        controlError instanceof Error ? controlError : String(controlError),
        accountError instanceof Error ? accountError : String(accountError)
      ]);
    }
  }

  async batchScript(value: string): Promise<string> {
    const id = validateJobId(value);
    const unavailable = () => new UserError("Job {0} has no retrievable batch script. It may be an interactive job, purged, inaccessible, or accounting may not store scripts (AccountingStoreFlags=job_script).", [id]);
    const script = (text: string): string => {
      if (!text.trim() || text.trim() === "NONE") { throw unavailable(); }
      return text;
    };
    let controlError: unknown;
    try {
      // '-' sends the stored script to stdout instead of creating a remote file.
      return script(await this.run("scontrol", ["write", "batch_script", id, "-"]));
    } catch (error) { controlError = error; }
    const date = new Date(Date.now() - this.settings().historyDays * 86400000);
    const start = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    try {
      // --noheader omits sacct's banner; NONE means no stored script.
      return script(await this.run("sacct", ["--batch-script", `--jobs=${id}`, "--noheader", "--array", `--starttime=${start}`]));
    } catch (accountError) {
      throw new UserError("{0}\nController: {1}\nAccounting: {2}", [unavailable(),
        controlError instanceof Error ? controlError : String(controlError),
        accountError instanceof Error ? accountError : String(accountError)]);
    }
  }

  async logDetails(value: string, known?: JobDetails): Promise<JobDetails> {
    const id = validateJobId(value);
    const details = known ?? await this.details(id);
    if (details.source === "scontrol" || details.fields.StdOut || details.fields.StdErr) { return details; }
    // Query log metadata only when opening a history log, so old Slurm versions
    // without these fields can still display their normal accounting history.
    const directory = this.settings().binDirectory;
    if (!this.logFields || this.logFields.directory !== directory) {
      this.logFields = { directory, promise: this.run("sacct", ["--helpformat"]).then(text => new Set(text.toLowerCase().split(/\s+/))) };
    }
    let supported: Set<string>;
    try { supported = await this.logFields.promise; }
    catch (error) { this.logFields = undefined; throw error; }
    if (!supported.has("stdout") && !supported.has("stderr")) { return details; }
    const fields = ["JobID", "JobIDRaw", "StdOut", "StdErr", "WorkDir", "JobName", "User"]
      .filter(field => supported.has(field.toLowerCase()));
    if (!fields.includes("JobID")) { return details; }
    const date = new Date(Date.now() - this.settings().historyDays * 86400000);
    const start = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const raw = await this.run("sacct", ["--noheader", "--parsable2", `--delimiter=${SEPARATOR}`, "--allocations", "--array",
      `--jobs=${id}`, `--starttime=${start}`, `--format=${fields.map(field => `${field}%4096`).join(",")}`]);
    for (const line of raw.split(/\r?\n/)) {
      const values = line.split(SEPARATOR);
      if (values[0]?.trim() !== id || values.length < fields.length) { continue; }
      const enriched = { ...details.fields };
      fields.forEach((field, index) => { enriched[field] = values[index].trim(); });
      return { ...details, fields: enriched };
    }
    return details;
  }
}
