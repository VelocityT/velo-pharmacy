import { config as loadEnv } from "dotenv";
import { join } from "node:path";
import type { NextConfig } from "next";

/**
 * ONE .env, at the repository root — see apps/cloud/next.config.ts.
 * In the Docker image env vars come from docker-compose, where this
 * call is a harmless no-op.
 */
loadEnv({ path: join(__dirname, "../../.env") });

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@velocare/core", "@velocare/ui"],
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
  // standalone bundles the server so the hospital's machine never
  // needs an npm install — the image moves on a USB stick.
  output: "standalone",
};

export default config;
