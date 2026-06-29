import { useState } from "react";
import {
  ActionIcon, Badge, Box, Button, CopyButton, Group, Menu, Modal, PasswordInput, Select, Stack, Switch,
  Table, Tabs, Text, TextInput, Tooltip,
} from "@mantine/core";
import { IconCheck, IconCopy, IconDots, IconMail, IconPlus, IconShield, IconUsers } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { ConsoleInvite, ConsoleRole, ConsoleUserItem } from "../api/types";
import { useSession } from "../auth/session";
import { ConfirmModal } from "../components/ConfirmModal";
import classes from "./UsersPage.module.css";

const ROLES: ConsoleRole[] = ["Admin", "Member", "Viewer"];

export function UsersPage() {
  return (
    <Stack gap="sm" h="calc(100vh - 4rem)">
      <Group gap={6} c="#5f6368">
        <IconShield size={18} />
        <Text size="sm" fw={500} c="#5f6368">Access</Text>
      </Group>
      <Tabs
        defaultValue="users"
        keepMounted={false}
        color="googleBlue"
        classNames={{ list: classes.list, tab: classes.tab }}
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
      >
        <Tabs.List>
          <Tabs.Tab value="users" leftSection={<IconUsers size={16} stroke={1.7} />}>Users</Tabs.Tab>
          <Tabs.Tab value="invites" leftSection={<IconMail size={16} stroke={1.7} />}>Invites</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="users" pt="md" style={{ flex: 1, minHeight: 0 }}><UsersTab /></Tabs.Panel>
        <Tabs.Panel value="invites" pt="md" style={{ flex: 1, minHeight: 0 }}><InvitesTab /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

function UsersTab() {
  const qc = useQueryClient();
  const { user: me } = useSession();
  const users = useQuery({ queryKey: ["users"], queryFn: () => api.listUsers() });
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState<ConsoleUserItem | null>(null);
  const [resetFor, setResetFor] = useState<ConsoleUserItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ConsoleUserItem | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["users"] });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteUser(id),
    onSuccess: () => { setConfirmDelete(null); invalidate(); },
    onError: (e) => setRemoveError(e instanceof Error ? e.message : "Failed to delete."),
  });
  const unlock = useMutation({ mutationFn: (id: string) => api.unlockUser(id), onSuccess: invalidate });

  return (
    <Stack gap="sm" h="100%">
      <Group justify="flex-end">
        <Button size="xs" leftSection={<IconPlus size={15} />} onClick={() => setCreateOpen(true)}>New user</Button>
      </Group>

      <Box style={{ flex: 1, minHeight: 0, border: "1px solid #e0e0e0", borderRadius: 8, background: "#fff", overflow: "auto" }}>
        <Table verticalSpacing="sm" highlightOnHover>
          <Table.Thead style={{ background: "#fafafa", position: "sticky", top: 0 }}>
            <Table.Tr>
              <Table.Th>Email</Table.Th><Table.Th>Name</Table.Th><Table.Th>Role</Table.Th>
              <Table.Th>Status</Table.Th><Table.Th w={48} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {users.data?.map((u) => (
              <Table.Tr key={u.id}>
                <Table.Td><Text size="sm" ff="monospace">{u.email}</Text></Table.Td>
                <Table.Td><Text size="sm">{[u.firstName, u.lastName].filter(Boolean).join(" ") || "—"}</Text></Table.Td>
                <Table.Td><Badge variant="light" color={u.role === "Admin" ? "blue" : u.role === "Member" ? "teal" : "gray"}>{u.role}</Badge></Table.Td>
                <Table.Td>
                  <Group gap={6}>
                    {!u.active && <Badge color="red" variant="light" size="sm">Disabled</Badge>}
                    {u.lockedOut && <Badge color="orange" variant="light" size="sm">Locked</Badge>}
                    {u.active && !u.lockedOut && <Badge color="green" variant="light" size="sm">Active</Badge>}
                    {u.twoFactorEnabled && <Badge color="blue" variant="light" size="sm">2FA</Badge>}
                    {u.twoFactorRequired && !u.twoFactorEnabled && <Badge color="yellow" variant="light" size="sm">2FA required</Badge>}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Menu position="bottom-end" withinPortal>
                    <Menu.Target><ActionIcon variant="subtle" color="gray" aria-label="User menu"><IconDots size={18} /></ActionIcon></Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item onClick={() => setEdit(u)}>Edit</Menu.Item>
                      <Menu.Item onClick={() => setResetFor(u)}>Reset password</Menu.Item>
                      {u.lockedOut && <Menu.Item onClick={() => unlock.mutate(u.id)}>Unlock</Menu.Item>}
                      {u.id !== me?.id && (
                        <Menu.Item color="red" onClick={() => { setRemoveError(null); setConfirmDelete(u); }}>Delete</Menu.Item>
                      )}
                    </Menu.Dropdown>
                  </Menu>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Box>

      <CreateUserModal opened={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); invalidate(); }} />
      {edit && <EditUserModal user={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); invalidate(); }} />}
      {resetFor && <ResetPasswordModal user={resetFor} onClose={() => setResetFor(null)} />}
      <ConfirmModal
        opened={!!confirmDelete}
        title="Delete user"
        message={confirmDelete
          ? `Delete ${confirmDelete.email}? This permanently removes the account and cannot be undone.`
          : ""}
        confirmLabel="Delete"
        loading={remove.isPending}
        error={removeError}
        onConfirm={() => confirmDelete && remove.mutate(confirmDelete.id)}
        onCancel={() => { setConfirmDelete(null); setRemoveError(null); }}
      />
    </Stack>
  );
}

