import type { NextConfig } from "next";
import { securityHeaders } from "./src/config/security-headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["firebase-admin"],
  async headers() {
    // Fail closed: only `next dev` gets the relaxed policy; any other NODE_ENV
    // (production, test, unset, typos) gets the strict production policy.
    const isDev = process.env.NODE_ENV === "development";
    return [
      {
        source: "/(.*)",
        headers: securityHeaders(isDev),
      },
    ];
  },
};

export default nextConfig;
