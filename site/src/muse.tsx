import React from 'react'
import ReactDOM from 'react-dom/client'
import { MuseGuide } from './MuseGuide'
import './site.css'

ReactDOM.createRoot(document.getElementById('muse-root')!).render(
  <React.StrictMode>
    <MuseGuide />
  </React.StrictMode>
)
