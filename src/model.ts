export interface Job {
  id: string;
  name: string;
  user: string;
  state: string;
  partition: string;
  elapsed: string;
  timeLimit: string;
  nodes: string;
  cpus: string;
  memory: string;
  resources: string;
  reason: string;
}

export interface JobDetails {
  id: string;
  fields: Record<string, string>;
  raw: string;
  source: "scontrol" | "sacct";
}

export const SEPARATOR = "\x1f";

export function validateJobId(value: string): string {
  const id = value.trim();
  // Expanded array elements and heterogeneous job components are supported.
  if (!/^\d+(?:_\d+)?(?:\+\d+)?$/.test(id)) {
    throw new UserError("Enter a numeric job ID, array element (123_4), or heterogeneous component (123+1).");
  }
  return id;
}

export function parseQueue(text: string): Job[] {
  return text.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const parts = line.split(SEPARATOR);
    if (parts.length < 12) {
      throw new UserError("Unexpected squeue output. The query requires the standard Slurm formatted output.");
    }
    const [id, user, state, partition, elapsed, timeLimit, nodes, cpus, memory, resources, reason] = parts;
    return {
      id: id.trim(), user: user.trim(), state: state.trim(), partition: partition.trim(),
      elapsed: elapsed.trim(), timeLimit: timeLimit.trim(), nodes: nodes.trim(),
      cpus: cpus.trim(), memory: memory.trim(), resources: resources.trim(),
      reason: reason.trim(), name: parts.slice(11).join(SEPARATOR).trim()
    };
  });
}

export function parseControl(text: string, id: string): JobDetails {
  const fields: Record<string, string> = {};
  const matches = [...text.matchAll(/(?:^|\s)([A-Za-z][A-Za-z0-9_:/]*)=/g)];
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const start = match.index! + match[0].length;
    fields[match[1]] = text.slice(start, matches[index + 1]?.index ?? text.length).trim();
  }
  if (!fields.JobId) {
    throw new UserError("scontrol did not return a job record.");
  }
  return { id, fields, raw: text.trim(), source: "scontrol" };
}

export const ACCOUNT_FIELDS = [
  "JobID", "JobName", "User", "State", "Partition", "Elapsed", "Timelimit",
  "AllocCPUS", "ReqMem", "AllocTRES", "NodeList", "ExitCode", "Start", "End", "WorkDir"
];

export function parseAccounting(text: string): JobDetails[] {
  return text.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const values = line.split(SEPARATOR);
    if (values.length < ACCOUNT_FIELDS.length) {
      throw new UserError("Unexpected sacct output.");
    }
    const fields: Record<string, string> = {};
    ACCOUNT_FIELDS.forEach((field, index) => { fields[field] = values[index].trim(); });
    fields.WorkDir = values.slice(ACCOUNT_FIELDS.length - 1).join(SEPARATOR).trim();
    return { id: fields.JobID, fields, raw: values.join(" | "), source: "sacct" };
  });
}

export function groupFor(state: string): "Running" | "Pending" | "Other" {
  if (/^(RUNNING|COMPLETING|CONFIGURING|STAGE_OUT|RESIZING)$/.test(state)) { return "Running"; }
  if (/^(PENDING|REQUEUED|REQUEUE_FED|REQUEUE_HOLD)$/.test(state)) { return "Pending"; }
  return "Other";
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]!);
}
import { UserError } from "./i18n";

