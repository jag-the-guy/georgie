import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, StickyNote } from 'lucide-react';
import { api } from '../api';
import type { Card } from '../../shared/types';
import { useFolders } from '../state';
import { CardEditor } from '../components/CardEditor';
import { FlipCard } from '../components/FlipCard';
import { Lightbox } from '../components/ui';

/**
 * Flip through a folder's cards (including its subfolders') in order. No scheduling: nothing is
 * saved about how you did, and cards don't wait for a due time. Use Study for spaced repetition.
 */
export function Browse() {
  const folderId = Number(useParams().id);
  const startId = Number(useSearchParams()[0].get('start')) || null;
  const navigate = useNavigate();
  const { byId, pathTo, refresh } = useFolders();

  const [cards, setCards] = useState<Card[] | null>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [editing, setEditing] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);

  useEffect(() => {
    api
      .deepCards(folderId)
      .then((r) => {
        setCards(r.cards);
        const at = startId ? r.cards.findIndex((c) => c.id === startId) : -1;
        setIndex(at >= 0 ? at : 0);
      })
      .catch(() => setCards([]));
  }, [folderId]); // eslint-disable-line react-hooks/exhaustive-deps

  const card = cards?.[index] ?? null;
  const total = cards?.length ?? 0;

  const go = useCallback(
    (delta: number) => {
      if (!cards) return;
      setIndex((i) => Math.min(cards.length - 1, Math.max(0, i + delta)));
      setFlipped(false);
    },
    [cards],
  );

  useEffect(() => {
    if (!card || editing || zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, editing, zoom, go]);

  const folder = byId.get(folderId);
  const title = folder ? pathTo(folderId).map((f) => f.name).join(' / ') : 'Browse';
  // When browsing across subfolders, say which folder this card lives in.
  const cardFolder = card && card.folder_id !== folderId ? pathTo(card.folder_id).map((f) => f.name).join(' / ') : null;

  return (
    <div className="study">
      <div className="study-top">
        <button className="icon-btn" onClick={() => navigate(`/folders/${folderId}`)} aria-label="Back to folder">
          <ArrowLeft size={18} />
        </button>
        <h1 title={title}>{title}</h1>
        {total > 0 && (
          <div className="counts" aria-label="Position">
            <span className="n">
              {index + 1} / {total}
            </span>
          </div>
        )}
      </div>

      {cards?.length === 0 && (
        <div className="empty">
          <StickyNote size={40} />
          <h3>No cards to browse</h3>
          <p>Add some cards to this folder first.</p>
        </div>
      )}

      {card && (
        <>
          {cardFolder && <div className="muted small" style={{ marginBottom: 10 }}>In {cardFolder}</div>}
          <FlipCard
            key={card.id}
            card={card}
            flipped={flipped}
            onFlip={() => setFlipped((f) => !f)}
            onEdit={() => setEditing(true)}
            onZoom={setZoom}
          />
          <div className="browse-nav">
            <button className="btn ghost" onClick={() => go(-1)} disabled={index === 0}>
              <ChevronLeft size={18} /> Previous
            </button>
            <button className="btn" onClick={() => go(1)} disabled={index === total - 1}>
              Next <ChevronRight size={18} />
            </button>
          </div>
          <div className="hint">
            Click the card or press <kbd>Space</kbd> to flip · <kbd>←</kbd> <kbd>→</kbd> to move · browsing doesn't affect your
            spaced repetition
          </div>
        </>
      )}

      {editing && card && (
        <CardEditor
          folderId={card.folder_id}
          card={card}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setEditing(false);
            setCards((all) => all?.map((c) => (c.id === saved.id ? saved : c)) ?? all);
          }}
          onDeleted={() => {
            setEditing(false);
            const next = (cards ?? []).filter((c) => c.id !== card.id);
            setCards(next);
            setIndex((i) => Math.min(i, Math.max(0, next.length - 1)));
            refresh();
          }}
        />
      )}
      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}
