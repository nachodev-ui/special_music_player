import { Minus, Square, X, Music2 } from 'lucide-react';

export function TitleBar() {
  return <header className="titlebar">
    <div className="window-brand"><Music2 size={15} /><span>suki's room</span><span className="titlebar-dot">·</span><span className="titlebar-note">un lugar para nosotros</span></div>
    <div className="window-actions">
      <button aria-label="Minimizar ventana" onClick={() => void window.desktop?.windowControl('minimize')}><Minus size={15} /></button>
      <button aria-label="Maximizar o restaurar ventana" onClick={() => void window.desktop?.windowControl('maximize')}><Square size={12} /></button>
      <button className="window-close" aria-label="Cerrar ventana" onClick={() => void window.desktop?.windowControl('close')}><X size={16} /></button>
    </div>
  </header>;
}
