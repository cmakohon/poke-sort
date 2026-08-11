import { router } from "@/app/router";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@/index.css";
import "@/lib/i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <RouterProvider router={router} />
      {/* Upstream dropped this to de-duplicate with the one NeonAuthUIProvider
          rendered; Phase 1 removed that provider, leaving no Toaster at all. */}
      <Toaster />
    </TooltipProvider>
  </StrictMode>,
);
