import type {
  HostGpuSnapshot,
  HostResourcesSnapshot,
  ServerProcessDiagnosticsEntry,
  ServerProcessResourceHistoryBucket,
  ServerProcessResourceHistorySummary,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

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

export function hostGpus(snapshot: HostResourcesSnapshot | null): readonly HostGpuSnapshot[] {
  return snapshot?.gpus ?? [];
}

export function formatGpuName(name: string): string {
  const shortened = name
    .replace(/^(?:NVIDIA\s+(?:GeForce\s+)?)|(?:AMD\s+)|(?:Apple\s+)/i, "")
    .trim();
  return shortened.length > 0 ? shortened : name;
}

export function gpuUtilizationPercent(gpu: HostGpuSnapshot): number | null {
  if (gpu.utilization == null) return null;
  return gpu.utilization * 100;
}

export function gpuMemoryUsedPercent(gpu: HostGpuSnapshot): number | null {
  if (gpu.memoryUsedBytes == null || gpu.memoryTotalBytes == null || gpu.memoryTotalBytes <= 0) {
    return null;
  }
  return (gpu.memoryUsedBytes / gpu.memoryTotalBytes) * 100;
}

export function gpuMemoryDetail(gpu: HostGpuSnapshot): string {
  if (gpu.memoryUsedBytes == null || gpu.memoryTotalBytes == null) return "Unavailable";
  return `${formatBytes(gpu.memoryUsedBytes)} / ${formatBytes(gpu.memoryTotalBytes)}`;
}

export function gpuGaugeLabels(gpus: readonly HostGpuSnapshot[]): ReadonlyArray<{
  readonly util: string;
  readonly memory: string;
}> {
  if (gpus.length === 1) return [{ util: "GPU util", memory: "GPU memory" }];
  const counts = new Map<string, number>();
  for (const gpu of gpus) {
    const name = formatGpuName(gpu.name);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return gpus.map((gpu) => {
    const name = formatGpuName(gpu.name);
    const total = counts.get(name) ?? 1;
    const next = (seen.get(name) ?? 0) + 1;
    seen.set(name, next);
    const label = total === 1 ? name : `${name} ${next}`;
    return { util: `${label} util`, memory: `${label} memory` };
  });
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

/** RN percentage heights collapse when the column's height is content-sized. */
export const HISTORY_CHART_TRACK_HEIGHT = 80;
export const HISTORY_CHART_TRACK_PADDING = 8;
export const HISTORY_CHART_BAR_MAX_HEIGHT =
  HISTORY_CHART_TRACK_HEIGHT - HISTORY_CHART_TRACK_PADDING * 2;

export function historyChartBars(
  buckets: ReadonlyArray<ServerProcessResourceHistoryBucket>,
): ReadonlyArray<{
  readonly startedAtMs: number;
  readonly peakCpuHeight: number;
  readonly averageCpuHeight: number;
  readonly peakMemoryHeight: number;
}> {
  const cpuMax = historyCpuScaleMax(buckets);
  const memoryMax = historyMemoryScaleMax(buckets);
  return buckets.map((bucket) => ({
    startedAtMs: DateTime.toEpochMillis(bucket.startedAt),
    peakCpuHeight: (barHeight(bucket.maxCpuPercent, cpuMax) / 100) * HISTORY_CHART_BAR_MAX_HEIGHT,
    averageCpuHeight:
      (barHeight(bucket.avgCpuPercent, cpuMax) / 100) * HISTORY_CHART_BAR_MAX_HEIGHT,
    peakMemoryHeight:
      (barHeight(bucket.maxRssBytes, memoryMax) / 100) * HISTORY_CHART_BAR_MAX_HEIGHT,
  }));
}

/**
 * T3 gauges are the server process plus descendants. `getProcessDiagnostics`
 * totals omit the root (signalable children only); history `topProcesses`
 * includes `isServerRoot`.
 */
export function t3Workload(input: {
  readonly diagnostics: {
    readonly processes: ReadonlyArray<{
      readonly pid: number;
      readonly cpuPercent: number;
      readonly rssBytes: number;
    }>;
    readonly processCount: number;
    readonly totalCpuPercent: number;
    readonly totalRssBytes: number;
  } | null;
  readonly history: {
    readonly topProcesses: ReadonlyArray<{
      readonly pid: number;
      readonly currentCpuPercent: number;
      readonly currentRssBytes: number;
    }>;
  } | null;
}): { cpuPercent: number; rssBytes: number; processCount: number } | null {
  if (input.diagnostics === null && input.history === null) return null;

  const byPid = new Map<number, { cpuPercent: number; rssBytes: number }>();
  for (const process of input.history?.topProcesses ?? []) {
    byPid.set(process.pid, {
      cpuPercent: process.currentCpuPercent,
      rssBytes: process.currentRssBytes,
    });
  }
  for (const process of input.diagnostics?.processes ?? []) {
    if (byPid.has(process.pid)) continue;
    byPid.set(process.pid, {
      cpuPercent: process.cpuPercent,
      rssBytes: process.rssBytes,
    });
  }
  if (byPid.size === 0) {
    return input.diagnostics === null
      ? { cpuPercent: 0, rssBytes: 0, processCount: 0 }
      : {
          cpuPercent: input.diagnostics.totalCpuPercent,
          rssBytes: input.diagnostics.totalRssBytes,
          processCount: input.diagnostics.processCount,
        };
  }

  let cpuPercent = 0;
  let rssBytes = 0;
  for (const process of byPid.values()) {
    cpuPercent += process.cpuPercent;
    rssBytes += process.rssBytes;
  }
  return { cpuPercent, rssBytes, processCount: byPid.size };
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

export type ProcessLayoutMode = "usage" | "tree";

export const PROCESS_LAYOUT_OPTIONS: ReadonlyArray<{
  readonly value: ProcessLayoutMode;
  readonly label: string;
}> = [
  { value: "usage", label: "Usage" },
  { value: "tree", label: "Tree" },
];

export const PROCESS_ROW_INDENT_STEP = 8;
export const PROCESS_ROW_INDENT_MAX_DEPTH = 2;

export function processRowIndent(depth: number): number {
  if (!Number.isFinite(depth) || depth <= 0) return 0;
  return Math.min(depth, PROCESS_ROW_INDENT_MAX_DEPTH) * PROCESS_ROW_INDENT_STEP;
}

export function processDepthLabel(depth: number): string | null {
  if (!Number.isFinite(depth) || depth <= PROCESS_ROW_INDENT_MAX_DEPTH) return null;
  return `d${Math.floor(depth)}`;
}

export function formatProcessGpuMemory(gpuMemoryBytes: number | undefined): string | null {
  if (gpuMemoryBytes === undefined || gpuMemoryBytes <= 0) return null;
  return `GPU ${formatBytes(gpuMemoryBytes)}`;
}

export interface ProcessIntensityKey {
  readonly pid: number;
  readonly cpuPercent: number;
  readonly rssBytes: number;
  readonly gpuMemoryBytes?: number;
}

export function liveProcessIntensity(
  process: Pick<
    ServerProcessDiagnosticsEntry,
    "pid" | "cpuPercent" | "rssBytes" | "gpuMemoryBytes"
  >,
): ProcessIntensityKey {
  return {
    pid: process.pid,
    cpuPercent: process.cpuPercent,
    rssBytes: process.rssBytes,
    gpuMemoryBytes: process.gpuMemoryBytes,
  };
}

export function historyProcessIntensity(
  process: Pick<
    ServerProcessResourceHistorySummary,
    "pid" | "currentCpuPercent" | "currentRssBytes" | "gpuMemoryBytes"
  >,
): ProcessIntensityKey {
  return {
    pid: process.pid,
    cpuPercent: process.currentCpuPercent,
    rssBytes: process.currentRssBytes,
    gpuMemoryBytes: process.gpuMemoryBytes,
  };
}

export function compareProcessIntensity(
  left: ProcessIntensityKey,
  right: ProcessIntensityKey,
): number {
  if (right.cpuPercent !== left.cpuPercent) return right.cpuPercent - left.cpuPercent;
  if (right.rssBytes !== left.rssBytes) return right.rssBytes - left.rssBytes;
  const leftGpu = left.gpuMemoryBytes ?? 0;
  const rightGpu = right.gpuMemoryBytes ?? 0;
  if (rightGpu !== leftGpu) return rightGpu - leftGpu;
  return left.pid - right.pid;
}

export function sortProcessesByUsage<T>(
  processes: ReadonlyArray<T>,
  intensity: (process: T) => ProcessIntensityKey,
): T[] {
  return [...processes].sort((left, right) =>
    compareProcessIntensity(intensity(left), intensity(right)),
  );
}

type ProcessTreeNode<T> = {
  readonly process: T;
  readonly children: ProcessTreeNode<T>[];
};

function forestFromDepth<T>(
  processes: ReadonlyArray<T>,
  depthOf: (process: T) => number,
): ProcessTreeNode<T>[] {
  const roots: ProcessTreeNode<T>[] = [];
  const stack: ProcessTreeNode<T>[] = [];
  for (const process of processes) {
    const node: ProcessTreeNode<T> = { process, children: [] };
    const depth = depthOf(process);
    while (stack.length > 0 && depthOf(stack[stack.length - 1]!.process) >= depth) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

function forestFromParent<T>(
  processes: ReadonlyArray<T>,
  input: {
    readonly id: (process: T) => number;
    readonly parentId: (process: T) => number;
  },
): ProcessTreeNode<T>[] | null {
  const nodes = processes.map((process) => ({ process, children: [] as ProcessTreeNode<T>[] }));
  const byId = new Map(nodes.map((node) => [input.id(node.process), node]));
  let linked = 0;
  for (const node of nodes) {
    const parent = byId.get(input.parentId(node.process));
    if (parent && parent !== node) {
      parent.children.push(node);
      linked += 1;
    }
  }
  if (linked === 0) return null;
  return nodes.filter((node) => {
    const parent = byId.get(input.parentId(node.process));
    return parent == null || parent === node;
  });
}

function subtreeIntensity<T>(
  node: ProcessTreeNode<T>,
  intensity: (process: T) => ProcessIntensityKey,
): ProcessIntensityKey {
  const self = intensity(node.process);
  let cpuPercent = self.cpuPercent;
  let rssBytes = self.rssBytes;
  let gpuMemoryBytes = self.gpuMemoryBytes ?? 0;
  for (const child of node.children) {
    const childIntensity = subtreeIntensity(child, intensity);
    cpuPercent = Math.max(cpuPercent, childIntensity.cpuPercent);
    rssBytes += childIntensity.rssBytes;
    gpuMemoryBytes += childIntensity.gpuMemoryBytes ?? 0;
  }
  return { pid: self.pid, cpuPercent, rssBytes, gpuMemoryBytes };
}

function flattenSortedTree<T>(
  nodes: ReadonlyArray<ProcessTreeNode<T>>,
  intensity: (process: T) => ProcessIntensityKey,
): T[] {
  const sorted = [...nodes].sort((left, right) =>
    compareProcessIntensity(subtreeIntensity(left, intensity), subtreeIntensity(right, intensity)),
  );
  const flattened: T[] = [];
  for (const node of sorted) {
    flattened.push(node.process);
    flattened.push(...flattenSortedTree(node.children, intensity));
  }
  return flattened;
}

export function sortProcessTree<T>(
  processes: ReadonlyArray<T>,
  input: {
    readonly depth: (process: T) => number;
    readonly id?: (process: T) => number;
    readonly parentId?: (process: T) => number;
    readonly intensity: (process: T) => ProcessIntensityKey;
  },
): T[] {
  const forest =
    input.id && input.parentId
      ? (forestFromParent(processes, { id: input.id, parentId: input.parentId }) ??
        forestFromDepth(processes, input.depth))
      : forestFromDepth(processes, input.depth);
  return flattenSortedTree(forest, input.intensity);
}

export function displayedLiveProcesses(
  processes: ReadonlyArray<ServerProcessDiagnosticsEntry>,
  layout: ProcessLayoutMode,
  collapsedPids: ReadonlySet<number>,
): ReadonlyArray<ServerProcessDiagnosticsEntry> {
  if (layout === "usage") return sortProcessesByUsage(processes, liveProcessIntensity);
  return visibleProcessTree(
    sortProcessTree(processes, {
      depth: (process) => process.depth,
      id: (process) => process.pid,
      parentId: (process) => process.ppid,
      intensity: liveProcessIntensity,
    }),
    collapsedPids,
  );
}

export function displayedHistoryProcesses(
  processes: ReadonlyArray<ServerProcessResourceHistorySummary>,
  layout: ProcessLayoutMode,
): ReadonlyArray<ServerProcessResourceHistorySummary> {
  if (layout === "usage") return sortProcessesByUsage(processes, historyProcessIntensity);
  return sortProcessTree(processes, {
    depth: (process) => process.depth,
    id: (process) => process.pid,
    parentId: (process) => process.ppid,
    intensity: historyProcessIntensity,
  });
}

export function liveProcessStats(process: ServerProcessDiagnosticsEntry): string {
  return [
    formatProcessType(process),
    `PID ${process.pid}`,
    formatBytes(process.rssBytes),
    formatProcessGpuMemory(process.gpuMemoryBytes),
    process.elapsed,
  ]
    .filter((part) => part != null)
    .join(" · ");
}

export function historyProcessStats(process: ServerProcessResourceHistorySummary): string {
  return [
    process.isServerRoot ? "Root" : "Child",
    `PID ${process.pid}`,
    `peak ${formatPercent(process.maxCpuPercent)}`,
    formatBytes(process.maxRssBytes),
    formatProcessGpuMemory(process.gpuMemoryBytes),
    formatCpuTime(process.cpuSecondsApprox),
  ]
    .filter((part) => part != null)
    .join(" · ");
}
