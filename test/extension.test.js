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
    historyQueries: [], quickPickCalls: 0, executed: [], revealed: [], terminals: []
  };
  class EventEmitter {
    listeners = [];
    event = listener => { this.listeners.push(listener); return disposable(); };
    fire(data) { this.listeners.forEach(listener => listener(data)); }
    dispose() { this.listeners = []; }
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
      createTerminal: options => {
        let opened = false, closed = false;
        const terminal = { name: options.name, text: "", pty: options.pty,
          show() { api.window.activeTerminal = terminal; if (!opened) { opened = true; options.pty.open(); } },
          dispose() { if (!closed) { closed = true; options.pty.close(); } }
        };
        options.pty.onDidWrite(data => { terminal.text += data; });
        state.terminals.push(terminal); return terminal;
      },
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
    async logDetails(id, known) {
      if (state.logDetailsHandler) { return state.logDetailsHandler(id, known); }
      return known ?? this.details(id);
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

test("native terminal tabs retain separate task streams, deduplicate and pause independently", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slurm-output-"));
  const filename = path.join(directory, "job.log");
  fs.writeFileSync(filename, "epoch 1\n");
  const app = harness();
  try {
    app.logFile = filename;
    await app.run("slurm.stdout", "42");
    assert.equal(app.terminals.length, 1);
    const first = app.terminals[0];
    assert.equal(first.name, "Slurm 42 · stdout");
    assert.match(first.text, /epoch 1\r\n$/);
    await app.run("slurm.pauseOutput");
    fs.appendFileSync(filename, "epoch 2\n");
    await app.run("slurm.stdout", "43");
    assert.equal(app.terminals.length, 2);
    const second = app.terminals[1];
    assert.doesNotMatch(first.text, /epoch 2/);
    assert.match(second.text, /epoch 1\r\nepoch 2\r\n$/);
    await app.run("slurm.stdout", "42");
    assert.equal(app.terminals.length, 2);
    assert.doesNotMatch(first.text, /epoch 2/);
    await app.run("slurm.resumeOutput");
    await settle();
    await app.run("slurm.stdout", "42");
    assert.match(first.text, /epoch 2\r\n$/);
    await app.run("slurm.stderr", "42");
    assert.equal(app.terminals.length, 3);
    assert.equal(app.terminals[2].name, "Slurm 42 · stderr");
    await app.run("slurm.clearOutput");
    assert.ok(app.terminals[2].text.endsWith("\x1b[2J\x1b[3J\x1b[H"));
    first.dispose();
    fs.appendFileSync(filename, "epoch 3\n");
    const snapshot = first.text;
    await app.run("slurm.stdout", "42");
    assert.equal(app.terminals.length, 4);
    assert.equal(first.text, snapshot);
    assert.match(app.terminals[3].text, /epoch 3\r\n$/);
    assert.deepEqual(app.errors, []);
  } finally { app.dispose(); fs.rmSync(directory, {recursive:true}); }
});

test("history output enriches known accounting metadata before opening a native tab", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slurm-history-log-"));
  const filename = path.join(directory, "history.log");
  fs.writeFileSync(filename, "finished\n");
  const app = harness();
  try {
    const known = app.historyData[0];
    app.logDetailsHandler = async (id, details) => {
      assert.equal(id, known.id); assert.equal(details, known);
      return {...details, fields: {...details.fields, StdOut:filename}};
    };
    await app.run("slurm.stdout", {kind:"historyJob", details:known});
    assert.match(app.terminals[0].text, /finished\r\n$/);
    app.logDetailsHandler = async (_id, details) => details;
    await app.run("slurm.stdout", {kind:"historyJob", details:app.historyData[1]});
    assert.equal(app.terminals.length, 1);
    assert.match(app.errors[0], /did not retain a log path/);
  } finally { app.dispose(); fs.rmSync(directory,{recursive:true}); }
});

test("concurrent log lookups keep both native tabs without stealing focus from the latest click", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slurm-native-switch-"));
  const filename = path.join(directory,"job.log");
  fs.writeFileSync(filename,"output\n");
  const app = harness();
  let release;
  try {
    app.logDetailsHandler = id => id === "42" ? new Promise(resolve => { release = resolve; })
      : Promise.resolve({id,source:"scontrol",fields:{StdOut:filename},raw:""});
    const first = app.run("slurm.stdout","42");
    await settle();
    await app.run("slurm.stdout","43");
    release({id:"42",source:"scontrol",fields:{StdOut:filename},raw:""});
    await first;
    app.logDetailsHandler = async id => ({id,source:"scontrol",fields:{StdOut:filename},raw:""});
    assert.deepEqual(app.terminals.map(terminal=>terminal.name),["Slurm 43 · stdout","Slurm 42 · stdout"]);
    await app.run("slurm.pauseOutput");
    fs.appendFileSync(filename,"more\n");
    await app.run("slurm.stdout","43");
    assert.doesNotMatch(app.terminals[0].text,/more/);
    await app.run("slurm.stdout","42");
    assert.match(app.terminals[1].text,/more\r\n$/);
  } finally { app.dispose(); fs.rmSync(directory,{recursive:true}); }
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
