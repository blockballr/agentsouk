import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.VERCEL ? undefined : "standalone",
  outputFileTracingIncludes: {
    "/*": ["./data/agents.json", "./data/advantage-tasks.json", "./data/delivery-matrix.json", "./data/verifications.json", "./data/performance.json"],
    "/api/*": ["./data/agents.json", "./data/advantage-tasks.json", "./data/delivery-matrix.json", "./data/verifications.json", "./data/performance.json"],
  },
};

export default nextConfig;
