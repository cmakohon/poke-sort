import type { Context } from "hono";
import type { z } from "zod";

/**
 * Parses a JSON request body against a schema.
 *
 * `c.req.json<T>()` is a cast, not a parse — it asserts a shape and checks
 * nothing, so whatever arrives flows into the handler wearing a type it may not
 * have. That is how a request body ended up able to pick which servo module a
 * calibration write landed on: it was spread into the insert as if it were
 * trusted, because as far as the types were concerned it was.
 *
 * Returning a discriminated result rather than throwing keeps the 400 next to
 * the route that knows what it expected, and leaves `onError` for genuine
 * faults rather than routine bad input.
 *
 * Usage:
 *
 *   const body = await parseBody(c, MySchema);
 *   if (!body.ok) return body.response;
 *   // body.data is validated, not asserted
 */
export async function parseBody<S extends z.ZodType>(
  c: Context,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return {
      ok: false,
      response: c.json({ success: false, message: "Body must be valid JSON." }, 400),
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    // Name the offending fields. A bare "invalid request" turns every
    // client-side mistake into a bisect.
    const detail = result.error.issues
      .map((issue) => {
        const path = issue.path.join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join("; ");
    return {
      ok: false,
      response: c.json({ success: false, message: `Invalid request. ${detail}` }, 400),
    };
  }

  return { ok: true, data: result.data };
}
