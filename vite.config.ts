import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Базовый путь обязателен для GitHub Pages: сайт проекта живёт в /ratingplus/
// (https://segodnyaev.github.io/ratingplus/)
export default defineConfig({
  plugins: [react()],
  base: '/ratingplus/',
})
