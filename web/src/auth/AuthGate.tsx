import { Button, Card, Center, Loader, Stack, Text } from "@mantine/core";
import { IconLogin } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useSession } from "./session";
import { TwoFactorSetup } from "./TwoFactorSetup";
import { LoginPage } from "../pages/LoginPage";
import { SetupPage } from "../pages/SetupPage";
import { keycloakLogin } from "./keycloak";
import logoUrl from "../assets/winche-logo.png";

export function AuthGate({ children }: { children: ReactNode }) {
  const { state, refresh } = useSession();
  if (!state) return <Center h="100vh"><Loader /></Center>;

  if (state.provider === "keycloak") {
    if (!state.user) {
      return (
        <Center h="100vh" bg="#f6f8fb">
          <Card withBorder shadow="md" radius="lg" p="xl" w={400}>
            <Stack align="center" gap="xs">
              <img src={logoUrl} alt="Winche" width={64} height={64}
                style={{ borderRadius: 14, display: "block" }} />
              <Text fw={600} size="xl" mt="sm" c="#202124">Winche Console</Text>
              <Text c="dimmed" size="sm" ta="center">Sign in to continue.</Text>
              <Button fullWidth size="md" mt="md" leftSection={<IconLogin size={18} />}
                onClick={() => void keycloakLogin()}>
                Sign in with Keycloak
              </Button>
              <Text c="dimmed" size="xs" mt="xs">Secured by Keycloak</Text>
            </Stack>
          </Card>
        </Center>
      );
    }
    return <>{children}</>;
  }

  if (!state.initialized) return <SetupPage />;
  if (!state.user) return <LoginPage />;
  if (state.user.mustSetupTwoFactor) {
    return (
      <Center h="100vh" bg="#f6f8fb">
        <Card withBorder shadow="sm" radius="md" p="xl" w={420}>
          <TwoFactorSetup forced onDone={refresh} />
        </Card>
      </Center>
    );
  }
  return <>{children}</>;
}
