import * as NodeOS from "node:os";
import type { HostResourcesSnapshot } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { amdSysfsCardIds, parseAmdSysfsCard, parseNvidiaSmiCsv, withHostGpus } from "./HostGpus.ts";

export class HostResources extends Context.Service<
  HostResources,
  { readonly read: Effect.Effect<HostResourcesSnapshot> }
>()("t3/resourceTelemetry/HostResources") {}

function readCpu() {
  const cpus = NodeOS.cpus();
  const cpu = cpus.reduce(
    (sum, { times }) => ({
      idle: sum.idle + times.idle,
      total: sum.total + times.user + times.nice + times.sys + times.idle + times.irq,
    }),
    { idle: 0, total: 0 },
  );
  return { ...cpu, count: cpus.length };
}

function darwinAvailableMemory(output: string): number | null {
  const pageSize = /page size of (\d+) bytes/.exec(output)?.[1];
  const free = /^Pages free:\s+(\d+)\./m.exec(output)?.[1];
  const inactive = /^Pages inactive:\s+(\d+)\./m.exec(output)?.[1];
  const speculative = /^Pages speculative:\s+(\d+)\./m.exec(output)?.[1];
  if (!pageSize || !free || !inactive || !speculative) return null;
  // vm_stat excludes speculative from free; add it once, without overlapping purgeable pages.
  const available = (Number(free) + Number(inactive) + Number(speculative)) * Number(pageSize);
  return Number.isSafeInteger(available) && Number(pageSize) > 0 ? available : null;
}

const make = Effect.fn("makeHostResources")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const platform = yield* HostProcess.Platform;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const sample = Effect.fn("HostResources.sample")(function* () {
    const previousCpu = readCpu();
    yield* Effect.sleep("200 millis");
    const cpu = readCpu();
    const totalDelta = cpu.total - previousCpu.total;
    const idleDelta = cpu.idle - previousCpu.idle;
    const cpuUtilization =
      previousCpu.count === cpu.count && totalDelta > 0 && idleDelta >= 0
        ? Math.min(1, Math.max(0, 1 - idleDelta / totalDelta))
        : null;
    const totalMemoryBytes = NodeOS.totalmem();
    // On Windows libuv returns GlobalMemoryStatusEx.ullAvailPhys, including standby memory.
    let availableMemoryBytes = NodeOS.freemem();
    if (platform === "linux") {
      const meminfo = yield* fs
        .readFileString("/proc/meminfo")
        .pipe(Effect.orElseSucceed(() => ""));
      const available = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(meminfo)?.[1];
      if (available) availableMemoryBytes = Number(available) * 1024;
    } else if (platform === "darwin") {
      const output = yield* spawner
        .string(ChildProcess.make("/usr/bin/vm_stat", [], { stdin: "ignore", stderr: "ignore" }))
        .pipe(
          Effect.timeout("1 second"),
          Effect.orElseSucceed(() => ""),
        );
      availableMemoryBytes = darwinAvailableMemory(output) ?? availableMemoryBytes;
    }
    const nvidiaOutput = yield* spawner
      .string(
        ChildProcess.make(
          "nvidia-smi",
          [
            "--query-gpu=name,utilization.gpu,memory.used,memory.total",
            "--format=csv,noheader,nounits",
          ],
          { stdin: "ignore", stderr: "ignore" },
        ),
      )
      .pipe(
        Effect.timeout("2 seconds"),
        Effect.orElseSucceed(() => ""),
      );
    const gpus = parseNvidiaSmiCsv(nvidiaOutput);
    if (platform === "linux") {
      const cards = yield* fs.readDirectory("/sys/class/drm").pipe(Effect.orElseSucceed(() => []));
      for (const card of amdSysfsCardIds(cards)) {
        const device = `/sys/class/drm/${card}/device`;
        const [vendor, busyPercent, memoryUsed, memoryTotal, productName, gpuName] =
          yield* Effect.all([
            fs.readFileString(`${device}/vendor`).pipe(Effect.orElseSucceed(() => "")),
            fs.readFileString(`${device}/gpu_busy_percent`).pipe(Effect.orElseSucceed(() => "")),
            fs.readFileString(`${device}/mem_info_vram_used`).pipe(Effect.orElseSucceed(() => "")),
            fs.readFileString(`${device}/mem_info_vram_total`).pipe(Effect.orElseSucceed(() => "")),
            fs.readFileString(`${device}/product_name`).pipe(Effect.orElseSucceed(() => "")),
            fs.readFileString(`${device}/gpu_name`).pipe(Effect.orElseSucceed(() => "")),
          ]);
        const name = productName.trim() || gpuName.trim();
        const gpu = parseAmdSysfsCard({
          vendor,
          busyPercent,
          memoryUsed,
          memoryTotal,
          ...(name.length > 0 ? { productName: name } : {}),
        });
        if (gpu) gpus.push(gpu);
      }
    }
    return withHostGpus(
      {
        sampledAt: DateTime.toEpochMillis(yield* DateTime.now),
        cpuUtilization,
        cpuCount: cpu.count,
        availableMemoryBytes: Math.min(totalMemoryBytes, Math.max(0, availableMemoryBytes)),
        totalMemoryBytes,
      },
      gpus,
    );
  });

  const cache = yield* Cache.make({
    capacity: 1,
    lookup: (_key: "host") => sample(),
    timeToLive: "5 seconds",
  });
  return HostResources.of({ read: Cache.get(cache, "host") });
});

export const layer = Layer.effect(HostResources, make());
