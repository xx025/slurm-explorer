const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");

const disposable = () => ({ dispose() {} });
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness(initialGate) {
  const state = {
    values: { refreshSeconds: 0 }, configurationListeners: [], commands: new Map(),
    selections: [], inputs: [], queries: [], panels: [], errors: [],
    historyQueries: [], quickPickCalls: 0, executed: [], revealed: []
  };
  class EventEmitter {
    event = () => disposable();
    fire() {}
    dispose() {}
  }
  const own = os.userInfo().username;
  const other = own === "bob" ? "alice" : "bob";
  const jobs = [own, other].map((user, index) => ({
    id: String(42 + index), name: "train", user, state: "RUNNING", partition: "gpu",
    elapsed: "1:00", timeLimit: "2:00", nodes: "1", cpus: "4", memory: "8G",
    resources: "gpu:1", reason: "node01"
  }));
  state.historyData = [
    { id: "100", source: "sacct", raw: "", fields: { JobName: "finished-train", User: own, State: "COMPLETED", Partition: "gpu", Elapsed: "10:00", Start: "2026-11-10T10:00:00", End: "2026-11-10T10:10:00", ExitCode: "0:0" } },
    { id: "101", source: "sacct", raw: "", fields: { JobName: "failed-train", User: own, State: "FAILED", Partition: "gpu", Elapsed: "1:00", Start: "2026-11-10T11:00:00", End: "2026-11-10T11:01:00", ExitCode: "1:0" } },
    { id: "99", source: "sacct", raw: "", fields: { JobName: "other-train", User: other, State: "TIMEOUT", Partition: "gpu", Elapsed: "2:00", Start: "2026-11-10T09:00:00", End: "2026-11-10T09:02:00", ExitCode: "0:15" } },
    { id: "42", source: "sacct", raw: "", fields: { JobName: "train", User: own, State: "RUNNING", Partition: "gpu", Elapsed: "1:00", Start: "2026-11-10T12:00:00", End: "Unknown", ExitCode: "0:0" } }
  ];
  const configuration = {
    get: (key, fallback) => state.values[key] ?? fallback,
    update: async (key, value) => {
      state.values[key] = value;
      const changed = `slurmJobs.${key}`;
      state.configurationListeners.forEach(listener => listener({
        affectsConfiguration: section => changed === section || changed.startsWith(`${section}.`)
      }));
    }
  };
  const api = {
    EventEmitter,
    TreeItem: class { constructor(label) { this.label = label; } },
    ThemeIcon: class {},
    TreeItemCollapsibleState: { Expanded: 2, Collapsed: 1 },
    ConfigurationTarget: { Global: 1 },
    ViewColumn: { Active: -1 },
    ProgressLocation: { Notification: 15 },
    env: { language: "en", clipboard: { writeText: async () => {} } },
    workspace: {
      getConfiguration: () => configuration,
      textDocuments: [],
      registerTextDocumentContentProvider: () => disposable(),
      onDidCloseTextDocument: () => disposable(),
      onDidChangeConfiguration: listener => {
        state.configurationListeners.push(listener);
        return disposable();
      }
    },
    window: {
      registerWebviewViewProvider: (_id, provider) => { state.outputProvider = provider; return disposable(); },
      createOutputChannel: () => ({ ...disposable(), appendLine() {}, show() {} }),
      createTreeView: (_id, options) => {
        state.tree = options.treeDataProvider;
        state.view = {
          ...disposable(), visible: true, onDidChangeVisibility: () => disposable(),
          reveal: async (element, options) => { state.revealed.push({ element, options }); state.tree.getChildren(element); }
        };
        return state.view;
      },
      showQuickPick: async items => {
        state.quickPickCalls++;
        const selection = state.selections.shift();
        return items.find(item => item.value === selection);
      },
      showInputBox: async () => state.inputs.shift(),
      showErrorMessage: async text => { state.errors.push(text); },
      showInformationMessage: async () => {},
      withProgress: async (_options, task) => task(),
      createWebviewPanel: () => {
        const listeners = [];
        const panel = {
          webview: { html: "", onDidReceiveMessage: () => disposable() },
          reveal() {},
          onDidDispose(listener) { listeners.push(listener); return disposable(); },
          dispose() { listeners.forEach(listener => listener()); }
        };
        state.panels.push(panel);
        return panel;
      }
    },
    commands: {
      registerCommand(name, handler) { state.commands.set(name, handler); return disposable(); },
      executeCommand: async (...args) => { state.executed.push(args); }
    }
  };
  let gated = false;
  class SlurmClient {
    constructor(readSettings) { this.readSettings = readSettings; }
    async queue() {
      const user = this.readSettings().user;
      state.queries.push(user);
      if (initialGate && !gated) { gated = true; await initialGate; }
      return jobs.filter(job => user === "*" || job.user === user);
    }
    async details(id) {
      if (state.detailsHandler) { return state.detailsHandler(id); }
      return { id, source: "scontrol", fields: { JobId: id, JobName: "<script>test</script>", JobState: "RUNNING", ...(state.logFile ? {StdOut: state.logFile, StdErr: ""} : {}) }, raw: "JobId=" + id };
    }
    async history() {
      const user = this.readSettings().user;
      state.historyQueries.push(user);
      if (state.historyHandler) { return state.historyHandler(user); }
      return state.historyData.filter(record => user === "*" || record.fields.User === user);
    }
  }
  const filename = path.join(__dirname, "../dist/extension.js");
  const realRequire = createRequire(filename);
  const outputModule = { exports: {} };
  new Function("require", "module", "exports", fs.readFileSync(path.join(__dirname, "../dist/output.js"), "utf8"))(
    name => name === "vscode" ? api : realRequire(name), outputModule, outputModule.exports);
  const injectedRequire = name => name === "vscode" ? api : name === "./slurm" ? { SlurmClient } : name === "./output" ? outputModule.exports : realRequire(name);
  const module = { exports: {} };
  new Function("require", "module", "exports", fs.readFileSync(filename, "utf8"))(injectedRequire, module, module.exports);
  const context = { subscriptions: [] };
  module.exports.activate(context);
  state.own = own;
  state.other = other;
  state.run = (name, ...args) => state.commands.get(name)(...args);
  state.dispose = () => [...context.subscriptions].reverse().forEach(item => item.dispose());
  return state;
}

