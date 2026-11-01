import { EnvironmentId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { EnvironmentQueryView } from "../../state/query";

const { Children, mocks } = vi.hoisted(() => ({
  Children: ({ children }: { children?: ReactNode }) => children,
  mocks: {
    focused: true,
    appActive: true,
    canReadDiagnostics: true,
    canReadHost: true,
    processDiagnostics: vi.fn((target: { environmentId: string; input: object }) => ({
      kind: "process",
      target,
    })),
    processResourceHistory: vi.fn((target: { environmentId: string; input: object }) => ({
      kind: "history",
      target,
    })),
    hostResources: vi.fn((target: { environmentId: string; input: object }) => ({
      kind: "host",
      target,
    })),
    queries: new Map<string, EnvironmentQueryView<unknown>>(),
  },
}));

vi.mock("react-native", () => ({
  View: ({
    children,
    accessibilityLabel,
    accessibilityRole,
    style,
  }: {
    children?: ReactNode;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    style?: { height?: number | string };
  }) => (
    <div aria-label={accessibilityLabel} role={accessibilityRole} style={style}>
      {children}
    </div>
  ),
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
  }: {
    children?: ReactNode;
    onPress?: () => void;
    accessibilityLabel?: string;
  }) => (
    <button onClick={onPress} aria-label={accessibilityLabel}>
      {children}
    </button>
  ),
  ActivityIndicator: () => <span>loading</span>,
}));
vi.mock("react-native-svg", () => ({
  default: Children,
  Circle: () => null,
}));
vi.mock("uniwind", () => ({
  useResolveClassNames: () => ({ color: "#22c55e" }),
}));
vi.mock("@react-navigation/native", () => ({
  useIsFocused: () => mocks.focused,
}));
vi.mock("../../lib/appState", () => ({
  useAppActive: () => mocks.appActive,
}));
vi.mock("../../state/session", () => ({
  useEnvironmentScope: (_environmentId: unknown, scope: string) =>
    scope === "diagnostics:read" ? mocks.canReadDiagnostics : mocks.canReadHost,
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    processDiagnostics: mocks.processDiagnostics,
    processResourceHistory: mocks.processResourceHistory,
    hostResources: mocks.hostResources,
  },
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: { kind?: string } | null) => {
    if (atom === null) {
      return {
        data: null,
        error: null,
        isPending: false,
        refresh: vi.fn(),
      };
    }
    return (
      mocks.queries.get(atom.kind ?? "") ?? {
        data: null,
        error: null,
        isPending: false,
        refresh: vi.fn(),
      }
    );
  },
}));
vi.mock("../../components/ui/AppText", () => ({ AppText: Children }));
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../../components/ui/AppActivityIndicator", () => ({
  AppActivityIndicator: () => <span>loading</span>,
}));
vi.mock("../../components/ui/SegmentedControl", () => ({
  SegmentedControl: ({
    options,
    selected,
    onSelect,
  }: {
    options: ReadonlyArray<{ value: number; label: string }>;
    selected: number;
    onSelect: (value: number) => void;
  }) => (
    <div>
      {options.map((option) => (
        <button
          key={option.value}
          aria-pressed={option.value === selected}
          onClick={() => onSelect(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("../settings/components/SettingsSection", () => ({
  SettingsSection: ({ children, trailing }: { children?: ReactNode; trailing?: ReactNode }) => (
    <>
      {trailing}
      {children}
    </>
  ),
}));

import * as ResourceMonitorModel from "./ResourceMonitorModel";
import { ResourceMonitorSection } from "./ResourceMonitorSection";

const ENVIRONMENT_ID = EnvironmentId.make("env-1");
const NOW = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");

function query<A>(
  data: A | null,
  extras?: Partial<EnvironmentQueryView<A>>,
): EnvironmentQueryView<A> {
  return {
    data,
    successResult: null,
    error: null,
    failure: null,
    isPending: false,
    isSuccess: data !== null,
    refresh: vi.fn(),
    ...extras,
  };
}

function hostSnapshot() {
  return {
    sampledAt: 1,
    cpuUtilization: 0.42,
    cpuCount: 8,
    availableMemoryBytes: 8 * 1024 * 1024 * 1024,
    totalMemoryBytes: 16 * 1024 * 1024 * 1024,
  };
}

function processSnapshot() {
  return {
    serverPid: 100,
    readAt: NOW,
    processCount: 2,
    totalRssBytes: 200 * 1024 * 1024,
    totalCpuPercent: 18.5,
    error: Option.none(),
    processes: [
      {
        pid: 200,
        startTimeMs: 1,
        ppid: 100,
        pgid: Option.none(),
        status: "running",
        cpuPercent: 12.5,
        rssBytes: 120 * 1024 * 1024,
        elapsed: "1:20",
        command: "/usr/bin/codex exec",
        depth: 0,
        childPids: [201],
      },
      {
        pid: 201,
        startTimeMs: 2,
        ppid: 200,
        pgid: Option.none(),
        status: "running",
        cpuPercent: 6,
        rssBytes: 80 * 1024 * 1024,
        elapsed: "0:40",
        command: "/opt/t3/worker-child",
        depth: 1,
        childPids: [],
      },
    ],
  };
}

function historySnapshot() {
  return {
    readAt: NOW,
    windowMs: 15 * 60_000,
    bucketMs: 60_000,
    sampleIntervalMs: 1_000,
    retainedSampleCount: 12,
    totalCpuSecondsApprox: 8.5,
    error: Option.none(),
    buckets: [
      {
        startedAt: NOW,
        endedAt: NOW,
        avgCpuPercent: 10,
        maxCpuPercent: 20,
        maxRssBytes: 256 * 1024 * 1024,
        maxProcessCount: 3,
      },
    ],
    topProcesses: [
      {
        processKey: "100:1",
        pid: 100,
        ppid: 1,
        command: "node apps/server/src/bin.ts",
        depth: 0,
        isServerRoot: true,
        firstSeenAt: NOW,
        lastSeenAt: NOW,
        currentCpuPercent: 4,
        avgCpuPercent: 3,
        maxCpuPercent: 9,
        cpuSecondsApprox: 5,
        currentRssBytes: 64 * 1024 * 1024,
        maxRssBytes: 96 * 1024 * 1024,
        sampleCount: 12,
      },
    ],
  };
}

function renderSection(environmentId: EnvironmentId | null = ENVIRONMENT_ID) {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(
      <ResourceMonitorSection environmentId={environmentId} environmentLabel="Dev box" />,
    );
  });
  return { container, root };
}

let root: Root | null = null;

beforeEach(() => {
  mocks.focused = true;
  mocks.appActive = true;
  mocks.canReadDiagnostics = true;
  mocks.canReadHost = true;
  mocks.processDiagnostics.mockClear();
  mocks.processResourceHistory.mockClear();
  mocks.hostResources.mockClear();
  mocks.queries.clear();
  mocks.queries.set("process", query(processSnapshot()));
  mocks.queries.set("history", query(historySnapshot()));
  mocks.queries.set("host", query(hostSnapshot()));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("ResourceMonitorSection", () => {
  it("requests the existing process, history, and host RPCs with the selected window", () => {
    const rendered = renderSection();
    root = rendered.root;

    expect(mocks.processDiagnostics).toHaveBeenCalledWith({
      environmentId: ENVIRONMENT_ID,
      input: {},
    });
    expect(mocks.processResourceHistory).toHaveBeenCalledWith({
      environmentId: ENVIRONMENT_ID,
      input: { windowMs: 15 * 60_000, bucketMs: 60_000 },
    });
    expect(mocks.hostResources).toHaveBeenCalledWith({
      environmentId: ENVIRONMENT_ID,
      input: {},
    });
    expect(rendered.container.textContent).toContain("Host CPU");
    expect(rendered.container.textContent).toContain("42.0%");
    expect(rendered.container.textContent).toContain("T3 CPU");
    expect(rendered.container.textContent).toContain("22.5%");
    expect(rendered.container.textContent).toContain("3 processes");
    expect(rendered.container.textContent).toContain("codex");
    expect(rendered.container.textContent).toContain("worker-child");
    const cpuBar = rendered.container.querySelector(
      `[aria-label="Average CPU 10.0%, peak 20.0%"]`,
    );
    expect(cpuBar).not.toBeNull();
    const expectedPeakHeight = ResourceMonitorModel.historyChartBars(historySnapshot().buckets)[0]!
      .peakCpuHeight;
    expect(expectedPeakHeight).toBeGreaterThan(0);
    expect(
      [...(cpuBar?.querySelectorAll("div") ?? [])].some(
        (node) => node.style.height === `${expectedPeakHeight}px`,
      ),
    ).toBe(true);
  });

  it("shows T3 totals from the history root when diagnostics has no children", () => {
    mocks.queries.set(
      "process",
      query({
        ...processSnapshot(),
        processCount: 0,
        totalRssBytes: 0,
        totalCpuPercent: 0,
        processes: [],
      }),
    );
    const rendered = renderSection();
    root = rendered.root;

    expect(rendered.container.textContent).toContain("4.0%");
    expect(rendered.container.textContent).toContain("64.0 MB");
    expect(rendered.container.textContent).toContain("1 process");
    expect(rendered.container.textContent).toContain("No live descendant processes found.");
  });

  it.each([
    ["unfocused", () => (mocks.focused = false)],
    ["backgrounded", () => (mocks.appActive = false)],
    ["missing diagnostics scope", () => (mocks.canReadDiagnostics = false)],
  ])("issues no RPCs when %s", (_name, arrange) => {
    arrange();
    const rendered = renderSection();
    root = rendered.root;

    expect(mocks.processDiagnostics).not.toHaveBeenCalled();
    expect(mocks.processResourceHistory).not.toHaveBeenCalled();
    expect(mocks.hostResources).not.toHaveBeenCalled();
  });

  it("does not invent host figures when the host RPC is out of scope", () => {
    mocks.canReadHost = false;
    const rendered = renderSection();
    root = rendered.root;

    expect(mocks.hostResources).not.toHaveBeenCalled();
    expect(rendered.container.textContent).toContain("Unavailable");
    expect(rendered.container.textContent).toContain("codex");
  });

  it("collapses descendant process-tree rows", () => {
    const rendered = renderSection();
    root = rendered.root;
    expect(rendered.container.textContent).toContain("worker-child");

    act(() => {
      rendered.container.querySelector<HTMLButtonElement>(`[aria-label="Collapse codex"]`)?.click();
    });
    expect(rendered.container.textContent).not.toContain("worker-child");
    expect(rendered.container.querySelector(`[aria-label="Expand codex"]`)).not.toBeNull();
  });

  it("re-requests history with the 5m bucket when the window changes", () => {
    const rendered = renderSection();
    root = rendered.root;
    mocks.processResourceHistory.mockClear();

    act(() => {
      const fiveMinutes = [...rendered.container.querySelectorAll("button")].find(
        (button) => button.textContent === "5m",
      );
      fiveMinutes?.click();
    });

    expect(mocks.processResourceHistory).toHaveBeenCalledWith({
      environmentId: ENVIRONMENT_ID,
      input: { windowMs: 5 * 60_000, bucketMs: 30_000 },
    });
  });
});
