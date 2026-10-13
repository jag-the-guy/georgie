import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, FileUp, Loader2 } from 'lucide-react';
import { api, type ApkgAnalysis, type ApkgMappings, type ApkgSample, type ApkgStats, type ImportSummary } from '../api';
import { useFolders } from '../state';
import {
  buildCards,
  cleanField,
  decodeBytes,
  folderSummary,
  parseImportText,
  sampleIndexes,
  type Mapping,
  type ParsedTable,
} from '../../shared/importParse';
import { DestinationPicker, FrontBackPicker, Notices, SamplePreview, toDestination, type DestinationState, type SampleView } from '../components/ImportParts';
import { plural } from '../components/ui';

const MAX_TEXT_BYTES = 10 * 1024 * 1024;
const MAX_APKG_BYTES = 50 * 1024 * 1024;
const MAX_CARDS = 20_000;
const ACCEPT = '.csv,.tsv,.txt,.text,.apkg,.colpkg,text/csv,text/plain,text/tab-separated-values';

type Source = { kind: 'text'; fileName: string; text: string; note: string | null } | { kind: 'apkg'; fileName: string; analysis: ApkgAnalysis };

const baseName = (file: string) => file.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Imported cards';

/** Reads the chosen file, and for Anki decks uploads it for analysis. Throws with a message fit to show the user. */
async function openFile(file: File): Promise<Source> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.apkg') || lower.endsWith('.colpkg')) {
    if (file.size > MAX_APKG_BYTES) throw new Error('That Anki file is larger than 50 MB, which is more than Georgie can import in one go. In Anki you can export a smaller deck, or split it up.');
    return { kind: 'apkg', fileName: file.name, analysis: await api.apkgAnalyze(file) };
  }
  if (file.size > MAX_TEXT_BYTES) throw new Error('That file is larger than 10 MB. Try splitting it into smaller files.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0) throw new Error('That file is empty.');
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    throw new Error(
      lower.endsWith('.xlsx') || lower.endsWith('.xls')
        ? "Excel files can't be read directly. In Excel or Google Sheets choose File > Save As (or Download) > CSV, then import that."
        : "That looks like a zip file. If it's an Anki deck, it should end in .apkg.",
    );
  }
  if (bytes.subarray(0, 4000).includes(0) && !(bytes[0] === 0xff && bytes[1] === 0xfe) && !(bytes[0] === 0xfe && bytes[1] === 0xff)) {
    throw new Error("That doesn't look like a text or CSV file.");
  }
  const { text, note } = decodeBytes(bytes);
  if (!parseImportText(text)) throw new Error('No cards were found in that file.');
  return { kind: 'text', fileName: file.name, text, note };
}

