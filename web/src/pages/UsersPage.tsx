import { useState } from "react";
import {
  ActionIcon, Badge, Button, Group, Menu, Modal, PasswordInput, Select, Stack, Switch,
  Table, Text, TextInput, Title,
} from "@mantine/core";
import { IconDots, IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { ConsoleRole, ConsoleUserItem } from "../api/types";

const ROLES: ConsoleRole[] = ["Admin", "Member", "Viewer"];

export function UsersPage() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: () => api.listUsers() });
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState<ConsoleUserItem | null>(null);
  const [resetFor, setResetFor] = useState<ConsoleUserItem | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["users"] });

  const remove = useMutation({ mutationFn: (id: string) => api.deleteUser(id), onSuccess: invalidate });
  const unlock = useMutation({ mutationFn: (id: string) => api.unlockUser(id), onSuccess: invalidate });

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Title order={2} fw={600} c="#202124">Users</Title>
          <Text c="dimmed" size="sm" mt={2}>Console accounts and their roles.</Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>New user</Button>
      </Group>

      <Table.ScrollContainer minWidth={680}>
        <Table verticalSpacing="sm" highlightOnHover withTableBorder>
          <Table.Thead>
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
                    {u.twoFactorEnabled && <Badge color="green" variant="light" size="sm">2FA</Badge>}
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
                      <Menu.Item color="red" onClick={() => remove.mutate(u.id)}>Delete</Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <CreateUserModal opened={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); invalidate(); }} />
      {edit && <EditUserModal user={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); invalidate(); }} />}
      {resetFor && <ResetPasswordModal user={resetFor} onClose={() => setResetFor(null)} />}
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
