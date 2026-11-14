import React, { Fragment, useState } from "react";
import {
  ActionIcon, AppShell, Box, Button, Group, Menu, Modal, NavLink, PasswordInput, Stack, Text, TextInput,
  Tooltip, UnstyledButton,
} from "@mantine/core";
import {
  IconChevronRight, IconDatabase, IconFolder, IconHome, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand,
  IconLogout, IconShield, IconUserCog, IconListDetails, IconUsers, IconWebhook, IconLambda, IconSettings,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { surface } from "../theme";
import { Link, Outlet, useLocation } from "react-router-dom";
import { api } from "../api/client";
import { useSession } from "../auth/session";
import { keycloakAccountUrl, keycloakLogout } from "../auth/keycloak";
import { TwoFactorSetup } from "../auth/TwoFactorSetup";
import { useTabsManifest, tabIcon } from "../tabs/useTabsManifest";
import { builtinNav } from "./nav";
import logoUrl from "../assets/winche-logo.png";
import { StatusPill } from "../components/PageHeader";

export function AppLayout() {
  const { pathname } = useLocation();
  const { state, user } = useSession();
  const caps = state?.capabilities;
  const isKeycloak = state?.provider === "keycloak";
  const [profileOpen, setProfileOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [twoFactorOpen, setTwoFactorOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const overview = useQuery({ queryKey: ["overview"], queryFn: api.overview, staleTime: 60_000 });
  const project = overview.data?.project;
  const projectState = useQuery({ queryKey: ["project"], queryFn: api.project, staleTime: 30_000 });
  // With project setup: products not started yet carry an "Off" mark.
  const off = (to: string) => {
    const p = projectState.data;
    if (!p?.setup) return false;
    const id = to.slice(1);
    return !p.created || p.products.some((x) => x.id === id && !x.started);
  };
  const iconFor = { database: IconDatabase, folder: IconFolder, shield: IconShield, logs: IconListDetails, users: IconUsers, hooks: IconWebhook, functions: IconLambda };
  const builtins = builtinNav(state, user).map((n) => ({ to: n.to, label: n.label, icon: iconFor[n.icon], group: n.group }));
  const manifest = useTabsManifest();
  const customTabs = (manifest.data?.tabs ?? []).map((t) => ({ to: `/${t.id}`, label: t.label, icon: tabIcon(t.icon), group: "monitor" as const }));
  const groups = [
    { id: "build", label: "Build", items: builtins.filter((n) => n.group === "build") },
    { id: "monitor", label: "Monitor", items: [...builtins.filter((n) => n.group === "monitor"), ...customTabs] },
  ].filter((g) => g.items.length > 0);
  const inSettings = pathname === "/settings" || pathname.startsWith("/settings/");
  const initials = (user?.firstName && user?.lastName ? user.firstName[0] + user.lastName[0] : (user?.email ?? "?").slice(0, 2)).toUpperCase();

  const onLogout = async () => {
    if (isKeycloak) { await keycloakLogout(); return; }
    await api.logout();
    window.location.assign(document.baseURI);
  };

  const link = (to: string, label: string, Icon: React.ElementType, dimmed = false) => {
    const active = pathname === to || pathname.startsWith(to + "/");
    const item = (
      <NavLink component={Link} to={to} active={active}
        aria-current={active ? "page" : undefined}
        label={collapsed ? undefined : label}
        rightSection={!collapsed && dimmed ? <StatusPill tone="off">Off</StatusPill> : undefined}
        aria-label={collapsed ? label : undefined}
        leftSection={<Icon size={18} stroke={1.8} />}
        styles={{
          root: { borderRadius: 8, padding: "8px 10px", justifyContent: collapsed ? "center" : undefined, paddingInline: collapsed ? 0 : undefined },
          label: { fontSize: 14, fontWeight: active ? 600 : 500 },
          body: collapsed ? { display: "none" } : undefined,
          section: collapsed ? { marginInlineEnd: 0 } : undefined,
        }} />
    );
    return collapsed
      ? <Tooltip key={to} label={label} position="right" withArrow>{item}</Tooltip>
      : <Fragment key={to}>{item}</Fragment>;
  };

  // Project settings: a gear beside the project's name, like Firebase's.
  const settingsGear = (
    <Tooltip label="Project settings" position="right" withArrow>
      <ActionIcon component={Link} to="/settings/general" size={34} variant={inSettings ? "light" : "subtle"} color={inSettings ? "winche" : "gray"}
        aria-label="Project settings">
        <IconSettings size={18} stroke={1.8} />
      </ActionIcon>
    </Tooltip>
  );

  return (
    <AppShell
      navbar={{ width: collapsed ? 72 : 256, breakpoint: "xs", collapsed: { mobile: false } }}
      padding={0}
      styles={{ main: { background: surface.page, minHeight: "100vh" } }}
    >
      <AppShell.Navbar p="sm" style={{ background: surface.card, borderRight: `1px solid ${surface.border}` }}>
        {/* Project */}
        <Group justify={collapsed ? "center" : "space-between"} gap={8} px={collapsed ? 0 : 4} pt={4} pb={12} wrap="nowrap">
          <Group gap={10} wrap="nowrap" style={{ minWidth: 0 }}>
            <img src={logoUrl} alt="Winche" width={32} height={32} style={{ borderRadius: 8, display: "block", flexShrink: 0 }} />
            {!collapsed && (
              <div style={{ minWidth: 0 }}>
                <Text fw={600} size="sm" lh={1.2} c={surface.text} truncate>{project?.name ?? "Winche"}</Text>
                <Text size="xs" lh={1.3} c={surface.faint} truncate>{project?.id ?? "Console"}</Text>
              </div>
            )}
          </Group>
          {!collapsed && settingsGear}
        </Group>
        {collapsed && <Group justify="center" mb={6}>{settingsGear}</Group>}

        <Stack gap={2}>
          {link("/overview", "Project overview", IconHome)}
          {groups.map((g) => (
            <Fragment key={g.id}>
              {collapsed
                ? <Box my={8} style={{ borderTop: `1px solid ${surface.subtle}` }} />
                : <Text size="11px" fw={600} c={surface.faint} px={10} pt={16} pb={6} style={{ letterSpacing: "0.06em", textTransform: "uppercase" }}>{g.label}</Text>}
              {g.items.map((n) => link(n.to, n.label, n.icon, n.group === "build" && off(n.to)))}
            </Fragment>
          ))}
        </Stack>

        {/* Account */}
        <Box mt="auto" pt="sm" style={{ borderTop: `1px solid ${surface.subtle}` }}>
          <Group justify={collapsed ? "center" : "space-between"} gap={4} wrap="nowrap">
            <Menu position="top-start" withinPortal width={220}>
              <Menu.Target>
                <UnstyledButton aria-label="Your account" style={{ flex: collapsed ? undefined : 1, borderRadius: 8, padding: 6, minWidth: 0 }}>
                  <Group gap={10} wrap="nowrap">
                    <Box w={32} h={32} style={{ background: "var(--mantine-color-winche-0)", color: "var(--mantine-color-winche-6)", borderRadius: 999, display: "grid", placeItems: "center", flexShrink: 0, fontSize: 12, fontWeight: 600 }}>
                      {initials}
                    </Box>
                    {!collapsed && (
                      <>
                        <div style={{ flex: 1, overflow: "hidden" }}>
                          <Text size="xs" fw={500} c={surface.text} truncate>{user?.email}</Text>
                          <Text size="xs" c={surface.faint}>{user?.role}</Text>
                        </div>
                        <IconChevronRight size={14} color="#98A2B3" />
                      </>
                    )}
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                {caps?.editProfile && <Menu.Item onClick={() => setProfileOpen(true)}>Edit profile</Menu.Item>}
                {caps?.changePassword && <Menu.Item onClick={() => setPasswordOpen(true)}>Change password</Menu.Item>}
                {caps?.twoFactor && (
                  <Menu.Item onClick={() => setTwoFactorOpen(true)}>
                    {user?.twoFactorEnabled ? "Two-step sign-in: on" : "Set up two-step sign-in"}
                  </Menu.Item>
                )}
                {isKeycloak && (
                  <Menu.Item leftSection={<IconUserCog size={15} />}
                    onClick={() => window.open(keycloakAccountUrl(), "_blank", "noopener,noreferrer")}>
                    Manage account
                  </Menu.Item>
                )}
                <Menu.Divider />
                <Menu.Item color="red" leftSection={<IconLogout size={15} />} onClick={onLogout}>Sign out</Menu.Item>
              </Menu.Dropdown>
            </Menu>
            {!collapsed && (
              <Tooltip label="Collapse" position="right" withArrow>
                <ActionIcon variant="subtle" color="gray" onClick={() => setCollapsed(true)} aria-label="Collapse sidebar">
                  <IconLayoutSidebarLeftCollapse size={18} stroke={1.8} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
          {collapsed && (
            <Group justify="center" mt={6}>
              <Tooltip label="Expand" position="right" withArrow>
                <ActionIcon variant="subtle" color="gray" onClick={() => setCollapsed(false)} aria-label="Expand sidebar">
                  <IconLayoutSidebarLeftExpand size={18} stroke={1.8} />
                </ActionIcon>
              </Tooltip>
            </Group>
          )}
        </Box>
      </AppShell.Navbar>

      <AppShell.Main>
        <Box px={{ base: 16, sm: 32 }} py={28} maw={1280} mx="auto">
          <Outlet />
        </Box>
      </AppShell.Main>

      <ProfileModal opened={profileOpen} onClose={() => setProfileOpen(false)} />
      <PasswordModal opened={passwordOpen} onClose={() => setPasswordOpen(false)} />
      <TwoFactorModal opened={twoFactorOpen} onClose={() => setTwoFactorOpen(false)} />
    </AppShell>
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
