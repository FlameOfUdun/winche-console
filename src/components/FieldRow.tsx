import { Children, type ReactNode } from "react";
import { SimpleGrid } from "@mantine/core";

/**
 * Fields side by side, lined up: labels on one line, boxes on the next, and each help line or error under its box
 * (so a field with help doesn't sit lower than one without). One per line on narrow screens.
 */
export function FieldRow({ children }: { children: ReactNode }) {
  const n = Math.max(1, Children.toArray(children).length);
  return <SimpleGrid cols={{ base: 1, sm: n }} spacing="md" verticalSpacing="sm" className="w-field-row">{children}</SimpleGrid>;
}
