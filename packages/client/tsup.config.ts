import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      "core/index": "src/core/index.ts",
      "utils/index": "src/utils/index.ts",
      "elements/index": "src/elements/index.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: true,
    treeshake: true,
  },
  {
    entry: { "react/index": "src/react/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    splitting: true,
    treeshake: true,
    external: ["react"],
    esbuildOptions(options) {
      options.jsx = "automatic";
    },
  },
]);
