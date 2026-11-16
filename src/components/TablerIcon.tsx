import { useEffect, useState, type ElementType, type CSSProperties } from "react";

type IconProps = { size?: number; stroke?: number; style?: CSSProperties };

// The whole icon set is only loaded when a project's own page names an icon (it's large), once.
let library: Promise<Record<string, unknown>> | null = null;
const load = () => (library ??= import("@tabler/icons-react") as unknown as Promise<Record<string, unknown>>);

/** "chart-bar" → IconChartBar. */
export const componentName = (name: string) => "Icon" + name.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");

/** A Tabler icon by its name (the project's own pages choose theirs); `fallback` until it's loaded, or if there's none by that name. */
export function TablerIcon({ name, fallback: Fallback, ...props }: IconProps & { name: string; fallback: ElementType }) {
  const [Icon, setIcon] = useState<ElementType | null>(null);
  useEffect(() => {
    let live = true;
    load().then((icons) => { if (live) setIcon(() => (icons[componentName(name)] as ElementType | undefined) ?? null); }).catch(() => {});
    return () => { live = false; };
  }, [name]);
  const Shown = Icon ?? Fallback;
  return <Shown {...props} />;
}
