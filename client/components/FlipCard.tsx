import { Pencil } from 'lucide-react';
import { api } from '../api';
import type { Card } from '../../shared/types';

/**
 * A two-sided card that flips when clicked. Give it a `key` that changes with the card, so each new
 * card mounts already facing the front (no flip back, and no peek at the next answer).
 */
export function FlipCard({
  card,
  flipped,
  onFlip,
  onEdit,
  onZoom,
}: {
  card: Card;
  flipped: boolean;
  onFlip: () => void;
  onEdit: () => void;
  onZoom: (url: string) => void;
}) {
  const face = (which: 'front' | 'back') => (
    <div>
      {card[which] && <div className="face-text">{card[which]}</div>}
      <div className="face-images" style={card[which] ? { marginTop: 14 } : undefined}>
        {card.images
          .filter((i) => i.side === which)
          .map((i) => (
            <img
              key={i.id}
              src={api.imageUrl(i.id)}
              alt=""
              onClick={(e) => {
                e.stopPropagation(); // enlarge the picture without flipping the card
                onZoom(api.imageUrl(i.id));
              }}
            />
          ))}
      </div>
    </div>
  );

  const header = (label: string) => (
    <div className="face-head">
      <span className="face-label">{label}</span>
      <button
        className="icon-btn plain"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        aria-label="Edit card"
        title="Edit card"
      >
        <Pencil size={16} />
      </button>
    </div>
  );

  return (
    <div className="flip-scene">
      <div
        className={`flip ${flipped ? 'is-flipped' : ''}`}
        onClick={onFlip}
        onKeyDown={(e) => e.key === 'Enter' && onFlip()}
        role="button"
        tabIndex={0}
        aria-label={flipped ? 'Showing the answer. Click to show the question.' : 'Showing the question. Click to show the answer.'}
      >
        <div className="flashcard flip-face" aria-hidden={flipped}>
          {header('Question')}
          {face('front')}
        </div>
        <div className="flashcard flip-face back" aria-hidden={!flipped}>
          {header('Answer')}
          {face('back')}
        </div>
      </div>
    </div>
  );
}
