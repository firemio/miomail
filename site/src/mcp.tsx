import React from 'react'
import ReactDOM from 'react-dom/client'
import { McpGuide } from './McpGuide'
import './site.css'

ReactDOM.createRoot(document.getElementById('mcp-root')!).render(
  <React.StrictMode>
    <McpGuide />
  </React.StrictMode>
)
