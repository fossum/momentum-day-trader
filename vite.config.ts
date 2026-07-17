/**
 * @file vite.config.ts
 * @description Vite configuration file. Configures plugins, path resolution, and development HMR settings.
 */

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

/**
 * Factory function that returns the Vite configuration.
 * @returns {import('vite').UserConfig} The Vite user configuration object.
 */
export default defineConfig(() => {
  const isRemote = process.env.APP_URL && !process.env.APP_URL.includes('localhost');

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR === 'true' ? false : {
        path: 'vite-hmr',
        clientPort: isRemote ? 443 : undefined,
      },
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      allowedHosts: ['trader.thefoss.org'],
    },
  };
});

