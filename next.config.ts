import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": ["./data/agents.json"],
    "/api/*": ["./data/agents.json"],
  },
};

export default nextConfig;
