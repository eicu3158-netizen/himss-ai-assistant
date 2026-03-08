import React from 'react'
import ReactDOM from 'react-dom/client'
// 修正：必須指向與 Canvas 中主程式一致的檔名 App.jsx
import App from './App.jsx'

// 將 React 內容掛載到 index.html 中的 <div id="root"></div>
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)