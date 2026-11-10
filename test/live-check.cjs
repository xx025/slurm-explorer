// Read-only integration check. Run on a Slurm login node after npm run compile.
const os = require("node:os");
const { SlurmClient, runCommand } = require("../dist/slurm");
const { logPath, readTail } = require("../dist/logs");
const { finishedHistory } = require("../dist/history");

async function check() {
  const user = os.userInfo().username;
  const client = new SlurmClient(() => ({
    user, binDirectory: process.env.SLURM_TEST_BIN || "", timeoutSeconds: 20, historyDays: 7
  }), () => {});
  const report = {
    host: os.hostname(), user, time: new Date().toISOString(),
    version: (await runCommand("squeue", ["--version"], 20000)).trim(),
    queueCount: 0, historyCount: 0, jobs: [], historicalLookup: null
  };
  const jobs = await client.queue();
  report.queueCount = jobs.length;
  for (const job of jobs.slice(0, 5)) {
    const details = await client.details(job.id);
    if (details.fields.JobId !== job.id) { throw new Error("Job detail ID mismatch"); }
    const item = {
      id: job.id, state: job.state, partition: job.partition,
      source: details.source, cpus: details.fields.NumCPUs,
      allocatedResources: details.fields.AllocTRES,
      logs: {}
    };
    for (const stream of ["StdOut", "StdErr"]) {
      try {
        const text = await readTail(logPath(details, stream), 4096);
        item.logs[stream] = { readable: true, previewBytes: Buffer.byteLength(text) };
      } catch (error) {
        item.logs[stream] = { readable: false, reason: error.message };
      }
    }
    report.jobs.push(item);
  }
  const history = await client.history();
  report.historyCount = history.length;
  const finished = finishedHistory(history).filter(record => !jobs.some(job => job.id === record.id));
  report.sidebarHistory = {
    finishedCount: finished.length,
    latest: finished.slice(0, 3).map(record => ({ id: record.id, state: record.fields.State, end: record.fields.End }))
  };
  const historical = [...history].reverse().find(job =>
    !["RUNNING", "PENDING", "COMPLETING"].includes(job.fields.State) && /^\d+(?:_\d+)?(?:\+\d+)?$/.test(job.id)
  );
  if (historical) {
    const details = await client.details(historical.id);
    report.historicalLookup = { id: details.id, source: details.source, state: details.fields.State ?? details.fields.JobState };
  }
  const allClient = new SlurmClient(() => ({
    user: "*", binDirectory: process.env.SLURM_TEST_BIN || "", timeoutSeconds: 20, historyDays: 7
  }), () => {});
  const allJobs = await allClient.queue();
  const allHistory = await allClient.history();
  report.allUsers = {
    queueCount: allJobs.length,
    historyCount: allHistory.length,
    users: [...new Set(allJobs.map(job => job.user))].sort()
  };
  report.allUsers.finishedHistoryCount = finishedHistory(allHistory).filter(record => !allJobs.some(job => job.id === record.id)).length;
  const other = allJobs.find(job => job.user !== user);
  if (other) {
    const namedClient = new SlurmClient(() => ({
      user: other.user, binDirectory: process.env.SLURM_TEST_BIN || "", timeoutSeconds: 20, historyDays: 7
    }), () => {});
    const namedJobs = await namedClient.queue();
    const namedHistory = await namedClient.history();
    if (namedJobs.some(job => job.user !== other.user)) { throw new Error("Specified user query returned another user's jobs"); }
    const details = await namedClient.details(other.id);
    report.specifiedUser = {
      user: other.user, queueCount: namedJobs.length, historyCount: namedHistory.length,
      job: { id: details.id, source: details.source, state: details.fields.JobState ?? details.fields.State }
    };
  }
  return report;
}

if (require.main === module) {
  check().then(report => console.log(JSON.stringify(report, null, 2))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
module.exports = { check };
