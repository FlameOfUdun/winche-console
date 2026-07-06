import type { ReactNode } from "react";
import { Tabs } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { RuleSubsystem } from "../../api/rules";
import { useSession } from "../../auth/session";
import { RulesEditor } from "./RulesEditor";

/**
 * Wraps an existing browser page (Documents / Files) with a routed "Rules" sub-tab. The Rules tab
 * is gated to Admins whose subsystem is present in `api.rulesSubsystems()` (that list is admin-only
 * and only contains enabled + available subsystems, so presence alone is sufficient).
 */
export function SubsystemTabs({ subsystem, primaryLabel, basePath, children }: {
  subsystem: RuleSubsystem;
  primaryLabel: string;
  basePath: string;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user } = useSession();
  const isAdmin = user?.role === "Admin";

  const subsystems = useQuery({
    queryKey: ["rules-subsystems"],
    queryFn: api.rulesSubsystems,
    enabled: isAdmin,
  });
  const eligible = isAdmin && !!subsystems.data?.some((s) => s.id === subsystem);

  const onRulesPath = pathname.endsWith("/rules");
  if (onRulesPath && !eligible) return <Navigate to={basePath} replace />;

  const active = onRulesPath ? "rules" : "primary";

  return (
    <Tabs value={active} onChange={(v) => navigate(v === "rules" ? `${basePath}/rules` : basePath)}>
      <Tabs.List mb="sm">
        <Tabs.Tab value="primary">{primaryLabel}</Tabs.Tab>
        {eligible && <Tabs.Tab value="rules">Rules</Tabs.Tab>}
      </Tabs.List>

      <Tabs.Panel value="primary">{children}</Tabs.Panel>
      {eligible && (
        <Tabs.Panel value="rules">
          <RulesEditor subsystem={subsystem} />
        </Tabs.Panel>
      )}
    </Tabs>
  );
}
