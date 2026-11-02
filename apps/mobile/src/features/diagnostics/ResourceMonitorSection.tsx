import type {
  EnvironmentId,
  HostResourcesSnapshot,
  ServerProcessDiagnosticsEntry,
  ServerProcessResourceHistoryBucket,
  ServerProcessResourceHistorySummary,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useState } from "react";
import { Pressable, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useResolveClassNames } from "uniwind";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { cn } from "../../lib/cn";
import { SettingsSection } from "../settings/components/SettingsSection";
import * as ResourceMonitorModel from "./ResourceMonitorModel";
import { useResourceMonitor } from "./useResourceMonitor";

export function ResourceMonitorSection(props: {
  readonly environmentId: EnvironmentId | null;
  readonly environmentLabel?: string;
}) {
  const monitor = useResourceMonitor(props.environmentId);
  const [layoutMode, setLayoutMode] = useState<ResourceMonitorModel.ProcessLayoutMode>("usage");
  if (props.environmentId === null) {
    return (
      <SettingsSection title="Resource monitor">
        <EmptyCopy detail="Select a connected environment to watch its host and T3 server workload." />
      </SettingsSection>
    );
  }
  if (!monitor.canReadDiagnostics) {
    return (
      <SettingsSection title="Resource monitor">
        <EmptyCopy detail="This connection does not have access to diagnostics." />
      </SettingsSection>
    );
  }

  const processError = monitor.processes.data
    ? Option.getOrNull(monitor.processes.data.error)
    : null;
  const historyError = monitor.history.data ? Option.getOrNull(monitor.history.data.error) : null;
  const host = monitor.canReadHost ? monitor.host.data : null;
  const processes = monitor.processes.data;
  const history = monitor.history.data;
  const t3 = ResourceMonitorModel.t3Workload({
    diagnostics: processes,
    history,
  });
  const layoutControl = <ProcessLayoutControl layout={layoutMode} onChange={setLayoutMode} />;

  return (
    <View className="gap-6">
      <SettingsSection
        title="Workload"
        footer={
          props.environmentLabel
            ? `Live figures for ${props.environmentLabel}. Host CPU, memory, and GPU come from the machine running this T3 server. T3 figures are the server process and its descendants.`
            : "Host CPU, memory, and GPU come from the machine running this T3 server. T3 figures are the server process and its descendants."
        }
      >
        <WorkloadGauges
          host={host}
          t3CpuPercent={t3?.cpuPercent ?? null}
          t3RssBytes={t3?.rssBytes ?? null}
          processCount={t3?.processCount ?? null}
          loading={
            monitor.processes.isPending &&
            processes === null &&
            monitor.history.isPending &&
            history === null
          }
        />
        {monitor.host.error ? <ErrorCopy detail={monitor.host.error} /> : null}
        {processError ? <ErrorCopy detail={processError.message} /> : null}
        {monitor.processes.error ? <ErrorCopy detail={monitor.processes.error} /> : null}
      </SettingsSection>

      <SettingsSection
        title="Resource history"
        trailing={
          <SegmentedControl
            size="compact"
            selected={monitor.window.windowMs}
            onSelect={monitor.setWindowMs}
            options={ResourceMonitorModel.HISTORY_WINDOWS.map((window) => ({
              value: window.windowMs,
              label: window.label,
            }))}
          />
        }
        footer={
          history
            ? `Peak T3 memory ${ResourceMonitorModel.formatBytes(
                ResourceMonitorModel.memoryPeakBytes(history.buckets),
              )} · ${history.retainedSampleCount} samples`
            : undefined
        }
      >
        {historyError ? <ErrorCopy detail={historyError.message} /> : null}
        {monitor.history.error ? <ErrorCopy detail={monitor.history.error} /> : null}
        <HistoryCharts
          buckets={history?.buckets ?? []}
          loading={monitor.history.isPending && history === null}
        />
        <TopProcessList
          layout={layoutMode}
          onLayoutChange={setLayoutMode}
          processes={history?.topProcesses ?? []}
          emptyLabel={
            monitor.history.isPending && history === null
              ? "Collecting process resource samples…"
              : "No process resource samples found for this window."
          }
        />
      </SettingsSection>

      <SettingsSection
        title="Live processes"
        trailing={layoutControl}
        footer="Usage ranks every process by current CPU, then memory, then GPU. Tree keeps parent and child rows together, with heavier branches first."
      >
        <ProcessTree
          layout={layoutMode}
          processes={processes?.processes ?? []}
          emptyLabel={
            monitor.processes.isPending && processes === null
              ? "Loading live processes…"
              : "No live descendant processes found."
          }
        />
      </SettingsSection>
    </View>
  );
}

