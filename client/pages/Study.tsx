import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, PartyPopper } from 'lucide-react';
import { api } from '../api';
import type { Card, NextCardResponse, QueueCounts, Rating } from '../../shared/types';
import { RATINGS, RATING_LABELS } from '../../shared/types';
import { makeConfig } from '../../shared/srsConfig';
import { previewIntervals } from '../../shared/formatInterval';
import { useAuth, useFolders } from '../state';
import { CardEditor } from '../components/CardEditor';
import { FlipCard } from '../components/FlipCard';
import { ResultPanel, TypeBox, TypeModeSwitch, useTypeMode } from '../components/TypeAnswer';
import { canTypeAnswer, checkAnswer, pickMessage, suggestedRating, type AnswerCheck } from '../../shared/answerMatch';
import { Lightbox } from '../components/ui';

const formatNextDue = (ms: number) => {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `today at ${time}`;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow at ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })} at ${time}`;
};

const pad = (n: number) => String(n).padStart(2, '0');
const formatCountdown = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? `${h}h ${pad(m)}m` : `${m}:${pad(total % 60)}`;
};

export function Study() {
  const folderId = Number(useParams().id);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { byId, pathTo, refresh } = useFolders();
  const folder = byId.get(folderId);

  const [state, setState] = useState<NextCardResponse | null>(null);
  // `flipped` is which side is showing; `seenAnswer` stays true once the answer has been shown,
  // so the rating buttons don't vanish if you flip back to the question.
  const [flipped, setFlipped] = useState(false);
  const [seenAnswer, setSeenAnswer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(0);

  // "Type my answer": what was typed, how it was judged, and the message shown. Cleared for every new card.
  const [typeMode, setTypeMode] = useTypeMode();
  const [result, setResult] = useState<{ typed: string; check: AnswerCheck; message: string } | null>(null);
  const lastMessage = useRef<string | undefined>(undefined);

  const config = useMemo(() => makeConfig({ timezone: user!.timezone }), [user]);
  const card: Card | null = state && !state.done ? state.card : null;

  // Nothing is due right now, but cards you're still learning will come back soon: wait for them.
  const waitingUntil = state?.done && state.counts.learning > 0 ? state.nextDueAt : null;
  const [now, setNow] = useState(Date.now());

  const apply = useCallback((next: NextCardResponse) => {
    setState(next);
    setFlipped(false);
    setSeenAnswer(false);
    setResult(null);
  }, []);

  const flip = useCallback(() => {
    setFlipped((f) => !f);
    setSeenAnswer(true);
  }, []);

  useEffect(() => {
    api.nextCard(folderId).then(apply).catch((e) => setError(e.message));
  }, [folderId, apply]);

  useEffect(() => {
    if (waitingUntil === null) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    // Fetch again the moment the card is due, so it just appears.
    const fetchAt = setTimeout(
      () => api.nextCard(folderId).then(apply).catch((e) => setError(e.message)),
      Math.max(300, waitingUntil - Date.now() + 300),
    );
    return () => {
      clearInterval(tick);
      clearTimeout(fetchAt);
    };
  }, [waitingUntil, state, folderId, apply]);

  const typing = typeMode && card !== null && canTypeAnswer(card.front, card.back);

  // Judge what was typed, show the back of the card, and suggest (but never choose) a rating.
  const submitTyped = useCallback(
    (typed: string) => {
      if (!card) return;
      const check = checkAnswer(typed, card.back);
      const message = pickMessage(check.verdict, lastMessage.current);
      lastMessage.current = message;
      setResult({ typed, check, message });
      setFlipped(true);
      setSeenAnswer(true);
    },
    [card],
  );

  // Interval previews use the same pure scheduler as the server.
  const previews = useMemo(() => (card ? previewIntervals(card, Date.now(), config) : null), [card, config, seenAnswer]); // eslint-disable-line react-hooks/exhaustive-deps

  const rate = useCallback(
    async (rating: Rating) => {
      if (!card || busy) return;
      setBusy(true);
      setError('');
      try {
        apply(await api.rate(folderId, card.id, rating));
        setReviewed((n) => n + 1);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [card, busy, folderId, apply],
  );

  useEffect(() => {
    if (!card || editing || zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        flip();
      } else if (seenAnswer && ['1', '2', '3', '4'].includes(e.key)) {
        rate(Number(e.key) as Rating);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, seenAnswer, editing, zoom, rate, flip]);

  // Leaving the study page: folder counts on the dashboard are stale now.
  useEffect(() => () => void refresh(), [refresh]);

  const title = folder ? pathTo(folderId).map((f) => f.name).join(' / ') : 'Study';
  const counts: QueueCounts | null = state?.counts ?? null;

  return (
    <div className="study">
      <div className="study-top">
        <button className="icon-btn" onClick={() => navigate(`/folders/${folderId}`)} aria-label="Back to folder">
          <ArrowLeft size={18} />
        </button>
        <h1 title={title}>{title}</h1>
        <TypeModeSwitch on={typeMode} onChange={setTypeMode} />
        {counts && (
          <div className="counts" aria-label="Cards remaining">
            <span className="n" title="New">{counts.new}</span>
            <span className="l" title="Learning">{counts.learning}</span>
            <span className="r" title="To review">{counts.review}</span>
          </div>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      {state?.done && waitingUntil !== null && (
        <div className="done">
          <div className="done-icon">
            <Clock size={34} />
          </div>
          <h1>Next card in {formatCountdown(waitingUntil - now)}</h1>
          <p>
            {reviewed > 0 && `You reviewed ${reviewed} ${reviewed === 1 ? 'card' : 'cards'}. `}
            The card you just rated comes back when its time is up, and it will appear here by itself.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link className="btn ghost" to={`/browse/${folderId}`}>
              Browse cards while you wait
            </Link>
            <Link className="btn" to={`/folders/${folderId}`}>
              Back to folder
            </Link>
          </div>
        </div>
      )}

      {state?.done && waitingUntil === null && (
        <div className="done">
          <div className="done-icon">
            <PartyPopper size={34} />
          </div>
          <h1>Done for today</h1>
          <p>
            {reviewed > 0 && `You reviewed ${reviewed} ${reviewed === 1 ? 'card' : 'cards'}. `}
            {state.nextDueAt ? `Next card is due ${formatNextDue(state.nextDueAt)}.` : 'This folder has no cards to study yet.'}
          </p>
          <Link className="btn" to={`/folders/${folderId}`}>
            Back to folder
          </Link>
        </div>
      )}

      {card && previews && (
        <>
          {/* Keyed so each new card mounts already facing the front: no flip back, and no peek at the next answer. */}
          <FlipCard key={`${card.id}-${reviewed}`} card={card} flipped={flipped} onFlip={flip} onEdit={() => setEditing(true)} onZoom={setZoom} />

          {typing && !seenAnswer && (
            <TypeBox key={`${card.id}-${reviewed}`} onCheck={submitTyped} onGiveUp={() => submitTyped('')} />
          )}
          {result && <ResultPanel check={result.check} message={result.message} typed={result.typed} />}

          <div className="study-actions">
            {seenAnswer ? (
              <div className="ratings">
                {RATINGS.map((r) => {
                  const suggested = result !== null && suggestedRating(result.check.verdict) === r;
                  return (
                    <button key={r} className={`rate rate-${r} ${suggested ? 'suggested' : ''}`} onClick={() => rate(r)} disabled={busy}>
                      {suggested && <span className="suggested-tag">Suggested</span>}
                      {RATING_LABELS[r]}
                      <small>{previews[r]}</small>
                      <kbd>{r}</kbd>
                    </button>
                  );
                })}
              </div>
            ) : (
              !typing && (
                <button className="btn reveal-btn" onClick={flip}>
                  Show answer
                </button>
              )
            )}
          </div>
          <div className="hint">
            {typeMode && !typing && <div style={{ marginBottom: 6 }}>Nothing to type on this card, so flip it as usual.</div>}
            Click the card or press <kbd>Space</kbd> to flip · <kbd>1</kbd>–<kbd>4</kbd> to rate
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
            setState((s) => (s && !s.done ? { ...s, card: saved } : s));
          }}
          onDeleted={() => {
            setEditing(false);
            api.nextCard(folderId).then(apply);
          }}
        />
      )}
      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}
