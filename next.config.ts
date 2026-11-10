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
    "/*": ["./data/agents.json", "./data/agents-97.json", "./data/scout-97/verifications.json", "./data/advantage.json", "./data/delivery-matrix.json", "./data/verifications.json", "./data/performance.json", "./data/recovered-endpoints.json", "./packages/vault-sdk/dist/**", "./skill/**/*.md"],
    "/api/*": ["./data/agents.json", "./data/agents-97.json", "./data/scout-97/verifications.json", "./data/advantage.json", "./data/delivery-matrix.json", "./data/verifications.json", "./data/performance.json", "./data/recovered-endpoints.json", "./packages/vault-sdk/dist/**"],
    "/skill/*": ["./skill/**/*.md"],
  },
};

export default nextConfig;
