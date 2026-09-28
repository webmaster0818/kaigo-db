import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 全ページ force-dynamic（D1から都度読む）ため output:'export' は使わない
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
