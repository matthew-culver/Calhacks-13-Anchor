import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        // Screens (Person B): React components in a browser-like DOM.
        plugins: [react()],
        resolve: {
          alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
        },
        test: {
          name: "app",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: ["src/**/*.test.{ts,tsx}"],
        },
      },
      {
        // Backend (Person A): Convex functions via convex-test, in the edge runtime Convex uses.
        test: {
          name: "convex",
          environment: "edge-runtime",
          include: ["convex/**/*.test.ts"],
          server: { deps: { inline: ["convex-test"] } },
        },
      },
    ],
  },
});
