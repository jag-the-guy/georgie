import { useState, type FormEvent } from 'react';
import { api } from '../api';
import type { Folder } from '../../shared/types';
import { DEFAULT_CONFIG } from '../../shared/srsConfig';
import { Modal } from './ui';

export const COLORS = ['lavender', 'peach', 'sky', 'mint', 'rose', 'lemon'];

/** Create a folder (when `folder` is omitted) or edit an existing one. */
export function FolderDialog({
  folder,
  parentId,
  onClose,
  onSaved,
}: {
  folder?: Folder;
  parentId?: number | null;
  onClose: () => void;
  onSaved: (f: Folder) => void;
}) {
  const [name, setName] = useState(folder?.name ?? '');
  const [color, setColor] = useState<string | undefined>(folder?.color);
  const [newPerDay, setNewPerDay] = useState(folder?.new_per_day?.toString() ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const limit = newPerDay.trim() === '' ? null : Number(newPerDay);
      if (limit !== null && (!Number.isInteger(limit) || limit < 0)) throw new Error('New cards per day must be a whole number');
      const saved = folder
        ? (await api.updateFolder(folder.id, { name, color, new_per_day: limit })).folder
        : (await api.createFolder({ name, parent_id: parentId ?? null, color, new_per_day: limit })).folder;
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={folder ? 'Folder settings' : parentId ? 'New subfolder' : 'New folder'} onClose={onClose}>
      <form onSubmit={submit}>
        {error && <div className="error">{error}</div>}
        <div className="field">
          <label htmlFor="folder-name">Name</label>
          <input id="folder-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={100} required />
        </div>
        <div className="field">
          <label>Colour</label>
          <div className="swatches">
            {COLORS.map((c) => (
              <button
                type="button"
                key={c}
                className={`swatch c-${c} ${color === c ? 'selected' : ''}`}
                onClick={() => setColor(c)}
                aria-label={c}
              />
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="folder-limit">New cards per day</label>
          <input
            id="folder-limit"
            className="input"
            type="number"
            min={0}
            placeholder={`Default (${DEFAULT_CONFIG.newPerDay})`}
            value={newPerDay}
            onChange={(e) => setNewPerDay(e.target.value)}
          />
          <span className="muted small">How many unseen cards to introduce each day when studying this folder.</span>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" disabled={busy || !name.trim()}>
            {folder ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