function WorkloadGauges(props: {
  readonly host: HostResourcesSnapshot | null;
  readonly t3CpuPercent: number | null;
  readonly t3RssBytes: number | null;
  readonly processCount: number | null;
  readonly loading: boolean;
}) {
  if (props.loading) {
    return (
      <View className="items-center gap-3 px-6 py-8">
        <AppActivityIndicator />
        <Text className="text-center text-sm text-foreground-muted">Reading host load…</Text>
      </View>
    );
  }

  const hostCpu = ResourceMonitorModel.hostCpuPercent(props.host);
  const hostMemory = ResourceMonitorModel.hostMemoryUsedPercent(props.host);
  const t3MemoryPercent = ResourceMonitorModel.t3MemoryPercentOfHost(
    props.t3RssBytes ?? 0,
    props.host,
  );

  return (
    <View className="flex-row flex-wrap justify-center gap-y-5 px-3 py-5">
      <ResourceLoadGauge
        label="Host CPU"
        percent={hostCpu}
        detail={
          props.host
            ? `${props.host.cpuCount} ${props.host.cpuCount === 1 ? "core" : "cores"}`
            : "Unavailable"
        }
      />
      <ResourceLoadGauge
        label="Host memory"
        percent={hostMemory}
        detail={
          props.host
            ? `${ResourceMonitorModel.formatBytes(
                ResourceMonitorModel.hostMemoryUsedBytes(props.host) ?? 0,
              )} / ${ResourceMonitorModel.formatBytes(props.host.totalMemoryBytes)}`
            : "Unavailable"
        }
      />
      <GpuGauges host={props.host} />
      <ResourceLoadGauge
        label="T3 CPU"
        percent={props.t3CpuPercent}
        detail={
          props.processCount === null
            ? "Descendants"
            : `${props.processCount} ${props.processCount === 1 ? "process" : "processes"}`
        }
      />
      <ResourceLoadGauge
        label="T3 memory"
        percent={t3MemoryPercent}
        valueLabel={
          props.t3RssBytes === null ? null : ResourceMonitorModel.formatBytes(props.t3RssBytes)
        }
        detail={t3MemoryPercent === null ? "Resident set" : "of host RAM"}
      />
    </View>
  );
}

function GpuGauges(props: { readonly host: HostResourcesSnapshot | null }) {
  if (props.host === null) {
    return (
      <View
        accessible
        accessibilityLabel="GPU unavailable"
        className="w-full items-center px-2 py-1"
      >
        <Text className="text-center text-sm text-foreground-muted">GPU unavailable</Text>
      </View>
    );
  }

  const gpus = ResourceMonitorModel.hostGpus(props.host);
  if (gpus.length === 0) {
    return (
      <View
        accessible
        accessibilityLabel="GPU not detected / not supported"
        className="w-full items-center px-2 py-1"
      >
        <Text className="text-center text-sm font-t3-medium text-foreground">
          GPU not detected / not supported
        </Text>
        <Text className="text-center text-xs text-foreground-muted">
          This host did not report a GPU sample.
        </Text>
      </View>
    );
  }

  const labels = ResourceMonitorModel.gpuGaugeLabels(gpus);
  return (
    <>
      {gpus.map((gpu, gpuIndex) => {
        const label = labels[gpuIndex]!;
        return (
          <View
            key={`${gpu.name}:${gpu.utilization ?? "na"}:${gpu.memoryUsedBytes ?? "na"}:${gpu.memoryTotalBytes ?? "na"}`}
            className="w-full flex-row flex-wrap"
          >
            <ResourceLoadGauge
              label={label.util}
              percent={ResourceMonitorModel.gpuUtilizationPercent(gpu)}
              detail={gpu.name}
            />
            <ResourceLoadGauge
              label={label.memory}
              percent={ResourceMonitorModel.gpuMemoryUsedPercent(gpu)}
              detail={ResourceMonitorModel.gpuMemoryDetail(gpu)}
            />
          </View>
        );
      })}
    </>
  );
}

