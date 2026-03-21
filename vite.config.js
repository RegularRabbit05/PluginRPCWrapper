import {defineConfig} from 'vite';

export default defineConfig({
  server: {
    allowedHosts: true,
    hmr: {
      clientPort: 443,
    },
  },
});
