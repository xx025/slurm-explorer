const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {createRequire} = require("node:module");
const filename = path.join(__dirname,"../dist/output.js");
const realRequire = createRequire(filename);
const loaded = {exports:{}};
new Function("require","module","exports",fs.readFileSync(filename,"utf8"))(
  name => name === "vscode" ? {} : realRequire(name), loaded, loaded.exports);
const {terminalNewlines} = loaded.exports;

test("native output converts LF to CRLF without altering CR progress or ANSI", () => {
  assert.equal(terminalNewlines("one\ntwo\n").text, "one\r\ntwo\r\n");
  assert.equal(terminalNewlines("one\r\ntwo\r\n").text, "one\r\ntwo\r\n");
  const progress = "\x1b[32m10%\r20%\x1b[K\r100%\x1b[0m\n";
  assert.equal(terminalNewlines(progress).text, progress.replace(/\n/g,"\r\n"));
  assert.equal(terminalNewlines("中文\n输出").text, "中文\r\n输出");
});

test("CRLF split over reads remains exactly one CR and one LF", () => {
  const first = terminalNewlines("first\r");
  assert.equal(first.lastCR,true);
  const empty = terminalNewlines("", first.lastCR);
  const second = terminalNewlines("\nsecond\n",empty.lastCR);
  assert.equal(first.text + empty.text + second.text,"first\r\nsecond\r\n");
  assert.equal(second.lastCR,false);
});
