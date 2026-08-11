import { router } from "@/app/router";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@/index.css";
import "@/lib/i18n";
import { ThemeProvider } from "next-themes";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Dark mode is a class on <html>: index.css declares
        `@custom-variant dark (&:is(.dark *))` and a `.dark { ... }` block, and
        something has to put that class there. NeonAuthUIProvider used to —
        with defaultTheme="system" — and Phase 1 removed it along with the auth
        it came from, which left `setTheme` in the theme toggle writing to a
        provider that no longer existed. The toggle rendered and did nothing.

        Same removal that took the Toaster below, for the same reason: both were
        children of a provider deleted for what it authenticated, not for what
        it rendered. */}
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      // The app is one full-height shell; animating every colour on a theme
      // switch makes the whole window smear rather than change.
      disableTransitionOnChange
    >
      <TooltipProvider>
        <RouterProvider router={router} />
        {/* Inside ThemeProvider on purpose — the toaster reads the resolved
            theme, and outside it would fall back to its own media query and
            style itself dark over a light app. */}
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
