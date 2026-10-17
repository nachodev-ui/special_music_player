import { useEffect, useId, useRef, type RefObject } from 'react';
import { room3d } from './room3d.config';

export function OutfitDialog({ outfit, onChoose, onClose, fallbackFocus }: {
  outfit: string; onChoose: (outfit: string) => void; onClose: () => void;
  fallbackFocus: RefObject<HTMLButtonElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const available = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    available.current?.focus();
    return () => {
      element.close();
      const target = previous && previous !== document.body && previous.isConnected ? previous : fallbackFocus.current;
      target?.focus();
    };
  }, [fallbackFocus]);
  return <dialog ref={dialog} className="room-outfit-dialog" aria-modal="true" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key !== 'Tab') return;
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <style>{`
      .room-outfit-dialog { box-sizing: border-box; width: min(620px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); padding: 24px; border: 1px solid var(--tint); border-radius: 22px; background: var(--surface); color: var(--ink); font-family: inherit; box-shadow: 0 16px 48px color-mix(in srgb, var(--ink) 22%, transparent); }
      .room-outfit-dialog::backdrop { background: color-mix(in srgb, var(--ink) 38%, transparent); }
      .room-outfit-dialog header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
      .room-outfit-dialog h2 { margin: 0 0 6px; font-size: 22px; font-weight: 800; }
      .room-outfit-dialog p { margin: 0; color: var(--muted); font-size: 14px; }
      .room-outfit-close { flex-shrink: 0; width: 36px; height: 36px; border: 1px solid var(--tint); border-radius: 10px; background: var(--bg); color: var(--ink); font-size: 24px; cursor: pointer; }
      .room-outfit-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
      .room-outfit-option { min-width: 0; display: flex; flex-direction: column; gap: 12px; padding: 12px; border: 1px solid var(--tint); border-radius: 18px; background: var(--bg); color: var(--ink); font: inherit; text-align: left; cursor: pointer; }
      .room-outfit-option img { display: block; width: 100%; height: clamp(180px, 37vh, 320px); object-fit: contain; border-radius: 10px; }
      .room-outfit-option-label { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; font-weight: 800; }
      .room-outfit-worn { padding: 3px 8px; border-radius: 8px; background: var(--tint); color: var(--ink); font-size: 12px; font-weight: 700; }
      .room-outfit-option:disabled { opacity: 1; border-color: var(--accent); cursor: default; }
      .room-outfit-option:not(:disabled):hover, .room-outfit-close:hover { background: var(--tint); }
      .room-outfit-dialog button:focus-visible { outline: 2px solid var(--accent-deep); outline-offset: 3px; }
      @media (max-width: 420px) { .room-outfit-dialog { padding: 18px; } .room-outfit-options { grid-template-columns: 1fr; } }
      @media (prefers-reduced-motion: reduce) { .room-outfit-dialog, .room-outfit-dialog button { animation: none; transition: none; transform: none; } }
    `}</style>
    <header><div><h2 id={titleId}>Ropero</h2><p>Elige el outfit de Mikako.</p></div>
      <button type="button" className="room-outfit-close" aria-label="Cerrar ropero" onClick={onClose}>×</button>
    </header>
    <div className="room-outfit-options">
      {room3d.mikako.outfits.map(item => {
        const worn = item.id === outfit;
        return <button key={item.id} ref={worn ? undefined : available} type="button" className="room-outfit-option"
          disabled={worn} aria-disabled={worn} onClick={worn ? undefined : () => onChoose(item.id)}>
          <img src={import.meta.env.BASE_URL + item.preview} alt={`Outfit ${item.label} de Mikako`} />
          <span className="room-outfit-option-label">{item.label}{worn && <span className="room-outfit-worn">Puesto</span>}</span>
        </button>;
      })}
    </div>
  </dialog>;
}
