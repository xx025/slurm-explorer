const { test } = require("node:test");
const assert = require("node:assert/strict");
const { gpuCounts } = require("../dist/gpu");

test("aggregate TRES takes precedence over typed counts without counting the same GPU twice", () => {
  assert.deepEqual(gpuCounts({
    CfgTRES: "cpu=64,mem=256000M,gres/gpu=8,gres/gpu:a100=4,gres/gpu:v100=4",
    AllocTRES: "cpu=16,gres/gpu=3,gres/gpu:a100=2,gres/gpu:v100=1"
  }), { total: 8, allocated: 3 });
});

test("typed-only GPU TRES counts are summed while memory and utilization are excluded", () => {
  assert.deepEqual(gpuCounts({
    CfgTRES: "gres/gpu:a100=4,gres/gpu:v100=2,gres/gpumem=64000,gres/gpuutil=100",
    AllocTRES: "gres/gpu:a100=1,gres/gpu:v100=1"
  }), { total: 6, allocated: 2 });
});

test("GRES fallback handles mixed models, socket affinity, device lists and shared GRES", () => {
  assert.deepEqual(gpuCounts({
    Gres: "gpu:a100:4(S:0-1),gpu:v100:2(S:2),shard:64,mps:400",
    GresUsed: "gpu:a100:2(IDX:0,2),gpu:v100:1(IDX:4),shard:8(-/5,5/5,3/5,0/5),mps:0"
  }), { total: 6, allocated: 3 });
  assert.deepEqual(gpuCounts({Gres: "gpu:8", GresUsed: "gpu:0(IDX:N/A)"}), {total:8, allocated:0});
});

test("GRES remains usable when GPU TRES tracking is absent", () => {
  assert.deepEqual(gpuCounts({
    CfgTRES: "cpu=64,mem=256000M", AllocTRES: "cpu=16",
    Gres: "gpu:a100:4", GresUsed: "gpu:a100:2(IDX:0-1)"
  }), { total:4, allocated:2 });
});

test("CPU-only nodes and explicitly empty allocations report zero", () => {
  assert.deepEqual(gpuCounts({ Gres: "(null)" }), {total:0, allocated:0});
  assert.deepEqual(gpuCounts({ CfgTRES: "cpu=64,mem=256000M", AllocTRES: "cpu=0" }), {total:0, allocated:0});
  assert.deepEqual(gpuCounts({ Gres: "gpu:a100:4", AllocTRES: "" }), {total:4, allocated:0});
});

test("unreported or malformed GPU counts stay unknown instead of implying zero", () => {
  assert.deepEqual(gpuCounts({}), {total:undefined, allocated:undefined});
  assert.deepEqual(gpuCounts({ Gres: "Unknown", GresUsed: "N/A" }), {total:undefined, allocated:undefined});
  assert.deepEqual(gpuCounts({ Gres: "gpu:a100:4" }), {total:4, allocated:undefined});
  assert.deepEqual(gpuCounts({ CfgTRES: "gres/gpu=Unknown", Gres: "gpu:a100:unknown" }), {total:undefined, allocated:undefined});
});

test("MIG resource counts retain Slurm's configured instance counts", () => {
  assert.deepEqual(gpuCounts({
    CfgTRES: "gres/gpu=7,gres/gpu:a100_1g.5gb=7", AllocTRES: "gres/gpu=2"
  }), {total:7, allocated:2});
});
