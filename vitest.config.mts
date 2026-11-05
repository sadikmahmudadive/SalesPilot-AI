import path from "node:path";
import { defineConfig } from "vitest/config";

const alias = {
  "@": path.resolve(import.meta.dirname, "src"),
  "server-only": path.resolve(import.meta.dirname, "src/test/server-only-stub.ts"),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/.next/**", "src/**/*.int.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["src/**/*.int.test.ts", "tests/rules/**/*.rules.test.ts"],
          exclude: ["**/node_modules/**", "**/.next/**"],
          setupFiles: ["src/test/setup-integration.ts"],
          testTimeout: 20000,
          fileParallelism: false,
        },
      },
    ],
  },
});
