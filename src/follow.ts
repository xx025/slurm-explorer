import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { UserError } from "./i18n";

/** Reads bounded increments, reopening the path to detect replacement and truncation. */
export class LogCursor {
  private identity = "";
  private offset = 0;
  private decoder = new StringDecoder("utf8");
  constructor(readonly filename: string, readonly maxBytes: number) {}

  async read(): Promise<{ text: string; reset: boolean; skipped: boolean }> {
    const file = await open(this.filename, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile()) { throw new UserError("Log preview supports regular files only."); }
      const identity = `${stat.dev}:${stat.ino}`;
      const reset = identity !== this.identity || stat.size < this.offset;
      let start = reset ? 0 : this.offset;
      const skipped = stat.size - start > this.maxBytes;
      if (skipped) { start = stat.size - this.maxBytes; }
      if (reset || skipped) { this.decoder = new StringDecoder("utf8"); }
      const buffer = Buffer.alloc(Math.min(this.maxBytes, Math.max(0, stat.size - start)));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
      this.identity = identity;
      this.offset = start + bytesRead;
      // A bounded tail can start in the middle of a UTF-8 character.
      let first = 0;
      if (skipped) { while (first < bytesRead && (buffer[first] & 0xc0) === 0x80) { first++; } }
      return { text: this.decoder.write(buffer.subarray(first, bytesRead)), reset, skipped };
    } finally { await file.close(); }
  }
}
