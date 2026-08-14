/**
 * Guards against a provider going missing.
 *
 * This is the third time theming or toasts have broken, and never once with an
 * error: `NeonAuthUIProvider` was deleted for the auth it carried, silently
 * taking the Toaster it rendered and the theme provider it supplied. A missing
 * provider does not throw — `useTheme()` returns a default and `setTheme`
 * becomes a no-op — so the failure only shows up as a person saying "dark mode
 * does nothing", weeks later.
 *
 * These assert the observable consequences rather than the JSX, so they would
 * fail on the real bug: not "is ThemeProvider in the tree" but "does asking for
 * dark actually put the class on <html>".
 *
 * Removing the ThemeProvider fails four of them; removing the Toaster fails
 * two. Both were checked by making the change and watching them go red, which
 * is the only thing that distinguishes a guard from decoration.
 */
import { AppShell } from "@/app/app-shell";
import { setPrefersDark } from "@/test/setup";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useTheme } from "next-themes";
import { useEffect } from "react";
import { toast } from "sonner";
import { FAULT_TOAST_DURATION_MS } from "@/lib/toast";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/** Calls setTheme once on mount, the way the theme toggle does on click. */
function SetThemeOnMount({ theme }: { theme: string }) {
  const { setTheme } = useTheme();
  useEffect(() => {
    setTheme(theme);
  }, [setTheme, theme]);
  return null;
}

function ReportResolvedTheme() {
  const { resolvedTheme } = useTheme();
  return <span data-testid="resolved">{resolvedTheme ?? "none"}</span>;
}

beforeEach(() => {
  setPrefersDark(false);
  document.documentElement.className = "";
  localStorage.clear();
});

afterEach(() => {
  // Explicit, because auto-cleanup only runs with vitest `globals: true`.
  // Without it each render leaves its Toaster mounted and the next test finds
  // several, which fails for reasons that have nothing to do with the app.
  cleanup();
  toast.dismiss();
  document.documentElement.className = "";
});

describe("AppShell providers", () => {
  it("puts the dark class on <html> when dark is selected", async () => {
    // The actual reported bug: the toggle rendered, and nothing happened.
    await act(async () => {
      render(
        <AppShell>
          <SetThemeOnMount theme="dark" />
        </AppShell>,
      );
    });

    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes it again when light is selected", async () => {
    await act(async () => {
      render(
        <AppShell>
          <SetThemeOnMount theme="light" />
        </AppShell>,
      );
    });

    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("follows the system preference when set to system", async () => {
    setPrefersDark(true);
    await act(async () => {
      render(
        <AppShell>
          <SetThemeOnMount theme="system" />
        </AppShell>,
      );
    });

    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("resolves a concrete theme, never the literal 'system'", async () => {
    // What the sonner wrapper reads. If this is "system", sonner falls back to
    // its own media query and can style a toast against a differently-themed
    // page — the unreadable-toast bug.
    //
    // Asserted as "not system" rather than as a specific colour: the colour is
    // the default's business and moved once already, but sonner receiving the
    // literal string is the failure this guards, whatever the default is.
    setPrefersDark(true);
    await act(async () => {
      render(
        <AppShell>
          <ReportResolvedTheme />
        </AppShell>,
      );
    });

    const resolved = screen.getByTestId("resolved").textContent;
    expect(resolved).not.toBe("system");
    expect(["light", "dark"]).toContain(resolved);
  });

  it("defaults to light even when the OS prefers dark", async () => {
    // The app is used under room lighting beside the machine; the OS setting
    // is not a better guess. beforeEach clears localStorage, so this is the
    // fresh-install path — a stored choice would (correctly) win over it.
    setPrefersDark(true);
    await act(async () => {
      render(
        <AppShell>
          <span />
        </AppShell>,
      );
    });

    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("themes the toaster from the app, not from the OS", async () => {
    // The unreadable-toast bug: OS dark, page light, dark toast chrome behind
    // light-theme text.
    //
    // The cause was the missing provider, not the wrapper reading `theme` —
    // with a provider mounted, `theme` and `resolvedTheme` agree. So this
    // guards the mismatch itself rather than one mechanism for it, and it does
    // fail when the provider is removed.
    setPrefersDark(true);

    await act(async () => {
      render(
        <AppShell>
          <SetThemeOnMount theme="light" />
        </AppShell>,
      );
    });
    await act(async () => {
      toast("themed toast");
    });
    await screen.findByText("themed toast");

    const toaster = document.querySelector("[data-sonner-toaster]");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(toaster?.getAttribute("data-sonner-theme")).toBe("light");
  });

  it("mounts a toaster that actually renders a toast", async () => {
    // Not "is <Toaster /> in the tree" — whether toast() reaches the screen.
    // For a while every toast in the app went nowhere.
    await act(async () => {
      render(
        <AppShell>
          <span />
        </AppShell>,
      );
    });

    await act(async () => {
      toast("mounted toast");
    });

    expect(await screen.findByText("mounted toast")).toBeDefined();
  });

  it("provides tooltip context to its children", async () => {
    // Radix throws if a Tooltip is used outside its provider, so rendering one
    // is the assertion.
    const { Tooltip, TooltipContent, TooltipTrigger } = await import(
      "@/components/ui/tooltip"
    );

    await act(async () => {
      render(
        <AppShell>
          <Tooltip>
            <TooltipTrigger>trigger</TooltipTrigger>
            <TooltipContent>content</TooltipContent>
          </Tooltip>
        </AppShell>,
      );
    });

    expect(screen.getByText("trigger")).toBeDefined();
  });
  it("gives every toast a close button and a finite lifetime", async () => {
    // Machine faults (jam, empty feeder, sorter error) used to be
    // `duration: Infinity` with no close button, so a stale fault notice sat
    // in the corner for the rest of the session with no way to clear it.
    await act(async () => {
      render(
        <AppShell>
          <span />
        </AppShell>,
      );
    });
    await act(async () => {
      toast.error("jam detected", { duration: FAULT_TOAST_DURATION_MS });
    });
    await screen.findByText("jam detected");

    expect(
      document.querySelector("[data-sonner-toast] [data-close-button]"),
    ).not.toBeNull();
    expect(Number.isFinite(FAULT_TOAST_DURATION_MS)).toBe(true);
  });
});
