/**
 * Identity constants for the single-user local build.
 *
 * The `org_id` columns and every `eq(table.orgId, orgId)` predicate stay in
 * place — they appear in unique constraints, audit tables and ~40 queries, and
 * dropping them would be a wide, risky diff with no user-visible payoff. The
 * tenancy model is simply pinned to one tenant instead of being removed.
 */
export const LOCAL_ORG_ID = "local";
export const LOCAL_USER_ID = "local-user";
export const LOCAL_USER_NAME = "Local";
