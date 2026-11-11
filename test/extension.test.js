const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");

const disposable = () => ({ dispose() {} });
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness(initialGate, cacheRoot, values = {}) {
  const state = {
    values: { refreshSeconds: 0, cacheEnabled: false, ...values }, configurationListeners: [], commands: new Map(),
    selections: [], inputs: [], queries: [], panels: [], errors: [], messages: [],
    historyQueries: [], quickPickCalls: 0, executed: [], revealed: [], terminals: [], documents: new Map(), editors: [],
    views: new Map(), resourceQueries: [], providers: new Map(), closeListeners: [], scriptQueries: []
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
  const uri = (scheme, filename) => ({ fsPath: filename, path: filename, scheme, toString: () => `${scheme}:${filename}` });
  const api = {
    Uri: {
      file: filename => uri("file", filename),
      from: value => uri(value.scheme, value.path),
      joinPath: (base, ...segments) => uri(base.scheme, path.join(base.fsPath, ...segments))
    },
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
      openTextDocument: async uri => {
        if (state.documentGate) { await state.documentGate(uri); }
        if (!state.documents.has(uri.fsPath)) {
          const provider = state.providers.get(uri.scheme);
          let text = provider ? await provider.provideTextDocumentContent(uri) : await fs.promises.readFile(uri.fsPath, "utf8");
          state.documents.set(uri.fsPath, { uri, getText: () => text, isReadonly: !!provider });
          if (provider) { provider.onDidChange(async changed => {
            if (changed.toString() === uri.toString()) { text = await provider.provideTextDocumentContent(uri); }
          }); }
        }
        return state.documents.get(uri.fsPath);
      },
      textDocuments: [],
      registerTextDocumentContentProvider: (scheme, provider) => {
        state.providers.set(scheme, provider);
        return { dispose: () => state.providers.delete(scheme) };
      },
      onDidCloseTextDocument: listener => { state.closeListeners.push(listener); return disposable(); },
      onDidChangeConfiguration: listener => {
        state.configurationListeners.push(listener);
        return disposable();
      }
    },
    window: {
      showTextDocument: async (document, options) => {
        state.editors.push({ document, options });
        return { document };
      },
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
      createTreeView: (id, options) => {
        const view = {
          ...disposable(), visible: true, onDidChangeVisibility: () => disposable(),
          reveal: async (element, options) => { state.revealed.push({ element, options }); state.tree.getChildren(element); }
        };
        state.views.set(id, { view, tree: options.treeDataProvider });
        if (id === "slurmJobs") { state.tree = options.treeDataProvider; state.view = view; }
        return view;
      },
      showQuickPick: async items => {
        state.quickPickCalls++;
        const selection = state.selections.shift();
        return items.find(item => item.value === selection);
      },
      showInputBox: async () => state.inputs.shift(),
      showErrorMessage: async text => { state.errors.push(text); },
      showInformationMessage: async text => { state.messages.push(text); },
      withProgress: async (_options, task) => task(),
      createWebviewPanel: () => {
        const listeners = [];
        const panel = {
          webview: { html: "", onDidReceiveMessage: listener => { panel.receive = listener; return disposable(); } },
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
    async batchScript(id) {
      state.scriptQueries.push(id);
      if (state.scriptHandler) { return state.scriptHandler(id); }
      return '#!/bin/bash\n#SBATCH --job-name=submitted\necho "$SLURM_JOB_ID"\n';
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
    async resources(kind) {
      state.resourceQueries.push(kind);
      if (state.resourceHandler) { return state.resourceHandler(kind); }
      return kind === "partition"
        ? [{ kind, name: "gpu", fields: { PartitionName: "gpu", State: "UP", TotalNodes: "2", TotalCPUs: "128", Default: "YES", Nodes: "gpu[01-02]" }, raw: "PartitionName=gpu State=UP" }]
        : [{ kind, name: "gpu01", fields: { NodeName: "gpu01", State: "MIXED", CPUAlloc: "16", CPUTot: "64", Partitions: "gpu", Gres: "gpu:a100:4", CfgTRES: "cpu=64,gres/gpu=4,gres/gpu:a100=4", AllocTRES: "cpu=16,gres/gpu=2,gres/gpu:a100=2", RealMemory: "256000" }, raw: "NodeName=gpu01 State=MIXED" }];
    }
  }
  const filename = path.join(__dirname, "../dist/extension.js");
  const realRequire = createRequire(filename);
  const outputModule = { exports: {} };
  new Function("require", "module", "exports", fs.readFileSync(path.join(__dirname, "../dist/output.js"), "utf8"))(
    name => name === "vscode" ? api : realRequire(name), outputModule, outputModule.exports);
  const scriptsModule = { exports: {} };
  new Function("require", "module", "exports", fs.readFileSync(path.join(__dirname, "../dist/scripts.js"), "utf8"))(
    name => name === "vscode" ? api : realRequire(name), scriptsModule, scriptsModule.exports);
  const clusterModule = { exports: {} };
  new Function("require", "module", "exports", fs.readFileSync(path.join(__dirname, "../dist/cluster.js"), "utf8"))(
    name => name === "vscode" ? api : realRequire(name), clusterModule, clusterModule.exports);
  const injectedRequire = name => name === "vscode" ? api : name === "./slurm" ? { SlurmClient }
    : name === "./output" ? outputModule.exports : name === "./scripts" ? scriptsModule.exports : name === "./cluster" ? clusterModule.exports : realRequire(name);
  const module = { exports: {} };
  new Function("require", "module", "exports", fs.readFileSync(filename, "utf8"))(injectedRequire, module, module.exports);
  const storage = cacheRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), "slurm-extension-cache-"));
  const context = { subscriptions: [], globalStorageUri: api.Uri.file(storage), extensionUri: api.Uri.file(path.join(__dirname, "..")) };
  module.exports.activate(context);
  state.own = own;
  state.other = other;
  state.run = (name, ...args) => state.commands.get(name)(...args);
  state.dispose = () => {
    [...context.subscriptions].reverse().forEach(item => item.dispose());
    if (!cacheRoot) { fs.rmSync(storage, {recursive:true,force:true}); }
  };
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

test("logs open actual files in persistent editor tabs, reusing documents and preserving bytes", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slurm-output-"));
  const filename = path.join(directory, "job #1.log");
  const stderr = path.join(directory, "error.err");
  const text = "INFO starting\n\x1b[31mERROR failed\x1b[0m\n";
  fs.writeFileSync(filename, text);
  fs.writeFileSync(stderr, "failure\n");
  const app = harness();
  try {
    app.logFile = filename;
    await app.run("slurm.stdout", "42");
    const first = app.editors[0];
    assert.equal(first.document.uri.fsPath, filename);
    assert.equal(first.document.uri.scheme, "file");
    assert.equal(first.document.getText(), text);
    assert.deepEqual(first.options, { preview: false });
    await app.run("slurm.stdout", "42");
    assert.equal(app.editors[1].document, first.document);
    await app.run("slurm.stderr", "42");
    assert.equal(app.editors[2].document, first.document); // merged stderr
    app.detailsHandler = async id => ({id, source:"scontrol", fields:{StdOut:filename,StdErr:stderr},raw:""});
    await app.run("slurm.stderr", "43");
    assert.equal(app.editors[3].document.uri.fsPath, stderr);
    assert.equal(app.terminals.length, 0);
    for (const command of ["slurm.pauseOutput", "slurm.resumeOutput", "slurm.clearOutput"]) {
      assert.equal(app.commands.has(command), false);
    }
    assert.deepEqual(app.errors, []);
  } finally { app.dispose(); fs.rmSync(directory, { recursive: true }); }
});

test("missing and non-regular logs report errors without opening an editor", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slurm-invalid-log-"));
  const app = harness();
  try {
    app.logFile = path.join(directory, "missing.out");
    await app.run("slurm.stdout", "42");
    assert.match(app.errors[0], /ENOENT/);
    app.logFile = directory;
    await app.run("slurm.stdout", "42");
    assert.match(app.errors[1], /regular files/);
    assert.equal(app.editors.length, 0);
    assert.equal(app.terminals.length, 0);
  } finally { app.dispose(); fs.rmSync(directory, { recursive: true }); }
});

