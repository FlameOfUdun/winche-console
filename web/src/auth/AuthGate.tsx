import { Button, Center, Loader } from "@mantine/core";
import { IconLock, IconLogin, IconLogout } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useSession } from "./session";
import { TwoFactorSetup } from "./TwoFactorSetup";
import { LoginPage } from "../pages/LoginPage";
import { SetupPage } from "../pages/SetupPage";
import { keycloakLogin, keycloakLogout } from "./keycloak";
import { AuthCard } from "../components/AuthCard";
import { Circle } from "../pages/ForgotPasswordPage";

export function AuthGate({ children }: { children: ReactNode }) {
  const { state, refresh } = useSession();
  if (!state) return <Center h="100vh"><Loader /></Center>;

  if (state.provider === "keycloak") {
    if (!state.user) {
      // Signed in to Keycloak but holding none of the console roles: a dead end with a way back out.
      if (state.accessDenied) {
        return (
          <AuthCard title="No access to this console" icon={<Circle tone="red"><IconLock size={24} /></Circle>}
            subtitle="Your account has no role in this console. Ask an admin to give you one.">
            <Button size="md" variant="default" leftSection={<IconLogout size={18} />} onClick={() => void keycloakLogout()}>
              Sign out
            </Button>
          </AuthCard>
        );
      }
      return (
        <AuthCard title="Sign in to the console" subtitle="This console signs in with your organisation's account.">
          <Button size="md" leftSection={<IconLogin size={18} />} onClick={() => void keycloakLogin()}>
            Sign in with Keycloak
          </Button>
        </AuthCard>
      );
    }
    return <>{children}</>;
  }

  if (!state.initialized) return <SetupPage />;
  if (!state.user) return <LoginPage />;
  if (state.user.mustSetupTwoFactor) {
    return (
      <AuthCard title="Protect your account" subtitle="This console asks for a code from your phone too.">
        <TwoFactorSetup forced onDone={refresh} />
      </AuthCard>
    );
  }
  return <>{children}</>;
}
