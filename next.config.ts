import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Turbopack's route runtime is loaded dynamically and can be missed by tracing.
  outputFileTracingIncludes: {
    "/*": ["./node_modules/next/dist/compiled/next-server/*.runtime.prod.js"],
  },
  // Desktop resources are copied separately; never trace previous packages into the server.
  // `/*` 只匹配一层，像 `/page` 这种顶层入口漏不掉，但再深一层的就漏了；
  // 之前 dist/ 里躺着几百 MB 的旧安装包，追踪去读它会直接 os error 1450。
  outputFileTracingExcludes: {
    "/*": ["./dist/**/*", "./packaging/**/*", "./electron-dist/**/*"],
    "/**": ["./dist/**/*", "./packaging/**/*", "./electron-dist/**/*"],
  },
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
