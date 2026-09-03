import { defineConfig } from "vite";

/**
 * 발표 모드 전용 dev server. Remotion 렌더(remotion.config.ts)와는 별개다.
 * @vitejs/plugin-react 는 쓰지 않는다. tsconfig 의 jsx: "react-jsx" 만으로
 * esbuild 가 변환하고, 그 플러그인은 babel peer 충돌을 끌고 온다.
 */
export default defineConfig({
  build: { target: "esnext", outDir: "out/present" },
  optimizeDeps: { esbuildOptions: { target: "esnext" } },
  server: { port: 5273, open: true },
});