test("partition and node views show independent resources and refresh localized details", async () => {
  const app = harness();
  try {
    await settle();
    const partitions = app.views.get("slurmPartitions");
    const nodes = app.views.get("slurmNodes");
    assert.deepEqual(app.resourceQueries.sort(), ["node", "partition"]);
    const partition = partitions.tree.getChildren()[0];
    assert.equal(partitions.tree.getTreeItem(partition).label, "gpu *");
    assert.match(partitions.tree.getTreeItem(partition).description, /2 nodes · 128 CPUs/);
    const node = nodes.tree.getChildren()[0];
    assert.match(nodes.tree.getTreeItem(node).description, /CPU 16\/64 · GPU 2\/4 · gpu/);
    assert.match(nodes.tree.getTreeItem(node).tooltip, /GPUs \(total\): 4/);
    await app.run("slurm.resourceDetails", node);
    const panel = app.panels[0];
    assert.match(panel.webview.html, /gpu:a100:4/);
    assert.match(panel.webview.html, /Configured memory/);
    assert.match(panel.webview.html, /GPUs \(total\)<\/th><td>4<\/td>/);
    assert.match(panel.webview.html, /GPUs \(allocated\)<\/th><td>2<\/td>/);
    await app.run("slurm.resourceDetails", node);
    assert.equal(app.panels.length, 1);
    app.resourceHandler = async kind => kind === "node"
      ? [{ ...node, fields: { ...node.fields, CPUAlloc: "32", Reason: "<script>unsafe</script>" } }]
      : [partition];
    await panel.receive({action:"refresh"});
    assert.match(panel.webview.html, />32</);
    assert.doesNotMatch(panel.webview.html, /<script>unsafe<\/script>/);
    assert.match(panel.webview.html, /&lt;script&gt;unsafe/);
    app.selections.push("zh-cn");
    await app.run("slurm.language");
    await settle();
    assert.equal(partitions.view.title, "分区");
    assert.equal(nodes.view.title, "节点");
    assert.match(panel.webview.html, /已分配 CPU/);
    assert.match(panel.webview.html, /GPU 总数<\/th><td>4<\/td>/);
    app.selections.push("*");
    await app.run("slurm.selectUser");
    assert.equal(partitions.tree.records[0].name, "gpu");
    assert.equal(nodes.tree.records[0].name, "gpu01");
    await app.run("slurm.resourceDetails", partition);
    assert.equal(app.panels.length, 2);
    for (const resourcePanel of app.panels) {
      assert.equal(path.basename(resourcePanel.iconPath.light.fsPath), "slurm-light.svg");
      assert.equal(path.basename(resourcePanel.iconPath.dark.fsPath), "slurm.svg");
      for (const icon of [resourcePanel.iconPath.light, resourcePanel.iconPath.dark]) {
        assert.ok(fs.existsSync(icon.fsPath));
      }
    }
    assert.deepEqual(app.errors, []);
  } finally { app.dispose(); }
});

