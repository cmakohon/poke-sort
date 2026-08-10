import AdminPage from "@/app/routes/app/admin";
import BinsPage from "@/app/routes/app/bins";
import CalibratePage from "@/app/routes/app/calibrate";
import CollectionsPage from "@/app/routes/app/collections";
import ScannerPage from "@/app/routes/app/index";
import AppLayout from "@/app/routes/app/layout";
import MonitorPage from "@/app/routes/app/monitor";
import MonitorSessionsPage from "@/app/routes/app/monitor-sessions";
import SettingsPage from "@/app/routes/app/settings";
import BuildGuidePage from "@/app/routes/build";
import LandingPage from "@/app/routes/index";
import NotFoundPage from "@/app/routes/not-found";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";

// AuthGuard and AdminGuard are gone: there is no sign-in, and the single local
// user is always admin. DesktopOnlyGuard stays — it is about screen size, not
// permissions, and still routes phones to the read-only monitor view.
function DesktopOnlyGuard() {
  const isMobile = useIsMobile();
  if (isMobile) return <Navigate to="/app/monitor" replace />;
  return <Outlet />;
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <LandingPage />,
  },
  {
    path: "/build",
    element: <BuildGuidePage />,
  },
  {
    element: <AppLayout />,
    children: [
      {
        element: <DesktopOnlyGuard />,
        children: [
          {
            path: "/app",
            element: <ScannerPage />,
          },
          {
            path: "/app/collections",
            element: <CollectionsPage />,
          },
          {
            path: "/app/collections/:collectionGuid/bins",
            element: <BinsPage />,
          },
          {
            path: "/app/calibrate",
            element: <CalibratePage />,
          },
          {
            path: "/app/settings",
            element: <SettingsPage />,
          },
          {
            path: "/app/admin",
            element: <AdminPage />,
          },
        ],
      },
      {
        path: "/app/monitor",
        element: <MonitorSessionsPage />,
      },
      {
        path: "/app/monitor/:collectionGuid",
        element: <MonitorPage />,
      },
    ],
  },
  {
    path: "*",
    element: <NotFoundPage />,
  },
]);
