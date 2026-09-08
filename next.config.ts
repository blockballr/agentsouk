import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": ["./data/agents.json", "./data/advantage-tasks.json", "./data/delivery-matrix.json"],
    "/api/*": ["./data/agents.json", "./data/advantage-tasks.json", "./data/delivery-matrix.json"],
  },
};

export default nextConfig;
