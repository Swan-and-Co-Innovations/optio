import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@optio/shared"],
  webpack: (config) => {
    // Resolve .js imports to .ts files in workspace packages
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
  async headers() {
    const isProd = process.env.NODE_ENV === "production";
    const baseHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
      {
        key: "Content-Security-Policy-Report-Only",
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline'",
          "connect-src 'self' wss: ws:",
          "img-src 'self' data: https:",
          "font-src 'self' data:",
          "frame-ancestors 'none'",
        ].join("; "),
      },
    ];
    if (isProd) {
      baseHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains; preload",
      });
    }
    return [
      {
        source: "/(.*)",
        headers: baseHeaders,
      },
    ];
  },
};

export default nextConfig;
