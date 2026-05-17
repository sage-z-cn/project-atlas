import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/extension.ts"),
      formats: ["cjs"],
      fileName: () => "extension.js",
    },
    outDir: "out",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      external: ["vscode", "path", "fs", "crypto", "child_process"],
    },
    minify: "esbuild",
  },
});