export function ImportPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [source, setSource] = useState<Source | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<(ImportSummary & { stats?: ApkgStats }) | null>(null);
  const started = useRef(false);

  const load = async (file: File) => {
    setBusy(true);
    setError('');
    try {
      setSource(await openFile(file));
    } catch (e) {
      setError((e as Error).message);
      setSource(null);
    } finally {
      setBusy(false);
    }
  };

  // The Import button on the dashboard hands us the file it picked.
  useEffect(() => {
    const file = (location.state as { file?: File } | null)?.file;
    if (file && !started.current) {
      started.current = true;
      void load(file);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => {
    setSource(null);
    setResult(null);
    setError('');
  };

  return (
    <div className="import-page">
      <div className="study-top">
        <button className="icon-btn" onClick={() => navigate('/')} aria-label="Back to dashboard">
          <ArrowLeft size={18} />
        </button>
        <h1>Import flashcards</h1>
      </div>

      {result ? (
        <Done result={result} onAnother={reset} />
      ) : source === null ? (
        <Chooser busy={busy} error={error} onFile={load} />
      ) : source.kind === 'text' ? (
        <TextReview source={source} onCancel={reset} onDone={setResult} />
      ) : (
        <ApkgReview source={source} onCancel={reset} onDone={setResult} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function Chooser({ busy, error, onFile }: { busy: boolean; error: string; onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };
  return (
    <>
      {error && <div className="error">{error}</div>}
      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {busy ? (
          <>
            <Loader2 size={36} className="spin" />
            <h3>Reading your file…</h3>
          </>
        ) : (
          <>
            <FileUp size={36} />
            <h3>Drop a file here, or choose one</h3>
            <p className="muted">
              CSV, TSV or text files from Quizlet, Anki, Google Sheets or Excel, Georgie's own export, and Anki deck files (.apkg) with their pictures.
            </p>
            <button className="btn" onClick={() => input.current?.click()}>
              Choose a file
            </button>
          </>
        )}
        <input
          ref={input}
          type="file"
          hidden
          accept={ACCEPT}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) onFile(f);
          }}
        />
      </div>
      <div className="import-help">
        <b>Exporting from other apps</b>
        <ul>
          <li>
            <b>Anki:</b> File &gt; Export. Choose <i>Anki Deck Package (.apkg)</i> to keep pictures, or <i>Notes in Plain Text</i> for text only.
          </li>
          <li>
            <b>Quizlet:</b> open a set, then ... &gt; Export, and save the text into a .txt file.
          </li>
          <li>
            <b>Excel / Google Sheets:</b> save or download as CSV.
          </li>
        </ul>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

/** Remembers what the user typed, but fills in sensible defaults from the file. */
function useDestination(defaultName: string) {
  return useState<DestinationState>({ mode: 'new', name: defaultName, parentId: null, folderId: null });
}

export function ImportFooter({
  onCancel,
  onImport,
  disabled,
  importing,
  summary,
  checking,
  total,
  problem,
  cancelLabel = 'Choose a different file',
}: {
  cancelLabel?: string;
  onCancel: () => void;
  onImport: () => void;
  disabled: boolean;
  importing: boolean;
  summary: ImportSummary | null;
  checking: boolean;
  total: number;
  problem: string;
}) {
  const count = summary ? summary.imported : total;
  return (
    <div className="import-footer">
      <div className="import-summary">
        {problem ? (
          <span className="danger-text">{problem}</span>
        ) : summary ? (
          <>
            <b>{plural(summary.imported, 'card')}</b> will be added
            {summary.foldersCreated > 0 && <>, creating {plural(summary.foldersCreated, 'folder')}</>}
            {summary.duplicates > 0 && <>. {plural(summary.duplicates, 'duplicate')} will be skipped</>}
            {summary.images > 0 && <>. {plural(summary.images, 'picture')} included</>}
          </>
        ) : checking ? (
          'Checking…'
        ) : (
          ''
        )}
      </div>
      <button className="btn ghost" onClick={onCancel} disabled={importing}>
        {cancelLabel}
      </button>
      <button className="btn" onClick={onImport} disabled={disabled || importing || count === 0}>
        {importing ? 'Importing…' : `Import ${plural(count, 'card')}`}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

const DELIMITER_CHOICES: [string, string][] = [
  ['\t', 'Tab'],
  [',', 'Comma'],
  [';', 'Semicolon'],
  ['|', 'Pipe |'],
  [' ', 'Space'],
];

function TextReview({ source, onCancel, onDone }: { source: Extract<Source, { kind: 'text' }>; onCancel: () => void; onDone: (r: ImportSummary) => void }) {
  const { refresh } = useFolders();
  const [delimiter, setDelimiter] = useState<string | undefined>();
  const [header, setHeader] = useState<boolean | undefined>();
  const [override, setOverride] = useState<Mapping | null>(null);
  const [shift, setShift] = useState(0);
  const [destination, setDestination] = useDestination(baseName(source.fileName));
  const [skipDuplicates, setSkipDuplicates] = useState(true);

  const table = useMemo(() => parseImportText(source.text, { delimiter, hasHeader: header }) as ParsedTable, [source.text, delimiter, header]);
  useEffect(() => setOverride(null), [delimiter, header]); // the column list changed, so take the new guesses
  const mapping = override ?? table.mapping;
  const built = useMemo(() => buildCards(table, mapping), [table, mapping]);

  const [rebuild, setRebuild] = useState(table.mapping.folder !== null);
  const canRebuild = mapping.folder !== null;
  const rebuildFolders = canRebuild && rebuild;

  const sample: SampleView[] = useMemo(() => sampleIndexes(built.cards.length, shift).map((i) => built.cards[i]), [built, shift]);
  const folders = useMemo(() => folderSummary(built.cards).filter((f) => f.path !== ''), [built]);

  // Ask the server what would happen (new vs duplicate cards, folders), a moment after the last change.
  const dest = toDestination(destination);
  const destKey = JSON.stringify(dest);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState('');
  const seq = useRef(0);
  const tooMany = built.cards.length > MAX_CARDS;
  useEffect(() => {
    setProblem(tooMany ? `This file has ${built.cards.length.toLocaleString()} cards. Georgie can import up to ${MAX_CARDS.toLocaleString()} at a time, so please split it.` : '');
    if (!dest || built.cards.length === 0 || tooMany) {
      setSummary(null);
      return;
    }
    const mine = ++seq.current;
    setChecking(true);
    const t = setTimeout(() => {
      api
        .importDryRun({ destination: dest, rebuildFolders, skipDuplicates, cards: built.cards })
        .then((s) => mine === seq.current && (setSummary(s), setProblem('')))
        .catch((e) => mine === seq.current && (setSummary(null), setProblem(e.message)))
        .finally(() => mine === seq.current && setChecking(false));
    }, 400);
    return () => clearTimeout(t);
  }, [destKey, built, rebuildFolders, skipDuplicates]); // eslint-disable-line react-hooks/exhaustive-deps

  const [importing, setImporting] = useState(false);
  const run = async () => {
    if (!dest) return;
    setImporting(true);
    setProblem('');
    try {
      const done = await api.importCommit({ destination: dest, rebuildFolders, skipDuplicates, cards: built.cards });
      await refresh();
      onDone(done);
    } catch (e) {
      setProblem((e as Error).message);
      setImporting(false);
    }
  };

  const firstDataRow = table.rows[table.hasHeader ? 1 : 0] ?? [];
  const columnOptions = table.headers.map((h, i) => {
    const eg = cleanField(firstDataRow[i] ?? '', table.html).text.replace(/\s+/g, ' ').trim();
    return { value: i, label: eg ? `${h} (${eg.length > 24 ? eg.slice(0, 24) + '…' : eg})` : h };
  });
  const sepName = (d: string) => DELIMITER_CHOICES.find(([c]) => c === d)?.[1] ?? d;

  const notices = [
    ...(source.note ? [{ tone: 'warn' as const, text: source.note }] : []),
    ...(built.empty > 0 ? [{ text: `${plural(built.empty, 'empty row')} will be skipped.` }] : []),
    ...(built.cloze > 0 ? [{ text: `${plural(built.cloze, 'fill-in-the-blank card')} converted: the blanks show on the front and the full text on the back.` }] : []),
    ...(built.missingImages > 0
      ? [{ tone: 'warn' as const, text: `${plural(built.missingImages, 'card')} mention pictures. A text export can't contain the pictures themselves. To bring them across, export from Anki as an Anki Deck Package (.apkg) and import that.` }]
      : []),
    ...(built.truncated > 0 ? [{ tone: 'warn' as const, text: `${plural(built.truncated, 'card')} had text longer than 20,000 characters, which was cut short.` }] : []),
  ];

  return (
    <>
      <div className="notice info big">
        <b>{table.description}.</b> Found {plural(built.cards.length, 'card')} in <b>{source.fileName}</b>.
      </div>
      <Notices items={notices} />

      <section className="import-section">
        <h2>How we read your file</h2>
        <div className="import-controls">
          <label className="field">
            <span>Columns are separated by</span>
            <select className="select" value={delimiter ?? ''} onChange={(e) => setDelimiter(e.target.value === '' ? undefined : e.target.value)}>
              <option value="">Detected: {sepName(table.delimiter)}</option>
              {DELIMITER_CHOICES.map(([c, label]) => (
                <option key={c} value={c}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="check compact">
            <input type="checkbox" checked={table.hasHeader} onChange={(e) => setHeader(e.target.checked)} />
            <span>The first row is a header (column names), not a card</span>
          </label>
        </div>
        <FrontBackPicker options={columnOptions} front={mapping.front} back={mapping.back} onChange={(front, back) => setOverride({ ...mapping, front, back: back ?? mapping.back })} />
        <label className="field narrow">
          <span>Folder column (optional)</span>
          <select className="select" value={mapping.folder ?? -1} onChange={(e) => setOverride({ ...mapping, folder: Number(e.target.value) < 0 ? null : Number(e.target.value) })}>
            <option value={-1}>None: no folder column</option>
            {columnOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <SamplePreview samples={sample} onShuffle={() => setShift((s) => s + 1)} canShuffle={built.cards.length > 3} />

      <DestinationPicker
        value={destination}
        onChange={setDestination}
        canRebuild={canRebuild}
        rebuildFolders={rebuild}
        onRebuild={setRebuild}
        rebuildHint={folders.length > 0 ? `(${plural(folders.length, 'folder')} found, such as "${folders[0].path}")` : ''}
        skipDuplicates={skipDuplicates}
        onSkipDuplicates={setSkipDuplicates}
      />

      <ImportFooter
        onCancel={onCancel}
        onImport={run}
        disabled={!dest || tooMany || built.cards.length === 0}
        importing={importing}
        summary={summary}
        checking={checking}
        total={built.cards.length}
        problem={problem}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function ApkgReview({ source, onCancel, onDone }: { source: Extract<Source, { kind: 'apkg' }>; onCancel: () => void; onDone: (r: ImportSummary & { stats?: ApkgStats }) => void }) {
  const { analysis } = source;
  const { refresh } = useFolders();
  const [mappings, setMappings] = useState<ApkgMappings>(analysis.mappings);
  const [strip, setStrip] = useState(analysis.commonRoot !== null);
  const [shift, setShift] = useState(0);
  const [destination, setDestination] = useDestination(analysis.suggestedName);
  const [skipDuplicates, setSkipDuplicates] = useState(true);

  const deckPaths = analysis.decks.map((d) => (strip && analysis.commonRoot ? d.path.split(' / ').slice(1).join(' / ') : d.path)).filter(Boolean);
  const canRebuild = deckPaths.length > 0;
  const [rebuild, setRebuild] = useState(true);
  const rebuildFolders = canRebuild && rebuild;

  const settings = { token: analysis.token, mappings, stripCommonRoot: strip };
  const settingsKey = JSON.stringify(settings);

  const [samples, setSamples] = useState<ApkgSample[]>([]);
  const [stats, setStats] = useState<ApkgStats | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    let live = true;
    setLoadingPreview(true);
    const t = setTimeout(() => {
      api
        .apkgPreview(settings, shift)
        .then((r) => live && (setSamples(r.samples), setStats(r.stats), setProblem('')))
        .catch((e) => live && setProblem(e.message))
        .finally(() => live && setLoadingPreview(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [settingsKey, shift]); // eslint-disable-line react-hooks/exhaustive-deps

  const dest = toDestination(destination);
  const destKey = JSON.stringify(dest);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [checking, setChecking] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    if (!dest) {
      setSummary(null);
      return;
    }
    const mine = ++seq.current;
    setChecking(true);
    const t = setTimeout(() => {
      api
        .apkgDryRun(settings, { destination: dest, rebuildFolders, skipDuplicates })
        .then((s) => mine === seq.current && (setSummary(s), setProblem('')))
        .catch((e) => mine === seq.current && (setSummary(null), setProblem(e.message)))
        .finally(() => mine === seq.current && setChecking(false));
    }, 400);
    return () => clearTimeout(t);
  }, [settingsKey, destKey, rebuildFolders, skipDuplicates]); // eslint-disable-line react-hooks/exhaustive-deps

  const [importing, setImporting] = useState(false);
  const run = async () => {
    if (!dest) return;
    setImporting(true);
    setProblem('');
    try {
      const done = await api.apkgCommit(settings, { destination: dest, rebuildFolders, skipDuplicates });
      await refresh();
      onDone(done);
    } catch (e) {
      setProblem((e as Error).message);
      setImporting(false);
    }
  };

  const setMapping = (typeId: string, front: number, back: number | null) => setMappings((m) => ({ ...m, [typeId]: { front, back } }));

  const notices = stats
    ? [
        ...(stats.images > 0 ? [{ text: `${plural(stats.images, 'picture')} will come across with their cards.` }] : []),
        ...(stats.missingMedia > 0 ? [{ tone: 'warn' as const, text: `${plural(stats.missingMedia, 'picture')} are mentioned in cards but missing from the file.` }] : []),
        ...(stats.unsupportedMedia > 0 ? [{ tone: 'warn' as const, text: `${plural(stats.unsupportedMedia, 'picture')} are in a format Georgie can't show (such as SVG) or are over 10 MB, so they'll be left out.` }] : []),
        ...(stats.cloze > 0 ? [{ text: `${plural(stats.cloze, 'fill-in-the-blank card')} converted: the blanks show on the front and the full text on the back.` }] : []),
        ...(stats.audio > 0 ? [{ text: `Sounds and videos (${stats.audio}) aren't imported.` }] : []),
      ]
    : [];

  return (
    <>
      <div className="notice info big">
        <b>Anki deck ({analysis.format}).</b> Found {plural(analysis.noteCount, 'note')} in <b>{source.fileName}</b>, with {plural(analysis.mediaCount, 'media file')}. Anki's reverse cards are imported once, as a single card.
      </div>
      <Notices items={notices} />

      <section className="import-section">
        <h2>Which fields are the front and back?</h2>
        {analysis.noteTypes.map((t) => {
          const m = mappings[t.id];
          const options = t.fields.map((f, i) => ({ value: i, label: t.examples[i] ? `${f} (${t.examples[i].length > 24 ? t.examples[i].slice(0, 24) + '…' : t.examples[i]})` : f }));
          return (
            <div className="type-card" key={t.id}>
              <div className="type-head">
                <b>{t.name}</b>
                <span className="muted small">{plural(t.count, 'note')}</span>
              </div>
              {t.cloze ? (
                <>
                  <div className="muted small" style={{ marginBottom: 10 }}>
                    Fill-in-the-blank notes: the blanks are shown on the front and the complete text on the back.
                  </div>
                  <label className="field narrow">
                    <span>Extra information to add to the back</span>
                    <select className="select" value={m.back ?? -1} onChange={(e) => setMapping(t.id, m.front, Number(e.target.value) < 0 ? null : Number(e.target.value))}>
                      <option value={-1}>(nothing)</option>
                      {options.filter((o) => o.value !== m.front).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : (
                <FrontBackPicker options={options} front={m.front} back={m.back} allowNoBack onChange={(f, b) => setMapping(t.id, f, b)} />
              )}
            </div>
          );
        })}
      </section>

      <SamplePreview
        samples={samples}
        loading={loadingPreview}
        onShuffle={() => setShift((s) => s + 1)}
        canShuffle={analysis.noteCount > 3}
      />

      {analysis.commonRoot && (
        <label className="check">
          <input type="checkbox" checked={strip} onChange={(e) => setStrip(e.target.checked)} />
          <span>
            Don't repeat the deck name as a folder
            <span className="muted small"> (every card is in the deck "{analysis.commonRoot}", so it becomes the destination folder instead)</span>
          </span>
        </label>
      )}

      <DestinationPicker
        value={destination}
        onChange={setDestination}
        canRebuild={canRebuild}
        rebuildFolders={rebuild}
        onRebuild={setRebuild}
        rebuildHint={`(${plural(deckPaths.length, 'deck')} become folders, e.g. "${deckPaths[0] ?? ''}")`}
        skipDuplicates={skipDuplicates}
        onSkipDuplicates={setSkipDuplicates}
      />

      <ImportFooter
        onCancel={onCancel}
        onImport={run}
        disabled={!dest}
        importing={importing}
        summary={summary}
        checking={checking}
        total={analysis.noteCount}
        problem={problem}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------

export function Done({ result, onAnother, anotherLabel = 'Import another file' }: { result: ImportSummary & { stats?: ApkgStats }; onAnother: () => void; anotherLabel?: string }) {
  return (
    <div className="done">
      <div className="done-icon">
        <CheckCircle2 size={34} />
      </div>
      <h1>
        Imported {plural(result.imported, 'card')}
      </h1>
      <p>
        {result.foldersCreated > 0 && `Created ${plural(result.foldersCreated, 'folder')}. `}
        {result.images > 0 && `${plural(result.images, 'picture')} came across. `}
        {result.duplicates > 0 && `Skipped ${plural(result.duplicates, 'duplicate')}. `}
        All the cards start as new, so they'll appear in your next study session.
      </p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button className="btn ghost" onClick={onAnother}>
          {anotherLabel}
        </button>
        {result.folderId !== undefined && (
          <>
            <Link className="btn ghost" to={`/folders/${result.folderId}`}>
              Open the folder
            </Link>
            <Link className="btn" to={`/study/${result.folderId}`}>
              Start studying
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
