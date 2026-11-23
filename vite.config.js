import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config.js'
import { customerConfig } from './src/customers.js'

// The customer this build is for (src/customers.js); an unknown one fails the
// build here rather than shipping an extension with no address.
const CUSTOMER = customerConfig(process.env.EXT_CUSTOMER).CUSTOMER

// Popup, service worker and content script from manifest.config.js, by CRXJS.
//
//   make build   -> dist/, the "Load unpacked" directory
//   make dev     -> dist/ kept live, with HMR inside the real extension; the
//                   popup also opens as a plain page at http://localhost:5175/index.html
const PORT = Number(process.env.PORT || 5175)

export default defineConfig({
  define: { __EXT_CUSTOMER__: JSON.stringify(CUSTOMER) },
  plugins: [react(), crx({ manifest })],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 2000
  },
  server: {
    port: PORT,
    strictPort: true, // the extension's HMR client is baked in with this port
    hmr: { port: PORT },
    cors: { origin: [/^chrome-extension:\/\//, /^http:\/\/localhost/] }
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}']
  }
})
