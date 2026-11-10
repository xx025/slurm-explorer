const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { createTranslator, resolveLanguage, UserError, errorMessage } = require("../dist/i18n");
const { SlurmClient } = require("../dist/slurm");
const { SEPARATOR, validateJobId } = require("../dist/model");

test("language follows the editor or the explicit preference", () => {
  assert.equal(resolveLanguage("auto", "zh-cn"), "zh-cn");
  assert.equal(resolveLanguage("auto", "zh-tw"), "zh-cn");
  assert.equal(resolveLanguage("auto", "en"), "en");
  assert.equal(resolveLanguage("auto", "fr"), "en");
  assert.equal(resolveLanguage("en", "zh-cn"), "en");
  assert.equal(resolveLanguage("zh-cn", "en"), "zh-cn");
});

test("Chinese interpolation preserves job identifiers, counts and user names", () => {
  const zh = createTranslator("zh-cn");
  const en = createTranslator("en");
  assert.equal(zh("Job {0}", "123_4"), "任务 123_4");
  assert.equal(zh("Only me ({0})", "alice"), "仅自己（alice）");
  assert.equal(zh("{0} · {1} jobs · {2}", "alice", 5, "12:00"), "alice · 5 个任务 · 12:00");
  assert.equal(en("Job {0}", "123_4"), "Job 123_4");
  assert.equal(zh("Unknown diagnostic: {0}", "raw data"), "Unknown diagnostic: raw data");
  assert.equal(zh("Job {0}", "$&<test>"), "任务 $&<test>");
});

test("all literal runtime translation keys and user errors have Chinese translations", () => {
  const root = path.join(__dirname, "../src");
  const zh = createTranslator("zh-cn");
  let checked = 0;
  for (const filename of fs.readdirSync(root).filter(file => file.endsWith(".ts") && file !== "i18n.ts")) {
    const file = ts.createSourceFile(filename, fs.readFileSync(path.join(root, filename), "utf8"), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if ((ts.isCallExpression(node) && ["t", "translate"].includes(node.expression.getText(file))) ||
          (ts.isNewExpression(node) && node.expression.getText(file) === "UserError")) {
        const key = node.arguments?.[0];
        if (key && ts.isStringLiteral(key)) {
          assert.notEqual(zh(key.text), key.text, `${filename}: untranslated "${key.text}"`);
          checked++;
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  assert.ok(checked > 50, `Expected broad UI coverage, checked ${checked} keys`);
});

test("nested fallback errors are translated, while native diagnostics remain intact", () => {
  const zh = createTranslator("zh-cn");
  const error = new UserError("{0}\nAccounting fallback: {1}", [
    new UserError("{0} failed: {1}", ["scontrol", "Access denied"]),
    new UserError("Job {0} was not found in the configured accounting window ({1} days).", ["42", 7])
  ]);
  assert.match(errorMessage(error, zh), /scontrol 执行失败：Access denied/);
  assert.match(errorMessage(error, zh), /记账查询回退/);
  assert.match(errorMessage(error, zh), /7 天/);
  assert.equal(errorMessage(new Error("Native Slurm error"), zh), "Native Slurm error");
  assert.match(errorMessage(Object.assign(new Error("/private/job.log"), { code: "EACCES" }), zh), /当前登录用户的权限/);
  try { validateJobId("oops"); assert.fail(); } catch (error) {
    assert.match(errorMessage(error, zh), /请输入数字任务 ID/);
  }
});

test("native manifest strings are localized with matching keys and valid links", () => {
  const root = path.join(__dirname, "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const english = JSON.parse(fs.readFileSync(path.join(root, "package.nls.json"), "utf8"));
  const chinese = JSON.parse(fs.readFileSync(path.join(root, "package.nls.zh-cn.json"), "utf8"));
  assert.deepEqual(Object.keys(chinese).sort(), Object.keys(english).sort());
  function walk(value) {
    if (typeof value === "string" && /^%[^%]+%$/.test(value)) {
      const key = value.slice(1, -1);
      assert.ok(english[key], `Missing English key: ${key}`);
      assert.ok(chinese[key], `Missing Chinese key: ${key}`);
    } else if (Array.isArray(value)) { value.forEach(walk); }
    else if (value && typeof value === "object") { Object.values(value).forEach(walk); }
  }
  walk(manifest);
  const commands = new Set(manifest.contributes.commands.map(command => command.command));
  for (const text of [english["view.welcome"], chinese["view.welcome"]]) {
    for (const [, command] of text.matchAll(/\(command:([^)]+)\)/g)) {
      assert.ok(commands.has(command), `Invalid welcome action: ${command}`);
    }
  }
  assert.ok(commands.has("slurm.selectUser"));
  assert.ok(commands.has("slurm.language"));
});

test("own, all and specified user scopes affect both queue and history queries", async () => {
  const calls = [];
  let user = "alice";
  const client = new SlurmClient(() => ({ user, binDirectory: "", timeoutSeconds: 2, historyDays: 7 }), () => {},
    async (command, args) => {
      calls.push({ command, args });
      if (command === "squeue") {
        return ["123", user === "*" ? "bob" : user, "RUNNING", "gpu", "1:00", "2:00", "1", "4", "8G", "gpu:1", "node01", "train"].join(SEPARATOR);
      }
      return "";
    });
  for (const value of ["alice", "*", "bob"]) {
    user = value;
    const [job] = await client.queue();
    await client.history();
    const queueArgs = calls.at(-2).args;
    const historyArgs = calls.at(-1).args;
    if (value === "*") {
      assert.ok(historyArgs.includes("--allusers"));
      assert.equal(queueArgs.some(arg => arg.startsWith("--user=")), false);
      assert.equal(job.user, "bob");
    } else {
      assert.ok(queueArgs.includes(`--user=${value}`));
      assert.ok(historyArgs.includes(`--user=${value}`));
      assert.equal(historyArgs.includes("--allusers"), false);
    }
  }
});
