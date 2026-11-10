const { test } = require("node:test");
const assert = require("node:assert/strict");
const { LogColors } = require("../dist/colors");

test("plain log levels use ANSI foreground colors and preserve ordinary output", () => {
  const colors = new LogColors();
  const input = "INFO starting\nWARNING slow\nERROR failed\nSUCCESS completed\nDEBUG details\n普通输出\n";
  assert.equal(colors.format(input, true),
    "\x1b[36mINFO starting\x1b[39m\n\x1b[33mWARNING slow\x1b[39m\n" +
    "\x1b[31mERROR failed\x1b[39m\n\x1b[32mSUCCESS completed\x1b[39m\n" +
    "\x1b[90mDEBUG details\x1b[39m\n普通输出\n");
  assert.equal(colors.format("警告：内存不足\r\n", true), "\x1b[33m警告：内存不足\x1b[39m\r\n");
});

test("original ANSI survives intact, including sequences split across file reads", () => {
  const colors = new LogColors();
  assert.equal(colors.format("\x1b[3", true), "\x1b[3");
  assert.equal(colors.format("5mWARNING custom\n", true), "5mWARNING custom\n");
  assert.equal(colors.format("ERROR still native\n\x1b[0m", true), "ERROR still native\n\x1b[0m");
  colors.reset();
  assert.equal(colors.format("ERROR plain\n", true), "\x1b[31mERROR plain\x1b[39m\n");
});

test("partial lines and progress remain immediate without color leaking across reads", () => {
  const colors = new LogColors();
  assert.equal(colors.format("ERROR par", true), "ERROR par");
  assert.equal(colors.format("", true), "");
  assert.equal(colors.format("tial\r", true), "tial\r");
  assert.equal(colors.format("\nWARNING next\n", true), "\n\x1b[33mWARNING next\x1b[39m\n");
  assert.equal(colors.format("10%\r20%\r100%\n", true), "10%\r20%\r100%\n");
});

test("disabling generated colors preserves log bytes and tracks partial lines", () => {
  const colors = new LogColors();
  assert.equal(colors.format("ERROR disabled\nINFO partial", false), "ERROR disabled\nINFO partial");
  assert.equal(colors.format(" rest\nINFO enabled\n", true), " rest\n\x1b[36mINFO enabled\x1b[39m\n");
  const ansi = "\x1b[32mSUCCESS native\x1b[0m\n";
  assert.equal(colors.format(ansi, false), ansi);
});
