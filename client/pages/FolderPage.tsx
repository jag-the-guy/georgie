import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, FolderPlus, MoreHorizontal, Play, Plus, Settings, StickyNote, Trash2, FolderInput, RotateCcw, Layers, Download } from 'lucide-react';
import { api } from '../api';
import type { Card } from '../../shared/types';
import { useFolders } from '../state';
import { TopBar } from '../components/TopBar';
import { AddTile, FolderTile } from '../components/FolderTile';
import { CardEditor } from '../components/CardEditor';
import { CardRow } from '../components/CardRow';
import { FolderDialog } from '../components/FolderDialog';
import { ExportDialog } from '../components/ExportDialog';
import { Modal, plural } from '../components/ui';
import { useLayout } from './Layout';

export function FolderPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { byId, childrenOf, pathTo, refresh, loaded, folders } = useFolders();
  const { newFolder } = useLayout();
  const folder = byId.get(id);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [editing, setEditing] = useState<Card | 'new' | null>(null);
  const [settings, setSettings] = useState(false);
  const [moving, setMoving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const loadCards = useCallback(() => {
    api.cards(id).then((r) => setCards(r.cards)).catch(() => setCards([]));
  }, [id]);

  useEffect(() => {
    setCards(null);
    loadCards();
  }, [loadCards]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  if (loaded && !folder) {
    return (
      <div className="empty">
        <h3>Folder not found</h3>
        <p>It may have been deleted.</p>
        <Link className="btn" to="/">
          Back to dashboard
        </Link>
      </div>
    );
  }
  if (!folder) return null;

  const subfolders = childrenOf(id);
  const crumbs = pathTo(id).slice(0, -1);

  const resetProgress = async () => {
    setMenu(false);
    const where = subfolders.length ? ` and its ${plural(subfolders.length, 'subfolder')}` : '';
    if (
      !confirm(
        `Reset progress for “${folder.name}”${where}?\n\nAll ${plural(folder.card_count, 'card')} will go back to new and be studied from the start. The cards themselves are kept.`,
      )
    )
      return;
    try {
      await api.resetFolder(id);
      loadCards();
      await refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const deleteFolder = async () => {
    setMenu(false);
    const what = [plural(folder.card_count, 'card'), subfolders.length ? plural(subfolders.length, 'subfolder') : '']
      .filter(Boolean)
      .join(' and ');
    if (!confirm(`Delete “${folder.name}” and everything in it (${what})? This can't be undone.`)) return;
    await api.deleteFolder(id);
    await refresh();
    navigate(folder.parent_id ? `/folders/${folder.parent_id}` : '/');
  };

  // Candidate parents for "Move": anywhere except this folder and its descendants.
  const descendants = new Set<number>();
  const collect = (fid: number) => {
    descendants.add(fid);
    childrenOf(fid).forEach((c) => collect(c.id));
  };
  collect(id);
  const moveTargets = folders.filter((f) => !descendants.has(f.id));

  return (
    <>
      <div className="breadcrumb">
        <Link to="/">Dashboard</Link>
        {crumbs.map((c) => (
          <span key={c.id} style={{ display: 'contents' }}>
            <ChevronRight size={14} />
            <Link to={`/folders/${c.id}`}>{c.name}</Link>
          </span>
        ))}
      </div>
      <TopBar title={folder.name}>
        <button className="btn ghost" onClick={() => navigate(`/browse/${id}`)} disabled={folder.card_count === 0} title="Flip through every card in order">
          <Layers size={16} /> Browse
        </button>
        <button className="btn" onClick={() => navigate(`/study/${id}`)} disabled={folder.card_count === 0}>
          <Play size={16} /> Study{folder.due_count ? ` (${folder.due_count})` : ''}
        </button>
        <div className="menu-wrap" ref={menuRef}>
          <button className="icon-btn" onClick={() => setMenu(!menu)} aria-label="Folder options">
            <MoreHorizontal size={18} />
          </button>
          {menu && (
            <div className="menu">
              <button onClick={() => (setMenu(false), setSettings(true))}>
                <Settings size={16} /> Settings
              </button>
              <button onClick={() => (setMenu(false), setMoving(true))}>
                <FolderInput size={16} /> Move
              </button>
              <button onClick={() => (setMenu(false), setExporting(true))} disabled={folder.card_count === 0}>
                <Download size={16} /> Export to CSV…
              </button>
              <button onClick={resetProgress} disabled={folder.card_count === 0}>
                <RotateCcw size={16} /> Reset progress
              </button>
              <button className="danger" onClick={deleteFolder}>
                <Trash2 size={16} /> Delete folder
              </button>
            </div>
          )}
        </div>
      </TopBar>

      <section className="section">
        <div className="section-head">
          <h2>Subfolders</h2>
          <button className="btn secondary small" onClick={() => newFolder(id)}>
            <FolderPlus size={16} /> New subfolder
          </button>
        </div>
        {subfolders.length === 0 ? (
          <div className="muted small">No subfolders yet. Use them to split a topic into smaller decks.</div>
        ) : (
          <div className="tiles">
            {subfolders.map((f) => (
              <FolderTile key={f.id} folder={f} />
            ))}
            <AddTile label="New subfolder" onClick={() => newFolder(id)} />
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Cards {cards && cards.length > 0 && <span className="muted small">({cards.length})</span>}</h2>
          <button className="btn small" onClick={() => setEditing('new')}>
            <Plus size={16} /> Add card
          </button>
        </div>
        {cards === null ? null : cards.length === 0 ? (
          <div className="empty">
            <StickyNote size={40} />
            <h3>No cards in this folder yet</h3>
            <p>Add a question on the front and the answer on the back. You can paste screenshots too.</p>
            <button className="btn" onClick={() => setEditing('new')}>
              <Plus size={16} /> Add card
            </button>
          </div>
        ) : (
          <div className="card-list">
            {cards.map((c) => (
              <CardRow key={c.id} card={c} onClick={() => navigate(`/browse/${id}?start=${c.id}`)} onEdit={() => setEditing(c)} />
            ))}
          </div>
        )}
      </section>

      {editing && (
        <CardEditor
          folderId={id}
          card={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(_card, keepOpen) => {
            if (!keepOpen) setEditing(null);
            loadCards();
            refresh();
          }}
          onDeleted={() => {
            setEditing(null);
            loadCards();
            refresh();
          }}
        />
      )}
      {exporting && <ExportDialog initial={[...descendants]} onClose={() => setExporting(false)} />}
      {settings && (
        <FolderDialog
          folder={folder}
          onClose={() => setSettings(false)}
          onSaved={() => {
            setSettings(false);
            refresh();
          }}
        />
      )}
      {moving && (
        <MoveDialog
          current={folder.parent_id}
          targets={moveTargets.map((f) => ({ id: f.id, label: pathTo(f.id).map((p) => p.name).join(' / ') }))}
          onClose={() => setMoving(false)}
          onMove={async (parentId) => {
            await api.updateFolder(id, { parent_id: parentId });
            setMoving(false);
            refresh();
          }}
        />
      )}
    </>
  );
}

function MoveDialog({
  current,
  targets,
  onClose,
  onMove,
}: {
  current: number | null;
  targets: { id: number; label: string }[];
  onClose: () => void;
  onMove: (parentId: number | null) => Promise<void>;
}) {
  const [value, setValue] = useState(current === null ? '' : String(current));
  const [error, setError] = useState('');
  return (
    <Modal title="Move folder" onClose={onClose}>
      {error && <div className="error">{error}</div>}
      <div className="field">
        <label htmlFor="move-to">Move into</label>
        <select id="move-to" className="select" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Top level</option>
          {targets
            .sort((a, b) => a.label.localeCompare(b.label))
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
        </select>
      </div>
      <div className="modal-foot">
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn" onClick={() => onMove(value === '' ? null : Number(value)).catch((e) => setError(e.message))}>
          Move
        </button>
      </div>
    </Modal>
  );
}
