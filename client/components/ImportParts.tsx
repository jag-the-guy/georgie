import { useMemo } from 'react';
import { ArrowLeftRight, RefreshCw } from 'lucide-react';
import { useFolders } from '../state';
import type { ImportDestination } from '../api';

export interface SampleView {
  path: string[];
  front: string;
  back: string;
  frontImages?: string[];
  backImages?: string[];
}

/** Three example cards, laid out like Georgie's study card: question on the left, answer (tinted) on the right. */
export function SamplePreview({ samples, loading, onShuffle, canShuffle }: { samples: SampleView[]; loading?: boolean; onShuffle: () => void; canShuffle: boolean }) {
  return (
    <section className="import-section">
      <div className="section-head">
        <div>
          <h2>How it will look in Georgie</h2>
          <div className="muted small">{samples.length > 0 ? `${samples.length} example ${samples.length === 1 ? 'card' : 'cards'} from your file` : 'No cards found yet'}</div>
        </div>
        <button className="btn ghost small" onClick={onShuffle} disabled={!canShuffle || loading}>
          <RefreshCw size={15} /> Show different cards
        </button>
      </div>
      <div className={`samples ${loading ? 'is-loading' : ''}`}>
        {samples.map((s, i) => (
          <div className="sample" key={i}>
            {s.path.length > 0 && <div className="sample-path muted small">Folder: {s.path.join(' / ')}</div>}
            <div className="sample-sides">
              <SampleSide label="Question" text={s.front} images={s.frontImages} />
              <SampleSide label="Answer" text={s.back} images={s.backImages} back />
            </div>
          </div>
        ))}
        {samples.length === 0 && <div className="empty">Nothing to show. Check the settings above: the front and back columns may be empty.</div>}
      </div>
    </section>
  );
}

function SampleSide({ label, text, images, back }: { label: string; text: string; images?: string[]; back?: boolean }) {
  return (
    <div className={`flashcard sample-side ${back ? 'back-face' : ''}`}>
      <span className="face-label">{label}</span>
      {text ? <div className="face-text">{text}</div> : <div className="muted small">{images?.length ? '' : '(empty)'}</div>}
      {images && images.length > 0 && (
        <div className="face-images">
          {images.map((src, i) => (
            <img key={i} src={src} alt="" />
          ))}
        </div>
      )}
    </div>
  );
}

/** A front/back picker with a swap button. Options are whatever the file offers (columns or Anki fields). */
export function FrontBackPicker({
  options,
  front,
  back,
  onChange,
  allowNoBack,
  frontLabel = 'Front (question)',
  backLabel = 'Back (answer)',
}: {
  options: { value: number; label: string }[];
  front: number;
  back: number | null;
  onChange: (front: number, back: number | null) => void;
  allowNoBack?: boolean;
  frontLabel?: string;
  backLabel?: string;
}) {
  return (
    <div className="picker-row">
      <label className="field">
        <span>{frontLabel}</span>
        <select className="select" value={front} onChange={(e) => onChange(Number(e.target.value), back)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button
        className="icon-btn swap"
        title="Swap front and back"
        aria-label="Swap front and back"
        disabled={back === null}
        onClick={() => back !== null && onChange(back, front)}
      >
        <ArrowLeftRight size={18} />
      </button>
      <label className="field">
        <span>{backLabel}</span>
        <select className="select" value={back ?? -1} onChange={(e) => onChange(front, Number(e.target.value) < 0 ? null : Number(e.target.value))}>
          {allowNoBack && <option value={-1}>(nothing)</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export interface DestinationState {
  mode: 'new' | 'existing';
  name: string;
  parentId: number | null;
  folderId: number | null;
}

export function toDestination(d: DestinationState): ImportDestination | null {
  if (d.mode === 'existing') return d.folderId === null ? null : { type: 'existing', folderId: d.folderId };
  return d.name.trim() ? { type: 'new', name: d.name.trim(), parentId: d.parentId } : null;
}

/** "Where should the cards go?" plus the folder and duplicate options. */
export function DestinationPicker({
  value,
  onChange,
  canRebuild,
  rebuildFolders,
  onRebuild,
  rebuildHint,
  skipDuplicates,
  onSkipDuplicates,
}: {
  value: DestinationState;
  onChange: (v: DestinationState) => void;
  canRebuild: boolean;
  rebuildFolders: boolean;
  onRebuild: (v: boolean) => void;
  rebuildHint: string;
  skipDuplicates: boolean;
  onSkipDuplicates: (v: boolean) => void;
}) {
  const { folders, pathTo } = useFolders();
  const labelled = useMemo(
    () =>
      folders
        .map((f) => ({ id: f.id, label: pathTo(f.id).map((p) => p.name).join(' / ') }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [folders, pathTo],
  );

  return (
    <section className="import-section">
      <h2>Where should the cards go?</h2>
      <div className="dest-options">
        <label className={`dest-option ${value.mode === 'new' ? 'selected' : ''}`}>
          <input type="radio" name="dest" checked={value.mode === 'new'} onChange={() => onChange({ ...value, mode: 'new' })} />
          <div className="dest-body">
            <b>A new folder</b>
            {value.mode === 'new' && (
              <div className="dest-fields">
                <input className="input" value={value.name} maxLength={100} onChange={(e) => onChange({ ...value, name: e.target.value })} aria-label="New folder name" placeholder="Folder name" />
                <label className="inline-select">
                  <span className="muted small">Inside</span>
                  <select className="select" value={value.parentId ?? ''} onChange={(e) => onChange({ ...value, parentId: e.target.value === '' ? null : Number(e.target.value) })}>
                    <option value="">Top level</option>
                    {labelled.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>
        </label>
        <label className={`dest-option ${value.mode === 'existing' ? 'selected' : ''} ${labelled.length === 0 ? 'disabled' : ''}`}>
          <input type="radio" name="dest" disabled={labelled.length === 0} checked={value.mode === 'existing'} onChange={() => onChange({ ...value, mode: 'existing', folderId: value.folderId ?? labelled[0]?.id ?? null })} />
          <div className="dest-body">
            <b>A folder I already have</b>
            {labelled.length === 0 && <span className="muted small"> (you have no folders yet)</span>}
            {value.mode === 'existing' && (
              <div className="dest-fields">
                <select className="select" value={value.folderId ?? ''} onChange={(e) => onChange({ ...value, folderId: Number(e.target.value) })} aria-label="Existing folder">
                  {labelled.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </label>
      </div>

      {canRebuild && (
        <label className="check">
          <input type="checkbox" checked={rebuildFolders} onChange={(e) => onRebuild(e.target.checked)} />
          <span>
            Recreate the folders from the file
            <span className="muted small"> {rebuildHint}</span>
          </span>
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={skipDuplicates} onChange={(e) => onSkipDuplicates(e.target.checked)} />
        <span>
          Skip cards that are already in the folder
          <span className="muted small"> (same front and back)</span>
        </span>
      </label>
    </section>
  );
}

export function Notices({ items }: { items: { tone?: 'info' | 'warn'; text: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="notices">
      {items.map((n, i) => (
        <div key={i} className={`notice ${n.tone ?? 'info'}`}>
          {n.text}
        </div>
      ))}
    </div>
  );
}