test("resource refresh retains previous data on failure, retries, and skips hidden views", async () => {
  const app = harness();
  try {
    await settle();
    const partitions = app.views.get("slurmPartitions");
    const nodes = app.views.get("slurmNodes");
    const previous = nodes.tree.records[0];
    partitions.view.visible = false;
    app.resourceQueries.length = 0;
    app.resourceHandler = async () => { throw new Error("controller unavailable"); };
    await app.run("slurm.refresh");
    assert.deepEqual(app.resourceQueries, ["node"]);
    assert.equal(nodes.tree.records[0], previous);
    assert.match(nodes.view.message, /Showing previous results.*controller unavailable/);
    const retry = nodes.tree.getTreeItem(nodes.tree.getChildren().at(-1));
    assert.equal(retry.command.command, "slurm.refreshNodes");
    await app.run("slurm.resourceDetails", previous);
    await app.panels[0].receive({action:"refresh"});
    assert.equal(app.errors.at(-1), "controller unavailable");
    app.resourceHandler = async () => [];
    await app.run(retry.command.command);
    assert.equal(nodes.tree.records.length, 0);
    assert.equal(nodes.view.message, undefined);
    assert.match(nodes.tree.getTreeItem(nodes.tree.getChildren()[0]).label, /No resources/);
  } finally { app.dispose(); }
});

