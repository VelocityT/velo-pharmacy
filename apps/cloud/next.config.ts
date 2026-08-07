import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@velocare/core", "@velocare/ui"],
};

export default config;
