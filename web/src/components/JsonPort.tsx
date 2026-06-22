import { useState } from "react";
import { Button, CopyButton, Group, JsonInput, Modal, Stack, Text } from "@mantine/core";
import { IconDownload, IconFileImport } from "@tabler/icons-react";

/**
 * Import/Export JSON controls for a builder. Export shows the current JSON (copy + download);
 * Import accepts pasted JSON and hands it back via onImport.
 */
export function JsonPort({
  filename, getJson, onImport,
}: { filename: string; getJson: () => string; onImport: (text: string) => void }) {
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const pretty = () => {
    try { return JSON.stringify(JSON.parse(getJson()), null, 2); } catch { return getJson(); }
  };

  const download = () => {
    const blob = new Blob([pretty()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const apply = () => {
    try { JSON.parse(draft); } catch (e) { setError((e as Error).message); return; }
    onImport(draft);
    setImportOpen(false);
    setError(null);
  };

  return (
    <>
      <Button variant="default" size="xs" leftSection={<IconFileImport size={14} />}
        onClick={() => { setDraft(pretty()); setError(null); setImportOpen(true); }}>
        Import
      </Button>
      <Button variant="default" size="xs" leftSection={<IconDownload size={14} />}
        onClick={() => setExportOpen(true)}>
        Export
      </Button>

      <Modal opened={exportOpen} onClose={() => setExportOpen(false)} title="Export JSON" size="lg">
        <Stack>
          <JsonInput value={pretty()} autosize minRows={8} maxRows={20} readOnly />
          <Group justify="flex-end">
            <CopyButton value={pretty()}>
              {({ copied, copy }) => <Button variant="default" onClick={copy}>{copied ? "Copied" : "Copy"}</Button>}
            </CopyButton>
            <Button onClick={download} leftSection={<IconDownload size={16} />}>Download</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={importOpen} onClose={() => setImportOpen(false)} title="Import JSON" size="lg">
        <Stack>
          <Text size="sm" c="dimmed">Paste JSON below; it replaces the current configuration when applied.</Text>
          <JsonInput value={draft} onChange={setDraft} autosize minRows={8} maxRows={20} />
          {error && <Text c="red" size="sm">Invalid JSON: {error}</Text>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button onClick={apply}>Apply</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
