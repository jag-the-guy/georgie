import { Pencil } from 'lucide-react';
import type { Card } from '../../shared/types';
import { api } from '../api';
import { formatDays } from '../../shared/formatInterval';

export function CardRow({
  card,
  onClick,
  onEdit,
  subtitle,
}: {
  card: Card;
  /** Clicking the row (to review the card). */
  onClick: () => void;
  onEdit: () => void;
  subtitle?: string;
}) {
  const side = (which: 'front' | 'back', text: string) => {
    const images = card.images.filter((i) => i.side === which);
    return (
      <div className="side">
        <div className="text">{text || <span className="muted">{images.length ? 'Image only' : 'Empty'}</span>}</div>
        {images.length > 0 && (
          <div className="thumbs">
            {images.slice(0, 4).map((i) => (
              <img key={i.id} src={api.imageUrl(i.id)} alt="" loading="lazy" />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="card-row" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      {side('front', card.front)}
      {side('back', card.back)}
      <div className="row-end">
        <div style={{ textAlign: 'right' }}>
          <span className={`state-tag state-${card.state}`}>{card.state}</span>
          <div className="muted small" style={{ marginTop: 6 }}>
            {subtitle ?? (card.state === 'review' ? `every ${formatDays(card.interval_days)}` : '')}
          </div>
        </div>
        <button
          className="icon-btn plain"
          aria-label="Edit card"
          title="Edit card"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          <Pencil size={16} />
        </button>
      </div>
    </div>
  );
}
