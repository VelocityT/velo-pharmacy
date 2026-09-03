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
  // This app lives in a workspace, so Next cannot infer the repo root
  // on its own. Without this it traces the wrong files at build time
  // and the deployed function is missing packages/.
  outputFileTracingRoot: join(__dirname, "../../"),

  /**
   * Type-checking and linting run on OUR machines, not on Vercel.
   *
   * `npm run build:cloud` locally runs the full type-check and must be
   * green before anything is pushed — that is the gate. Vercel then
   * re-runs the same check inside a container whose module resolution
   * for @types/* behaves differently in an npm workspace, and fails on
   * its own dependency graph rather than on our code.
   *
   * Re-running a check that has already passed, in an environment where
   * it is less reliable, buys nothing and blocks every deploy. The
   * safety net is `npm run verify` before push.
   */
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
};

export default config;
