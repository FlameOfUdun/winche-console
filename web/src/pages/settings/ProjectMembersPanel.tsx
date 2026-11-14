import { useState } from "react";
import { ActionIcon, Alert, Badge, Button, CopyButton, Group, Loader, Modal, Paper, Select, Stack, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { IconCheck, IconCopy, IconTrash, IconUserPlus, IconUsers } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import type { ConsoleRole } from "../../api/types";
import { EmptyState } from "../../components/EmptyState";
import { useSession } from "../../auth/session";
import { surface } from "../../theme";

const ROLES: { value: ConsoleRole; label: string }[] = [
  { value: "Admin", label: "Admin" }, { value: "Member", label: "Member" }, { value: "Viewer", label: "Viewer" },
];
const nameOf = (p: { email: string; firstName: string | null; lastName: string | null }) =>
  [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email;

/** Project settings → Members, for a project with its own member list: who's in it and as what. */
export function ProjectMembersPanel() {
  const qc = useQueryClient();
  const { user } = useSession();
  const data = useQuery({ queryKey: ["members"], queryFn: api.members });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<{ userId: string; name: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["members"] });
  const members = data.data?.members ?? [];

  return (
    <Stack gap="lg">
      <Paper withBorder p="lg">
        <Group justify="space-between" mb="md">
          <div>
            <Title order={2} fz={16}>Members</Title>
            <Text size="sm" c="dimmed" mt={2}>Who can use this project's console, and with which role.</Text>
          </div>
          {members.length > 0 && <Button leftSection={<IconUserPlus size={16} />} onClick={() => setAdding(true)}>Add member</Button>}
        </Group>
        {data.isLoading && <Loader size="sm" />}
        {data.data && members.length === 0 && (
          <EmptyState icon={IconUsers} title="No members yet" description="Server admins can use every project. Add the people who should use this one."
            action={<Button leftSection={<IconUserPlus size={16} />} onClick={() => setAdding(true)}>Add member</Button>} />
        )}
        {members.map((m) => (
          <Group key={m.userId} justify="space-between" wrap="nowrap" py={10} style={{ borderTop: `1px solid ${surface.subtle}` }} data-testid="member">
            <div style={{ minWidth: 0 }}>
              <Group gap={8}>
                <Text fw={500} truncate>{nameOf(m)}</Text>
                {!m.passwordSet && <Badge size="sm" variant="light" color="yellow" tt="none">Hasn't set a password</Badge>}
              </Group>
              {nameOf(m) !== m.email && <Text size="xs" c={surface.muted}>{m.email}</Text>}
            </div>
            <Group gap={6} wrap="nowrap">
              <Select size="xs" w={120} data={ROLES} value={m.role} allowDeselect={false} aria-label={`Role of ${m.email}`}
                onChange={async (v) => { if (v) { await api.setMemberRole(m.userId, v as ConsoleRole); await refresh(); } }} />
              <Tooltip label="Remove from the project" withArrow>
                <ActionIcon variant="subtle" color="gray" aria-label={`Remove ${m.email}`} onClick={() => setRemoving({ userId: m.userId, name: nameOf(m) })}>
                  <IconTrash size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
        ))}
      </Paper>

      {data.data && data.data.serverAdmins.length > 0 && (
        <Paper withBorder p="lg">
          <Title order={2} fz={16}>Server admins</Title>
          <Text size="sm" c="dimmed" mt={2} mb="sm">Admins of every project on this server, and the ones who create projects.</Text>
          {data.data.serverAdmins.map((a) => (
            <Group key={a.userId} justify="space-between" py={8} style={{ borderTop: `1px solid ${surface.subtle}` }}>
              <div>
                <Text fw={500}>{nameOf(a)}{a.userId === user?.id ? " (you)" : ""}</Text>
                <Text size="xs" c={surface.muted}>{a.email}</Text>
              </div>
              <Badge variant="light" tt="none">Admin</Badge>
            </Group>
          ))}
        </Paper>
      )}

      <AddMemberDialog opened={adding} onClose={() => setAdding(false)} onAdded={refresh} />
      <Modal opened={!!removing} onClose={() => setRemoving(null)} radius="lg" title={<Text fw={700} fz={18}>Remove {removing?.name}?</Text>}>
        <Stack gap="md">
          <Text size="sm" c={surface.muted}>They lose access to this project. Their account and other projects aren't touched.</Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setRemoving(null)}>Cancel</Button>
            <Button color="red" onClick={async () => { if (removing) await api.removeMember(removing.userId); setRemoving(null); await refresh(); }}>Remove</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

function AddMemberDialog({ opened, onClose, onAdded }: { opened: boolean; onClose: () => void; onAdded: () => Promise<unknown> }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ConsoleRole>("Member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ link: string | null; emailed: boolean; newAccount: boolean } | null>(null);
  const close = () => { setEmail(""); setRole("Member"); setError(null); setDone(null); onClose(); };
  const add = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.addMember(email.trim(), role);
      await onAdded();
      if (!r.newAccount) { close(); return; }
      setDone(r);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened={opened} onClose={close} radius="lg" title={<Text fw={700} fz={18}>Add a member</Text>}>
      {!done ? (
        <Stack gap="md">
          <TextInput label="Email" placeholder="ann@example.com" data-autofocus value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
          <Select label="Role" data={ROLES} value={role} allowDeselect={false} onChange={(v) => v && setRole(v as ConsoleRole)} />
          <Text size="sm" c={surface.muted}>Someone without an account gets one, with access to this project only, and a link to set their password.</Text>
          {error && <Alert color="red" p="xs">{error}</Alert>}
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={close}>Cancel</Button>
            <Button onClick={add} loading={busy} disabled={!email.includes("@")}>Add member</Button>
          </Group>
        </Stack>
      ) : (
        <Stack gap="md">
          {done.emailed ? (
            <Text size="sm">We emailed {email.trim()} a link to set their password.</Text>
          ) : (
            <>
              <Text size="sm">Email isn't set up, so send {email.trim()} this link to set their password:</Text>
              <Group gap={4} wrap="nowrap" style={{ background: surface.subtle, borderRadius: 8, padding: "6px 6px 6px 12px" }}>
                <Text size="xs" ff="monospace" style={{ flex: 1, minWidth: 0, overflowX: "auto", whiteSpace: "nowrap" }} data-testid="member-link">{done.link}</Text>
                <CopyButton value={done.link ?? ""}>
                  {({ copied, copy }) => (
                    <ActionIcon variant="subtle" color={copied ? "teal" : "gray"} onClick={copy} aria-label="Copy link">
                      {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                    </ActionIcon>
                  )}
                </CopyButton>
              </Group>
            </>
          )}
          <Group justify="flex-end"><Button onClick={close}>Done</Button></Group>
        </Stack>
      )}
    </Modal>
  );
}
