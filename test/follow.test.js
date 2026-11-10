const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {LogCursor} = require("../dist/follow");

async function fixture(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "slurm-follow-"));
  try { await run(path.join(directory, "job.log")); }
  finally { await fs.rm(directory, {recursive:true,force:true}); }
}

test("follower reads increments once and preserves split UTF-8 characters", () => fixture(async filename => {
  const cursor = new LogCursor(filename, 1024);
  const bytes = Buffer.from("你好");
  await fs.writeFile(filename, bytes.subarray(0,4));
  assert.equal((await cursor.read()).text, "你");
  await fs.appendFile(filename, bytes.subarray(4));
  assert.equal((await cursor.read()).text, "好");
  assert.equal((await cursor.read()).text, "");
}));

test("follower bounds initial and burst reads, detects truncation and rotation", () => fixture(async filename => {
  const cursor = new LogCursor(filename, 8);
  await fs.writeFile(filename, "0123456789");
  assert.deepEqual(await cursor.read(), {text:"23456789",reset:true,skipped:true});
  await fs.appendFile(filename, "abcdefghijk");
  assert.deepEqual(await cursor.read(), {text:"defghijk",reset:false,skipped:true});
  await fs.writeFile(filename, "new");
  assert.deepEqual(await cursor.read(), {text:"new",reset:true,skipped:false});
  await fs.rename(filename, filename+".old");
  await fs.writeFile(filename, "replaced");
  assert.deepEqual(await cursor.read(), {text:"replaced",reset:true,skipped:false});
}));

test("missing files recover later and non-regular paths are rejected", () => fixture(async filename => {
  const cursor = new LogCursor(filename, 8);
  await assert.rejects(cursor.read(), {code:"ENOENT"});
  await fs.writeFile(filename, "ready");
  assert.equal((await cursor.read()).text, "ready");
  await assert.rejects(new LogCursor(path.dirname(filename), 8).read(), /regular files/);
}));
