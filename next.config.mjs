import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root so Next.js doesn't infer it from an unrelated
  // lockfile higher up the tree (e.g. ~/package-lock.json).
  outputFileTracingRoot: projectRoot,
};

export default nextConfig;
