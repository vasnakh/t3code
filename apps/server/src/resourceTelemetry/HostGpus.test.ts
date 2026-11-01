import { describe, expect, it } from "@effect/vitest";

import {
  amdSysfsCardIds,
  parseAmdSysfsCard,
  parseNvidiaSmiCsv,
  parseOptionalBytes,
  parseOptionalNumber,
  withHostGpus,
} from "./HostGpus.ts";

describe("HostGpus parsers", () => {
  it("parses nvidia-smi csv, including multiple GPUs and N/A fields", () => {
    expect(
      parseNvidiaSmiCsv(`
NVIDIA GeForce RTX 4090, 12, 1024, 24576
"NVIDIA RTX A6000", 87.5, 20480, 49152
NVIDIA Tesla T4, [N/A], 256, 15360
NVIDIA Graphics Device, [N/A], [N/A], [N/A]
`),
    ).toEqual([
      {
        name: "NVIDIA GeForce RTX 4090",
        utilization: 0.12,
        memoryUsedBytes: 1024 * 1024 * 1024,
        memoryTotalBytes: 24576 * 1024 * 1024,
      },
      {
        name: "NVIDIA RTX A6000",
        utilization: 0.875,
        memoryUsedBytes: 20480 * 1024 * 1024,
        memoryTotalBytes: 49152 * 1024 * 1024,
      },
      {
        name: "NVIDIA Tesla T4",
        utilization: null,
        memoryUsedBytes: 256 * 1024 * 1024,
        memoryTotalBytes: 15360 * 1024 * 1024,
      },
    ]);
  });

  it("ignores empty nvidia-smi output and incomplete rows", () => {
    expect(parseNvidiaSmiCsv("")).toEqual([]);
    expect(parseNvidiaSmiCsv("NVIDIA GeForce RTX 4090, 10")).toEqual([]);
    expect(parseNvidiaSmiCsv("\n  \n")).toEqual([]);
  });

  it("reads AMD sysfs busy percent and VRAM bytes", () => {
    expect(
      parseAmdSysfsCard({
        vendor: "0x1002\n",
        busyPercent: "23\n",
        memoryUsed: "1073741824\n",
        memoryTotal: "17179869184\n",
        productName: "Radeon RX 7900 XTX\n",
      }),
    ).toEqual({
      name: "Radeon RX 7900 XTX",
      utilization: 0.23,
      memoryUsedBytes: 1_073_741_824,
      memoryTotalBytes: 17_179_869_184,
    });
  });

  it("skips non-AMD cards and AMD cards with no sample", () => {
    expect(
      parseAmdSysfsCard({
        vendor: "0x10de",
        busyPercent: "40",
        memoryUsed: "1",
        memoryTotal: "2",
        productName: "NVIDIA",
      }),
    ).toBeNull();
    expect(parseAmdSysfsCard({ vendor: "0x1002" })).toBeNull();
    expect(
      parseAmdSysfsCard({
        vendor: "0x1002",
        busyPercent: "11",
      }),
    ).toEqual({
      name: "AMD GPU",
      utilization: 0.11,
      memoryUsedBytes: null,
      memoryTotalBytes: null,
    });
  });

  it("keeps only cardN drm nodes", () => {
    expect(
      amdSysfsCardIds(["version", "card0-HDMI-A-1", "renderD128", "card1", "card0", "card10"]),
    ).toEqual(["card0", "card1", "card10"]);
  });

  it("omits gpus when no device reported a sample", () => {
    const host = {
      sampledAt: 1,
      cpuUtilization: 0.1,
      cpuCount: 8,
      availableMemoryBytes: 1,
      totalMemoryBytes: 2,
    };
    expect(withHostGpus(host, [])).toEqual(host);
    expect(withHostGpus(host, []).gpus).toBeUndefined();
    expect(
      withHostGpus(host, [
        {
          name: "NVIDIA GeForce RTX 4090",
          utilization: 0.4,
          memoryUsedBytes: 1,
          memoryTotalBytes: 2,
        },
      ]).gpus,
    ).toHaveLength(1);
  });

  it("rejects non-numeric and non-integer byte strings", () => {
    expect(parseOptionalNumber(" [N/A] ")).toBeNull();
    expect(parseOptionalNumber("-")).toBeNull();
    expect(parseOptionalNumber("12.5")).toBe(12.5);
    expect(parseOptionalBytes("12.5")).toBeNull();
    expect(parseOptionalBytes("-4")).toBeNull();
    expect(parseOptionalBytes("4096")).toBe(4096);
  });
});
