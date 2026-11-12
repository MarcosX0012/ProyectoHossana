import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * PROXY DE DESARROLLO
 *
 * El backend corre en http://localhost:3000 y este frontend en
 * http://localhost:5173. Sin el proxy serian dos "origenes" distintos
 * y habria que lidiar con CORS y con la cookie de refresco
 * (que el backend envia con SameSite=None).
 *
 * Con el proxy, el navegador solo ve http://localhost:5173: las
 * peticiones a /api y a /ws (Socket.IO) se reenvian al backend y las
 * cookies viajan como si todo viviera en el mismo sitio.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
});
