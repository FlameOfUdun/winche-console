import { useState } from "react";
import {
  AppShell, Box, Button, Group, Menu, Modal, NavLink, PasswordInput, Stack, Text, TextInput, UnstyledButton,
} from "@mantine/core";
import {
  IconChevronRight, IconDatabase, IconFolder, IconLogout, IconUser, IconUsers,
} from "@tabler/icons-react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { api } from "../api/client";
import { useSession } from "../auth/session";
import { TwoFactorSetup } from "../auth/TwoFactorSetup";

const NAV = [
  { to: "/data", label: "Data", icon: IconDatabase, adminOnly: false },
  { to: "/storage", label: "Storage", icon: IconFolder, adminOnly: false },
  { to: "/users", label: "Users", icon: IconUsers, adminOnly: true },
];

export function AppLayout() {
  const { pathname } = useLocation();
  const { user, refresh } = useSession();
  const [profileOpen, setProfileOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [twoFactorOpen, setTwoFactorOpen] = useState(false);
  const nav = NAV.filter((n) => !n.adminOnly || user?.role === "Admin");

  return (
    <AppShell
      navbar={{ width: 248, breakpoint: "xs", collapsed: { mobile: false } }}
      padding="xl"
      styles={{ main: { background: "#f6f8fb", minHeight: "100vh" } }}
    >
      <AppShell.Navbar p="sm" style={{ background: "#fff", borderRight: "1px solid #e8eaed" }}>
        {/* Brand */}
        <Group gap={11} px="xs" py="sm" mb="xs">
          <Box w={34} h={34} style={{
            background: "linear-gradient(135deg, #4285f4, #1a73e8)", borderRadius: 9,
            display: "grid", placeItems: "center", boxShadow: "0 2px 6px rgba(26,115,232,0.35)",
          }}>
            <Text fw={700} c="white">W</Text>
          </Box>
          <div>
            <Text fw={600} size="sm" lh={1.15} c="#202124">Winche</Text>
            <Text size="xs" c="dimmed" lh={1.15}>Console</Text>
          </div>
        </Group>

        {/* Nav */}
        <Stack gap={4} mt="xs">
          {nav.map(({ to, label, icon: Icon }) => {
            const active = pathname === to || pathname.startsWith(to + "/");
            return (
              <NavLink key={to} component={Link} to={to} label={label} active={active}
                leftSection={<Icon size={19} stroke={1.7} />}
                styles={{ root: { borderRadius: 8 }, label: { fontSize: 14, fontWeight: 500 } }} />
            );
          })}
        </Stack>

        {/* Account menu */}
        <Box mt="auto" pt="sm" style={{ borderTop: "1px solid #eef0f3" }}>
          <Menu position="top-start" withinPortal width={210}>
            <Menu.Target>
              <UnstyledButton style={{ width: "100%", borderRadius: 8, padding: 8 }}>
                <Group gap={8} wrap="nowrap">
                  <Box w={30} h={30} style={{ background: "#e8f0fe", borderRadius: 999, display: "grid", placeItems: "center", flexShrink: 0 }}>
                    <IconUser size={16} color="#1a73e8" />
                  </Box>
                  <div style={{ flex: 1, overflow: "hidden" }}>
                    <Text size="xs" fw={500} c="#3c4043" truncate>{user?.email}</Text>
                    <Text size="xs" c="dimmed">{user?.role}</Text>
                  </div>
                  <IconChevronRight size={14} color="#9aa0a6" />
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
