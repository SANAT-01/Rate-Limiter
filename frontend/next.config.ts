import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal, dependency-free production image: `next build` copies only the
  // files actually needed into .next/standalone, which the Dockerfile runs.
  output: "standalone",

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
