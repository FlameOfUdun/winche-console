import { useState, type ReactNode } from "react";
import { Alert, Button, Drawer, Group, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconHistory, IconPencil } from "@tabler/icons-react";
import { errorWithList } from "../api/appAuth";

/** One value on a settings card: its name (and a line under it), and what it is now. */
export interface ViewRow { label: ReactNode; value: ReactNode; hint?: ReactNode; testId?: string }

/** A card's label/value rows, divided by hairlines. */
export function ViewRows({ rows }: { rows: ViewRow[] }) {
  return (
    <div>
      {rows.map((r, i) => (
        <div key={i} className="winche-view-row" data-testid={r.testId}>
          <div style={{ minWidth: 0 }}>
            <Text size="sm" fw={500}>{r.label}</Text>
            {r.hint && <Text size="xs" c="var(--w-faint)" mt={2}>{r.hint}</Text>}
          </div>
          <div style={{ minWidth: 0, fontSize: 14, overflowWrap: "anywhere" }}>{r.value}</div>
        </div>
      ))}
    </div>
  );
}

/** A form row while editing: the name and a line on the left, the control on the right. */
export function EditRow({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="winche-view-row">
      <div style={{ minWidth: 0 }}>
        <Text size="sm" fw={500}>{label}</Text>
        {hint && <Text size="xs" c="var(--w-faint)" mt={2}>{hint}</Text>}
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

/**
 * A settings card: what's set now as rows, and Edit, which turns the card into its form with a reason
 * and Save. One card is edited at a time per page (the caller keeps which); Save gets the reason and throws to show
 * an error.
 */
export function EditCard({ title, description, rows, form, editing, onEdit, onCancel, onSave, editable = true, actions, children, testId, danger }: {
  title: ReactNode;
  description?: ReactNode;
  rows?: ViewRow[];
  /** The form shown while editing; none: the card can't be edited here. */
  form?: ReactNode;
  editing?: boolean;
  onEdit?: () => void;
  onCancel?: () => void;
  onSave?: (reason: string) => Promise<unknown>;
  editable?: boolean;
  /** More buttons beside Edit (Send a test, Rotate now…). */
  actions?: ReactNode;
  /** Shown under the rows (tables, notes). */
  children?: ReactNode;
  testId?: string;
  danger?: boolean;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!onSave) return;
    setBusy(true); setError(null);
    try { await onSave(reason.trim()); setReason(""); }
    catch (e) { setError(errorWithList(e)); }
    finally { setBusy(false); }
  };
  const cancel = () => { setReason(""); setError(null); onCancel?.(); };
  return (
    <Paper withBorder radius="lg" style={{ overflow: "hidden", borderColor: danger ? "var(--w-pill-danger-bd)" : undefined }} data-testid={testId}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md" px={24} py={18}>
        <div style={{ minWidth: 0 }}>
          <Title order={2} fz={16} fw={600} c={danger ? "var(--w-pill-danger-fg)" : undefined}>{title}</Title>
          {description && <Text size="sm" c="var(--w-faint)" mt={4}>{description}</Text>}
        </div>
        {!editing && (
          <Group gap={4} wrap="nowrap">
            {actions}
            {form !== undefined && editable && onEdit && (
              <Button variant="subtle" size="sm" leftSection={<IconPencil size={15} />} onClick={onEdit}>Edit</Button>
            )}
          </Group>
        )}
      </Group>
      {editing ? (
        <>
          {form}
          <div className="winche-edit-footer">
            {error && <Alert color="red" p="xs" mb="xs" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
            <Group gap="xs" wrap="wrap">
              <TextInput placeholder="Why are you making this change?" aria-label="Reason for the change" style={{ flex: "1 1 260px" }}
                value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
              <Button variant="default" onClick={cancel} disabled={busy}>Cancel</Button>
              <Button onClick={save} loading={busy} disabled={!reason.trim()}>Save</Button>
            </Group>
          </div>
        </>
      ) : rows && rows.length > 0 && <ViewRows rows={rows} />}
      {!editing && children}
    </Paper>
  );
}

/** A page of settings cards, the content's full width, with the line on how saves work and Change history. */
export function CardsPage({ intro, history, children }: { intro?: ReactNode; history?: ReactNode; children: ReactNode }) {
  return (
    <Stack gap={20} pb={40}>
      {(intro || history) && (
        <Group justify="space-between" align="center" gap="md" wrap="wrap">
          <Text size="sm" c="var(--w-muted)" maw={620}>{intro}</Text>
          {history}
        </Group>
      )}
      {children}
    </Stack>
  );
}

/** "On" / "Off" for a view row. */
export function OnOff({ on, onLabel = "On", offLabel = "Off" }: { on: boolean; onLabel?: string; offLabel?: string }) {
  return <span className="winche-onoff" data-on={on || undefined}>{on ? onLabel : offLabel}</span>;
}

/** Change history, opened from the page's button in a panel on the right. */
export function HistoryButton({ title = "Change history", subtitle, children }: { title?: string; subtitle?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="default" leftSection={<IconHistory size={16} />} onClick={() => setOpen(true)}>Change history</Button>
      <Drawer opened={open} onClose={() => setOpen(false)} position="right" size={480} padding="lg"
        title={<div><Text fw={600} fz={18}>{title}</Text>{subtitle && <Text size="sm" c="var(--w-faint)">{subtitle}</Text>}</div>}>
        {open && children}
      </Drawer>
    </>
  );
}
