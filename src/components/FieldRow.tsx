import type { ReactNode } from "react";
import { Group } from "@mantine/core";

/**
 * Fields side by side, lined up: labels on one line, boxes on the next, and each help line or error under its box
 * (so a field with help doesn't sit lower than one without). Wraps to one per line when narrow.
 */
export function FieldRow({ children }: { children: ReactNode }) {
  return <Group grow wrap="wrap" align="flex-start" className="w-field-row">{children}</Group>;
}
