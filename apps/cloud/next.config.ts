import { config as loadEnv } from "dotenv";
import { join } from "node:path";
import type { NextConfig } from "next";

/**
 * ONE .env, at the repository root.
 *
 * Prisma CLI commands run from the root (`prisma migrate --schema
 * packages/core/...`), so Prisma only ever looks for the root .env.
 * Next, by default, looks in this app folder. Without this line the
 * two disagree and you get "Environment variable not found" from
 * whichever tool you happen to run second.
 *
 * Root .env wins. Vercel injects its own vars in production, where
 * this file is absent and the call is a harmless no-op.
 */
loadEnv({ path: join(__dirname, "../../.env") });

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@velocare/core", "@velocare/ui"],
};

export default config;
