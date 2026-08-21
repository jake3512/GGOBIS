import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The SQLite file is opened dynamically (not `import`ed), so Next's file
  // tracer can't discover it on its own — without this, Vercel's serverless
  // bundle for these routes wouldn't include prisma/dev.db and every DB
  // query would fail at runtime with "no such file".
  outputFileTracingIncludes: {
    "/api/**": ["./prisma/dev.db"],
  },
};

export default nextConfig;