test("resource reads deduplicate and reset ignores results from the previous binary configuration", async () => {
  const app = harness();
  let release;
  try {
    await settle();
    const nodes = app.views.get("slurmNodes");
    const old = nodes.tree.records[0];
    app.resourceHandler = () => new Promise(resolve => { release = resolve; });
    const first = app.run("slurm.refreshNodes");
    await settle();
    const second = app.run("slurm.refreshNodes");
    const finishOld = release;
    nodes.tree.reset();
    app.resourceHandler = async () => [];
    await app.run("slurm.refreshNodes");
    finishOld([old]);
    await Promise.all([first, second]);
    assert.deepEqual(nodes.tree.records, []);
    assert.deepEqual(nodes.tree.getChildren(), [{status:"empty"}]);
  } finally { app.dispose(); }
});

test("history output enriches known accounting metadata before opening a file", async () => {
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
    assert.equal(app.editors[0].document.getText(), "finished\n");
    app.logDetailsHandler = async (_id, details) => details;
    await app.run("slurm.stdout", {kind:"historyJob", details:app.historyData[1]});
    assert.equal(app.editors.length, 1);
    assert.match(app.errors[0], /did not retain a log path/);
  } finally { app.dispose(); fs.rmSync(directory,{recursive:true}); }
});

test("a slower document open cannot steal focus from the latest click", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slurm-editor-switch-"));
  const firstFile = path.join(directory, "first.out");
  const secondFile = path.join(directory, "second.out");
  fs.writeFileSync(firstFile, "first\n"); fs.writeFileSync(secondFile, "second\n");
  const app = harness();
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  try {
    app.detailsHandler = async id => ({id,source:"scontrol",fields:{StdOut:id === "42" ? firstFile : secondFile},raw:""});
    app.documentGate = async uri => { if (uri.fsPath === firstFile) { entered(); await gate; } };
    const first = app.run("slurm.stdout", "42");
    await started;
    await app.run("slurm.stdout", "43");
    release(); await first;
    assert.deepEqual(app.editors.map(editor => editor.document.uri.fsPath), [secondFile]);
    assert.deepEqual(app.errors, []);
  } finally { release(); app.dispose(); fs.rmSync(directory, {recursive:true}); }
});

