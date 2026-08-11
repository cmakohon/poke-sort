import { LOCAL_ORG_ID, LOCAL_USER_NAME } from "@magic-vault/shared";

const LOCAL_ORG = { id: LOCAL_ORG_ID, name: LOCAL_USER_NAME } as const;

/**
 * Local build: exactly one org, resolved synchronously.
 *
 * Kept as a hook with the original shape because ~20 call sites gate their
 * queries on `enabled: !!activeOrg` and key their caches on `activeOrg?.id`.
 * Returning a constant makes those gates trivially true instead of requiring
 * every one of them to change — and it is what removes the org-resolution
 * round trip that used to block first paint.
 */
export function useOrg() {
  return {
    orgs: [LOCAL_ORG],
    activeOrg: LOCAL_ORG,
    isLoading: false,
    setActiveOrg: async (_orgId: string) => {},
  };
}
