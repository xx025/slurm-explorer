export interface GpuCounts {
  total?: number;
  allocated?: number;
}

/** Prefer aggregate TRES counts; typed entries describe the same GPUs. */
function tresGpus(value?: string): number | undefined {
  if (!value) { return undefined; }
  let aggregate: number | undefined;
  let typed: number | undefined;
  for (const entry of value.split(",")) {
    const match = /^gres\/gpu(:[^=]+)?=(\d+)$/.exec(entry.trim());
    if (!match) { continue; }
    const count = Number(match[2]);
    if (!Number.isSafeInteger(count)) { return undefined; }
    if (!match[1]) { aggregate = count; }
    else { typed = (typed ?? 0) + count; }
  }
  const count = aggregate ?? typed;
  return count !== undefined && Number.isSafeInteger(count) ? count : undefined;
}

/** Strip topology / device indices before splitting mixed GPU types. */
function gresGpus(value?: string): number | undefined {
  if (value === undefined || /^(?:unknown|n\/a)$/i.test(value.trim())) { return undefined; }
  if (!value.trim() || /^\(null\)$/i.test(value.trim())) { return 0; }
  let count = 0;
  for (const entry of value.replace(/\([^)]*\)/g, "").split(",")) {
    if (!/^gpu(?:[:\s]|$)/.test(entry.trim())) { continue; }
    const match = /^gpu(?::[^:]+)?:(\d+)$/.exec(entry.trim());
    if (!match) { return undefined; }
    count += Number(match[1]);
  }
  return Number.isSafeInteger(count) ? count : undefined;
}

function noGpuTres(value?: string): number | undefined {
  // Missing / unknown metadata is different from a reported resource list
  // with no GPU allocations.
  if (value === undefined || /gres\/gpu(?:[:=])/.test(value)) { return undefined; }
  return !value.trim() || /^\(null\)$/i.test(value.trim()) || /\w+=/.test(value) ? 0 : undefined;
}

/** Counts Slurm GPU resources (including configured MIG instances), not utilization. */
export function gpuCounts(fields: Record<string, string>): GpuCounts {
  const total = tresGpus(fields.CfgTRES) ?? gresGpus(fields.Gres) ?? noGpuTres(fields.CfgTRES);
  const allocated = tresGpus(fields.AllocTRES) ?? gresGpus(fields.GresUsed)
    ?? noGpuTres(fields.AllocTRES) ?? (total === 0 ? 0 : undefined);
  return { total, allocated };
}
