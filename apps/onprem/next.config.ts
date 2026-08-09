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
  // standalone bundles the server so the hospital's machine never
  // needs an npm install — the image moves on a USB stick.
  output: "standalone",
};

export default config;
