import { useMediaQuery } from "@mantine/hooks";
import React, { Fragment, useEffect, useState, type ReactNode } from "react";
import {
  ActionIcon, AppShell, Box, Burger, Button, Group, Menu, Modal, PasswordInput, Stack, Text, TextInput, Tooltip, UnstyledButton,
  useMantineColorScheme,
} from "@mantine/core";
import {
  IconDatabase, IconDeviceDesktop, IconFolder, IconHome, IconLambda, IconPackage, IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand, IconListDetails, IconLogout, IconMoon, IconServer, IconSettings, IconShield, IconSun,
  IconUsers, IconWebhook, IconKey, IconUserCircle, IconFile,
} from "@tabler/icons-react";
import { TablerIcon } from "../components/TablerIcon";
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useSession } from "../auth/session";
import { TwoFactorSetup } from "../auth/TwoFactorSetup";
import { StatusPill } from "../components/PageHeader";
import type { NavIcon, NavItem } from "./nav";
import { serverConsoleUrl } from "./nav";
import { useProjectNav } from "./useProjectNav";
import { ProjectPicker } from "./ProjectSwitcher";
import { SERVER_SECTIONS, sectionPath } from "../pages/server/sections";
import logoUrl from "../assets/winche-logo.png";

const ICONS: Record<NavIcon, React.ElementType> = {
  home: IconHome, database: IconDatabase, folder: IconFolder, shield: IconShield, logs: IconListDetails, users: IconUsers,
  hooks: IconWebhook, functions: IconLambda, assets: IconPackage, settings: IconSettings, page: IconFile,
};

const TOPBAR = 52;

