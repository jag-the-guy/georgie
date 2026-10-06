import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import type { Card } from '../../shared/types';
import { useFolders } from '../state';
import { TopBar } from '../components/TopBar';
import { CardRow } from '../components/CardRow';
import { CardEditor } from '../components/CardEditor';

export function SearchPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const { pathTo, refresh } = useFolders();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [editing, setEditing] = useState<Card | null>(null);

  const load = () => {
    if (q.trim()) api.search(q).then((r) => setCards(r.cards)).catch(() => setCards([]));
  };
  useEffect(load, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <TopBar key={q} title="Search" />
      <section className="section">
        <div className="section-head">
          <h2>
            Results for “{q}” {cards && <span className="muted small">({cards.length})</span>}
          </h2>
        </div>
        {cards?.length === 0 && <div className="empty">No cards match that search.</div>}
        <div className="card-list">
          {cards?.map((c) => (
            <CardRow
              key={c.id}
              card={c}
              onClick={() => navigate(`/browse/${c.folder_id}?start=${c.id}`)}
              onEdit={() => setEditing(c)}
              subtitle={pathTo(c.folder_id)
                .map((f) => f.name)
                .join(' / ')}
            />
          ))}
        </div>
      </section>
      {editing && (
        <CardEditor
          folderId={editing.folder_id}
          card={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
          onDeleted={() => {
            setEditing(null);
            load();
            refresh();
          }}
        />
      )}
    </>
  );
}
