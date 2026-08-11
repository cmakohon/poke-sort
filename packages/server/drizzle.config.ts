import { defineConfig } from "drizzle-kit";
import { DB_DIR } from "./src/config";

// drizzle-kit talks to the embedded database directly. `drizzle-kit studio`
// needs a real socket instead — see `pnpm db:socket`, which exposes this same
// directory over @electric-sql/pglite-socket.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "../../drizzle",
  dialect: "postgresql",
  driver: "pglite",
  dbCredentials: {
    url: DB_DIR,
  },
});
