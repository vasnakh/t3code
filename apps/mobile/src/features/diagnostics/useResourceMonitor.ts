import { useIsFocused } from "@react-navigation/native";
import {
  AuthDiagnosticsReadScope,
  AuthOrchestrationReadScope,
  type EnvironmentId,
} from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { useAppActive } from "../../lib/appState";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import * as ResourceMonitorModel from "./ResourceMonitorModel";

export function useResourceMonitor(environmentId: EnvironmentId | null) {
  const focused = useIsFocused();
  const appActive = useAppActive();
  const [windowMs, setWindowMs] = useState(15 * 60_000);
  const window = ResourceMonitorModel.historyWindow(windowMs);
  const canReadDiagnostics = useEnvironmentScope(environmentId, AuthDiagnosticsReadScope);
  const canReadHost = useEnvironmentScope(environmentId, AuthOrchestrationReadScope);
  const live = focused && appActive && environmentId !== null && canReadDiagnostics;
  const selectedEnvironmentId = live ? environmentId : null;

  const processes = useEnvironmentQuery(
    selectedEnvironmentId !== null
      ? serverEnvironment.processDiagnostics({
          environmentId: selectedEnvironmentId,
          input: {},
        })
      : null,
  );
  const history = useEnvironmentQuery(
    selectedEnvironmentId !== null
      ? serverEnvironment.processResourceHistory({
          environmentId: selectedEnvironmentId,
          input: {
            windowMs: window.windowMs,
            bucketMs: window.bucketMs,
          },
        })
      : null,
  );
  const host = useEnvironmentQuery(
    selectedEnvironmentId !== null && canReadHost
      ? serverEnvironment.hostResources({
          environmentId: selectedEnvironmentId,
          input: {},
        })
      : null,
  );

  const { refresh: refreshProcesses } = processes;
  const { refresh: refreshHistory } = history;
  const { refresh: refreshHost } = host;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls existing diagnostics RPCs only while this screen is focused and foregrounded
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      refreshProcesses();
      refreshHistory();
      refreshHost();
    }, ResourceMonitorModel.POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [live, refreshProcesses, refreshHistory, refreshHost]);

  return {
    window,
    setWindowMs,
    canReadDiagnostics,
    canReadHost,
    processes,
    history,
    host,
  };
}
