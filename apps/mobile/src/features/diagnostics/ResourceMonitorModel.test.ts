import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import * as ResourceMonitorModel from "./ResourceMonitorModel";

describe("ResourceMonitorModel", () => {
  it("picks history windows and falls back to 15m", () => {
    expect(ResourceMonitorModel.historyWindow(5 * 60_000).bucketMs).toBe(30_000);
    expect(ResourceMonitorModel.historyWindow(15 * 60_000).label).toBe("15m");
    expect(ResourceMonitorModel.historyWindow(999).label).toBe("15m");
  });

  it("colors load by green / yellow / red thresholds", () => {
    expect(ResourceMonitorModel.loadTone(0)).toBe("ok");
    expect(ResourceMonitorModel.loadTone(69.9)).toBe("ok");
    expect(ResourceMonitorModel.loadTone(70)).toBe("warn");
    expect(ResourceMonitorModel.loadTone(89.9)).toBe("warn");
    expect(ResourceMonitorModel.loadTone(90)).toBe("crit");
    expect(ResourceMonitorModel.loadTextClass("ok")).toBe("text-green-500");
    expect(ResourceMonitorModel.loadTextClass("warn")).toBe("text-warning-foreground");
    expect(ResourceMonitorModel.loadTextClass("crit")).toBe("text-danger-foreground");
  });

  it("formats percents, bytes, and CPU time", () => {
    expect(ResourceMonitorModel.formatPercent(12.34)).toBe("12.3%");
    expect(ResourceMonitorModel.formatBytes(512)).toBe("512 B");
    expect(ResourceMonitorModel.formatBytes(2048)).toBe("2.00 KB");
    expect(ResourceMonitorModel.formatBytes(10 * 1024 * 1024)).toBe("10.0 MB");
    expect(ResourceMonitorModel.formatCpuTime(8.25)).toBe("8.25s");
    expect(ResourceMonitorModel.formatCpuTime(12)).toBe("12s");
    expect(ResourceMonitorModel.formatCpuTime(90)).toBe("1.50m");
    expect(ResourceMonitorModel.formatCpuTime(7200)).toBe("2h");
  });

  it("shortens process commands and types descendants", () => {
    expect(ResourceMonitorModel.formatProcessName(`"/usr/bin/node" --watch`)).toBe("node");
    expect(ResourceMonitorModel.formatProcessType({ command: "codex exec", depth: 0 })).toBe(
      "Agent",
    );
    expect(ResourceMonitorModel.formatProcessType({ command: "node server", depth: 0 })).toBe(
      "Process",
    );
    expect(ResourceMonitorModel.formatProcessType({ command: "node worker", depth: 1 })).toBe(
      "Subprocess",
    );
  });

  it("derives host and T3 workload percents from existing RPC snapshots", () => {
    const host = {
      sampledAt: 1,
      cpuUtilization: 0.42,
      cpuCount: 8,
      availableMemoryBytes: 6 * 1024 * 1024 * 1024,
      totalMemoryBytes: 16 * 1024 * 1024 * 1024,
    };
    expect(ResourceMonitorModel.hostCpuPercent(host)).toBe(42);
    expect(ResourceMonitorModel.hostMemoryUsedPercent(host)).toBe(62.5);
    expect(ResourceMonitorModel.t3MemoryPercentOfHost(8 * 1024 * 1024 * 1024, host)).toBe(50);
    expect(ResourceMonitorModel.hostCpuPercent({ ...host, cpuUtilization: null })).toBeNull();
    expect(ResourceMonitorModel.hostMemoryUsedPercent({ ...host, totalMemoryBytes: 0 })).toBeNull();
    expect(ResourceMonitorModel.hostGpus(host)).toEqual([]);
    expect(ResourceMonitorModel.hostGpus(null)).toEqual([]);
  });

  it("formats GPU load without inventing a 0% sample", () => {
    const gpu = {
      name: "NVIDIA GeForce RTX 4090",
      utilization: 0.452,
      memoryUsedBytes: 10 * 1024 * 1024 * 1024,
      memoryTotalBytes: 24 * 1024 * 1024 * 1024,
    };
    expect(ResourceMonitorModel.formatGpuName(gpu.name)).toBe("RTX 4090");
    expect(ResourceMonitorModel.gpuUtilizationPercent(gpu)).toBeCloseTo(45.2);
    expect(ResourceMonitorModel.gpuMemoryUsedPercent(gpu)).toBeCloseTo((10 / 24) * 100);
    expect(ResourceMonitorModel.gpuMemoryDetail(gpu)).toBe("10.0 GB / 24.0 GB");
    expect(ResourceMonitorModel.loadTone(45.2)).toBe("ok");
    expect(ResourceMonitorModel.loadTone(70)).toBe("warn");
    expect(ResourceMonitorModel.loadTone(90)).toBe("crit");
    expect(ResourceMonitorModel.gpuUtilizationPercent({ ...gpu, utilization: null })).toBeNull();
    expect(
      ResourceMonitorModel.gpuMemoryUsedPercent({
        ...gpu,
        memoryUsedBytes: null,
        memoryTotalBytes: null,
      }),
    ).toBeNull();
    expect(
      ResourceMonitorModel.gpuMemoryDetail({
        ...gpu,
        memoryUsedBytes: null,
        memoryTotalBytes: null,
      }),
    ).toBe("Unavailable");
    expect(
      ResourceMonitorModel.gpuGaugeLabels([gpu]).map((label) => [label.util, label.memory]),
    ).toEqual([["GPU util", "GPU memory"]]);
    expect(
      ResourceMonitorModel.gpuGaugeLabels([gpu, { ...gpu, name: "Radeon RX 7900 XTX" }]).map(
        (label) => [label.util, label.memory],
      ),
    ).toEqual([
      ["RTX 4090 util", "RTX 4090 memory"],
      ["Radeon RX 7900 XTX util", "Radeon RX 7900 XTX memory"],
    ]);
    expect(
      ResourceMonitorModel.hostGpus({
        sampledAt: 1,
        cpuUtilization: 0.1,
        cpuCount: 8,
        availableMemoryBytes: 1,
        totalMemoryBytes: 2,
        gpus: [gpu],
      }),
    ).toEqual([gpu]);
  });

  it("scales history charts and reports memory peaks", () => {
    const buckets = [
      { maxCpuPercent: 10, maxRssBytes: 100 },
      { maxCpuPercent: 40, maxRssBytes: 400 },
    ];
    expect(ResourceMonitorModel.historyCpuScaleMax(buckets)).toBe(40);
    expect(ResourceMonitorModel.historyMemoryScaleMax(buckets)).toBe(400);
    expect(ResourceMonitorModel.memoryPeakBytes(buckets)).toBe(400);
    expect(ResourceMonitorModel.barHeight(20, 40)).toBe(50);
    expect(ResourceMonitorModel.barHeight(0, 40)).toBe(0);
    expect(ResourceMonitorModel.barHeight(0.1, 100)).toBe(2);
  });

  it("draws non-empty chart bars from a real-shaped history payload", () => {
    const started = DateTime.makeUnsafe("2026-11-01T18:54:00.000Z");
    const buckets = [
      bucket(started, { avgCpuPercent: 0, maxCpuPercent: 0, maxRssBytes: 0 }),
      bucket(DateTime.add(started, { minutes: 1 }), {
        avgCpuPercent: 0,
        maxCpuPercent: 0,
        maxRssBytes: 0,
      }),
      bucket(DateTime.add(started, { minutes: 14 }), {
        avgCpuPercent: 1.2,
        maxCpuPercent: 12,
        maxRssBytes: Math.round(452.1 * 1024 * 1024),
      }),
    ];
    const bars = ResourceMonitorModel.historyChartBars(buckets);
    expect(bars).toHaveLength(3);
    expect(bars[0]).toMatchObject({ peakCpuHeight: 0, averageCpuHeight: 0, peakMemoryHeight: 0 });
    expect(bars[2]!.peakCpuHeight).toBe(ResourceMonitorModel.HISTORY_CHART_BAR_MAX_HEIGHT);
    expect(bars[2]!.averageCpuHeight).toBeGreaterThan(0);
    expect(bars[2]!.peakMemoryHeight).toBe(ResourceMonitorModel.HISTORY_CHART_BAR_MAX_HEIGHT);
    expect(bars.some((bar) => bar.peakCpuHeight > 0 && bar.peakMemoryHeight > 0)).toBe(true);
  });

  it("includes the root server process in T3 totals when diagnostics omits it", () => {
    expect(
      ResourceMonitorModel.t3Workload({
        diagnostics: {
          processes: [],
          processCount: 0,
          totalCpuPercent: 0,
          totalRssBytes: 0,
        },
        history: {
          topProcesses: [
            {
              pid: 17318,
              currentCpuPercent: 1.4,
              currentRssBytes: Math.round(452.1 * 1024 * 1024),
            },
          ],
        },
      }),
    ).toEqual({
      cpuPercent: 1.4,
      rssBytes: Math.round(452.1 * 1024 * 1024),
      processCount: 1,
    });
  });

  it("unions diagnostics children with the history root and does not double-count", () => {
    expect(
      ResourceMonitorModel.t3Workload({
        diagnostics: {
          processes: [
            { pid: 200, cpuPercent: 6, rssBytes: 20_000_000 },
            { pid: 17318, cpuPercent: 99, rssBytes: 1 },
          ],
          processCount: 2,
          totalCpuPercent: 6,
          totalRssBytes: 20_000_000,
        },
        history: {
          topProcesses: [
            { pid: 17318, currentCpuPercent: 1.4, currentRssBytes: 452_000_000 },
            { pid: 200, currentCpuPercent: 5, currentRssBytes: 21_000_000 },
          ],
        },
      }),
    ).toEqual({
      cpuPercent: 6.4,
      rssBytes: 473_000_000,
      processCount: 2,
    });
  });

  it("hides collapsed descendant rows in depth order", () => {
    const processes = [
      process(10, 0, [11, 12]),
      process(11, 1, [13]),
      process(13, 2, []),
      process(12, 1, []),
      process(20, 0, []),
    ];
    expect(
      ResourceMonitorModel.visibleProcessTree(processes, new Set([11])).map((entry) => entry.pid),
    ).toEqual([10, 11, 12, 20]);
    expect(
      ResourceMonitorModel.visibleProcessTree(processes, new Set([10])).map((entry) => entry.pid),
    ).toEqual([10, 20]);
  });

  it("indents history rows from the shallowest child", () => {
    const processes = [
      { depth: 0, isServerRoot: true },
      { depth: 3, isServerRoot: false },
      { depth: 4, isServerRoot: false },
    ];
    const shallowest = ResourceMonitorModel.shallowestChildDepth(processes);
    expect(shallowest).toBe(3);
    expect(ResourceMonitorModel.historyVisualDepth(processes[0]!, shallowest)).toBe(0);
    expect(ResourceMonitorModel.historyVisualDepth(processes[1]!, shallowest)).toBe(1);
    expect(ResourceMonitorModel.historyVisualDepth(processes[2]!, shallowest)).toBe(2);
  });

  it("caps process-row indent and badges depths past the visual max", () => {
    expect(ResourceMonitorModel.processRowIndent(0)).toBe(0);
    expect(ResourceMonitorModel.processRowIndent(1)).toBe(
      ResourceMonitorModel.PROCESS_ROW_INDENT_STEP,
    );
    expect(ResourceMonitorModel.processRowIndent(2)).toBe(
      ResourceMonitorModel.PROCESS_ROW_INDENT_STEP * 2,
    );
    expect(ResourceMonitorModel.processRowIndent(8)).toBe(
      ResourceMonitorModel.PROCESS_ROW_INDENT_STEP *
        ResourceMonitorModel.PROCESS_ROW_INDENT_MAX_DEPTH,
    );
    expect(ResourceMonitorModel.processRowIndent(8)).toBeLessThan(24);
    expect(ResourceMonitorModel.processDepthLabel(2)).toBeNull();
    expect(ResourceMonitorModel.processDepthLabel(5)).toBe("d5");
  });

  it("sorts usage by current CPU, then memory, then GPU, then pid", () => {
    const processes = [
      { pid: 3, cpuPercent: 10, rssBytes: 10, gpuMemoryBytes: 1 },
      { pid: 1, cpuPercent: 10, rssBytes: 20 },
      { pid: 4, cpuPercent: 4, rssBytes: 1, gpuMemoryBytes: 9 },
      { pid: 2, cpuPercent: 10, rssBytes: 20, gpuMemoryBytes: 8 },
      { pid: 5, cpuPercent: 10, rssBytes: 20, gpuMemoryBytes: 8 },
    ];
    expect(
      ResourceMonitorModel.sortProcessesByUsage(
        processes,
        ResourceMonitorModel.liveProcessIntensity,
      ).map((entry) => entry.pid),
    ).toEqual([2, 5, 1, 3, 4]);
  });

  it("breaks equal CPU and memory ties with per-process GPU memory", () => {
    expect(
      ResourceMonitorModel.compareProcessIntensity(
        { pid: 1, cpuPercent: 4, rssBytes: 100, gpuMemoryBytes: 10 },
        { pid: 2, cpuPercent: 4, rssBytes: 100, gpuMemoryBytes: 50 },
      ),
    ).toBeGreaterThan(0);
    expect(
      ResourceMonitorModel.sortProcessesByUsage(
        [
          { pid: 8, currentCpuPercent: 1.2, currentRssBytes: 64, gpuMemoryBytes: 2 },
          { pid: 9, currentCpuPercent: 1.2, currentRssBytes: 64, gpuMemoryBytes: 40 },
        ],
        ResourceMonitorModel.historyProcessIntensity,
      ).map((entry) => entry.pid),
    ).toEqual([9, 8]);
  });

  it("sorts tree siblings by subtree intensity so heavy branches float up", () => {
    const processes = [
      process(10, 0, [11, 12], { cpuPercent: 1, rssBytes: 10 }),
      process(11, 1, [13], { cpuPercent: 0.2, rssBytes: 4 }),
      process(13, 2, [], { cpuPercent: 0.1, rssBytes: 2 }),
      process(12, 1, [], { cpuPercent: 8, rssBytes: 3, gpuMemoryBytes: 16 }),
      process(20, 0, [], { cpuPercent: 0.4, rssBytes: 1 }),
    ];
    expect(
      ResourceMonitorModel.sortProcessTree(processes, {
        depth: (entry) => entry.depth,
        intensity: ResourceMonitorModel.liveProcessIntensity,
      }).map((entry) => entry.pid),
    ).toEqual([10, 12, 11, 13, 20]);
    expect(
      ResourceMonitorModel.displayedLiveProcesses(processes, "usage", new Set()).map(
        (entry) => entry.pid,
      ),
    ).toEqual([12, 10, 20, 11, 13]);
    expect(
      ResourceMonitorModel.displayedHistoryProcesses(
        [
          historyProcess(1, 0, true, { currentCpuPercent: 2, currentRssBytes: 8 }),
          historyProcess(2, 3, false, { currentCpuPercent: 0.2, currentRssBytes: 4 }),
          historyProcess(3, 4, false, {
            currentCpuPercent: 9,
            currentRssBytes: 2,
            gpuMemoryBytes: 32,
          }),
          historyProcess(4, 3, false, { currentCpuPercent: 1, currentRssBytes: 3 }),
        ],
        "tree",
      ).map((entry) => entry.pid),
    ).toEqual([1, 2, 3, 4]);
  });

  it("omits GPU from process stats when the server did not report it", () => {
    expect(ResourceMonitorModel.formatProcessGpuMemory(undefined)).toBeNull();
    expect(ResourceMonitorModel.formatProcessGpuMemory(0)).toBeNull();
    expect(ResourceMonitorModel.formatProcessGpuMemory(2 * 1024 * 1024)).toBe("GPU 2.00 MB");
    expect(
      ResourceMonitorModel.historyProcessStats(
        historyProcess(8, 1, false, { currentCpuPercent: 1, currentRssBytes: 1 }),
      ),
    ).not.toContain("GPU");
    expect(
      ResourceMonitorModel.historyProcessStats(
        historyProcess(8, 1, false, {
          currentCpuPercent: 1,
          currentRssBytes: 1,
          gpuMemoryBytes: 512 * 1024 * 1024,
        }),
      ),
    ).toContain("GPU 512.0 MB");
  });
});

