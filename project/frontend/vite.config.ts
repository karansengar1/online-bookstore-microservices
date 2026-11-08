import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The gateway allows requests from http://localhost:5173, so the port must not change.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
});
