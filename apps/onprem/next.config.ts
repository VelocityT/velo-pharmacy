import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@velocare/core", "@velocare/ui"],
  // standalone bundles the server so the hospital's machine never
  // needs an npm install — the image moves on a USB stick.
  output: "standalone",
};

export default config;