function bucket(
  startedAt: DateTime.Utc,
  values: {
    readonly avgCpuPercent: number;
    readonly maxCpuPercent: number;
    readonly maxRssBytes: number;
  },
) {
  return {
    startedAt,
    endedAt: DateTime.add(startedAt, { seconds: 60 }),
    maxProcessCount: values.maxRssBytes > 0 ? 1 : 0,
    ...values,
  };
}

function process(
  pid: number,
  depth: number,
  childPids: readonly number[],
  extras?: {
    readonly cpuPercent?: number;
    readonly rssBytes?: number;
    readonly gpuMemoryBytes?: number;
  },
) {
  return {
    pid,
    startTimeMs: 1,
    ppid: 1,
    pgid: Option.none(),
    status: "running",
    cpuPercent: extras?.cpuPercent ?? 1,
    rssBytes: extras?.rssBytes ?? 1,
    ...(extras?.gpuMemoryBytes === undefined ? {} : { gpuMemoryBytes: extras.gpuMemoryBytes }),
    elapsed: "0:01",
    command: `proc-${pid}`,
    depth,
    childPids,
  };
}

function historyProcess(
  pid: number,
  depth: number,
  isServerRoot: boolean,
  extras: {
    readonly currentCpuPercent: number;
    readonly currentRssBytes: number;
    readonly gpuMemoryBytes?: number;
  },
) {
  const now = DateTime.makeUnsafe("2026-11-01T00:00:00.000Z");
  return {
    processKey: `${pid}:1`,
    pid,
    ppid: 1,
    command: `proc-${pid}`,
    depth,
    isServerRoot,
    firstSeenAt: now,
    lastSeenAt: now,
    currentCpuPercent: extras.currentCpuPercent,
    avgCpuPercent: extras.currentCpuPercent,
    maxCpuPercent: extras.currentCpuPercent,
    cpuSecondsApprox: 1,
    currentRssBytes: extras.currentRssBytes,
    maxRssBytes: extras.currentRssBytes,
    ...(extras.gpuMemoryBytes === undefined ? {} : { gpuMemoryBytes: extras.gpuMemoryBytes }),
    sampleCount: 1,
  };
}
