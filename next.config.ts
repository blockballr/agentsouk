import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/*": ["./data/agents.json"],
    "/api/*": ["./data/agents.json"],
  },
};

export default nextConfig;
