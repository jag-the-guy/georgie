import { useEffect, type ReactNode } from 'react';
import { X, BookOpen, Brain, FlaskConical, Globe, Code, Calculator, Music, Palette, Atom, Leaf, Landmark, Languages } from 'lucide-react';

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="3" y="9" width="14" height="14" rx="3" transform="rotate(45 10 16)" fill="var(--color-primary)" />
      <rect x="13" y="9" width="14" height="14" rx="3" transform="rotate(45 20 16)" fill="var(--color-logo-2)" opacity=".9" />
    </svg>
  );
}

const FOLDER_ICONS = [BookOpen, Brain, FlaskConical, Globe, Code, Calculator, Music, Palette, Atom, Leaf, Landmark, Languages];

export function FolderIcon({ id, size = 20 }: { id: number; size?: number }) {
  const Icon = FOLDER_ICONS[id % FOLDER_ICONS.length];
  return <Icon size={size} strokeWidth={1.8} />;
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn plain" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="lightbox" onClick={onClose}>
      <img src={src} alt="" />
    </div>
  );
}

export function Ring({ percent, color = 'var(--color-primary)', track = 'var(--color-border)' }: { percent: number; color?: string; track?: string }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring">
      <svg width="40" height="40" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={r} fill="none" stroke={track} strokeWidth="3.5" />
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(100, Math.max(0, percent)) / 100)}
        />
      </svg>
      <b>{Math.round(percent)}%</b>
    </div>
  );
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
