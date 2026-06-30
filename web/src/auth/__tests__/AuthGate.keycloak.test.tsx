import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { AuthGate } from "../AuthGate";
import { SessionContext } from "../session";
import type { AuthState } from "../../api/types";

vi.mock("../keycloak", () => ({ keycloakLogin: vi.fn(), keycloakLogout: vi.fn() }));

function renderWithState(state: AuthState | null) {
  return render(
    <MantineProvider>
      <SessionContext.Provider value={{ state, user: state?.user ?? null, refresh: vi.fn() }}>
        <AuthGate><div>PROTECTED</div></AuthGate>
      </SessionContext.Provider>
    </MantineProvider>
  );
}

const keycloakSignedOut: AuthState = {
  provider: "keycloak",
  initialized: true,
  capabilities: { manageUsers: false, invites: false, twoFactor: false, changePassword: false, editProfile: false },
  user: null,
} as AuthState;

describe("AuthGate (Keycloak)", () => {
  it("shows the Keycloak sign-in button and Winche logo when signed out", () => {
    renderWithState(keycloakSignedOut);
    expect(screen.getByText("Sign in with Keycloak")).toBeInTheDocument();
    expect(screen.getByAltText("Winche")).toBeInTheDocument();
    expect(screen.queryByText("PROTECTED")).not.toBeInTheDocument();
  });

  it("renders protected content when a Keycloak user is present", () => {
    renderWithState({ ...keycloakSignedOut, user: { id: "u1", email: "a@b", role: "Member" } } as AuthState);
    expect(screen.getByText("PROTECTED")).toBeInTheDocument();
  });
});
