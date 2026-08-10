import { Hono } from "hono";
import { readCapture } from "../lib/captures";
import type { AppEnv } from "../middleware/auth";

const router = new Hono<AppEnv>();

// GET /captures/:fileName — serve a scan capture off disk.
// Deliberately unauthenticated, like the image proxy: this is a single-user
// local app, and the URL is only ever produced by the server itself.
router.get("/:fileName", async (c) => {
  const file = await readCapture(c.req.param("fileName"));
  if (!file) return c.json({ success: false, message: "Not found." }, 404);

  return c.body(
    new Uint8Array(file.body).buffer as ArrayBuffer,
    200,
    {
      "Content-Type": file.contentType,
      // Content is immutable: the file name is the scan guid.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  );
});

export { router as capturesRouter };