function CreateUserModal({ opened, onClose, onSaved }: { opened: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ email: "", firstName: "", lastName: "", role: "Viewer" as ConsoleRole, password: "" });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.createUser(f),
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof Error ? e.message : "Failed."),
  });
  return (
    <Modal opened={opened} onClose={onClose} title="New user">
      <Stack>
        <TextInput label="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.currentTarget.value })} />
        <Group grow>
          <TextInput label="First name" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.currentTarget.value })} />
          <TextInput label="Last name" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.currentTarget.value })} />
        </Group>
        <Select label="Role" data={ROLES} value={f.role} onChange={(v) => setF({ ...f, role: (v as ConsoleRole) ?? "Viewer" })} />
        <PasswordInput label="Password" value={f.password} onChange={(e) => setF({ ...f, password: e.currentTarget.value })} />
        {error && <Text c="red" size="sm">{error}</Text>}
        <Button onClick={() => { setError(null); save.mutate(); }} loading={save.isPending}>Create</Button>
      </Stack>
    </Modal>
  );
}

function EditUserModal({ user, onClose, onSaved }: { user: ConsoleUserItem; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    firstName: user.firstName ?? "", lastName: user.lastName ?? "", email: user.email,
    role: user.role, active: user.active, twoFactorRequired: user.twoFactorRequired,
  });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.updateUser(user.id, f),
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof Error ? e.message : "Failed."),
  });
  return (
    <Modal opened onClose={onClose} title={`Edit ${user.email}`}>
      <Stack>
        <Group grow>
          <TextInput label="First name" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.currentTarget.value })} />
          <TextInput label="Last name" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.currentTarget.value })} />
        </Group>
        <TextInput label="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.currentTarget.value })} />
        <Select label="Role" data={ROLES} value={f.role} onChange={(v) => setF({ ...f, role: (v as ConsoleRole) ?? f.role })} />
        <Switch label="Active" checked={f.active} onChange={(e) => setF({ ...f, active: e.currentTarget.checked })} />
        <Switch label="Require two-factor" checked={f.twoFactorRequired} onChange={(e) => setF({ ...f, twoFactorRequired: e.currentTarget.checked })} />
        {error && <Text c="red" size="sm">{error}</Text>}
        <Button onClick={() => { setError(null); save.mutate(); }} loading={save.isPending}>Save</Button>
      </Stack>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: { user: ConsoleUserItem; onClose: () => void }) {
  const [pwd, setPwd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.resetUserPassword(user.id, pwd),
    onSuccess: onClose,
    onError: (e) => setError(e instanceof Error ? e.message : "Failed."),
  });
  return (
    <Modal opened onClose={onClose} title={`Reset password — ${user.email}`}>
      <Stack>
        <PasswordInput label="New password" value={pwd} onChange={(e) => setPwd(e.currentTarget.value)} />
        {error && <Text c="red" size="sm">{error}</Text>}
        <Button onClick={() => { setError(null); save.mutate(); }} loading={save.isPending}>Set password</Button>
      </Stack>
    </Modal>
  );
}

const EXPIRY_OPTIONS = [
  { value: "24", label: "24 hours" },
  { value: "72", label: "3 days" },
  { value: "168", label: "7 days" },
];

function statusColor(s: ConsoleInvite["status"]) {
  return s === "pending" ? "blue" : s === "expired" ? "gray" : "red";
}

