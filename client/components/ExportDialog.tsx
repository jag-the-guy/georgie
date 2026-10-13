import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Download } from 'lucide-react';
import { api, type FolderWithStats } from '../api';
import { useFolders } from '../state';
import { Modal, plural } from './ui';

/** Choose which folders to export, as a tree of checkboxes. Ticking a folder ticks everything inside it. */
export function ExportDialog({ initial, onClose }: { initial?: number[]; onClose: () => void }) {
  const { folders, childrenOf } = useFolders();

  const rows = useMemo(() => {
    const out: { folder: FolderWithStats; depth: number }[] = [];
    const walk = (parent: number | null, depth: number) => {
      for (const f of childrenOf(parent)) {
        out.push({ folder: f, depth });
        walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [folders, childrenOf]);

  // card_count includes subfolders; the export lists each folder's own cards, so work those out.
  const own = useMemo(() => {
    const m = new Map<number, number>();
    for (const f of folders) m.set(f.id, f.card_count - childrenOf(f.id).reduce((n, c) => n + c.card_count, 0));
    return m;
  }, [folders, childrenOf]);

  const subtree = (id: number): number[] => [id, ...childrenOf(id).flatMap((c) => subtree(c.id))];

  const [selected, setSelected] = useState<Set<number>>(() => new Set(initial ?? folders.map((f) => f.id)));

  const toggle = (id: number) => {
    const ids = subtree(id);
    const everyOn = ids.every((i) => selected.has(i));
    setSelected((s) => {
      const next = new Set(s);
      for (const i of ids) everyOn ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const chosen = folders.filter((f) => selected.has(f.id));
  const cardCount = chosen.reduce((n, f) => n + (own.get(f.id) ?? 0), 0);
  const everything = chosen.length === folders.length;

  // Fetch the file ourselves (so a failure shows a message instead of silently saving nothing), then hand it to the
  // browser. The dialog stays open with a real "Download" link, which always works because you click it yourself.
  const [phase, setPhase] = useState<'choose' | 'working' | 'saved'>('choose');
  const [error, setError] = useState('');
  const [file, setFile] = useState<{ name: string; url: string; cards: number } | null>(null);
  useEffect(() => () => void (file && URL.revokeObjectURL(file.url)), [file]);

  const download = async () => {
    setPhase('working');
    setError('');
    try {
      const res = await fetch(api.exportUrl(everything ? undefined : chosen.map((f) => f.id)), { credentials: 'same-origin' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(res.status === 401 ? 'You have been logged out. Please log in again.' : (body.error ?? 'The export failed. Please try again.'));
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'georgie-flashcards.csv';
      const url = URL.createObjectURL(new Blob([await res.blob()], { type: 'text/csv' }));
      setFile({ name, url, cards: cardCount });
      setPhase('saved');
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setError((e as Error).message);
      setPhase('choose');
    }
  };

  if (phase === 'saved' && file) {
    return (
      <Modal title="Export to CSV" onClose={onClose}>
        <div className="export-done">
          <CheckCircle2 size={40} />
          <h3>{file.name}</h3>
          <p className="muted">
            {plural(file.cards, 'card')} exported. Your browser should have saved it to your <b>Downloads</b> folder.
          </p>
          <a className="btn" href={file.url} download={file.name}>
            <Download size={16} /> Download again
          </a>
          <p className="muted small">
            Nothing in Downloads? Your browser may have blocked it: check for a download or "blocked" icon in its address bar, or click the button above.
            If you are viewing this inside another app's built-in browser, open Georgie in Chrome or Safari instead, since built-in browsers often can't save files.
          </p>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>
            Done
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Export to CSV" onClose={onClose}>
      <p className="muted small" style={{ marginTop: -8 }}>
        Tick the folders to include. The file has three columns (Folder, Front, Back) and opens in Excel, Google Sheets, or other flashcard apps.
      </p>
      <div className="export-actions">
        <button className="link" onClick={() => setSelected(new Set(folders.map((f) => f.id)))}>
          Select all
        </button>
        <button className="link" onClick={() => setSelected(new Set())}>
          Select none
        </button>
      </div>
      <div className="export-tree" role="group" aria-label="Folders to export">
        {rows.map(({ folder, depth }) => {
          const ids = subtree(folder.id);
          const on = ids.filter((i) => selected.has(i)).length;
          const all = on === ids.length;
          const mixed = on > 0 && !all;
          return (
            <label className="export-row" key={folder.id} style={{ paddingLeft: 10 + depth * 22 }}>
              <input
                type="checkbox"
                checked={all}
                ref={(el) => {
                  if (el) el.indeterminate = mixed;
                }}
                onChange={() => toggle(folder.id)}
              />
              <span className={`dot c-${folder.color}`} />
              <span className="export-name">{folder.name}</span>
              <span className="muted small">{plural(own.get(folder.id) ?? 0, 'card')}</span>
            </label>
          );
        })}
        {rows.length === 0 && <div className="muted small" style={{ padding: 12 }}>You have no folders yet.</div>}
      </div>
      {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
      <div className="modal-foot">
        <span className="export-total muted small">
          {plural(cardCount, 'card')} in {plural(chosen.length, 'folder')}
        </span>
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn" onClick={download} disabled={cardCount === 0 || phase === 'working'}>
          <Download size={16} /> {phase === 'working' ? 'Preparing…' : `Export ${plural(cardCount, 'card')}`}
        </button>
      </div>
    </Modal>
  );
}
