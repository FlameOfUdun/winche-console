import type { ReactNode } from "react";
import { Group, Text, Title, UnstyledButton } from "@mantine/core";
import { Link, useLocation } from "react-router-dom";
import { useProjectNav } from "../layout/useProjectNav";
import { isPageActive, navItemFor } from "../layout/nav";

/** A tab in a page band: a link to a page, or (in-page tabs) a button. */
export interface BandTab { label: string; to?: string; active?: boolean; onClick?: () => void }

/**
 * The white band at the top of a page: its title, an optional line and actions, and its tabs — like Firebase's
 * product pages. Spans the page's width (it cancels the page's padding).
 */
export function PageBand({ title, description, actions, tabs, children }: {
  title: ReactNode; description?: ReactNode; actions?: ReactNode; tabs?: BandTab[]; children?: ReactNode;
}) {
  return (
    <div className="winche-band" data-tabs={tabs && tabs.length > 0 ? "" : undefined}>
      <Group justify="space-between" align="flex-start" gap="md" wrap="wrap">
        <div style={{ minWidth: 0 }}>
          <Title order={1} fz={26} lh={1.25} style={{ letterSpacing: "-0.01em" }}>{title}</Title>
          {description && <Text size="sm" c="var(--w-muted)" mt={4} maw={760}>{description}</Text>}
        </div>
        {actions && <Group gap="xs" wrap="wrap">{actions}</Group>}
      </Group>
      {children}
      {tabs && tabs.length > 0 && (
        <nav className="winche-tabs" aria-label="Pages">
          {tabs.map((t) => t.to
            ? <UnstyledButton key={t.label} component={Link} to={t.to} className="winche-tab" data-active={t.active || undefined}
                aria-current={t.active ? "page" : undefined}>{t.label}</UnstyledButton>
            : <UnstyledButton key={t.label} onClick={t.onClick} className="winche-tab" data-active={t.active || undefined}
                aria-pressed={t.active}>{t.label}</UnstyledButton>)}
        </nav>
      )}
    </div>
  );
}

/** A project page's band, from the sidebar's model: the product's name, and its pages as tabs. */
export function NavPageHeader({ title, description, actions }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  const { items } = useProjectNav();
  const { pathname } = useLocation();
  const item = navItemFor(items, pathname);
  const tabs = (item?.pages ?? []).map((p) => ({ label: p.label, to: p.to, active: !!item && isPageActive(p, item, pathname) }));
  return <PageBand title={title ?? item?.label ?? ""} description={description} actions={actions} tabs={tabs} />;
}
