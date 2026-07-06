import { Routes, Route, Navigate } from "react-router-dom";
import { AuthGate } from "./auth/AuthGate";
import { KeycloakCallback } from "./auth/KeycloakCallback";
import { useSession } from "./auth/session";
import { AppLayout } from "./layout/AppLayout";
import { DataBrowserPage } from "./pages/DataBrowserPage";
import { StorageBrowserPage } from "./pages/StorageBrowserPage";
import { UsersPage } from "./pages/UsersPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";

export function App() {
  return (
    <Routes>
      <Route path="forgot-password" element={<ForgotPasswordPage />} />
      <Route path="reset-password" element={<ResetPasswordPage />} />
      <Route path="invite" element={<AcceptInvitePage />} />
      <Route path="auth/callback" element={<KeycloakCallback />} />
      <Route path="*" element={<GatedApp />} />
    </Routes>
  );
}

function GatedApp() {
  const { state } = useSession();
  const canManageUsers = state?.capabilities?.manageUsers ?? false;
  return (
    <AuthGate>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="data" replace />} />
          <Route path="data" element={<DataBrowserPage />} />
          <Route path="data/rules" element={<DataBrowserPage />} />
          <Route path="storage" element={<StorageBrowserPage />} />
          <Route path="storage/rules" element={<StorageBrowserPage />} />
          <Route path="users" element={canManageUsers ? <UsersPage /> : <Navigate to="/data" replace />} />
        </Route>
      </Routes>
    </AuthGate>
  );
}
