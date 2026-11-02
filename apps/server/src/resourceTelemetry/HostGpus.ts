import type { HostGpuSnapshot, HostResourcesSnapshot } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

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

export function parseNvidiaSmiProcessMemory(output: string): Map<number, number> {
  const byPid = new Map<number, number>();
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const fields = splitCsvLine(trimmed);
    if (fields.length < 2) continue;
    const pid = parseOptionalNumber(fields[0] ?? "");
    const memoryMib = parseOptionalNumber(fields[1] ?? "");
    if (
      pid === null ||
      memoryMib === null ||
      pid <= 0 ||
      memoryMib < 0 ||
      !Number.isSafeInteger(pid)
    ) {
      continue;
    }
    byPid.set(pid, (byPid.get(pid) ?? 0) + mibToBytes(memoryMib));
  }
  return byPid;
}

export function mergeProcessGpuMemory(
  maps: ReadonlyArray<ReadonlyMap<number, number>>,
): Map<number, number> {
  const merged = new Map<number, number>();
  for (const map of maps) {
    for (const [pid, bytes] of map) {
      merged.set(pid, (merged.get(pid) ?? 0) + bytes);
    }
  }
  return merged;
}

export function attachGpuMemory<T extends { readonly pid: number }>(
  entry: T,
  byPid: ReadonlyMap<number, number>,
): T {
  const gpuMemoryBytes = byPid.get(entry.pid);
  return gpuMemoryBytes === undefined || gpuMemoryBytes <= 0 ? entry : { ...entry, gpuMemoryBytes };
}

function nvidiaSmiCsv(spawner: ChildProcessSpawner.ChildProcessSpawner["Service"], query: string) {
  return spawner
    .string(
      ChildProcess.make("nvidia-smi", [query, "--format=csv,noheader,nounits"], {
        stdin: "ignore",
        stderr: "ignore",
      }),
    )
    .pipe(
      Effect.timeout("2 seconds"),
      Effect.orElseSucceed(() => ""),
    );
}

export const collectNvidiaProcessGpuMemory = Effect.fn("HostResources.collectProcessGpu")(
  function* () {
    const spawner = yield* Effect.serviceOption(ChildProcessSpawner.ChildProcessSpawner);
    if (Option.isNone(spawner)) return new Map<number, number>();
    const compute = yield* nvidiaSmiCsv(spawner.value, "--query-compute-apps=pid,used_memory");
    const graphics = yield* nvidiaSmiCsv(spawner.value, "--query-graphics-apps=pid,used_memory");
    return mergeProcessGpuMemory([
      parseNvidiaSmiProcessMemory(compute),
      parseNvidiaSmiProcessMemory(graphics),
    ]);
  },
);

export function withHostGpus(
  snapshot: Omit<HostResourcesSnapshot, "gpus">,
  gpus: readonly HostGpuSnapshot[],
): HostResourcesSnapshot {
  return gpus.length === 0 ? snapshot : { ...snapshot, gpus: [...gpus] };
}
