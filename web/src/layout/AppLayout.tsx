import { Fragment, useState } from "react";
import {
  ActionIcon, AppShell, Box, Button, Group, Menu, Modal, NavLink, PasswordInput, Stack, Text, TextInput,
  Tooltip, UnstyledButton,
} from "@mantine/core";
import {
  IconChevronRight, IconDatabase, IconFolder, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand,
  IconLogout, IconShield, IconUser,
} from "@tabler/icons-react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { api } from "../api/client";
import { useSession } from "../auth/session";
import { TwoFactorSetup } from "../auth/TwoFactorSetup";
import logoUrl from "../assets/winche-logo.png";

const NAV = [
  { to: "/data", label: "Database", icon: IconDatabase, adminOnly: false },
  { to: "/storage", label: "Storage", icon: IconFolder, adminOnly: false },
  { to: "/users", label: "Access", icon: IconShield, adminOnly: true },
];

export function AppLayout() {
  const { pathname } = useLocation();
  const { user, refresh } = useSession();
  const [profileOpen, setProfileOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [twoFactorOpen, setTwoFactorOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const nav = NAV.filter((n) => !n.adminOnly || user?.role === "Admin");

  return (
    <AppShell
      navbar={{ width: collapsed ? 72 : 248, breakpoint: "xs", collapsed: { mobile: false } }}
      padding="xl"
      styles={{ main: { background: "#f6f8fb", minHeight: "100vh" } }}
    >
      <AppShell.Navbar p="sm" style={{ background: "#fff", borderRight: "1px solid #e8eaed" }}>
        {/* Brand */}
        <Group justify={collapsed ? "center" : "space-between"} gap={collapsed ? 0 : 11}
          px={collapsed ? 0 : "xs"} py="sm" mb={4} wrap="nowrap">
          <Group gap={11} wrap="nowrap">
            <img src={logoUrl} alt="Winche" width={34} height={34} style={{ borderRadius: 8, display: "block" }} />
            {!collapsed && (
              <div>
                <Text fw={600} size="sm" lh={1.15} c="#202124">Winche</Text>
                <Text size="xs" c="dimmed" lh={1.15}>Console</Text>
              </div>
            )}
          </Group>
          {!collapsed && (
            <Tooltip label="Collapse" position="right" withArrow>
              <ActionIcon variant="subtle" color="gray" onClick={() => setCollapsed(true)} aria-label="Collapse sidebar">
                <IconLayoutSidebarLeftCollapse size={19} stroke={1.7} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>

        {collapsed && (
          <Group justify="center" mb={4}>
            <Tooltip label="Expand" position="right" withArrow>
              <ActionIcon variant="subtle" color="gray" onClick={() => setCollapsed(false)} aria-label="Expand sidebar">
                <IconLayoutSidebarLeftExpand size={19} stroke={1.7} />
              </ActionIcon>
            </Tooltip>
          </Group>
        )}

        {/* Nav */}
        <Stack gap={4} mt="xs">
          {nav.map(({ to, label, icon: Icon }) => {
            const active = pathname === to || pathname.startsWith(to + "/");
            const link = (
              <NavLink component={Link} to={to} active={active}
                label={collapsed ? undefined : label}
                leftSection={<Icon size={19} stroke={1.7} />}
                styles={{
                  root: { borderRadius: 8, justifyContent: collapsed ? "center" : undefined, paddingInline: collapsed ? 0 : undefined },
                  label: { fontSize: 14, fontWeight: 500 },
                  body: collapsed ? { display: "none" } : undefined,
                  section: collapsed ? { marginInlineEnd: 0 } : undefined,
                }} />
            );
            return collapsed
              ? <Tooltip key={to} label={label} position="right" withArrow>{link}</Tooltip>
              : <Fragment key={to}>{link}</Fragment>;
          })}
        </Stack>

        {/* Account menu */}
        <Box mt="auto" pt="sm" style={{ borderTop: "1px solid #eef0f3" }}>
          <Menu position="top-start" withinPortal width={210}>
            <Menu.Target>
              <UnstyledButton style={{ width: "100%", borderRadius: 8, padding: 8 }}>
                <Group gap={8} wrap="nowrap" justify={collapsed ? "center" : undefined}>
                  <Box w={30} h={30} style={{ background: "#e8f0fe", borderRadius: 999, display: "grid", placeItems: "center", flexShrink: 0 }}>
                    <IconUser size={16} color="#1a73e8" />
                  </Box>
                  {!collapsed && (
                    <>
                      <div style={{ flex: 1, overflow: "hidden" }}>
                        <Text size="xs" fw={500} c="#3c4043" truncate>{user?.email}</Text>
                        <Text size="xs" c="dimmed">{user?.role}</Text>
                      </div>
                      <IconChevronRight size={14} color="#9aa0a6" />
                    </>
                  )}
                </Group>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={() => setProfileOpen(true)}>Edit profile</Menu.Item>
              <Menu.Item onClick={() => setPasswordOpen(true)}>Change password</Menu.Item>
              <Menu.Item onClick={() => setTwoFactorOpen(true)}>
                {user?.twoFactorEnabled ? "Two-factor: on" : "Set up two-factor"}
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item color="red" leftSection={<IconLogout size={15} />}
                onClick={async () => { await api.logout(); await refresh(); }}>Sign out</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Box>
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
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