function InvitesTab() {
  const qc = useQueryClient();
  const invites = useQuery({ queryKey: ["invites"], queryFn: () => api.listInvites() });
  const [createOpen, setCreateOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["invites"] });

  const revoke = useMutation({ mutationFn: (id: string) => api.revokeInvite(id), onSuccess: invalidate });
  const resend = useMutation({ mutationFn: (id: string) => api.resendInvite(id), onSuccess: invalidate });
  const copyLink = useMutation({
    mutationFn: (id: string) => api.inviteLink(id),
    onSuccess: async (r) => {
      await navigator.clipboard.writeText(r.link);
      setCopied("Link copied.");
      setTimeout(() => setCopied(null), 3000);
    },
  });

  return (
    <Stack gap="sm" h="100%">
      <Group justify="flex-end">
        {copied && <Text size="xs" c="green">{copied}</Text>}
        <Button size="xs" leftSection={<IconPlus size={15} />} onClick={() => setCreateOpen(true)}>Invite</Button>
      </Group>

      <Box style={{ flex: 1, minHeight: 0, border: "1px solid #e0e0e0", borderRadius: 8, background: "#fff", overflow: "auto" }}>
        <Table verticalSpacing="sm" highlightOnHover>
          <Table.Thead style={{ background: "#fafafa", position: "sticky", top: 0 }}>
            <Table.Tr>
              <Table.Th>Email</Table.Th><Table.Th>Role</Table.Th><Table.Th>Requires</Table.Th>
              <Table.Th>Status</Table.Th><Table.Th>Expires</Table.Th><Table.Th w={48} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {invites.data?.map((i) => (
              <Table.Tr key={i.id}>
                <Table.Td><Text size="sm" ff="monospace">{i.email}</Text></Table.Td>
                <Table.Td><Badge variant="light" color={i.role === "Admin" ? "blue" : i.role === "Member" ? "teal" : "gray"}>{i.role}</Badge></Table.Td>
                <Table.Td>
                  <Group gap={6}>
                    {i.requireName && <Badge color="grape" variant="light" size="sm">Name</Badge>}
                    {i.requireTwoFactor && <Badge color="yellow" variant="light" size="sm">2FA</Badge>}
                    {!i.requireName && !i.requireTwoFactor && <Text size="sm" c="dimmed">—</Text>}
                  </Group>
                </Table.Td>
                <Table.Td><Badge color={statusColor(i.status)} variant="light" size="sm">{i.status}</Badge></Table.Td>
                <Table.Td><Text size="sm" c="dimmed">{new Date(i.expiresAt).toLocaleString()}</Text></Table.Td>
                <Table.Td>
                  <Menu position="bottom-end" withinPortal>
                    <Menu.Target><ActionIcon variant="subtle" color="gray" aria-label="Invite menu"><IconDots size={18} /></ActionIcon></Menu.Target>
                    <Menu.Dropdown>
                      {i.status === "pending" && <Menu.Item leftSection={<IconCopy size={15} />} onClick={() => copyLink.mutate(i.id)}>Copy link</Menu.Item>}
                      <Menu.Item leftSection={<IconMail size={15} />} onClick={() => resend.mutate(i.id)}>Resend email</Menu.Item>
                      {i.status !== "revoked" && <Menu.Item color="red" onClick={() => revoke.mutate(i.id)}>Revoke</Menu.Item>}
                    </Menu.Dropdown>
                  </Menu>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Box>

      <CreateInviteModal opened={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => invalidate()} />
    </Stack>
  );
}

function CreateInviteModal({ opened, onClose, onSaved }: { opened: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    email: "", firstName: "", lastName: "", role: "Viewer" as ConsoleRole,
    requireName: false, requireTwoFactor: false, expiresInHours: "72",
  });
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => api.createInvite({
      email: f.email, firstName: f.firstName || undefined, lastName: f.lastName || undefined,
      role: f.role, requireName: f.requireName, requireTwoFactor: f.requireTwoFactor,
      expiresInHours: Number(f.expiresInHours),
    }),
    onSuccess: (r) => { setLink(r.link); onSaved(); },
    onError: (e) => setError(e instanceof Error ? e.message : "Failed."),
  });

  const close = () => { setLink(null); setError(null); setF({ ...f, email: "", firstName: "", lastName: "" }); onClose(); };

  return (
    <Modal opened={opened} onClose={close} title="Invite a user">
      <Stack>
        {link ? (
          <>
            <Text size="sm">Email sent to {f.email}. You can also share this link:</Text>
            <TextInput readOnly value={link} rightSection={
              <CopyButton value={link}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? "Copied" : "Copy"}>
                    <ActionIcon variant="subtle" color={copied ? "green" : "gray"} onClick={copy} aria-label="Copy link">
                      {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            } />
            <Button onClick={close}>Done</Button>
          </>
        ) : (
          <>
            <TextInput label="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.currentTarget.value })} />
            <Group grow>
              <TextInput label="First name" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.currentTarget.value })} />
              <TextInput label="Last name" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.currentTarget.value })} />
            </Group>
            <Select label="Role" data={ROLES} value={f.role} onChange={(v) => setF({ ...f, role: (v as ConsoleRole) ?? "Viewer" })} />
            <Select label="Link expires in" data={EXPIRY_OPTIONS} value={f.expiresInHours}
              onChange={(v) => setF({ ...f, expiresInHours: v ?? "72" })} />
            <Switch label="Require first and last name" checked={f.requireName}
              onChange={(e) => setF({ ...f, requireName: e.currentTarget.checked })} />
            <Switch label="Require two-factor authentication" checked={f.requireTwoFactor}
              onChange={(e) => setF({ ...f, requireTwoFactor: e.currentTarget.checked })} />
            {error && <Text c="red" size="sm">{error}</Text>}
            <Button onClick={() => { setError(null); save.mutate(); }} loading={save.isPending}>Send invite</Button>
          </>
        )}
      </Stack>
    </Modal>
  );
}
