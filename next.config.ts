import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root explicitly. The user's home directory has an
  // unrelated package-lock.json several levels above this repository,
  // which otherwise causes Turbopack to misdetect the project root.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Playwright's webServer talks to the dev server over 127.0.0.1 rather
  // than localhost; allow that origin for dev-only HMR/asset requests.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
