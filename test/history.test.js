const { test } = require("node:test");
const assert = require("node:assert/strict");
const { HistoryStore, finishedHistory } = require("../dist/history");

const record = (id, state = "COMPLETED", end = "2026-11-10T10:00:00") => ({
  id, source: "sacct", raw: "", fields: { State: state, Start: "2026-11-10T09:00:00", End: end }
});

test("history keeps terminal jobs, sorts newest first and removes older duplicate records", () => {
  const result = finishedHistory([
    record("1"), record("2", "RUNNING", "Unknown"), record("3", "PENDING", "Unknown"),
    record("4", "SUSPENDED", "Unknown"), record("5", "FAILED", "2026-11-10T11:00:00"),
    record("6", "CANCELLED by 1000"), record("7", "OUT_OF_MEMORY"),
    record("8", "COMPLETED+"), record("1", "COMPLETED", "2026-11-10T08:00:00")
  ]);
  assert.deepEqual(result.map(job => job.id), ["5", "8", "7", "6", "1"]);
  assert.equal(result.at(-1).fields.End, "2026-11-10T10:00:00");
});

test("history caches reads, combines concurrent expansion requests and permits explicit refresh", async () => {
  let calls = 0;
  const store = new HistoryStore(async () => { calls++; return [record(String(calls))]; }, () => {});
  const first = store.load();
  assert.equal(store.loading, true);
  assert.equal(first, store.load());
  await first;
  await store.load();
  assert.equal(calls, 1);
  await store.load(true);
  assert.equal(calls, 2);
  assert.equal(store.records[0].id, "2");
});

test("a stale history response cannot restore data from an earlier user scope", async () => {
  let release;
  let calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const store = new HistoryStore(async () => ++calls === 1 ? gate : [record("new-user")], () => {});
  const old = store.load();
  await Promise.resolve();
  store.reset();
  assert.deepEqual(store.records, []);
  const current = store.load();
  await current;
  release([record("old-user")]);
  await old;
  assert.deepEqual(store.records.map(job => job.id), ["new-user"]);
  assert.equal(store.loading, false);
});

test("failed accounting queries retain an explicit error and can recover on retry", async () => {
  let fail = true;
  const store = new HistoryStore(async () => {
    if (fail) { throw new Error("No accounting connection"); }
    return [record("recovered")];
  }, () => {});
  await store.load();
  assert.match(store.error.message, /No accounting/);
  assert.equal(store.loading, false);
  fail = false;
  await store.load(true);
  assert.equal(store.error, undefined);
  assert.equal(store.records[0].id, "recovered");
});

test("disposing while a query is running suppresses later updates", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let changes = 0;
  const store = new HistoryStore(() => gate, () => changes++);
  const pending = store.load();
  store.dispose();
  release([record("late")]);
  await pending;
  assert.deepEqual(store.records, []);
  assert.equal(changes, 1);
});
