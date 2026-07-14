import React from 'react'
import ReactDOM from 'react-dom/client'
import { MioMailSite } from './MioMailSite'
import '../../src/renderer/styles/globals.css'
import './site.css'

ReactDOM.createRoot(document.getElementById('site-root')!).render(
  <React.StrictMode>
    <MioMailSite />
  </React.StrictMode>
)
