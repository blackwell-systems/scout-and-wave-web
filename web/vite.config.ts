/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'codemirror': [
            '@uiw/react-codemirror',
            '@codemirror/lang-go',
            '@codemirror/lang-javascript',
            '@codemirror/lang-python',
            '@codemirror/theme-one-dark',
          ],
          'markdown': ['react-markdown'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
})
