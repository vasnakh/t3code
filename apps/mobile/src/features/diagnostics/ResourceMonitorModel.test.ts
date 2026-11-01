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
});

function process(pid: number, depth: number, childPids: readonly number[]) {
  return {
    pid,
    startTimeMs: 1,
    ppid: 1,
    pgid: Option.none(),
    status: "running",
    cpuPercent: 1,
    rssBytes: 1,
    elapsed: "0:01",
    command: `proc-${pid}`,
    depth,
    childPids,
  };
}
