import { ActionIcon, CopyButton, Tooltip } from "@mantine/core";
import { IconCheck, IconCopy } from "@tabler/icons-react";

/** A small copy button for [value]; [label] names what's copied ("Copy app id"). */
export function Copy({ value, label }: { value: string; label: string }) {
  return (
    <CopyButton value={value} timeout={1500}>
      {({ copied, copy }) => (
        <Tooltip label={copied ? "Copied" : `Copy ${label}`} withArrow>
          <ActionIcon variant="subtle" color={copied ? "teal" : "gray"} onClick={copy} aria-label={`Copy ${label}`}>
            {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
          </ActionIcon>
        </Tooltip>
      )}
    </CopyButton>
  );
}
