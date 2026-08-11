import {
  LOCAL_ORG_ID,
  LOCAL_USER_ID,
  LOCAL_USER_NAME,
} from "@poke-sort/shared";
import { createMiddleware } from "hono/factory";

/**
 * Local build: there are no accounts, so every guard is a pass-through that
 * pins the request to the single local identity.
 *
 * The exports and the `AppVariables` shape are deliberately unchanged — every
 * route still composes `requireAuth`/`requireOrg`/`requireRole` and still reads
 * `c.get("orgId")` and `c.get("jwtClaims")`. Keeping the surface identical is
 * what holds this diff to one file instead of every route file.
 */

export type OrgRole = "owner" | "admin" | "member";

export type AppVariables = {
  jwtClaims: string;
  userId: string;
  userRole: string;
  orgId: string;
  orgRole: OrgRole;
};
export type AppEnv = { Variables: AppVariables };

/**
 * Still shaped like a PostgREST claims blob because `authQuery` forwards it to
 * `set_config('request.jwt.claims', ...)`. Phase 2 drops that call.
 */
export const LOCAL_JWT_CLAIMS = JSON.stringify({
  sub: LOCAL_USER_ID,
  role: "authenticated",
  org_id: LOCAL_ORG_ID,
});

/** Single local user; nothing to look up. */
export async function getUserDisplayName(_userId: string): Promise<string> {
  return LOCAL_USER_NAME;
}

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  c.set("jwtClaims", LOCAL_JWT_CLAIMS);
  c.set("userId", LOCAL_USER_ID);
  c.set("userRole", "admin");
  await next();
});

export const requireOrg = createMiddleware<AppEnv>(async (c, next) => {
  c.set("orgId", LOCAL_ORG_ID);
  c.set("orgRole", "owner");
  c.set("jwtClaims", LOCAL_JWT_CLAIMS);
  await next();
});

// The local user owns the machine, so both role guards always pass. Kept so
// route definitions do not have to change.
export function requireRole(..._roles: string[]) {
  return createMiddleware<AppEnv>(async (_c, next) => {
    await next();
  });
}

export function requireOrgRole(..._roles: OrgRole[]) {
  return createMiddleware<AppEnv>(async (_c, next) => {
    await next();
  });
}
