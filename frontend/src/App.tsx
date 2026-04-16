import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { ReactElement } from "react";
import { ApiKeysManager } from "./components/ApiKeysManager";
import { ConnectedAccountsManager } from "./components/ConnectedAccountsManager";
import { PaymentsManager } from "./components/PaymentsManager";
import { WebhookConfigManager } from "./components/WebhookConfigManager";
import { Dashboard } from "./components/Dashboard";
import { ForgotPasswordPage } from "./components/ForgotPasswordPage";
import { LoginPage } from "./components/LoginPage";
import { RegisterPage } from "./components/RegisterPage";
import { AdminAnalyticsPage } from "./components/AdminAnalyticsPage";

type ProtectedRouteProps = {
  children: ReactElement;
};

function ProtectedRoute({ children }: ProtectedRouteProps) {
  const token = localStorage.getItem("apexpay_token");
  if (token === null || token.length === 0) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function roleFromToken(token: string | null): string | null {
  if (token === null || token.length === 0) {
    return null;
  }
  try {
    const payloadBase64 = token.split(".")[1];
    if (payloadBase64 === undefined || payloadBase64.length === 0) {
      return null;
    }
    const normalized = payloadBase64.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function AdminRoute({ children }: ProtectedRouteProps) {
  const token = localStorage.getItem("apexpay_token");
  if (token === null || token.length === 0) {
    return <Navigate to="/login" replace />;
  }
  const role = roleFromToken(token);
  if (role !== "ADMIN") {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

function LoginRoute() {
  const token = localStorage.getItem("apexpay_token");
  if (token !== null && token.length > 0) {
    return <Navigate to="/dashboard" replace />;
  }
  return <LoginPage />;
}

function RegisterRoute() {
  const token = localStorage.getItem("apexpay_token");
  if (token !== null && token.length > 0) {
    return <Navigate to="/dashboard" replace />;
  }
  return <RegisterPage />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/rejestracja" element={<RegisterRoute />} />
        <Route path="/zapomnialem-hasla" element={<ForgotPasswordPage />} />
        <Route
          path="/dashboard"
          element={(
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/panel/integrator/klucze-api"
          element={(
            <ProtectedRoute>
              <ApiKeysManager />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/panel/integrator/webhook"
          element={(
            <ProtectedRoute>
              <WebhookConfigManager />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/panel/integrator/accounts"
          element={(
            <ProtectedRoute>
              <ConnectedAccountsManager />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/panel/integrator/payments"
          element={(
            <ProtectedRoute>
              <PaymentsManager />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/panel/admin/analytics"
          element={(
            <AdminRoute>
              <AdminAnalyticsPage />
            </AdminRoute>
          )}
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
