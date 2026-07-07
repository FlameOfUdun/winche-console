import type { LayoutNode } from "../../api/tabs";

/** Widget ids currently visible given the filter values (switch branches pick by value). */
export function visibleWidgetIds(node: LayoutNode, values: Record<string, string>): string[] {
  switch (node.type) {
    case "widget": return [node.id];
    case "embed": return [];
    case "column":
    case "row":
    case "section":
      return node.children.flatMap((c) => visibleWidgetIds(c, values));
    case "filter": {
      if (node.mode === "switch") {
        const options = node.control.kind === "select" ? node.control.options : [];
        const v = values[node.control.id] ?? options[0] ?? "";
        return (node.branches[v] ?? []).flatMap((c) => visibleWidgetIds(c, values));
      }
      return node.children.flatMap((c) => visibleWidgetIds(c, values));
    }
  }
}
