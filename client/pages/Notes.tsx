import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronRight, FileText, Loader2, Plus, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { api, type ImportSummary, type NotesDensity, type NotesResult, type NotesStatus } from '../api';
import { useFolders } from '../state';
import { DestinationPicker, Notices, toDestination, type DestinationState } from '../components/ImportParts';
import { plural } from '../components/ui';
import { Done, ImportFooter } from './Import';

const ACCEPT = '.pdf,.txt,.md,.markdown,.docx,.png,.jpg,.jpeg,.gif,.webp,application/pdf,text/plain,text/markdown,image/*';

const DENSITIES: { value: NotesDensity; title: string; text: string }[] = [
  { value: 'light', title: 'Light', text: 'Just the key ideas. About 1 card per page.' },
  { value: 'standard', title: 'Standard', text: 'Main concepts and definitions. 2 to 3 cards per page.' },
  { value: 'thorough', title: 'Thorough', text: 'Every fact worth remembering. 4 or more per page.' },
];

const sizeLabel = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

type Phase = 'input' | 'working' | 'review' | 'done';

export function NotesPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<NotesStatus | null>(null);
  const [phase, setPhase] = useState<Phase>('input');
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState('');
  const [density, setDensity] = useState<NotesDensity>('standard');
  const [focus, setFocus] = useState('');
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ stage: string; cards: number }>({ stage: 'Starting…', cards: 0 });
  const [result, setResult] = useState<NotesResult | null>(null);
  const [imported, setImported] = useState<ImportSummary | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const refreshStatus = () => api.notesStatus().then(setStatus).catch(() => setStatus({ available: false }));
  useEffect(() => void refreshStatus(), []);

  // While the AI is working, check on it every second.
  useEffect(() => {
    if (phase !== 'working' || !jobId) return;
    let stop = false;
    const started = Date.now();
    const tick = async () => {
      setElapsed(Math.round((Date.now() - started) / 1000));
      try {
        const job = await api.notesJob(jobId);
        if (stop) return;
        setProgress({ stage: job.stage, cards: job.cards });
        if (job.status === 'done' && job.result) {
          setResult(job.result);
          setPhase('review');
          void refreshStatus();
        } else if (job.status === 'error' || job.status === 'cancelled') {
          if (job.status === 'error') setError(job.error ?? 'Something went wrong. Please try again.');
          setPhase('input');
          void refreshStatus();
        }
      } catch (e) {
        if (stop) return;
        setError((e as Error).message);
        setPhase('input');
      }
    };
    void tick();
    const timer = setInterval(tick, 1000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [phase, jobId]);

  // Leaving the page while the AI is working would waste money: stop it.
  const live = useRef({ phase, jobId });
  live.current = { phase, jobId };
  useEffect(
    () => () => {
      if (live.current.phase === 'working' && live.current.jobId) void api.notesCancel(live.current.jobId).catch(() => {});
    },
    [],
  );

  const start = async () => {
    setError('');
    const form = new FormData();
    for (const f of files) form.append('files', f);
    form.append('text', text);
    form.append('density', density);
    if (focus.trim()) form.append('focus', focus.trim());
    try {
      setProgress({ stage: 'Uploading your notes…', cards: 0 });
      setElapsed(0);
      setPhase('working');
      const { jobId } = await api.notesGenerate(form);
      setJobId(jobId);
    } catch (e) {
      setError((e as Error).message);
      setPhase('input');
      void refreshStatus();
    }
  };

  const cancel = async () => {
    if (jobId) await api.notesCancel(jobId).catch(() => {});
    setPhase('input');
    void refreshStatus();
  };

  return (
    <div className="import-page">
      <div className="study-top">
        <button className="icon-btn" onClick={() => navigate('/')} aria-label="Back to dashboard">
          <ArrowLeft size={18} />
        </button>
        <h1>Turn your notes into flashcards</h1>
      </div>

      {status === null ? null : !status.available ? (
        <div className="empty">
          <Sparkles size={40} />
          <h3>This isn't switched on for your account</h3>
          <p>Turning notes into flashcards uses AI, which costs money, so it's only available to people the site owner has allowed.</p>
        </div>
      ) : phase === 'input' ? (
        <InputStep
          status={status}
          files={files}
          setFiles={setFiles}
          text={text}
          setText={setText}
          density={density}
          setDensity={setDensity}
          focus={focus}
          setFocus={setFocus}
          error={error}
          onStart={start}
        />
      ) : phase === 'working' ? (
        <WorkingStep progress={progress} elapsed={elapsed} onCancel={cancel} />
      ) : phase === 'review' && result ? (
        <ReviewStep
          result={result}
          onStartOver={() => {
            setResult(null);
            setPhase('input');
          }}
          onDone={(summary) => {
            setImported(summary);
            setPhase('done');
          }}
        />
      ) : phase === 'done' && imported ? (
        <Done
          result={imported}
          anotherLabel="Make more flashcards"
          onAnother={() => {
            setImported(null);
            setResult(null);
            setFiles([]);
            setText('');
            setFocus('');
            setPhase('input');
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function InputStep(props: {
  status: NotesStatus;
  files: File[];
  setFiles: (f: File[]) => void;
  text: string;
  setText: (t: string) => void;
  density: NotesDensity;
  setDensity: (d: NotesDensity) => void;
  focus: string;
  setFocus: (f: string) => void;
  error: string;
  onStart: () => void;
}) {
  const { status, files, setFiles, text, setText, density, setDensity, focus, setFocus, error, onStart } = props;
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const limits = status.limits!;
  const left = (status.dailyLimit ?? 0) - (status.usedToday ?? 0);

  const add = (incoming: File[]) => {
    const next = [...files];
    for (const f of incoming) if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    setFiles(next.slice(0, limits.maxFiles));
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    add(Array.from(e.dataTransfer.files));
  };
  const ready = files.length > 0 || text.trim().length > 0;

  return (
    <>
      {status.mode === 'demo' && (
        <div className="notice warn big">
          <b>Demo mode.</b> No AI key is set up yet, so cards are made by a simple rule-based demo, not real AI. It only understands plain text with lines like “Term: definition”. Everything else on this screen works exactly as it will with the real AI.
        </div>
      )}
      {error && <div className="error">{error}</div>}

      <section className="import-section">
        <h2>1. Add your notes</h2>
        <div
          className={`dropzone compact ${over ? 'over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <Upload size={30} />
          <h3>Drop your notes here, or choose files</h3>
          <p className="muted">
            PDF (including scanned pages), Word (.docx), text or Markdown files, and photos or screenshots of notes. Up to {limits.maxFiles} files.
          </p>
          <button className="btn" onClick={() => input.current?.click()} disabled={files.length >= limits.maxFiles}>
            Choose files
          </button>
          <input
            ref={input}
            type="file"
            hidden
            multiple
            accept={ACCEPT}
            onChange={(e) => {
              add(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
        </div>
        {files.length > 0 && (
          <div className="file-list">
            {files.map((f) => (
              <div className="file-chip" key={`${f.name}-${f.size}`}>
                <FileText size={16} />
                <span className="file-name">{f.name}</span>
                <span className="muted small">{sizeLabel(f.size)}</span>
                <button className="icon-btn plain" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x !== f))}>
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
        <label className="field" style={{ marginTop: 16 }}>
          <span>…or paste your notes in</span>
          <textarea
            className="textarea"
            rows={6}
            value={text}
            maxLength={limits.maxTextChars}
            placeholder="Paste lecture notes, a textbook section, a summary…"
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      </section>

      <section className="import-section">
        <h2>2. How many cards?</h2>
        <div className="density-options" role="radiogroup" aria-label="How many cards">
          {DENSITIES.map((d) => (
            <label key={d.value} className={`density ${density === d.value ? 'selected' : ''}`}>
              <input type="radio" name="density" checked={density === d.value} onChange={() => setDensity(d.value)} />
              <b>{d.title}</b>
              <span className="muted small">{d.text}</span>
            </label>
          ))}
        </div>
        <label className="field" style={{ marginTop: 16 }}>
          <span>Anything to focus on? (optional)</span>
          <input
            className="input"
            value={focus}
            maxLength={limits.maxFocusChars}
            placeholder="e.g. “only chapters 3 and 4”, “focus on the formulas”, “dates and names”"
            onChange={(e) => setFocus(e.target.value)}
          />
        </label>
      </section>

      <div className="import-footer">
        <div className="import-summary">
          {status.mode === 'claude' ? (
            <>
              Your notes are sent to Anthropic's Claude AI to make the cards. Georgie doesn't keep your files afterwards. <b>{left}</b> of {status.dailyLimit} goes left today.
            </>
          ) : (
            <>
              <b>{left}</b> of {status.dailyLimit} goes left today.
            </>
          )}
        </div>
        <button className="btn" onClick={onStart} disabled={!ready || left <= 0}>
          <Sparkles size={16} /> Make flashcards
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function WorkingStep({ progress, elapsed, onCancel }: { progress: { stage: string; cards: number }; elapsed: number; onCancel: () => void }) {
  return (
    <div className="done working">
      <div className="done-icon">
        <Loader2 size={34} className="spin" />
      </div>
      <h1>{progress.stage}</h1>
      <p>
        {progress.cards > 0 ? <b>{plural(progress.cards, 'card')} written so far. </b> : null}
        This usually takes between 30 seconds and a couple of minutes, longer for big PDFs. Keep this page open.
        <span className="muted small" style={{ display: 'block', marginTop: 8 }}>
          {elapsed}s elapsed
        </span>
      </p>
      <button className="btn ghost" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

interface EditCard {
  id: number;
  front: string;
  back: string;
  on: boolean;
}
interface EditTopic {
  id: number;
  name: string;
  open: boolean;
  cards: EditCard[];
}

function ReviewStep({ result, onStartOver, onDone }: { result: NotesResult; onStartOver: () => void; onDone: (s: ImportSummary) => void }) {
  const { refresh } = useFolders();
  const nextId = useRef(1);
  const [topics, setTopics] = useState<EditTopic[]>(() =>
    result.topics.map((t) => ({ id: nextId.current++, name: t.name, open: true, cards: t.cards.map((c) => ({ id: nextId.current++, front: c.front, back: c.back, on: true })) })),
  );
  const [destination, setDestination] = useState<DestinationState>({ mode: 'new', name: result.subject, parentId: null, folderId: null });
  const [rebuild, setRebuild] = useState(result.topics.length > 1);
  const [skipDuplicates, setSkipDuplicates] = useState(true);

  const update = (topicId: number, fn: (t: EditTopic) => EditTopic) => setTopics((all) => all.map((t) => (t.id === topicId ? fn(t) : t)));
  const updateCard = (topicId: number, cardId: number, patch: Partial<EditCard>) =>
    update(topicId, (t) => ({ ...t, cards: t.cards.map((c) => (c.id === cardId ? { ...c, ...patch } : c)) }));

  const usable = (c: EditCard) => c.on && c.front.trim() !== '' && c.back.trim() !== '';
  const total = topics.reduce((n, t) => n + t.cards.length, 0);
  const selected = topics.reduce((n, t) => n + t.cards.filter(usable).length, 0);

  const cards = useMemo(
    () => topics.flatMap((t) => t.cards.filter(usable).map((c) => ({ path: [t.name.trim().slice(0, 100) || 'Notes'], front: c.front.trim(), back: c.back.trim() }))),
    [topics], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const dest = toDestination(destination);
  const destKey = JSON.stringify(dest);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState('');
  const seq = useRef(0);
  const rebuildFolders = rebuild && topics.length > 1;
  useEffect(() => {
    if (!dest || cards.length === 0) {
      setSummary(null);
      return;
    }
    const mine = ++seq.current;
    setChecking(true);
    const t = setTimeout(() => {
      api
        .importDryRun({ destination: dest, rebuildFolders, skipDuplicates, cards })
        .then((s) => mine === seq.current && (setSummary(s), setProblem('')))
        .catch((e) => mine === seq.current && (setSummary(null), setProblem(e.message)))
        .finally(() => mine === seq.current && setChecking(false));
    }, 400);
    return () => clearTimeout(t);
  }, [destKey, cards, rebuildFolders, skipDuplicates]); // eslint-disable-line react-hooks/exhaustive-deps

  const [importing, setImporting] = useState(false);
  const run = async () => {
    if (!dest) return;
    setImporting(true);
    setProblem('');
    try {
      const done = await api.importCommit({ destination: dest, rebuildFolders, skipDuplicates, cards });
      await refresh();
      onDone(done);
    } catch (e) {
      setProblem((e as Error).message);
      setImporting(false);
    }
  };

  const setAll = (on: boolean) => setTopics((all) => all.map((t) => ({ ...t, cards: t.cards.map((c) => ({ ...c, on })) })));

  const notices = [
    ...result.warnings.map((text) => ({ tone: 'warn' as const, text })),
    ...(result.mode === 'claude' ? [{ text: `Made by Claude (${result.model}). Read through the cards: AI can occasionally get something wrong, so edit or delete anything that doesn't look right.` }] : []),
  ];

  return (
    <>
      <div className="notice info big">
        <b>{result.subject}.</b> {result.summary && `${result.summary} `}
        Found {plural(total, 'card')} across {plural(topics.length, 'topic')}.
      </div>
      <Notices items={notices} />

      <section className="import-section">
        <div className="section-head">
          <div>
            <h2>Review your flashcards</h2>
            <div className="muted small">
              {selected} of {total} selected. Edit any text, rename a topic, or untick and delete what you don't want.
            </div>
          </div>
          <div className="export-actions" style={{ margin: 0 }}>
            <button className="link" onClick={() => setAll(true)}>
              Select all
            </button>
            <button className="link" onClick={() => setAll(false)}>
              Select none
            </button>
          </div>
        </div>

        {topics.map((t) => {
          const on = t.cards.filter((c) => c.on).length;
          return (
            <div className="review-topic" key={t.id}>
              <div className="review-topic-head">
                <input
                  type="checkbox"
                  aria-label={`Select all cards in ${t.name}`}
                  checked={t.cards.length > 0 && on === t.cards.length}
                  ref={(el) => {
                    if (el) el.indeterminate = on > 0 && on < t.cards.length;
                  }}
                  onChange={() => update(t.id, (x) => ({ ...x, cards: x.cards.map((c) => ({ ...c, on: on !== x.cards.length })) }))}
                />
                <input className="topic-name" value={t.name} maxLength={100} aria-label="Topic (folder) name" onChange={(e) => update(t.id, (x) => ({ ...x, name: e.target.value }))} />
                <span className="muted small">{plural(t.cards.length, 'card')}</span>
                <button className="icon-btn plain" aria-label={t.open ? 'Collapse topic' : 'Expand topic'} onClick={() => update(t.id, (x) => ({ ...x, open: !x.open }))}>
                  {t.open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                </button>
              </div>
              {t.open && (
                <div className="review-cards">
                  {t.cards.map((c) => (
                    <div className={`review-card ${c.on ? '' : 'off'}`} key={c.id}>
                      <input type="checkbox" aria-label="Include this card" checked={c.on} onChange={(e) => updateCard(t.id, c.id, { on: e.target.checked })} />
                      <div className="review-sides">
                        <textarea className="textarea side-front" rows={2} value={c.front} aria-label="Front (question)" placeholder="Question" onChange={(e) => updateCard(t.id, c.id, { front: e.target.value })} />
                        <textarea className="textarea side-back" rows={2} value={c.back} aria-label="Back (answer)" placeholder="Answer" onChange={(e) => updateCard(t.id, c.id, { back: e.target.value })} />
                      </div>
                      <button className="icon-btn plain" aria-label="Delete this card" title="Delete this card" onClick={() => update(t.id, (x) => ({ ...x, cards: x.cards.filter((k) => k.id !== c.id) }))}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  <button className="btn ghost small" onClick={() => update(t.id, (x) => ({ ...x, cards: [...x.cards, { id: nextId.current++, front: '', back: '', on: true }] }))}>
                    <Plus size={15} /> Add a card
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </section>

      <DestinationPicker
        value={destination}
        onChange={setDestination}
        canRebuild={topics.length > 1}
        rebuildFolders={rebuild}
        onRebuild={setRebuild}
        rebuildHint={`(${topics.slice(0, 3).map((t) => `"${t.name}"`).join(', ')}${topics.length > 3 ? ', …' : ''} become subfolders)`}
        skipDuplicates={skipDuplicates}
        onSkipDuplicates={setSkipDuplicates}
      />

      <ImportFooter
        onCancel={onStartOver}
        cancelLabel="Start over"
        onImport={run}
        disabled={!dest || cards.length === 0}
        importing={importing}
        summary={summary}
        checking={checking}
        total={selected}
        problem={problem}
      />
    </>
  );
}
