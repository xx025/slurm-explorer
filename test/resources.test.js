const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseResources } = require("../dist/model");
const { SlurmClient } = require("../dist/slurm");

test("partition records retain node ranges, nested TRES, defaults and limits", () => {
  const records = parseResources(
    "PartitionName=gpu10 State=UP Default=NO TotalNodes=2 TotalCPUs=128 Nodes=gpu[01-02] MaxTime=2-00:00:00 TRES=cpu=128,mem=512000M,gres/gpu=8\n" +
    "PartitionName=gpu2 State=DOWN Default=YES TotalNodes=0 TotalCPUs=0 Nodes=(null)\n", "partition");
  assert.deepEqual(records.map(record => record.name), ["gpu2", "gpu10"]);
  assert.equal(records[1].fields.TRES, "cpu=128,mem=512000M,gres/gpu=8");
  assert.equal(records[1].fields.Nodes, "gpu[01-02]");
  assert.equal(records[0].fields.Default, "YES");
  assert.equal(records[1].kind, "partition");
  assert.match(records[1].raw, /MaxTime=2-00:00:00/);
  assert.deepEqual(parseResources("\n", "partition"), []);
  assert.throws(() => parseResources("unrecognized result", "partition"), /Unexpected scontrol/);
});

test("node records keep compound states, GPU topology and spaced drain reasons", () => {
  const [node] = parseResources("NodeName=gpu01 CPUAlloc=16 CPUTot=64 RealMemory=256000 AllocMem=64000 FreeMem=120000 Gres=gpu:a100:4(S:0-1) State=MIXED+DRAIN Partitions=gpu,debug CfgTRES=cpu=64,gres/gpu=4 Reason=Not responding [root@2026-11-10T10:00:00]", "node");
  assert.equal(node.fields.Reason, "Not responding [root@2026-11-10T10:00:00]");
  assert.equal(node.fields.State, "MIXED+DRAIN");
  assert.equal(node.fields.Gres, "gpu:a100:4(S:0-1)");
  assert.equal(node.fields.Partitions, "gpu,debug");
  assert.throws(() => parseResources("PartitionName=gpu State=UP", "node"), /Unexpected/);
});

test("cluster queries use the configured executable and timeout without a job user filter", async () => {
  const calls = [];
  const client = new SlurmClient(() => ({
    user: "alice", binDirectory: "/opt/slurm/bin", timeoutSeconds: 13, historyDays: 7
  }), () => {}, async (command, args, timeout) => {
    calls.push({ command, args, timeout });
    return args.includes("partition") ? "PartitionName=gpu State=UP" : "NodeName=gpu01 State=IDLE";
  });
  assert.equal((await client.resources("partition"))[0].name, "gpu");
  assert.equal((await client.resources("node"))[0].name, "gpu01");
  assert.deepEqual(calls, [
    { command: "/opt/slurm/bin/scontrol", args: ["show", "partition", "--oneliner"], timeout: 13000 },
    { command: "/opt/slurm/bin/scontrol", args: ["show", "node", "--oneliner", "--details"], timeout: 13000 }
  ]);
});
