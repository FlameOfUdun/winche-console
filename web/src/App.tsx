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
import { TabPage } from "./tabs/TabPage";
import { useTabsManifest } from "./tabs/useTabsManifest";
import { homePath } from "./layout/nav";

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
  const { state, user } = useSession();
  const manifest = useTabsManifest();
  const home = homePath(state, user, manifest.data?.tabs) ?? "/database";
  const caps = state?.capabilities;
  return (
    <AuthGate>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to={home} replace />} />
          <Route path="database" element={caps?.database ? <DataBrowserPage /> : <Navigate to={home} replace />} />
          <Route path="database/rules" element={caps?.database ? <DataBrowserPage /> : <Navigate to={home} replace />} />
          <Route path="storage" element={caps?.storage ? <StorageBrowserPage /> : <Navigate to={home} replace />} />
          <Route path="storage/rules" element={caps?.storage ? <StorageBrowserPage /> : <Navigate to={home} replace />} />
          <Route path="access" element={caps?.manageUsers && user?.role === "Admin" ? <UsersPage /> : <Navigate to={home} replace />} />
          <Route path=":tabId" element={<TabPage />} />
        </Route>
      </Routes>
    </AuthGate>
  );
}
