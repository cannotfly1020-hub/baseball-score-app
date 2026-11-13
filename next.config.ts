import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    // FormData 画像送信 + 長時間 Gemini 解析
    proxyClientMaxBodySize: "50mb",
    proxyTimeout: 300_000, // 5分（旧60s切断が Failed to fetch の主因）
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
