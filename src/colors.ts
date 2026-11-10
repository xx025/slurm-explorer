/** Add theme-aware ANSI colors to complete plain log lines, without delaying output. */
export class LogColors {
  private lineStart = true;
  private nativeAnsi = false;

  reset(): void {
    this.lineStart = true;
    this.nativeAnsi = false;
  }

  format(text: string, enabled: boolean): string {
    // Let the terminal interpret original ANSI, including sequences split across reads.
    // Once a file supplies ANSI, it owns the terminal's color state until rotation.
    if (text.includes("\x1b")) { this.nativeAnsi = true; }
    const parts = text.split(/(\r\n|\r|\n)/);
    let result = "";
    for (let i = 0; i < parts.length; i += 2) {
      const line = parts[i];
      const ending = parts[i + 1] ?? "";
      const complete = ending.endsWith("\n");
      const color = enabled && !this.nativeAnsi && this.lineStart && complete
        ? lineColor(line) : undefined;
      result += color ? `\x1b[${color}m${line}\x1b[39m${ending}` : line + ending;
      // Partial lines and carriage-return progress updates pass through immediately.
      if (ending) { this.lineStart = complete; }
      else if (line) { this.lineStart = false; }
    }
    return result;
  }
}

function lineColor(line: string): number | undefined {
  if (/\b(?:ERROR|FATAL|CRITICAL|EXCEPTION|TRACEBACK|FAILED|FAILURE)\b|错误|异常|失败/i.test(line)) { return 31; }
  if (/\bWARN(?:ING)?\b|警告/i.test(line)) { return 33; }
  if (/\b(?:SUCCESS|SUCCEEDED|COMPLETED)\b|成功|已完成/i.test(line)) { return 32; }
  if (/\bINFO\b|信息/i.test(line)) { return 36; }
  if (/\b(?:DEBUG|TRACE)\b|调试/i.test(line)) { return 90; }
  return undefined;
}
