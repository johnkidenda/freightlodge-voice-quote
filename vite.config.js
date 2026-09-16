import { defineConfig } from "vite";
import { quoteApiPlugin } from "./server/vite-plugin-api.js";

const pagesBase = "/freightlodge-voice-quote/";
const base = process.env.VITE_BASE || (process.env.GITHUB_ACTIONS ? pagesBase : "/");

export default defineConfig({
  base,
  plugins: [quoteApiPlugin()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
  },
});
