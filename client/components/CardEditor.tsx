import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent } from 'react';
import { ImagePlus, Trash2, X } from 'lucide-react';
import { api } from '../api';
import type { Card } from '../../shared/types';
import { Modal } from './ui';

type Side = 'front' | 'back';
const ACCEPTED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;

interface Pending {
  key: string;
  file: File;
  url: string;
  side: Side;
}

/** Create a card (when `card` is omitted) or edit one. Images are uploaded when the card is saved. */
export function CardEditor({
  folderId,
  card,
  onClose,
  onSaved,
  onDeleted,
}: {
  folderId: number;
  card?: Card;
  onClose: () => void;
  onSaved: (card: Card, keepOpen: boolean) => void;
  onDeleted?: () => void;
}) {
  const [front, setFront] = useState(card?.front ?? '');
  const [back, setBack] = useState(card?.back ?? '');
  const [pending, setPending] = useState<Pending[]>([]);
  const [removed, setRemoved] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const frontRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => () => pending.forEach((p) => URL.revokeObjectURL(p.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = (files: File[], side: Side) => {
    const ok: Pending[] = [];
    for (const file of files) {
      if (!ACCEPTED.includes(file.type)) {
        setError('Only PNG, JPEG, GIF and WebP images are supported');
        continue;
      }
      if (file.size > MAX_BYTES) {
        setError(`${file.name || 'That image'} is larger than 10 MB`);
        continue;
      }
      ok.push({ key: crypto.randomUUID(), file, url: URL.createObjectURL(file), side });
    }
    setPending((p) => [...p, ...ok]);
  };

  const existing = (side: Side) => (card?.images ?? []).filter((i) => i.side === side && !removed.includes(i.id));
  const hasFrontContent = front.trim() !== '' || existing('front').length > 0 || pending.some((p) => p.side === 'front');

  const save = async (keepOpen: boolean) => {
    if (!hasFrontContent) {
      setError('Add a question or an image to the front of the card');
      return;
    }
    setBusy(true);
    setError('');
    try {
      let saved = card
        ? (await api.updateCard(card.id, { front, back })).card
        : (await api.createCard(folderId, { front, back })).card;
      for (const id of removed) saved = (await api.deleteImage(id)).card;
      for (const side of ['front', 'back'] as Side[]) {
        const files = pending.filter((p) => p.side === side).map((p) => p.file);
        if (files.length) saved = (await api.uploadImages(saved.id, side, files)).card;
      }
      pending.forEach((p) => URL.revokeObjectURL(p.url));
      onSaved(saved, keepOpen);
      if (keepOpen) {
        setFront('');
        setBack('');
        setPending([]);
        setBusy(false);
        frontRef.current?.focus();
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save(false);
  };

  const remove = async () => {
    if (!card || !confirm('Delete this card? Its review history is kept, but the card and its images are removed.')) return;
    setBusy(true);
    try {
      await api.deleteCard(card.id);
      onDeleted?.();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const sideEditor = (side: Side, value: string, setValue: (v: string) => void) => (
    <div className="field">
      <label htmlFor={`card-${side}`}>{side === 'front' ? 'Front (question)' : 'Back (answer)'}</label>
      <textarea
        id={`card-${side}`}
        ref={side === 'front' ? frontRef : undefined}
        className="textarea"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onPaste={(e) => pasteImages(e, side)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save(!card);
          }
        }}
        autoFocus={side === 'front'}
        placeholder={side === 'front' ? 'What do you want to remember?' : 'The answer'}
        maxLength={20000}
      />
      <ImageDrop
        side={side}
        onFiles={(files) => addFiles(files, side)}
        existing={existing(side).map((i) => ({ key: `e${i.id}`, url: api.imageUrl(i.id), onRemove: () => setRemoved((r) => [...r, i.id]) }))}
        pending={pending
          .filter((p) => p.side === side)
          .map((p) => ({
            key: p.key,
            url: p.url,
            onRemove: () => {
              URL.revokeObjectURL(p.url);
              setPending((all) => all.filter((x) => x.key !== p.key));
            },
          }))}
      />
    </div>
  );

  const pasteImages = (e: ClipboardEvent, side: Side) => {
    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      addFiles(files, side);
    }
  };

  return (
    <Modal title={card ? 'Edit card' : 'New card'} onClose={onClose} wide>
      <form onSubmit={submit}>
        {error && <div className="error">{error}</div>}
        <div className="editor-sides">
          {sideEditor('front', front, setFront)}
          {sideEditor('back', back, setBack)}
        </div>
        <div className="modal-foot">
          {card && (
            <button type="button" className="btn danger" onClick={remove} disabled={busy}>
              <Trash2 size={16} /> Delete
            </button>
          )}
          <span className="spacer" />
          {!card && (
            <button type="button" className="btn secondary" onClick={() => save(true)} disabled={busy} title="⌘ Enter">
              Save & add another
            </button>
          )}
          <button className="btn" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface Thumb {
  key: string;
  url: string;
  onRemove: () => void;
}

function ImageDrop({ side, onFiles, existing, pending }: { side: Side; onFiles: (f: File[]) => void; existing: Thumb[]; pending: Thumb[] }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const thumbs = [...existing, ...pending];

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    onFiles(Array.from(e.dataTransfer.files));
  };

  return (
    <div
      className={`drop ${over ? 'over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      {thumbs.length > 0 && (
        <div className="thumb-grid">
          {thumbs.map((t) => (
            <div className="thumb" key={t.key}>
              <img src={t.url} alt="" />
              <button type="button" onClick={t.onRemove} aria-label="Remove image">
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="drop-actions">
        <button type="button" className="btn ghost small" onClick={() => input.current?.click()}>
          <ImagePlus size={15} /> Add image
        </button>
        <span>or drop / paste a screenshot here</span>
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPTED.join(',')}
        multiple
        hidden
        aria-label={`Add images to the ${side}`}
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </div>
  );
}