test("disposing the extension while a file opens prevents a late editor", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slurm-editor-close-"));
  const filename = path.join(directory, "job.out"); fs.writeFileSync(filename, "output\n");
  const app = harness();
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  try {
    app.logFile = filename;
    app.documentGate = async () => { entered(); await gate; };
    const pending = app.run("slurm.stdout", "42");
    await started; app.dispose(); release(); await pending;
    assert.equal(app.editors.length, 0);
  } finally { release(); fs.rmSync(directory, {recursive:true}); }
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

test("job details tabs use the Slurm icon in both themes and expose a translated script action", async () => {
  const app = harness();
  try {
    await app.run("slurm.details", "42");
    const panel = app.panels[0];
    assert.equal(path.basename(panel.iconPath.light.fsPath), "slurm-light.svg");
    assert.equal(path.basename(panel.iconPath.dark.fsPath), "slurm.svg");
    for (const icon of [panel.iconPath.light, panel.iconPath.dark]) { assert.ok(fs.existsSync(icon.fsPath)); }
    assert.match(panel.webview.html, /data-action="script">View batch script/);
    await panel.receive({ action: "script" });
    assert.deepEqual(app.scriptQueries, ["42"]);
    const editor = app.editors[0];
    assert.equal(editor.document.uri.scheme, "slurm-script");
    assert.equal(path.basename(editor.document.uri.path), "slurm-42.sh");
    assert.equal(editor.document.isReadonly, true);
    assert.match(editor.document.getText(), /echo "\$SLURM_JOB_ID"/);
    assert.equal(editor.options.preview, false);
    app.selections.push("zh-cn"); await app.run("slurm.language"); await settle();
    assert.match(panel.webview.html, /查看提交脚本/);
    await app.run("slurm.script", {kind:"historyJob", details:app.historyData[0]});
    assert.equal(app.scriptQueries.at(-1), "100");
    assert.equal(path.basename(app.editors.at(-1).document.uri.path), "slurm-100.sh");
    assert.equal(app.terminals.length, 0);
  } finally { app.dispose(); }
});

test("script command refreshes the same document and reports errors without opening a false snapshot", async () => {
  const app = harness();
  try {
    await app.run("slurm.script", "42");
    const document = app.editors[0].document;
    app.scriptHandler = async () => "#!/bin/bash\necho updated\n";
    await app.run("slurm.script", "42"); await settle();
    assert.equal(app.editors[1].document, document);
    assert.equal(document.getText(), "#!/bin/bash\necho updated\n");
    app.scriptHandler = async () => { throw new Error("script not retained"); };
    await app.run("slurm.script", "101");
    assert.equal(app.editors.length, 2);
    assert.equal(app.errors.at(-1), "script not retained");
  } finally { app.dispose(); }
});

test("concurrent script reads deduplicate and only the latest selected job gains focus", async () => {
  const app = harness();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    app.scriptHandler = async id => { if (id === "42") { await gate; } return "#!/bin/bash\necho " + id + "\n"; };
    const first = app.run("slurm.script", "42");
    const duplicate = app.run("slurm.script", "42");
    await settle();
    await app.run("slurm.script", "43");
    release(); await Promise.all([first, duplicate]);
    assert.deepEqual(app.scriptQueries, ["42", "43"]);
    assert.equal(app.editors.length, 1);
    assert.equal(path.basename(app.editors[0].document.uri.path), "slurm-43.sh");
  } finally { release(); app.dispose(); }
});

test("a script query finishing after disposal does not open an editor", async () => {
  const app = harness();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    app.scriptHandler = async () => { await gate; return "#!/bin/bash\ntrue\n"; };
    const pending = app.run("slurm.script", "42"); await settle();
    app.dispose(); release(); await pending;
    assert.equal(app.editors.length, 0);
    assert.equal(app.providers.has("slurm-script"), false);
  } finally { release(); }
});