test("extension user selection and language commands update real providers and open details", async () => {
  const app = harness();
  try {
    await settle();
    assert.deepEqual(app.tree.jobs.map(job => job.user), [app.own]);
    app.selections.push("*");
    await app.run("slurm.selectUser");
    assert.equal(app.values.user, "*");
    assert.equal(app.tree.jobs.length, 2);
    assert.match(app.view.message, /All users/);
    assert.match(app.tree.getTreeItem({ kind: "job", job: app.tree.jobs[1] }).description, new RegExp(app.other));

    app.selections.push("custom");
    app.inputs.push(app.other);
    await app.run("slurm.selectUser");
    assert.deepEqual(app.tree.jobs.map(job => job.user), [app.other]);

    await app.run("slurm.details", "43");
    assert.match(app.panels[0].webview.html, /Refresh details/);
    assert.doesNotMatch(app.panels[0].webview.html, /<script>test<\/script>/);
    app.selections.push("zh-cn");
    await app.run("slurm.language");
    await settle();
    assert.equal(app.view.title, "任务");
    assert.match(app.panels[0].webview.html, /刷新详情/);
    assert.match(app.panels[0].webview.html, /lang="zh-cn"/);
    assert.match(app.tree.getTreeItem(app.tree.getChildren()[0]).label, /运行中/);
    app.selections.push("en");
    await app.run("slurm.language");
    await settle();
    assert.match(app.panels[0].webview.html, /Refresh details/);
    assert.deepEqual(app.errors, []);
  } finally { app.dispose(); }
});

test("late reads and controller lookups cannot overwrite a newly selected job", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slurm-switch-"));
  const first = path.join(directory, "first.log");
  const second = path.join(directory, "second.log");
  fs.writeFileSync(first, "first\n");
  fs.writeFileSync(second, "second\n");
  const app = harness();
  const messages = [];
  app.outputProvider.resolveWebviewView({
    webview: { html:"", postMessage:async data=>messages.push(data), onDidReceiveMessage:()=>disposable() },
    onDidDispose:()=>disposable()
  });
  try {
    app.logFile = first;
    await app.run("slurm.stdout", "42");
    let releaseRead;
    app.outputProvider.cursor.read = () => new Promise(resolve => { releaseRead = resolve; });
    const pendingRead = app.outputProvider.poll();
    app.logFile = second;
    await app.run("slurm.stdout", "43");
    releaseRead({text:"late first\n",reset:false,skipped:false});
    await pendingRead;
    assert.equal(messages.at(-1).text, "second\n");
    assert.equal(messages.at(-1).title, "Job 43");
    let releaseLookup;
    app.detailsHandler = id => id === "42" ? new Promise(resolve => {releaseLookup=resolve;})
      : Promise.resolve({id,source:"scontrol",fields:{StdOut:second},raw:""});
    const pendingLookup = app.run("slurm.stdout", "42");
    await settle();
    await app.run("slurm.stdout", "43");
    releaseLookup({id:"42",source:"scontrol",fields:{StdOut:first},raw:""});
    await pendingLookup;
    assert.equal(messages.at(-1).title, "Job 43");
    assert.equal(messages.at(-1).text, "second\n");
  } finally { app.dispose(); fs.rmSync(directory,{recursive:true}); }
});

