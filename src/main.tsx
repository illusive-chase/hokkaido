import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import './styles.css'
import Gate from './Gate'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Gate />
  </StrictMode>,
)