function ResourceLoadGauge(props: {
  readonly label: string;
  readonly percent: number | null;
  readonly detail: string;
  readonly valueLabel?: string | null;
}) {
  const percent = props.percent;
  const tone = percent === null ? "ok" : ResourceMonitorModel.loadTone(percent);
  const fill = percent === null ? 0 : ResourceMonitorModel.clampGaugePercent(percent);
  const colors = useResolveClassNames(ResourceMonitorModel.loadTextClass(tone));
  const track = useResolveClassNames("text-foreground-muted");
  const size = 84;
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const value =
    props.valueLabel ?? (percent === null ? "N/A" : ResourceMonitorModel.formatPercent(percent));

  return (
    <View className="w-1/2 items-center gap-2 px-2">
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`${props.label} ${value}`}
        accessibilityValue={percent === null ? undefined : { min: 0, max: 100, now: fill }}
      >
        <Svg width={size} height={size}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={typeof track.color === "string" ? track.color : "#737373"}
            strokeWidth={stroke}
            strokeOpacity={0.25}
            fill="none"
          />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={typeof colors.color === "string" ? colors.color : "#22c55e"}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={circumference * (1 - fill / 100)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>
        <View className="absolute inset-0 items-center justify-center">
          <Text
            className={cn(
              "text-base font-t3-bold tabular-nums",
              ResourceMonitorModel.loadTextClass(tone),
            )}
          >
            {value}
          </Text>
        </View>
      </View>
      <Text className="text-sm font-t3-medium text-foreground">{props.label}</Text>
      <Text className="text-center text-xs text-foreground-muted">{props.detail}</Text>
    </View>
  );
}

function HistoryCharts(props: {
  readonly buckets: ReadonlyArray<ServerProcessResourceHistoryBucket>;
  readonly loading: boolean;
}) {
  if (props.loading) {
    return (
      <View className="items-center gap-3 px-6 py-8">
        <AppActivityIndicator />
        <Text className="text-center text-sm text-foreground-muted">
          Collecting process resource samples…
        </Text>
      </View>
    );
  }
  if (props.buckets.length === 0) {
    return <EmptyCopy detail="No resource samples in this window yet. Keep this screen open." />;
  }

  const bars = ResourceMonitorModel.historyChartBars(props.buckets);

  return (
    <View className="gap-4 border-b border-border-subtle px-4 py-4">
      <HistoryChart
        title="CPU"
        bars={bars.map((bar, index) => {
          const bucket = props.buckets[index]!;
          return {
            key: bar.startedAtMs,
            peakHeight: bar.peakCpuHeight,
            averageHeight: bar.averageCpuHeight,
            label: `Average CPU ${ResourceMonitorModel.formatPercent(
              bucket.avgCpuPercent,
            )}, peak ${ResourceMonitorModel.formatPercent(bucket.maxCpuPercent)}`,
          };
        })}
      />
      <HistoryChart
        title="Memory"
        bars={bars.map((bar, index) => {
          const bucket = props.buckets[index]!;
          return {
            key: bar.startedAtMs,
            peakHeight: bar.peakMemoryHeight,
            label: `Peak memory ${ResourceMonitorModel.formatBytes(bucket.maxRssBytes)}`,
          };
        })}
      />
    </View>
  );
}

