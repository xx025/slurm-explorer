import { open } from "node:fs/promises";
import path from "node:path";
import { JobDetails } from "./model";
import { Translator, UserError, createTranslator } from "./i18n";

export function logPath(details: JobDetails, stream: "StdOut" | "StdErr"): string {
  const fields = details.fields;
  let filename = fields[stream];
  // An explicitly empty controller StdErr uses the batch job's stdout file.
  if (stream === "StdErr" && filename === "" && details.source === "scontrol") {
    filename = fields.StdOut;
  }
  if (!filename || /^(?:\(null\)|Unknown|N\/A|None)$/i.test(filename)) {
    throw new UserError("{0} path is unavailable. Slurm did not retain a log path for this job.", [stream]);
  }
  const replacements: Record<string, string | undefined> = {
    j: fields.JobId ?? fields.JobIDRaw ?? details.id,
    A: fields.ArrayJobId ?? /^(\d+)_\d+/.exec(details.id)?.[1],
    a: fields.ArrayTaskId ?? /^\d+_(\d+)/.exec(details.id)?.[1],
    x: fields.JobName,
    u: fields.UserId?.replace(/\(\d+\)$/, "") ?? fields.User,
    "%": "%"
  };
  filename = filename.replace(/%(?:\d+)?([A-Za-z%])/g, (token, key: string) => {
    const value = replacements[key];
    if (value === undefined) { throw new UserError("Cannot resolve log filename token {0}. Open the resolved log file directly.", [token]); }
    const width = /^%(\d+)/.exec(token)?.[1];
    return width ? value.padStart(Math.min(Number(width), 64), "0") : value;
  });
  if (filename.includes("%")) { throw new UserError("The log path contains an unresolved filename token."); }
  if (!path.isAbsolute(filename)) {
    if (!fields.WorkDir || !path.isAbsolute(fields.WorkDir)) { throw new UserError("Cannot resolve a relative log path without an absolute WorkDir."); }
    filename = path.resolve(fields.WorkDir, filename);
  }
  return filename;
}

export async function readTail(filename: string, maxBytes: number, translate: Translator = createTranslator("en")): Promise<string> {
  // O_NONBLOCK avoids hanging when a configured log is a FIFO or a device.
  const { constants } = await import("node:fs");
  const handle = await open(filename, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) { throw new UserError("Log preview supports regular files only."); }
    const start = Math.max(0, stat.size - maxBytes);
    const buffer = Buffer.alloc(Math.min(stat.size, maxBytes));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    return `${start ? translate("[Showing the last {0} KiB]", maxBytes / 1024) + "\n" : ""}${buffer.subarray(0, bytesRead).toString("utf8")}`;
  } finally { await handle.close(); }
}
