import { useEffect, useState, type ReactNode } from "react";
import { Center, Paper, Stack, Text, Title } from "@mantine/core";
import { api } from "../api/client";
import { surface } from "../theme";
import logoUrl from "../assets/winche-logo.png";

let projectName: Promise<string | null> | null = null;

/**
 * The project this console belongs to (public: shown before sign-in). Read once per page load, without React Query:
 * sign-in pages render before (and outside) the signed-in app.
 */
export function useProjectName(): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    projectName ??= api.authConfig().then((c) => c.project?.name ?? null).catch(() => null);
    projectName.then((n) => { if (live) setName(n); });
    return () => { live = false; };
  }, []);
  return name;
}

/**
 * The centred card every sign-in page uses: the logo (or an icon), the project's name, a heading and a line, the
 * form, and an optional line under the card.
 */
export function AuthCard({ title, subtitle, icon, footer, width = 420, children }: {
  title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; footer?: ReactNode; width?: number; children: ReactNode;
}) {
  const project = useProjectName();
  return (
    <Center mih="100vh" bg={surface.page} p="md">
      <Stack gap="lg" align="center" w="100%" maw={width}>
        <Paper withBorder radius="xl" p={36} w="100%" shadow="sm">
          <Stack gap="lg">
            <Stack gap={12} align="center" ta="center">
              {icon ?? <img src={logoUrl} alt="Winche" width={52} height={52} style={{ borderRadius: 13, display: "block" }} />}
              <div>
                {project && <Text size="sm" fw={600} c={surface.muted}>{project}</Text>}
                <Title order={1} fz={24} mt={project ? 4 : 0} style={{ letterSpacing: "-0.01em" }}>{title}</Title>
                {subtitle && <Text size="sm" c={surface.muted} mt={8} lh={1.5}>{subtitle}</Text>}
              </div>
            </Stack>
            {children}
          </Stack>
        </Paper>
        {footer && <Text size="sm" c={surface.faint} ta="center" lh={1.6}>{footer}</Text>}
      </Stack>
    </Center>
  );
}
