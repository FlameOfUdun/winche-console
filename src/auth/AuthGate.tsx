import { Center, Loader } from "@mantine/core";
import type { ReactNode } from "react";
import { useSession } from "./session";
import { TwoFactorSetup } from "./TwoFactorSetup";
import { LoginPage } from "../pages/LoginPage";
import { AuthCard } from "../components/AuthCard";
import { Onboarding, onboardingInProgress } from "../pages/onboarding/Onboarding";

export function AuthGate({ children }: { children: ReactNode }) {
  const { state, refresh } = useSession();
  if (!state) return <Center h="100vh"><Loader /></Center>;

  // First run: the three-part setup (console access, the project, a first app); it carries on after signing in.
  if (!state.initialized) return <Onboarding mode="first-run" />;
  if (!state.user) return <LoginPage />;
  if (onboardingInProgress()) return <Onboarding mode="first-run" />;
  if (state.user.mustSetupTwoFactor) {
    return (
      <AuthCard title="Protect your account" subtitle="This console asks for a code from your phone too.">
        <TwoFactorSetup forced onDone={refresh} />
      </AuthCard>
    );
  }
  return <>{children}</>;
}
