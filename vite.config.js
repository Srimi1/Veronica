import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src',
  publicDir: false,
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**']
    }
  },
  build: {
    target: ['es2021', 'chrome100', 'safari14'],
    outDir: '../dist',
    emptyOutDir: true
  }
})
