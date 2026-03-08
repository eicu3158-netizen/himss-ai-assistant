import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 針對所有檔案都在根目錄的平鋪結構進行優化
export default defineConfig({
  plugins: [react()],
  build: {
    // 確保輸出目錄為 dist
    outDir: 'dist',
    rollupOptions: {
      // 明確指定入口文件為根目錄的 index.html
      input: './index.html',
    },
  },
  // 強制設定根目錄為當前資料夾，確保 Vite 能找到 main.jsx 與 index.jsx
  root: './'
})