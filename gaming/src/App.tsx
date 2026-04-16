import type { ReactElement } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { getToken } from "./lib/api";
import { CreateTournamentPage } from "./pages/CreateTournamentPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { AdminPage } from "./pages/AdminPage";
import { TournamentsPage } from "./pages/TournamentsPage";
import { TradePage } from "./pages/TradePage";
import { TradeViewPage } from "./pages/TradeViewPage";

type RouteGuardProps = {
  children: ReactElement;
};

function PublicRoute({ children }: RouteGuardProps): ReactElement {
  if (getToken() !== null) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

function ProtectedRoute({ children }: RouteGuardProps): ReactElement {
  if (getToken() === null) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function GuestRoute({ children }: RouteGuardProps): ReactElement {
  return children;
}

function App(): ReactElement {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <GuestRoute>
              <LandingPage />
            </GuestRoute>
          }
        />
        <Route
          path="/login"
          element={
            <PublicRoute>
              <LoginPage />
            </PublicRoute>
          }
        />
        <Route
          path="/rejestracja"
          element={
            <PublicRoute>
              <RegisterPage />
            </PublicRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/turnieje"
          element={
            <ProtectedRoute>
              <TournamentsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/turnieje/nowy"
          element={
            <ProtectedRoute>
              <CreateTournamentPage />
            </ProtectedRoute>
          }
        />
        <Route path="/trade/:tradeId" element={<TradeViewPage />} />
        <Route
          path="/trade"
          element={
            <ProtectedRoute>
              <TradePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AdminPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
