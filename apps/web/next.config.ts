import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const appRoot = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = path.resolve(appRoot, "../..");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
  outputFileTracingRoot: repositoryRoot,
  reactStrictMode: true,
  turbopack: {
    root: repositoryRoot,
  },
};

export default nextConfig;
