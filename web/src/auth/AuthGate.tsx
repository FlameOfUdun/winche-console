import { Card, Center, Loader } from "@mantine/core";
import type { ReactNode } from "react";
import { useSession } from "./session";
import { TwoFactorSetup } from "./TwoFactorSetup";
import { LoginPage } from "../pages/LoginPage";
import { SetupPage } from "../pages/SetupPage";

export function AuthGate({ children }: { children: ReactNode }) {
  const { state, refresh } = useSession();
  if (!state) return <Center h="100vh"><Loader /></Center>;
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
