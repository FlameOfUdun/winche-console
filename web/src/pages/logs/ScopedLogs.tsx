import { useState } from "react";
import type { LogScope } from "../../api/logs";
import { LogsExplorer } from "./LogsExplorer";
import { EMPTY, type ExplorerState } from "./explorerQuery";

/** A library's Logs sub-tab: the explorer limited to its entries. */
export function ScopedLogs({ scope }: { scope: Exclude<LogScope, "app"> }) {
  const [state, setState] = useState<ExplorerState>(EMPTY);
  return <LogsExplorer scope={scope} state={state} onChange={setState} />;
}
