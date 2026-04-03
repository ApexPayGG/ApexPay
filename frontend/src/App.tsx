import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { ReactElement } from "react";
import { Dashboard } from "./components/Dashboard";
import { ForgotPasswordPage } from "./components/ForgotPasswordPage";
import { LoginPage } from "./components/LoginPage";
import { RegisterPage } from "./components/RegisterPage";

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
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