function HistoryChart(props: {
  readonly title: string;
  readonly bars: ReadonlyArray<{
    readonly key: number;
    readonly peakHeight: number;
    readonly averageHeight?: number;
    readonly label: string;
  }>;
}) {
  const trackHeight = ResourceMonitorModel.HISTORY_CHART_TRACK_HEIGHT;
  const barMaxHeight = ResourceMonitorModel.HISTORY_CHART_BAR_MAX_HEIGHT;
  return (
    <View className="gap-2">
      <Text className="text-xs font-t3-medium uppercase tracking-widest text-foreground-muted">
        {props.title}
      </Text>
      <View
        className="flex-row items-end gap-0.5 overflow-hidden rounded-lg bg-subtle p-2"
        style={{ height: trackHeight }}
      >
        {props.bars.map((bar) => (
          <View
            key={bar.key}
            accessibilityLabel={bar.label}
            className="relative min-w-1 flex-1"
            style={{ height: barMaxHeight }}
          >
            <View
              className="absolute inset-x-0 bottom-0 rounded-t-sm bg-foreground/20"
              style={{ height: bar.peakHeight }}
            />
            {bar.averageHeight !== undefined ? (
              <View
                className="absolute inset-x-0 bottom-0 rounded-t-sm bg-foreground/70"
                style={{ height: bar.averageHeight }}
              />
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

function ProcessLayoutControl(props: {
  readonly layout: ResourceMonitorModel.ProcessLayoutMode;
  readonly onChange: (layout: ResourceMonitorModel.ProcessLayoutMode) => void;
}) {
  return (
    <SegmentedControl
      size="compact"
      selected={props.layout}
      onSelect={props.onChange}
      options={ResourceMonitorModel.PROCESS_LAYOUT_OPTIONS}
    />
  );
}

function TopProcessList(props: {
  readonly layout: ResourceMonitorModel.ProcessLayoutMode;
  readonly onLayoutChange: (layout: ResourceMonitorModel.ProcessLayoutMode) => void;
  readonly processes: ReadonlyArray<ServerProcessResourceHistorySummary>;
  readonly emptyLabel: string;
}) {
  if (props.processes.length === 0) {
    return <EmptyCopy detail={props.emptyLabel} />;
  }
  const shallowest = ResourceMonitorModel.shallowestChildDepth(props.processes);
  const rows = ResourceMonitorModel.displayedHistoryProcesses(props.processes, props.layout);
  return (
    <View>
      <View className="items-end border-b border-border-subtle px-4 py-2">
        <ProcessLayoutControl layout={props.layout} onChange={props.onLayoutChange} />
      </View>
      {rows.map((process, index) => {
        const name = ResourceMonitorModel.formatProcessName(process.command);
        const visualDepth =
          props.layout === "tree"
            ? ResourceMonitorModel.historyVisualDepth(process, shallowest)
            : 0;
        const depthLabel =
          props.layout === "tree" ? ResourceMonitorModel.processDepthLabel(visualDepth) : null;
        return (
          <View
            key={process.processKey}
            accessibilityLabel={`history-process ${process.pid}`}
            className={cn("gap-1 px-4 py-3", index > 0 && "border-t border-border-subtle")}
            style={{
              paddingLeft: 16 + ResourceMonitorModel.processRowIndent(visualDepth),
            }}
          >
            <View className="flex-row items-baseline justify-between gap-3">
              <View className="min-w-0 flex-1 flex-row items-baseline gap-1.5">
                {depthLabel ? (
                  <Text className="shrink-0 text-xs font-t3-medium tabular-nums text-foreground-muted">
                    {depthLabel}
                  </Text>
                ) : null}
                <Text className="min-w-0 flex-1 text-base text-foreground" numberOfLines={1}>
                  {name}
                </Text>
              </View>
              <Text
                className={cn(
                  "shrink-0 text-sm font-t3-medium tabular-nums",
                  ResourceMonitorModel.loadTextClass(
                    ResourceMonitorModel.loadTone(process.currentCpuPercent),
                  ),
                )}
              >
                {ResourceMonitorModel.formatPercent(process.currentCpuPercent)}
              </Text>
            </View>
            <Text className="text-xs text-foreground-muted">
              {ResourceMonitorModel.historyProcessStats(process)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function ProcessTree(props: {
  readonly layout: ResourceMonitorModel.ProcessLayoutMode;
  readonly processes: ReadonlyArray<ServerProcessDiagnosticsEntry>;
  readonly emptyLabel: string;
}) {
  const [collapsedPids, setCollapsedPids] = useState<ReadonlySet<number>>(() => new Set());
  const visible = ResourceMonitorModel.displayedLiveProcesses(
    props.processes,
    props.layout,
    collapsedPids,
  );
  if (props.processes.length === 0) {
    return <EmptyCopy detail={props.emptyLabel} />;
  }

  const toggle = (pid: number) => {
    setCollapsedPids((previous) => {
      const next = new Set(previous);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  return (
    <View>
      {visible.map((process, index) => {
        const name = ResourceMonitorModel.formatProcessName(process.command);
        const expanded = !collapsedPids.has(process.pid);
        const tree = props.layout === "tree";
        const depthLabel = tree ? ResourceMonitorModel.processDepthLabel(process.depth) : null;
        return (
          <View
            key={process.pid}
            accessibilityLabel={`live-process ${process.pid}`}
            className={cn(
              "flex-row items-start gap-2 px-3 py-3",
              index > 0 && "border-t border-border-subtle",
            )}
            style={{
              paddingLeft: 12 + (tree ? ResourceMonitorModel.processRowIndent(process.depth) : 0),
            }}
          >
            {tree && process.childPids.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={expanded ? `Collapse ${name}` : `Expand ${name}`}
                onPress={() => toggle(process.pid)}
                className="size-7 items-center justify-center"
              >
                <SymbolView
                  name={expanded ? "chevron.down" : "chevron.right"}
                  size={14}
                  tintColorClassName="accent-chevron"
                  type="monochrome"
                  weight="semibold"
                />
              </Pressable>
            ) : (
              <View className="size-7" />
            )}
            <View className="min-w-0 flex-1 gap-0.5">
              <View className="flex-row items-baseline justify-between gap-3">
                <View className="min-w-0 flex-1 flex-row items-baseline gap-1.5">
                  {depthLabel ? (
                    <Text className="shrink-0 text-xs font-t3-medium tabular-nums text-foreground-muted">
                      {depthLabel}
                    </Text>
                  ) : null}
                  <Text className="min-w-0 flex-1 text-base text-foreground" numberOfLines={1}>
                    {name}
                  </Text>
                </View>
                <Text
                  className={cn(
                    "shrink-0 text-sm font-t3-medium tabular-nums",
                    ResourceMonitorModel.loadTextClass(
                      ResourceMonitorModel.loadTone(process.cpuPercent),
                    ),
                  )}
                >
                  {ResourceMonitorModel.formatPercent(process.cpuPercent)}
                </Text>
              </View>
              <Text className="text-xs text-foreground-muted">
                {ResourceMonitorModel.liveProcessStats(process)}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function EmptyCopy(props: { readonly detail: string }) {
  return (
    <View className="items-center px-6 py-8">
      <Text className="text-center text-sm text-foreground-muted">{props.detail}</Text>
    </View>
  );
}

function ErrorCopy(props: { readonly detail: string }) {
  return (
    <View className="flex-row items-start gap-2 border-t border-border-subtle px-4 py-3">
      <SymbolView
        name="exclamationmark.triangle"
        size={16}
        tintColorClassName="accent-danger-foreground"
        type="monochrome"
        weight="regular"
      />
      <Text className="flex-1 text-sm text-danger-foreground">{props.detail}</Text>
    </View>
  );
}