test("opening stdout focuses the bottom view and follows incremental content", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slurm-output-"));
  const filename = path.join(directory, "job.log");
  fs.writeFileSync(filename, "epoch 1\n");
  const app = harness();
  const messages = [];
  let receive;
  const view = {
    webview: {
      html: "", postMessage: async data => { messages.push(data); },
      onDidReceiveMessage: handler => { receive = handler; return disposable(); }
    },
    onDidDispose: () => disposable()
  };
  try {
    app.logFile = filename;
    app.outputProvider.resolveWebviewView(view);
    await app.run("slurm.stdout", "42");
    assert.ok(app.executed.some(([command]) => command === "slurmLogOutput.focus"));
    assert.equal(messages.at(-1).text, "epoch 1\n");
    await receive({action:"pause"});
    fs.appendFileSync(filename, "epoch 2\n");
    await app.outputProvider.poll();
    assert.equal(messages.at(-1).text, "epoch 1\n");
    await receive({action:"pause"});
    assert.equal(messages.at(-1).text, "epoch 1\nepoch 2\n");
    await receive({action:"clear"});
    fs.appendFileSync(filename, "epoch 3\n");
    await app.outputProvider.poll();
    assert.equal(messages.at(-1).text, "epoch 3\n");
    await receive({action:"stream",stream:"StdErr"});
    assert.equal(messages.at(-1).stream, "StdErr");
    assert.equal(messages.at(-1).text, "epoch 1\nepoch 2\nepoch 3\n");
    app.selections.push("zh-cn");
    await app.run("slurm.language");
    assert.match(view.webview.html, /自动滚动/);
    await receive({action:"stop"});
    await receive({action:"ready"});
    assert.equal(messages.at(-1).active, false);
    assert.deepEqual(app.errors, []);
  } finally { app.dispose(); fs.rmSync(directory, {recursive:true}); }
});

test("a pending own-user query cannot replace results after switching to all users", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const app = harness(gate);
  try {
    app.selections.push("*");
    const selection = app.run("slurm.selectUser");
    await settle();
    release();
    await selection;
    assert.deepEqual(app.queries, [app.own, "*"]);
    assert.equal(app.tree.jobs.length, 2);
    assert.match(app.view.message, /All users/);
  } finally { release(); app.dispose(); }
});

test("history is a lazy sidebar group; the history command expands it without a picker", async () => {
  const app = harness();
  try {
    await settle();
    const root = app.tree.getChildren().at(-1);
    assert.equal(root.kind, "history");
    assert.equal(app.historyQueries.length, 0);
    assert.equal(app.tree.getTreeItem(root).label, "History");
    const pending = app.tree.getChildren(root);
    assert.equal(pending[0].status, "loading");
    await app.tree.history.load();
    const children = app.tree.getChildren(root);
    assert.deepEqual(children.map(child => child.details.id), ["101", "100"]);
    assert.equal(app.tree.getTreeItem(root).label, "History (2)");
    await app.run("slurm.details", children[0]);
    assert.match(app.panels[0].webview.html, /failed-train/);
    assert.match(app.panels[0].webview.html, /sacct/);
    await app.run("slurm.history");
    assert.equal(app.quickPickCalls, 0);
    assert.equal(app.revealed.at(-1).element, root);
    assert.equal(app.revealed.at(-1).options.expand, true);
  } finally { app.dispose(); }
});

test("history follows user scope, filtering and language changes", async () => {
  const app = harness();
  try {
    await settle();
    await app.run("slurm.history");
    app.selections.push("*");
    await app.run("slurm.selectUser");
    await app.tree.history.load();
    assert.equal(app.tree.getChildren(app.tree.historyRoot).length, 3);
    app.tree.setFilter("TIMEOUT");
    assert.deepEqual(app.tree.getChildren(app.tree.historyRoot).map(child => child.details.id), ["99"]);
    app.tree.setFilter("");
    app.selections.push("custom");
    app.inputs.push(app.other);
    await app.run("slurm.selectUser");
    await app.tree.history.load();
    assert.deepEqual(app.tree.getChildren(app.tree.historyRoot).map(child => child.details.fields.User), [app.other]);
    app.selections.push("zh-cn");
    await app.run("slurm.language");
    await settle();
    assert.equal(app.tree.getTreeItem(app.tree.historyRoot).label, "历史 (1)");
  } finally { app.dispose(); }
});

test("failed history queries can be retried in the sidebar and empty history remains visible", async () => {
  const app = harness();
  try {
    await settle();
    app.historyHandler = async () => { throw new Error("Accounting unavailable"); };
    await app.run("slurm.history");
    let [status] = app.tree.getChildren(app.tree.historyRoot);
    assert.equal(status.status, "error");
    assert.equal(app.tree.getTreeItem(status).tooltip, "Accounting unavailable");
    assert.equal(app.tree.getTreeItem(status).command.command, "slurm.history");
    app.historyHandler = async () => [];
    await app.run("slurm.history");
    [status] = app.tree.getChildren(app.tree.historyRoot);
    assert.equal(status.status, "empty");
    app.tree.update([]);
    assert.deepEqual(app.tree.getChildren(), [app.tree.historyRoot]);
    assert.equal(app.quickPickCalls, 0);
    assert.deepEqual(app.errors, []);
  } finally { app.dispose(); }
});
