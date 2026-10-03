import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/skylines/',
  server: {
    port: 5174,
    strictPort: true,
  },
})