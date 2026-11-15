import { defineConfig } from "vite";

// Relative base so it works on GitHub Pages under /decoy-cipher/ and anywhere else.
export default defineConfig({
  base: "./",
  build: { target: "es2022" },
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
});