test("paths and complete scripts survive extension restart without changing the history list", async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"slurm-persistent-cache-"));
  const filename=path.join(root,'job.out');
  const logText='secret training log content is never cached\n';
  const script='#!/bin/bash\n# generated script\necho "$SLURM_JOB_ID"\n';
  fs.writeFileSync(filename,logText);
  let app=harness(undefined,root);
  try {
    await settle(); app.values.cacheEnabled=true; app.logFile=filename;
    app.scriptHandler=async()=>script;
    await app.run('slurm.stdout','42');
    await app.run('slurm.script','42');
    app.dispose();
    fs.writeFileSync(filename,logText+"new output after restart\n");
    app=harness(undefined,root);
    await settle(); app.values.cacheEnabled=true;
    app.logDetailsHandler=async()=>{throw new Error('job no longer retained');};
    app.scriptHandler=async()=>{throw new Error('controller and accounting lost script');};
    await app.run('slurm.stdout','42');
    assert.equal(app.editors[0].document.uri.fsPath,filename);
    assert.equal(app.editors[0].document.getText(),logText+"new output after restart\n");
    assert.match(app.messages[0],/cached path/);
    await app.run('slurm.script','42');
    assert.equal(app.editors[1].document.getText(),script);
    assert.match(app.messages[1],/cached script/);
    assert.match(app.messages[1],/saved/);
    await app.run('slurm.history');
    assert.deepEqual(app.tree.getChildren(app.tree.historyRoot).map(node=>node.details.id),['101','100']);
    assert.equal(app.commands.has('slurm.cachedJobs'),false);
    const cacheDir=path.join(root,'job-cache');
    const scope=fs.readdirSync(cacheDir)[0];
    const files=fs.readdirSync(path.join(cacheDir,scope));
    assert.equal(files.filter(file=>file.endsWith('.data')).length,1);
    for(const file of files) {
      assert.ok(!fs.readFileSync(path.join(cacheDir,scope,file),'utf8').includes(logText));
    }
    assert.deepEqual(app.errors,[]);
    fs.unlinkSync(filename);
    const count=app.editors.length;
    await app.run('slurm.stdout','42');
    assert.equal(app.editors.length,count);
    assert.match(app.errors.at(-1),/ENOENT/);
  } finally {app.dispose();fs.rmSync(root,{recursive:true,force:true});}
});

test("clearing cache during an in-flight script fetch cannot recreate the cleared snapshot", async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"slurm-clear-cache-"));
  const app=harness(undefined,root);
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  try {
    await settle(); app.values.cacheEnabled=true;
    app.scriptHandler=async()=>{await gate;return '#!/bin/bash\necho current\n';};
    const pending=app.run('slurm.script','42'); await settle();
    await app.run('slurm.clearCache'); release(); await pending;
    assert.equal(app.editors.length,1);
    app.scriptHandler=async()=>{throw new Error('no remote script');};
    await app.run('slurm.script','42');
    assert.equal(app.editors.length,1);
    assert.equal(app.errors.at(-1),'no remote script');
  } finally {release();app.dispose();fs.rmSync(root,{recursive:true,force:true});}
});

test("cache-disabled operation never falls back to a script saved earlier", async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"slurm-disabled-cache-"));
  const app=harness(undefined,root);
  try {
    await settle(); app.values.cacheEnabled=true;
    await app.run('slurm.script','42');
    app.values.cacheEnabled=false;
    app.scriptHandler=async()=>{throw new Error('offline');};
    await app.run('slurm.script','42');
    assert.equal(app.editors.length,1);
    assert.equal(app.errors.at(-1),'offline');
  } finally {app.dispose();fs.rmSync(root,{recursive:true,force:true});}
});

test("queue background capture saves only login-user jobs without loading history", async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"slurm-auto-cache-"));
  const app=harness(undefined,root,{cacheEnabled:true,user:'*'});
  try {
    app.logFile=path.join(root,'not-created-yet.out');
    const findRecord=()=>{
      const cacheDir=path.join(root,'job-cache');
      if(!fs.existsSync(cacheDir))return;
      for(const scope of fs.readdirSync(cacheDir)) {
        for(const name of fs.readdirSync(path.join(cacheDir,scope)).filter(name=>name.endsWith('.json'))) {
          const record=JSON.parse(fs.readFileSync(path.join(cacheDir,scope,name),'utf8'));
          if(record.items.script)return record;
        }
      }
    };
    let record;
    for(let attempt=0;attempt<100&&!record;attempt++) {
      await new Promise(resolve=>setTimeout(resolve,5));record=findRecord();
    }
    assert.ok(record,'expected background snapshot');
    assert.equal(record.id,'42');
    assert.equal(record.items.stdout.source,app.logFile);
    assert.equal(record.items.stdout.file,undefined);
    assert.deepEqual(app.scriptQueries,['42']);
    assert.deepEqual(app.historyQueries,[]);
    assert.equal(app.editors.length,0);
    assert.deepEqual(app.errors,[]);
  } finally {app.dispose();fs.rmSync(root,{recursive:true,force:true});}
});
