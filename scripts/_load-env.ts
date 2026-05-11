/**
 * Side-effect import for tsx scripts: loads .env.local before any other code
 * touches process.env. Import this FIRST in every script.
 *
 *   import "./_load-env";
 */
import { config } from "dotenv";
import path from "node:path";

config({ path: path.join(process.cwd(), ".env.local") });