/** The console's frame: the top bar (Winche, the project, Server, you) over a sidebar and the page. */
function Shell({ crumb, sidebar, children }: { crumb: ReactNode; sidebar: ((collapsed: boolean) => ReactNode) | null; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem("winche-sidebar") === "collapsed"; } catch { return false; } });
  // On a phone the sidebar is a menu over the page: closed until asked for, closed again once a page is picked.
  const phone = useMediaQuery("(max-width: 36em)") ?? false;
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setMenuOpen(false), [pathname]);
  const toggle = () => {
    setCollapsed(!collapsed);
    try { localStorage.setItem("winche-sidebar", collapsed ? "open" : "collapsed"); } catch { /* not kept */ }
  };
  return (
    <AppShell header={{ height: TOPBAR }} padding={0}
      navbar={sidebar ? { width: collapsed ? 64 : 248, breakpoint: "xs", collapsed: { mobile: !menuOpen } } : undefined}
      styles={{ main: { background: "var(--w-page)" } }}>
      <AppShell.Header className="winche-topbar">
        <TopBar crumb={crumb} menu={sidebar && phone ? { open: menuOpen, toggle: () => setMenuOpen(!menuOpen) } : null} />
      </AppShell.Header>
      {sidebar && (
        <AppShell.Navbar className="winche-sidebar" p={collapsed ? 8 : 10}>
          <Box style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>{sidebar(collapsed && !phone)}</Box>
          {!phone && <Group justify={collapsed ? "center" : "flex-end"} pt={6}>
            <Tooltip label={collapsed ? "Expand" : "Collapse"} position="right" withArrow>
              <ActionIcon variant="subtle" color="gray" onClick={toggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
                {collapsed ? <IconLayoutSidebarLeftExpand size={18} stroke={1.8} /> : <IconLayoutSidebarLeftCollapse size={18} stroke={1.8} />}
              </ActionIcon>
            </Tooltip>
          </Group>}
        </AppShell.Navbar>
      )}
      <AppShell.Main>
        <Box className="winche-page" px={{ base: 16, sm: 32 }} pt={24} pb={0} data-centered={sidebar ? undefined : ""}>
          {children}
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}

function TopBar({ crumb, menu }: { crumb: ReactNode; menu: { open: boolean; toggle: () => void } | null }) {
  const { state, user } = useSession();
  const { pathname } = useLocation();
  const projects = useQuery({ queryKey: ["server-projects"], queryFn: api.projects, staleTime: 30_000 });
  // On a server, the projects and its settings are the server's own console's: from a project's, they're links there.
  const onServer = state?.server || !!projects.data?.available;
  const local = !!state?.server;
  const inServer = local && pathname.startsWith("/server");
  const navigate = useNavigate();
  // A link into the server's console: navigated in place there, a page load from a project's.
  const to = (path: string) => ({
    component: "a" as const, href: serverConsoleUrl(path),
    onClick: (e: React.MouseEvent) => { if (local && !e.metaKey && !e.ctrlKey) { e.preventDefault(); navigate(`/${path}`); } },
  });
  return (
    <Group h={TOPBAR} px="md" justify="space-between" wrap="nowrap" gap="sm">
      <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
        {menu && <Burger opened={menu.open} onClick={menu.toggle} size="sm" aria-label={menu.open ? "Close the menu" : "Open the menu"} />}
        <UnstyledButton {...to(onServer ? "projects" : "overview")} aria-label={onServer ? "All projects" : "Overview"}
          className="winche-brand">
          <span className="winche-logo-tile"><img src={logoUrl} alt="" width={22} height={22} /></span>
          <Text fw={700} fz={15} visibleFrom="sm">Winche</Text>
        </UnstyledButton>
        {crumb && <Text c="var(--w-faint)" fz={18} fw={300} aria-hidden>/</Text>}
        {crumb}
      </Group>
      <Group gap={6} wrap="nowrap">
        {user?.serverAdmin && (
          <Button {...to("server")} size="compact-sm" h={32} px={10} variant={inServer ? "light" : "subtle"}
            color={inServer ? "winche" : "gray"} leftSection={<IconServer size={16} stroke={1.8} />} aria-current={inServer ? "page" : undefined}>
            Server
          </Button>
        )}
        <ThemeMenu />
        <AccountMenu />
      </Group>
    </Group>
  );
}

/** Light, dark, or the system's. */
function ThemeMenu() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const Icon = colorScheme === "dark" ? IconMoon : colorScheme === "light" ? IconSun : IconDeviceDesktop;
  return (
    <Menu position="bottom-end" width={160} withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="gray" size={32} aria-label="Theme"><Icon size={18} stroke={1.8} /></ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconSun size={15} />} onClick={() => setColorScheme("light")}>Light</Menu.Item>
        <Menu.Item leftSection={<IconMoon size={15} />} onClick={() => setColorScheme("dark")}>Dark</Menu.Item>
        <Menu.Item leftSection={<IconDeviceDesktop size={15} />} onClick={() => setColorScheme("auto")}>System</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

function AccountMenu() {
  const { state, user } = useSession();
  const caps = state?.capabilities;
  const [profileOpen, setProfileOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [twoFactorOpen, setTwoFactorOpen] = useState(false);
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ");
  const initials = (user?.firstName && user?.lastName ? user.firstName[0] + user.lastName[0] : (user?.email ?? "?").slice(0, 2)).toUpperCase();
  const onLogout = async () => {
    await api.logout();
    window.location.assign(document.baseURI);
  };
  return (
    <>
      <Menu position="bottom-end" width={260} withinPortal>
        <Menu.Target>
          <UnstyledButton aria-label="Your account" className="winche-avatar">{initials}</UnstyledButton>
        </Menu.Target>
        <Menu.Dropdown>
          <Box px="sm" py={8}>
            {name && <Text size="sm" fw={600} truncate>{name}</Text>}
            <Text size="sm" c="var(--w-muted)" truncate>{user?.email}</Text>
            <Text size="xs" c="var(--w-faint)" mt={2}>{user?.serverAdmin ? "Server admin" : user?.role}</Text>
          </Box>
          <Menu.Divider />
          {caps?.editProfile && <Menu.Item leftSection={<IconUserCircle size={15} />} onClick={() => setProfileOpen(true)}>Edit profile</Menu.Item>}
          {caps?.changePassword && <Menu.Item leftSection={<IconKey size={15} />} onClick={() => setPasswordOpen(true)}>Change password</Menu.Item>}
          {caps?.twoFactor && (
            <Menu.Item leftSection={<IconShield size={15} />} onClick={() => setTwoFactorOpen(true)}>
              {user?.twoFactorEnabled ? "Two-step sign-in: on" : "Set up two-step sign-in"}
            </Menu.Item>
          )}
          <Menu.Divider />
          <Menu.Item color="red" leftSection={<IconLogout size={15} />} onClick={onLogout}>Sign out</Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <ProfileModal opened={profileOpen} onClose={() => setProfileOpen(false)} />
      <PasswordModal opened={passwordOpen} onClose={() => setPasswordOpen(false)} />
      <TwoFactorModal opened={twoFactorOpen} onClose={() => setTwoFactorOpen(false)} />
    </>
  );
}

/** A sidebar link; collapsed, just its icon with the name in a tooltip. */
function SideLink({ to, label, icon: Icon, active, collapsed, right, onClick, expanded }: {
  to: string; label: string; icon?: React.ElementType; active: boolean; collapsed: boolean; right?: ReactNode; onClick?: () => void; expanded?: boolean;
}) {
  const link = (
    <UnstyledButton component={Link} to={to} onClick={onClick} className="winche-nav-link" data-active={active || undefined}
      aria-current={active ? "page" : undefined} aria-label={collapsed ? label : undefined} aria-expanded={expanded}
      style={{ justifyContent: collapsed ? "center" : undefined }}>
      {Icon && <Icon size={18} stroke={1.8} style={{ flexShrink: 0 }} />}
      {!collapsed && <span className="winche-nav-label">{label}</span>}
      {!collapsed && right}
    </UnstyledButton>
  );
  return collapsed ? <Tooltip label={label} position="right" withArrow>{link}</Tooltip> : link;
}

function GroupLabel({ children, collapsed }: { children: ReactNode; collapsed: boolean }) {
  return collapsed
    ? <Box my={8} mx={8} style={{ borderTop: "1px solid var(--w-border)" }} />
    : <Text className="winche-nav-group">{children}</Text>;
}

/** A product (or Logs, Project settings) in the sidebar. */
function NavEntry({ item, collapsed, off }: { item: NavItem; collapsed: boolean; off: boolean }) {
  const { pathname } = useLocation();
  const inside = pathname === item.to || pathname.startsWith(item.to + "/");
  // A product's pages are tabs on its page: the sidebar opens its first.
  const first = off ? item.to : item.pages[0]?.to ?? item.to;
  const icon = item.tablerIcon ? (props: { size?: number; stroke?: number; style?: React.CSSProperties }) => <TablerIcon name={item.tablerIcon!} fallback={IconFile} {...props} /> : ICONS[item.icon];
  return <SideLink to={first} label={item.label} icon={icon} active={inside} collapsed={collapsed}
    right={off ? <StatusPill tone="off">Off</StatusPill> : undefined} />;
}

/** The project's console: its products, Logs, and Project settings at the bottom; each product's pages are tabs. */
export function AppLayout() {
  const { items } = useProjectNav();
  const projectState = useQuery({ queryKey: ["project"], queryFn: api.project, staleTime: 30_000 });
  const overview = useQuery({ queryKey: ["overview"], queryFn: api.overview, staleTime: 60_000 });
  const project = overview.data?.project;
  // With project setup: products not started yet carry an "Off" mark.
  const off = (item: NavItem) => {
    const p = projectState.data;
    if (!p?.setup || item.group !== "build") return false;
    return !p.created || p.products.some((x) => x.id === item.to.slice(1) && !x.started);
  };
  const groups: { id: NavItem["group"]; label?: string }[] = [{ id: "top" }, { id: "build", label: "Build" }, { id: "monitor", label: "Monitor" }, { id: "pages", label: "Project pages" }];
  const bottom = items.filter((n) => n.group === "bottom");
  return (
    <Shell
      crumb={<ProjectPicker name={project?.name ?? projectState.data?.name ?? "Project"} id={project?.id ?? projectState.data?.id ?? ""} imageVersion={projectState.data?.imageVersion} />}
      sidebar={(collapsed) => (
        <Stack gap={0} h="100%" justify="space-between">
          <Stack gap={2}>
            {groups.map((g) => {
              const list = items.filter((n) => n.group === g.id);
              if (list.length === 0) return null;
              return (
                <Fragment key={g.id}>
                  {g.label && <GroupLabel collapsed={collapsed}>{g.label}</GroupLabel>}
                  {list.map((n) => <NavEntry key={n.to} item={n} collapsed={collapsed} off={off(n)} />)}
                </Fragment>
              );
            })}
          </Stack>
          <Stack gap={2} pt="sm" mt="sm" style={{ borderTop: "1px solid var(--w-border)" }}>
            {bottom.map((n) => <NavEntry key={n.to} item={n} collapsed={collapsed} off={false} />)}
          </Stack>
        </Stack>
      )}>
      <Outlet />
    </Shell>
  );
}

/**
 * The server's own pages: every project (no sidebar), and, for server admins, the server's settings, laid out like a
 * project's console: a section per sidebar entry (Authentication, Security), its pages as tabs.
 */
export function ServerLayout() {
  const { pathname } = useLocation();
  const inServer = pathname.startsWith("/server");
  const sidebar = inServer
    ? (collapsed: boolean) => (
        <Stack gap={2}>
          {SERVER_SECTIONS.map((s) => (
            <SideLink key={s.id} to={sectionPath(s)} label={s.label} icon={ICONS[s.icon]} collapsed={collapsed}
              active={pathname === `/server/${s.id}` || pathname.startsWith(`/server/${s.id}/`)} />
          ))}
        </Stack>
      )
    : null;
  return (
    <Shell crumb={inServer ? <Text fw={600} fz={14}>Server settings</Text> : null} sidebar={sidebar}>
      <Outlet />
    </Shell>
  );
}

function TwoFactorModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { user, refresh } = useSession();
  const [error, setError] = useState<string | null>(null);
  const disable = async () => {
    setError(null);
    try { await api.twoFactorDisable(); await refresh(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not disable."); }
  };
  return (
    <Modal opened={opened} onClose={onClose} title="Two-factor authentication">
      {user?.twoFactorEnabled ? (
        <Stack>
          <Text size="sm">Two-factor authentication is <b>on</b> for your account.</Text>
          {user.twoFactorRequired
            ? <Text size="sm" c="dimmed">It is required by an administrator and cannot be turned off.</Text>
            : <Button color="red" variant="light" onClick={disable}>Disable two-factor</Button>}
          {error && <Text c="red" size="sm">{error}</Text>}
        </Stack>
      ) : (
        opened ? <TwoFactorSetup onDone={async () => { await refresh(); onClose(); }} /> : null
      )}
    </Modal>
  );
}

function ProfileModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { user, refresh } = useSession();
  const [f, setF] = useState({ firstName: user?.firstName ?? "", lastName: user?.lastName ?? "" });
  const submit = async () => { await api.updateProfile(f); await refresh(); onClose(); };
  return (
    <Modal opened={opened} onClose={onClose} title="Edit profile">
      <Stack>
        <Group grow>
          <TextInput label="First name" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.currentTarget.value })} />
          <TextInput label="Last name" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.currentTarget.value })} />
        </Group>
        <Button onClick={submit}>Save</Button>
      </Stack>
    </Modal>
  );
}

function PasswordModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const [f, setF] = useState({ current: "", next: "" });
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    try { await api.changePassword(f.current, f.next); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed."); }
  };
  return (
    <Modal opened={opened} onClose={onClose} title="Change password">
      <Stack>
        <PasswordInput label="Current password" value={f.current} onChange={(e) => setF({ ...f, current: e.currentTarget.value })} />
        <PasswordInput label="New password" value={f.next} onChange={(e) => setF({ ...f, next: e.currentTarget.value })} />
        {error && <Text c="red" size="sm">{error}</Text>}
        <Button onClick={submit}>Change password</Button>
      </Stack>
    </Modal>
  );
}
