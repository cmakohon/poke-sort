"use client"

import { TOAST_DURATION_MS } from "@/lib/toast"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { IconCircleCheck, IconInfoCircle, IconAlertTriangle, IconAlertOctagon, IconLoader } from "@tabler/icons-react"

const Toaster = ({ ...props }: ToasterProps) => {
  // resolvedTheme rather than theme, so this never hands sonner the literal
  // "system" and leaves it to consult its own media query.
  //
  // Hardening, not the fix for the unreadable toasts — that was the missing
  // ThemeProvider, which left sonner theming from the OS while the page stayed
  // light. With a provider mounted the two agree either way (verified). This
  // removes the second source of truth regardless, so the toast follows the
  // page rather than happening to match it.
  const { resolvedTheme } = useTheme()

  return (
    <Sonner
      theme={(resolvedTheme ?? "system") as ToasterProps["theme"]}
      className="toaster group"
      // Every toast gets an X and a finite lifetime. Without the close button
      // a toast could only be waited out, and the machine-fault ones were
      // `duration: Infinity` — so a jam notice from an hour ago just sat there.
      closeButton
      duration={TOAST_DURATION_MS}
      icons={{
        success: (
          <IconCircleCheck className="size-4" />
        ),
        info: (
          <IconInfoCircle className="size-4" />
        ),
        warning: (
          <IconAlertTriangle className="size-4" />
        ),
        error: (
          <IconAlertOctagon className="size-4" />
        ),
        loading: (
          <IconLoader className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
