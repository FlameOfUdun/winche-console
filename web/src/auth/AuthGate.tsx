import { Button, Card, Center, Loader, Stack, Text } from "@mantine/core";
import { IconLogin, IconLogout } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useSession } from "./session";
import { TwoFactorSetup } from "./TwoFactorSetup";
import { LoginPage } from "../pages/LoginPage";
import { SetupPage } from "../pages/SetupPage";
import { keycloakLogin, keycloakLogout } from "./keycloak";
import logoUrl from "../assets/winche-logo.png";

export function AuthGate({ children }: { children: ReactNode }) {
  const { state, refresh } = useSession();
  if (!state) return <Center h="100vh"><Loader /></Center>;

  if (state.provider === "keycloak") {
    if (!state.user) {
      // Authenticated with Keycloak but holding none of the console roles: a dead-end "no access" screen
      // with a way back out, rather than the sign-in prompt (they are already signed in) or the console.
      if (state.accessDenied) {
        return (
          <Center h="100vh" bg="#f6f8fb">
            <Card withBorder shadow="md" radius="lg" p="xl" w={400}>
              <Stack align="center" gap="xs">
                <img src={logoUrl} alt="Winche" width={64} height={64}
                  style={{ borderRadius: 14, display: "block" }} />
                <Text fw={600} size="xl" mt="sm" c="#202124">No access</Text>
                <Text c="dimmed" size="sm" ta="center">
                  Your account doesn't have a role for this console. Ask an administrator to grant you access.
                </Text>
                <Button fullWidth variant="light" size="md" mt="md" leftSection={<IconLogout size={18} />}
                  onClick={() => void keycloakLogout()}>
                  Sign out
                </Button>
              </Stack>
            </Card>
          </Center>
        );
      }
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
