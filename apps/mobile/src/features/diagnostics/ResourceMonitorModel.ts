import type {
  HostResourcesSnapshot,
  ServerProcessDiagnosticsEntry,
  ServerProcessResourceHistoryBucket,
  ServerProcessResourceHistorySummary,
} from "@t3tools/contracts";

export type ResourceLoadTone = "ok" | "warn" | "crit";

export interface ResourceHistoryWindow {
  readonly label: string;
  readonly windowMs: number;
  readonly bucketMs: number;
}

export const POLL_INTERVAL_MS = 5_000;
const WARN_PERCENT = 70;
const CRIT_PERCENT = 90;
export const HISTORY_WINDOWS: readonly ResourceHistoryWindow[] = [
  { label: "5m", windowMs: 5 * 60_000, bucketMs: 30_000 },
  { label: "15m", windowMs: 15 * 60_000, bucketMs: 60_000 },
  { label: "30m", windowMs: 30 * 60_000, bucketMs: 2 * 60_000 },
  { label: "1h", windowMs: 60 * 60_000, bucketMs: 5 * 60_000 },
];

export function historyWindow(windowMs: number): ResourceHistoryWindow {
  return HISTORY_WINDOWS.find((window) => window.windowMs === windowMs) ?? HISTORY_WINDOWS[1]!;
}

export function loadTone(percent: number): ResourceLoadTone {
  if (percent >= CRIT_PERCENT) return "crit";
  if (percent >= WARN_PERCENT) return "warn";
  return "ok";
}

export function loadTextClass(tone: ResourceLoadTone): string {
  if (tone === "crit") return "text-danger-foreground";
  if (tone === "warn") return "text-warning-foreground";
  return "text-green-500";
}

export function clampGaugePercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, percent));
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let unitIndex = -1;
  let next = value;
  do {
    next /= 1024;
    unitIndex += 1;
  } while (next >= 1024 && unitIndex < units.length - 1);
  return `${next.toFixed(next >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export function formatCpuTime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 1 : 2).replace(/\.0+$/, "")}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(minutes >= 10 ? 1 : 2).replace(/\.0+$/, "")}m`;
  return `${(minutes / 60).toFixed(2).replace(/\.0+$/, "")}h`;
}

export function formatProcessName(command: string): string {
  const firstToken = command.trim().split(/\s+/)[0];
  if (!firstToken) return command;
  const normalized = firstToken.replace(/^['"]|['"]$/g, "");
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? normalized;
}

export function formatProcessType(
  process: Pick<ServerProcessDiagnosticsEntry, "command" | "depth">,
): string {
  if (process.depth > 0) return "Subprocess";
  if (/\b(codex|claude|opencode|cursor)\b/i.test(process.command)) return "Agent";
  return "Process";
}

export function hostCpuPercent(snapshot: HostResourcesSnapshot | null): number | null {
  if (snapshot?.cpuUtilization == null) return null;
  return snapshot.cpuUtilization * 100;
}

export function hostMemoryUsedBytes(snapshot: HostResourcesSnapshot | null): number | null {
  if (snapshot === null || snapshot.totalMemoryBytes <= 0) return null;
  return Math.max(0, snapshot.totalMemoryBytes - snapshot.availableMemoryBytes);
}

export function hostMemoryUsedPercent(snapshot: HostResourcesSnapshot | null): number | null {
  const used = hostMemoryUsedBytes(snapshot);
  if (used === null || snapshot === null) return null;
  return (used / snapshot.totalMemoryBytes) * 100;
}

export function t3MemoryPercentOfHost(
  totalRssBytes: number,
  snapshot: HostResourcesSnapshot | null,
): number | null {
  if (snapshot === null || snapshot.totalMemoryBytes <= 0) return null;
  return (totalRssBytes / snapshot.totalMemoryBytes) * 100;
}

export function historyCpuScaleMax(
  buckets: ReadonlyArray<Pick<ServerProcessResourceHistoryBucket, "maxCpuPercent">>,
): number {
  return Math.max(1, ...buckets.map((bucket) => bucket.maxCpuPercent));
}

export function historyMemoryScaleMax(
  buckets: ReadonlyArray<Pick<ServerProcessResourceHistoryBucket, "maxRssBytes">>,
): number {
  return Math.max(1, ...buckets.map((bucket) => bucket.maxRssBytes));
}

export function memoryPeakBytes(
  buckets: ReadonlyArray<Pick<ServerProcessResourceHistoryBucket, "maxRssBytes">>,
): number {
  return buckets.reduce((peak, bucket) => Math.max(peak, bucket.maxRssBytes), 0);
}

export function barHeight(value: number, max: number, minimumVisiblePercent = 2): number {
  if (value <= 0) return 0;
  return Math.max(minimumVisiblePercent, (value / Math.max(1, max)) * 100);
}

export function visibleProcessTree(
  processes: ReadonlyArray<ServerProcessDiagnosticsEntry>,
  collapsedPids: ReadonlySet<number>,
): ReadonlyArray<ServerProcessDiagnosticsEntry> {
  const visible: ServerProcessDiagnosticsEntry[] = [];
  let hiddenChildDepth: number | null = null;

  for (const process of processes) {
    if (hiddenChildDepth !== null) {
      if (process.depth > hiddenChildDepth) continue;
      hiddenChildDepth = null;
    }

    visible.push(process);
    if (collapsedPids.has(process.pid)) {
      hiddenChildDepth = process.depth;
    }
  }

  return visible;
}

export function historyVisualDepth(
  process: Pick<ServerProcessResourceHistorySummary, "depth" | "isServerRoot">,
  shallowestChildDepth: number | null,
): number {
  if (process.isServerRoot || shallowestChildDepth === null) return 0;
  return Math.max(1, process.depth - shallowestChildDepth + 1);
}

export function shallowestChildDepth(
  processes: ReadonlyArray<Pick<ServerProcessResourceHistorySummary, "depth" | "isServerRoot">>,
): number | null {
  return processes.reduce<number | null>((minDepth, process) => {
    if (process.isServerRoot) return minDepth;
    return minDepth === null ? process.depth : Math.min(minDepth, process.depth);
  }, null);
}
