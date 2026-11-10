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
    selections: [], inputs: [], queries: [], panels: [], errors: []
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
    TreeItemCollapsibleState: { Expanded: 2 },
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
      createOutputChannel: () => ({ ...disposable(), appendLine() {}, show() {} }),
      createTreeView: (_id, options) => {
        state.tree = options.treeDataProvider;
        state.view = { ...disposable(), visible: true, onDidChangeVisibility: () => disposable() };
        return state.view;
      },
      showQuickPick: async items => {
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
      executeCommand: async () => {}
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
      return { id, source: "scontrol", fields: { JobId: id, JobName: "<script>test</script>", JobState: "RUNNING" }, raw: "JobId=" + id };
    }
    async history() { return []; }
  }
  const filename = path.join(__dirname, "../dist/extension.js");
  const realRequire = createRequire(filename);
  const injectedRequire = name => name === "vscode" ? api : name === "./slurm" ? { SlurmClient } : realRequire(name);
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
