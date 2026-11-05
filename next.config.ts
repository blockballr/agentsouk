import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  output: process.env.VERCEL ? undefined : "standalone",
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  outputFileTracingIncludes: {
    "/*": ["./data/agents.json", "./data/agents-97.json", "./data/scout-97/verifications.json", "./data/advantage-tasks.json", "./data/delivery-matrix.json", "./data/verifications.json", "./data/performance.json", "./data/seeded-endpoints.json", "./packages/vault-sdk/dist/**"],
    "/api/*": ["./data/agents.json", "./data/agents-97.json", "./data/scout-97/verifications.json", "./data/advantage-tasks.json", "./data/delivery-matrix.json", "./data/verifications.json", "./data/performance.json", "./data/seeded-endpoints.json", "./packages/vault-sdk/dist/**"],
  },
};

export default nextConfig;
