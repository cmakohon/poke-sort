import AdminPage from "@/app/routes/admin";
import BinsPage from "@/app/routes/bins";
import CalibratePage from "@/app/routes/calibrate";
import CollectionsPage from "@/app/routes/collections";
import ScannerPage from "@/app/routes/index";
import AppLayout from "@/app/routes/layout";
import MonitorPage from "@/app/routes/monitor";
import MonitorSessionsPage from "@/app/routes/monitor-sessions";
import NotFoundPage from "@/app/routes/not-found";
import SettingsPage from "@/app/routes/settings";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";

// AuthGuard and AdminGuard are gone: there is no sign-in, and the single local
// user is always admin. DesktopOnlyGuard stays — it is about screen size, not
// permissions, and still routes phones to the read-only monitor view.
function DesktopOnlyGuard() {
  const isMobile = useIsMobile();
  if (isMobile) return <Navigate to="/monitor" replace />;
  return <Outlet />;
}

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      {
        element: <DesktopOnlyGuard />,
        children: [
          {
            path: "/",
            element: <ScannerPage />,
          },
          {
            path: "/collections",
            element: <CollectionsPage />,
          },
          {
            path: "/collections/:collectionGuid/bins",
            element: <BinsPage />,
          },
          {
            path: "/calibrate",
            element: <CalibratePage />,
          },
          {
            path: "/settings",
            element: <SettingsPage />,
          },
          {
            path: "/admin",
            element: <AdminPage />,
          },
        ],
      },
      {
        path: "/monitor",
        element: <MonitorSessionsPage />,
      },
      {
        path: "/monitor/:collectionGuid",
        element: <MonitorPage />,
      },
    ],
  },
  {
    path: "*",
    element: <NotFoundPage />,
  },
]);
