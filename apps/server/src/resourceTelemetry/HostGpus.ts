import type { HostGpuSnapshot, HostResourcesSnapshot } from "@t3tools/contracts";

const AMD_SYSFS_VENDOR = "0x1002";
const MISSING = /^(?:\[?n\/a\]?|-)$/i;
const CARD_DIRECTORY = /^card\d+$/;

export function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "" || MISSING.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function parseOptionalBytes(raw: string): number | null {
  const value = parseOptionalNumber(raw);
  return value === null || value < 0 || !Number.isSafeInteger(value) ? null : value;
}

function clampUnitInterval(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      fields.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  fields.push(current);
  return fields;
}

function mibToBytes(mib: number): number {
  return Math.round(mib * 1024 * 1024);
}

export function parseNvidiaSmiCsv(output: string): HostGpuSnapshot[] {
  const gpus: HostGpuSnapshot[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const fields = splitCsvLine(trimmed);
    if (fields.length < 4) continue;
    const name = fields[0]?.trim();
    if (!name) continue;
    const utilizationPct = parseOptionalNumber(fields[1] ?? "");
    const memoryUsedMib = parseOptionalNumber(fields[2] ?? "");
    const memoryTotalMib = parseOptionalNumber(fields[3] ?? "");
    const utilization = utilizationPct === null ? null : clampUnitInterval(utilizationPct / 100);
    const memoryUsedBytes =
      memoryUsedMib === null || memoryUsedMib < 0 ? null : mibToBytes(memoryUsedMib);
    const memoryTotalBytes =
      memoryTotalMib === null || memoryTotalMib < 0 ? null : mibToBytes(memoryTotalMib);
    if (utilization === null && memoryUsedBytes === null && memoryTotalBytes === null) continue;
    gpus.push({ name, utilization, memoryUsedBytes, memoryTotalBytes });
  }
  return gpus;
}

export function amdSysfsCardIds(entries: readonly string[]): string[] {
  return entries
    .filter((name) => CARD_DIRECTORY.test(name))
    .toSorted((left, right) => Number(left.slice(4)) - Number(right.slice(4)));
}

export function parseAmdSysfsCard(files: {
  readonly vendor?: string;
  readonly busyPercent?: string;
  readonly memoryUsed?: string;
  readonly memoryTotal?: string;
  readonly productName?: string;
}): HostGpuSnapshot | null {
  if (files.vendor?.trim().toLowerCase() !== AMD_SYSFS_VENDOR) return null;
  const busyPercent = parseOptionalNumber(files.busyPercent ?? "");
  const memoryUsedBytes = parseOptionalBytes(files.memoryUsed ?? "");
  const memoryTotalBytes = parseOptionalBytes(files.memoryTotal ?? "");
  if (busyPercent === null && memoryUsedBytes === null && memoryTotalBytes === null) return null;
  const name = files.productName?.trim() || "AMD GPU";
  return {
    name,
    utilization: busyPercent === null ? null : clampUnitInterval(busyPercent / 100),
    memoryUsedBytes,
    memoryTotalBytes,
  };
}

export function withHostGpus(
  snapshot: Omit<HostResourcesSnapshot, "gpus">,
  gpus: readonly HostGpuSnapshot[],
): HostResourcesSnapshot {
  return gpus.length === 0 ? snapshot : { ...snapshot, gpus: [...gpus] };
}
