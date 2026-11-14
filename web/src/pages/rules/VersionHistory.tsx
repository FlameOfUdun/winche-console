import { useMemo, useState } from "react";
import { Badge, Box, Button, Group, Loader, Modal, ScrollArea, SegmentedControl, Stack, Text, UnstyledButton } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { RuleSubsystem, RuleVersionSummary } from "../../api/rules";
import { diffStats, lineDiff, type DiffLine } from "./lineDiff";
import { EmptyState } from "../../components/EmptyState";
import { IconHistory } from "@tabler/icons-react";

type View = "changes" | "file";

/** A version's rules as the rules file (cached per subsystem + version: versions never change). */
function useVersionText(subsystem: RuleSubsystem, version: number | undefined) {
  return useQuery({
    queryKey: ["rules-version-text", subsystem, version],
    enabled: version !== undefined,
    staleTime: Infinity,
    queryFn: async () => {
      const detail = await api.rulesVersion(subsystem, version!);
      return (await api.rulesFormatText(detail.rulesJson)).text;
    },
  });
}

const LINE_COLOURS: Record<DiffLine["kind"], { bg: string; sign: string; color: string }> = {
  same: { bg: "transparent", sign: " ", color: "#495057" },
  added: { bg: "#e6ffec", sign: "+", color: "#116329" },
  removed: { bg: "#ffebe9", sign: "-", color: "#82071e" },
};

function Lines({ lines }: { lines: DiffLine[] }) {
  return (
    <Box component="pre" m={0} style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5, lineHeight: 1.55 }}>
      {lines.map((l, i) => {
        const c = LINE_COLOURS[l.kind];
        return (
          <Box key={i} style={{ display: "flex", background: c.bg, color: c.color }}>
            <Box component="span" w={36} c="#adb5bd" ta="right" pr={6} style={{ userSelect: "none", flexShrink: 0 }}>{l.before ?? ""}</Box>
            <Box component="span" w={36} c="#adb5bd" ta="right" pr={6} style={{ userSelect: "none", flexShrink: 0 }}>{l.after ?? ""}</Box>
            <Box component="span" w={16} style={{ userSelect: "none", flexShrink: 0 }}>{c.sign}</Box>
            <Box component="span" style={{ whiteSpace: "pre" }}>{l.text || " "}</Box>
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * Rules history, Firebase-style: the saved versions on the left; on the right the selected one as the
 * rules file, or its changes against the active version (what's live), with "Open in editor" (load it as a
 * draft to look at or adjust before saving) and "Revert to this" (save it again as the new version).
 */
export function VersionHistory({ subsystem, opened, onClose, versions, onOpenInEditor, onRevert }: {
  subsystem: RuleSubsystem;
  opened: boolean;
  onClose: () => void;
  versions: RuleVersionSummary[] | undefined;
  onOpenInEditor: (version: number) => void;
  onRevert: (version: RuleVersionSummary) => void;
}) {
  const active = versions?.find((v) => v.isActive);
  const [picked, setPicked] = useState<number | null>(null);
  const selected = versions?.find((v) => v.version === picked) ?? versions?.[0];
  const [view, setView] = useState<View>("changes");

  const selectedText = useVersionText(subsystem, opened ? selected?.version : undefined);
  const activeText = useVersionText(subsystem, opened ? active?.version : undefined);

  const isActive = selected !== undefined && selected.version === active?.version;
  const effectiveView: View = isActive || !active ? "file" : view;
  const diff = useMemo(
    () => (selectedText.data !== undefined && activeText.data !== undefined ? lineDiff(activeText.data, selectedText.data) : null),
    [selectedText.data, activeText.data]);
  const stats = diff ? diffStats(diff) : null;

  return (
    <Modal opened={opened} onClose={onClose} title="Rules history" size="90%" padding="md">
      {!versions && <Loader size="sm" />}
      {versions?.length === 0 && <EmptyState icon={IconHistory} title="No versions yet" description="Each time rules are published, from here or with winche rules deploy, a version is kept." />}
      {versions && versions.length > 0 && selected && (
        <Group align="stretch" wrap="nowrap" gap="md" h="70vh">
          <ScrollArea w={280} style={{ flexShrink: 0, borderRight: "1px solid #eee" }}>
            <Stack gap={2} pr="sm">
              {versions.map((v) => (
                <UnstyledButton key={v.version} onClick={() => setPicked(v.version)} p={8}
                  style={{ borderRadius: 6, background: v.version === selected.version ? "#eef2ff" : undefined }}>
                  <Group gap={6} justify="space-between" wrap="nowrap">
                    <Text size="sm" fw={600}>#{v.version}</Text>
                    {v.isActive && <Badge size="xs" color="green" variant="light">active</Badge>}
                  </Group>
                  <Text size="xs" c="dimmed">{new Date(v.createdAtUtc).toLocaleString()}{v.createdBy ? ` · ${v.createdBy}` : ""}</Text>
                  {v.note && <Text size="xs" lineClamp={2}>{v.note}</Text>}
                  {v.revertedFromVersion != null && <Text size="xs" c="dimmed">Revert of #{v.revertedFromVersion}</Text>}
                </UnstyledButton>
              ))}
            </Stack>
          </ScrollArea>

          <Stack gap="sm" style={{ flex: 1, minWidth: 0 }}>
            <Group justify="space-between" wrap="wrap">
              <Group gap="xs">
                <Text fw={600}>Version #{selected.version}</Text>
                {isActive && <Badge size="sm" color="green" variant="light">active</Badge>}
                {!isActive && stats && effectiveView === "changes" && (
                  <Text size="xs" c="dimmed">
                    <Text span c="#116329">+{stats.added}</Text> <Text span c="#82071e">−{stats.removed}</Text> lines compared with the active version (#{active?.version})
                  </Text>
                )}
              </Group>
              <Group gap="xs">
                {!isActive && active && (
                  <SegmentedControl size="xs" value={effectiveView} onChange={(v) => setView(v as View)}
                    data={[{ label: "Changes", value: "changes" }, { label: "Full file", value: "file" }]} />
                )}
                <Button size="xs" variant="default" onClick={() => onOpenInEditor(selected.version)}>Open in editor</Button>
                {!isActive && <Button size="xs" color="red" variant="light" onClick={() => onRevert(selected)}>Revert to this</Button>}
              </Group>
            </Group>

            <ScrollArea style={{ flex: 1, border: "1px solid #eee", borderRadius: 6 }} p={4}>
              {(selectedText.isLoading || (effectiveView === "changes" && activeText.isLoading)) && <Loader size="sm" m="sm" />}
              {selectedText.isError && <Text size="sm" c="red" m="sm">Could not load this version.</Text>}
              {effectiveView === "file" && selectedText.data !== undefined && (
                <Lines lines={lineDiff(selectedText.data, selectedText.data)} />
              )}
              {effectiveView === "changes" && diff && (
                diff.length > 0 && stats && stats.added + stats.removed === 0
                  ? <Text size="sm" c="dimmed" m="sm">Same rules as the active version.</Text>
                  : <Lines lines={diff} />
              )}
            </ScrollArea>
          </Stack>
        </Group>
      )}
    </Modal>
  );
}
