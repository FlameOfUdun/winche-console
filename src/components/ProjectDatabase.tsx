import { useState } from "react";
import { FieldRow } from "./FieldRow";
import { Alert, NumberInput, PasswordInput, SegmentedControl, Select, Stack, Text, TextInput } from "@mantine/core";
import type { DataMoveCheck, DataMoveTarget } from "../api/dataLocation";
import { surface } from "../theme";

const NO_DB = { host: "", port: 5432, username: "", password: "", sslMode: "Require", database: "" };

/**
 * A new project's database, chosen as the project is made: one of its own on this server's PostgreSQL (never the
 * server's own database), or on another PostgreSQL server. Its data (documents, users, files' records, hooks, logs) all
 * goes there.
 */
export function useProjectDatabase() {
  const [where, setWhereState] = useState<"here" | "elsewhere">("here");
  const [db, setDb] = useState(NO_DB);
  const [check, setCheck] = useState<DataMoveCheck | null>(null);
  const setWhere = (w: "here" | "elsewhere") => { setWhereState(w); setCheck(null); };
  const set = (patch: Partial<typeof NO_DB>) => { setDb({ ...db, ...patch }); setCheck(null); };
  const target = (): DataMoveTarget | null => (where === "elsewhere"
    ? { host: db.host.trim(), port: db.port, username: db.username.trim() || null, password: db.password || null, sslMode: db.sslMode, database: db.database.trim() }
    : null);
  const reset = () => { setWhereState("here"); setDb(NO_DB); setCheck(null); };
  return { where, setWhere, db, set, check, setCheck, target, reset, ready: where === "here" || !!db.host.trim() };
}

export type ProjectDatabaseState = ReturnType<typeof useProjectDatabase>;

export function ProjectDatabaseFields({ state: s }: { state: ProjectDatabaseState }) {
  const mono = { input: { fontFamily: "var(--mantine-font-family-monospace)" } };
  return (
    <>
      <Stack gap={6}>
        <Text size="sm" fw={500}>Its database</Text>
        <SegmentedControl fullWidth value={s.where} onChange={(v) => s.setWhere(v as typeof s.where)}
          data={[{ value: "here", label: "This server's PostgreSQL" }, { value: "elsewhere", label: "Another PostgreSQL server" }]} />
        {s.where === "here" && <Text size="xs" c={surface.muted}>A database of its own, next to the server's.</Text>}
      </Stack>
      {s.where === "elsewhere" && (
        <>
          <FieldRow>
            <TextInput label="Host" placeholder="db.example.com" styles={mono} value={s.db.host} onChange={(e) => s.set({ host: e.currentTarget.value })} />
            <NumberInput label="Port" styles={mono} min={1} max={65535} value={s.db.port} onChange={(v) => s.set({ port: Number(v) || 5432 })} />
          </FieldRow>
          <FieldRow>
            <TextInput label="User" styles={mono} value={s.db.username} onChange={(e) => s.set({ username: e.currentTarget.value })} />
            <PasswordInput label="Password" autoComplete="new-password" value={s.db.password} onChange={(e) => s.set({ password: e.currentTarget.value })} />
            <Select label="SSL" allowDeselect={false} data={["Disable", "Prefer", "Require", "VerifyFull"]} value={s.db.sslMode} onChange={(v) => v && s.set({ sslMode: v })} />
          </FieldRow>
          <TextInput label="Database" description="New, or an empty one. Empty: named after the project." styles={mono}
            value={s.db.database} onChange={(e) => s.set({ database: e.currentTarget.value })} />
          {s.check && (s.check.ok
            ? <Alert color="teal" p="xs" data-testid="project-db-check">Ready{s.check.version ? `: PostgreSQL ${s.check.version}` : ""}. {s.check.exists ? "The database is there and empty." : "The database will be created."}</Alert>
            : <Alert color="red" p="xs" data-testid="project-db-check">{s.check.problem}</Alert>)}
        </>
      )}
    </>
  );
}
