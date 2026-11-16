import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { RuleSubsystem } from "../../api/rules";
import { RulesEditor } from "./RulesEditor";
import { ScopedLogs } from "../logs/ScopedLogs";
import { HistoryView } from "../history/HistoryView";
import { DatabaseIndexesView, DatabaseSettingsView } from "../settings/DatabaseSettingsView";
import { StorageSettingsView } from "../settings/StorageSettingsView";
import { AssetsSettingsView } from "../assets/AssetsSettingsView";
import { NavPageHeader } from "../../components/NavPageHeader";
import { ProductHooks } from "../hooks/ProductHooks";
import { useProjectNav } from "../../layout/useProjectNav";

/**
 * Database's and Storage's pages: the browser (Data / Files), and Rules, History, Webhooks, Logs and Settings, each its
 * own page in the sidebar under the product. A page the user can't open (see nav.ts) sends them to the browser.
 */
export function SubsystemTabs({ subsystem, basePath, children }: {
  subsystem: RuleSubsystem;
  primaryLabel?: string;
  basePath: string;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  const { items, ready } = useProjectNav();
  const item = items.find((n) => n.to === basePath);
  const page = pathname.slice(basePath.length + 1) || "primary";
  if (page === "hooks") return <Navigate to={`${basePath}/webhooks`} replace />;   // its address of before
  const allowed = page === "primary" || !!item?.pages.some((p) => p.to === pathname);
  if (!allowed && ready) return <Navigate to={basePath} replace />;
  if (!allowed) return null;

  return (
    <>
      <NavPageHeader />
      {page === "primary" && <div className="winche-fill">{children}</div>}
      {page !== "primary" && (
        <div style={{ paddingBottom: 28 }}>
          {page === "rules" && <RulesEditor subsystem={subsystem} />}
          {page === "indexes" && <DatabaseIndexesView />}
          {page === "history" && <HistoryView />}
          {page === "logs" && subsystem !== "assets" && <ScopedLogs scope={subsystem} />}
          {page === "webhooks" && <ProductHooks source={subsystem} />}
          {page === "settings" && (subsystem === "database" ? <DatabaseSettingsView /> : subsystem === "assets" ? <AssetsSettingsView /> : <StorageSettingsView />)}
        </div>
      )}
    </>
  );
}
