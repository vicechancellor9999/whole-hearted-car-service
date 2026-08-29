import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { localOriginRedirects } from "./src/lib/http/canonical-local-origin";

const appRoot = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = path.resolve(appRoot, "../..");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
  outputFileTracingRoot: repositoryRoot,
  reactStrictMode: true,
  redirects: async () => localOriginRedirects(),
  turbopack: {
    root: repositoryRoot,
  },
};

export default nextConfig;
