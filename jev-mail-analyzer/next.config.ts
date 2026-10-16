import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Gmail credential file and the TypeSafe key are read on the server only.
  serverExternalPackages: ["@typesafe-ai/sdk"],
};

export default nextConfig;
