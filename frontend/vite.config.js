import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    define: {
        global: 'window',
        process: {
            env: {}
        }
    },
    server: {
        port: 3001,
        host: true,
        allowedHosts: true,
        proxy: {
            '/api': {
                target: 'http://localhost:5629',
                changeOrigin: true
            }
        }
    }
})
