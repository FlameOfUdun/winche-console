import type { ReactNode } from "react";
import { Tabs } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { RuleSubsystem } from "../../api/rules";
import { useSession } from "../../auth/session";
import { RulesEditor } from "./RulesEditor";
import { LogsView } from "../logs/LogsView";
import { HistoryView } from "../history/HistoryView";

/**
 * Wraps an existing browser page (Documents / Files) with routed "Rules" and "Logs" sub-tabs. The Rules tab
 * is gated to Admins whose subsystem is present in `api.rulesSubsystems()` (that list is admin-only
 * and only contains enabled + available subsystems, so presence alone is sufficient); the Logs tab to the
 * session's `capabilities.logs[subsystem]` (Admins, when the host enabled it with UseLogs()).
 */
export function SubsystemTabs({ subsystem, primaryLabel, basePath, children }: {
  subsystem: RuleSubsystem;
  primaryLabel: string;
  basePath: string;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, state } = useSession();
  const isAdmin = user?.role === "Admin";

  const subsystems = useQuery({
    queryKey: ["rules-subsystems"],
    queryFn: api.rulesSubsystems,
    enabled: isAdmin,
  });
  const eligible = isAdmin && !!subsystems.data?.some((s) => s.id === subsystem);

  const logsEligible = !!state?.capabilities?.logs?.[subsystem];
  const historyEligible = subsystem === "database" && !!state?.capabilities?.history;

  const onRulesPath = pathname.endsWith("/rules");
  const onLogsPath = pathname.endsWith("/logs");
  const onHistoryPath = pathname.endsWith("/history");
  if ((onRulesPath && !eligible && !subsystems.isLoading) || (onLogsPath && !logsEligible) || (onHistoryPath && !historyEligible))
    return <Navigate to={basePath} replace />;

  const active = onRulesPath ? "rules" : onLogsPath ? "logs" : onHistoryPath ? "history" : "primary";

  return (
    <Tabs value={active} onChange={(v) => navigate(v === "rules" || v === "logs" || v === "history" ? `${basePath}/${v}` : basePath)}>
      <Tabs.List mb="sm">
        <Tabs.Tab value="primary">{primaryLabel}</Tabs.Tab>
        {eligible && <Tabs.Tab value="rules">Rules</Tabs.Tab>}
        {historyEligible && <Tabs.Tab value="history">History</Tabs.Tab>}
        {logsEligible && <Tabs.Tab value="logs">Logs</Tabs.Tab>}
      </Tabs.List>

      <Tabs.Panel value="primary">{children}</Tabs.Panel>
      {eligible && (
        <Tabs.Panel value="rules">
          <RulesEditor subsystem={subsystem} />
        </Tabs.Panel>
      )}
      {historyEligible && active === "history" && (
        <Tabs.Panel value="history">
          <HistoryView />
        </Tabs.Panel>
      )}
      {logsEligible && active === "logs" && (
        <Tabs.Panel value="logs">
          <LogsView scope={subsystem} />
        </Tabs.Panel>
      )}
    </Tabs>
  );
}
