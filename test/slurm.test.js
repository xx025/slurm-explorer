const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { parseQueue, parseControl, parseAccounting, validateJobId, escapeHtml, SEPARATOR } = require("../dist/model");
const { SlurmClient, runCommand } = require("../dist/slurm");
const { logPath, readTail } = require("../dist/logs");

const queueLine = ["123_4", "alice", "PENDING", "gpu", "0:00", "1:00:00", "1", "8", "16G", "gpu:1", "(Resources)", "train | test"].join(SEPARATOR);
const accountingLine = ["123_4", "train | test", "alice", "COMPLETED", "gpu", "00:04:00", "01:00:00", "8", "16Gn", "cpu=8,gres/gpu=1", "node01", "0:0", "2026-11-09T10:00:00", "2026-11-09T10:04:00", "/shared/run with spaces"].join(SEPARATOR);
const controlLine = "JobId=123_4 ArrayJobId=123 ArrayTaskId=4 JobName=train | test UserId=alice(1000) JobState=RUNNING Reason=None NumCPUs=8 WorkDir=/shared/run with spaces StdOut=/shared/run with spaces/out_%A_%a.log StdErr=/shared/run with spaces/error.log Command=/bin/bash run.sh";
const defaultSettings = () => ({ user: "alice", binDirectory: "", timeoutSeconds: 2, historyDays: 7 });

test("queue preserves job names and parses arrays, memory, GRES and pending reason", () => {
  const [job] = parseQueue(queueLine + "\n");
  assert.equal(job.id, "123_4");
  assert.equal(job.name, "train | test");
  assert.equal(job.resources, "gpu:1");
  assert.equal(job.reason, "(Resources)");
  assert.deepEqual(parseQueue("\n"), []);
  assert.throws(() => parseQueue("broken output"), /Unexpected/);
});

test("scontrol parser keeps paths, command arguments, array fields and GPU resource keys", () => {
  const details = parseControl(controlLine + " TresPerNode=gres/gpu:1", "123_4");
  assert.equal(details.fields.WorkDir, "/shared/run with spaces");
  assert.equal(details.fields.Command, "/bin/bash run.sh");
  assert.equal(details.fields.TresPerNode, "gres/gpu:1");
  assert.equal(logPath(details, "StdOut"), "/shared/run with spaces/out_123_4.log");
});

test("controller slash keys do not contaminate resource values", () => {
  const details = parseControl("JobId=42 AllocTRES=cpu=16,gres/gpu=4 Socks/Node=* CPUs/Task=4 StdErr= StdOut=/shared/slurm-42.out", "42");
  assert.equal(details.fields.AllocTRES, "cpu=16,gres/gpu=4");
  assert.equal(details.fields["CPUs/Task"], "4");
  assert.equal(details.fields.StdErr, "");
  assert.equal(logPath(details, "StdErr"), "/shared/slurm-42.out");
});

test("accounting uses an explicit separator, preserving pipes and spaces", () => {
  const [job] = parseAccounting(accountingLine);
  assert.equal(job.id, "123_4");
  assert.equal(job.fields.JobName, "train | test");
  assert.equal(job.fields.WorkDir, "/shared/run with spaces");
});

test("job identifiers reject options and shell payloads", () => {
  for (const value of ["12", "12_3", "12+1", "12_3+1"]) { assert.equal(validateJobId(value), value); }
  for (const value of ["--all", "12; touch bad", "$(id)", "12\n34", "../etc/passwd", "12_[1-5]"]) {
    assert.throws(() => validateJobId(value));
  }
});

test("details use scontrol, then fall back to exact accounting record", async () => {
  const calls = [];
  const client = new SlurmClient(defaultSettings, () => {}, async (command, args) => {
    calls.push({ command, args });
    if (command === "scontrol") { throw new Error("Invalid job id specified"); }
    return accountingLine;
  });
  const result = await client.details("123_4");
  assert.equal(result.source, "sacct");
  assert.equal(calls[0].args[2], "123_4");
  assert.ok(calls[1].args.includes("--jobs=123_4"));
  assert.ok(calls[1].args.includes("--array"));
  await assert.rejects(client.details("999"), /not found/);
  await assert.rejects(client.details("--all"), /numeric job ID/);
});

test("all-users queries explicitly include all users in accounting", async () => {
  const calls = [];
  const client = new SlurmClient(() => ({ ...defaultSettings(), user: "*" }), () => {}, async (command, args) => {
    calls.push(args);
    return "";
  });
  await client.queue();
  await client.history();
  assert.equal(calls[0].some(arg => arg.startsWith("--user=")), false);
  assert.ok(calls[1].includes("--allusers"));
});

test("queries use the configured binary directory and argv without a shell", async () => {
  const client = new SlurmClient(() => ({ ...defaultSettings(), binDirectory: "/opt/slurm/bin", user: "alice;echo hi" }), () => {},
    async (command, args, timeout) => {
      assert.equal(command, "/opt/slurm/bin/squeue");
      assert.ok(args.includes("--user=alice;echo hi"));
      assert.equal(timeout, 2000);
      return queueLine;
    });
  assert.equal((await client.queue()).length, 1);
  const value = await runCommand(process.execPath, ["-e", "process.stdout.write(process.argv[1])", "a;$(id)"], 2000);
  assert.equal(value, "a;$(id)");
});

test("runner explains missing commands and terminates timed out commands", async () => {
  await assert.rejects(runCommand("/missing-slurm-command", [], 1000), /was not found/);
  await assert.rejects(runCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], 150), /timeout/);
});

test("log path resolution handles relative paths and reports unresolved node tokens", () => {
  const details = parseControl(controlLine, "123_4");
  details.fields.StdOut = "logs/out_%04a.log";
  assert.equal(logPath(details, "StdOut"), "/shared/run with spaces/logs/out_0004.log");
  details.fields.StdOut = "/logs/%N.out";
  assert.throws(() => logPath(details, "StdOut"), /Cannot resolve/);
  assert.throws(() => logPath(parseAccounting(accountingLine)[0], "StdOut"), /unavailable/);
});

test("tail reads only the bounded suffix, handles empty files, and rejects directories", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "slurm-viewer-"));
  try {
    const filename = path.join(directory, "job.log");
    await fs.writeFile(filename, "0123456789");
    assert.match(await readTail(filename, 4), /\n6789$/);
    assert.equal(await readTail(filename, 100), "0123456789");
    await fs.writeFile(filename, "");
    assert.equal(await readTail(filename, 4), "");
    await assert.rejects(readTail(directory, 4), /regular files|EISDIR/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test("webview field escaping prevents HTML injection", () => {
  assert.equal(escapeHtml('<script x="a">&\'</script>'), "&lt;script x=&quot;a&quot;&gt;&amp;&#39;&lt;/script&gt;");
});
