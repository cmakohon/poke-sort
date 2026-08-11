import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "next-themes";

/**
 * The providers the whole app sits inside, as one component so they can be
 * asserted.
 *
 * Split out of main.tsx because twice now a provider has gone missing without
 * anything failing: NeonAuthUIProvider was deleted for the auth it carried, and
 * took with it the Toaster it rendered and the theming it supplied. Both times
 * the symptom surfaced much later as "toasts don't appear" and "dark mode does
 * nothing" — silent, because a missing provider is not an error, it is a
 * default. main.tsx calls createRoot and cannot be rendered in a test; this
 * can.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      // Dark mode is a class on <html>: index.css declares
      // `@custom-variant dark (&:is(.dark *))` and a `.dark { ... }` block,
      // and something has to put that class there.
      attribute="class"
      defaultTheme="system"
      enableSystem
      // The app is one full-height shell; animating every colour on a theme
      // switch makes the whole window smear rather than change.
      disableTransitionOnChange
    >
      <TooltipProvider>
        {children}
        {/* Inside ThemeProvider on purpose — the toaster reads the resolved
            theme, and outside it would fall back to its own media query and
            style itself dark over a light app. */}
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}
