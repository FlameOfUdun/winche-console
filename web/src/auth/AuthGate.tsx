import { Button, Card, Center, Loader, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";
import { useSession } from "./session";
import { TwoFactorSetup } from "./TwoFactorSetup";
import { LoginPage } from "../pages/LoginPage";
import { SetupPage } from "../pages/SetupPage";
import { keycloakLogin } from "./keycloak";

export function AuthGate({ children }: { children: ReactNode }) {
  const { state, refresh } = useSession();
  if (!state) return <Center h="100vh"><Loader /></Center>;

  if (state.provider === "keycloak") {
    if (!state.user) {
      return (
        <Center h="100vh" bg="#f6f8fb">
          <Card withBorder shadow="sm" radius="md" p="xl" w={420}>
            <Stack>
              <Text fw={600} size="lg">Winche Console</Text>
              <Text c="dimmed" size="sm">Sign in with your organization account.</Text>
              <Button onClick={() => void keycloakLogin()}>Sign in with Keycloak</Button>
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
