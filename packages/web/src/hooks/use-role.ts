/**
 * Local build: one user, who owns the machine and is therefore always admin.
 * Kept as a hook so the call sites (`AdminGuard`, `ScannerDebug`, admin nav)
 * do not have to change.
 */
export function useRole() {
  return {
    role: "admin" as const,
    isPending: false,
    isAdmin: true,
    hasRole: (...roles: string[]) => roles.includes("admin"),
  };
}
