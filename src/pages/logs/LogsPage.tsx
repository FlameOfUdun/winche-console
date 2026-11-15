import { useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { LogResource } from "../../api/logs";
import { LogsExplorer } from "./LogsExplorer";
import { SavedQueriesView } from "./SavedQueriesView";
import { EMPTY, fromSpec, type ExplorerState } from "./explorerQuery";
import { NavPageHeader } from "../../components/NavPageHeader";

/** Logs: the explorer over every kept entry (/logs), and the saved queries (/logs/saved). */
export function LogsPage() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // ?resource=auth (from Authentication) opens the explorer on that resource.
  const [state, setState] = useState<ExplorerState>(() => ({ ...EMPTY, resource: (params.get("resource") ?? "") as LogResource | "" }));
  const saved = pathname === "/logs/saved";
  return (
    <>
      <NavPageHeader />
      <div style={{ paddingBottom: 28 }}>
        {saved
          ? <SavedQueriesView onOpen={(q) => { setState(fromSpec(q.query, state.range)); navigate("/logs"); }} />
          : <LogsExplorer scope="app" state={state} onChange={setState} />}
      </div>
    </>
  );
}
