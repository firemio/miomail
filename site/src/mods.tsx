import React from 'react'
import ReactDOM from 'react-dom/client'
import { ModsGuide } from './ModsGuide'
import './site.css'

ReactDOM.createRoot(document.getElementById('mods-root')!).render(
  <React.StrictMode>
    <ModsGuide />
  </React.StrictMode>
)
