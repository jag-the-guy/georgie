import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Keyboard, Sparkles, Target } from 'lucide-react';
import type { AnswerCheck, Verdict } from '../../shared/answerMatch';

const KEY = 'georgie.typeAnswer';

/** The "Type my answer" switch, remembered on this device. */
export function useTypeMode(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  const set = (value: boolean) => {
    setOn(value);
    try {
      localStorage.setItem(KEY, value ? '1' : '0');
    } catch {
      /* private mode: the switch just won't be remembered */
    }
  };
  return [on, set];
}

export function TypeModeSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      className={`type-switch ${on ? 'on' : ''}`}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      title="Type your answer instead of just flipping the card"
    >
      <Keyboard size={16} />
      <span>Type my answer</span>
      <span className="switch-track" aria-hidden>
        <span className="switch-thumb" />
      </span>
    </button>
  );
}

/** Where you type your answer before seeing the back of the card. */
export function TypeBox({ onCheck, onGiveUp }: { onCheck: (typed: string) => void; onGiveUp: () => void }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);

  return (
    <div className="type-box">
      <label htmlFor="typed-answer" className="face-label">
        Your answer
      </label>
      <textarea
        id="typed-answer"
        ref={ref}
        className="textarea"
        rows={2}
        value={text}
        placeholder="Type what you think the answer is…"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (text.trim()) onCheck(text);
          }
        }}
      />
      <div className="type-actions">
        <span className="muted small">
          <kbd>Enter</kbd> to check · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
        </span>
        <button className="btn ghost small" onClick={onGiveUp}>
          I don't know
        </button>
        <button className="btn" onClick={() => text.trim() && onCheck(text)} disabled={!text.trim()}>
          Check answer
        </button>
      </div>
    </div>
  );
}

const ICON: Record<Verdict, typeof CheckCircle2> = { correct: CheckCircle2, almost: Target, wrong: Sparkles };

/** The verdict, a friendly message, and what was typed. The correct answer is on the flipped card above. */
export function ResultPanel({ check, message, typed }: { check: AnswerCheck; message: string; typed: string }) {
  const Icon = ICON[check.verdict];
  return (
    <div className={`result result-${check.verdict}`} role="status">
      <div className="result-head">
        <Icon size={22} />
        <b>{message}</b>
      </div>
      {check.accentNotes.length > 0 && (
        <div className="result-note">
          Watch the accent: <b>{check.accentNotes.join(', ')}</b>
        </div>
      )}
      {check.verdict === 'almost' && check.missing.length > 0 && (
        <div className="result-note">
          You were missing: <b>{check.missing.join(', ')}</b>
        </div>
      )}
      <div className="result-typed">
        <span className="face-label">What you typed</span>
        <div>{typed.trim() ? typed : <span className="muted">(nothing)</span>}</div>
      </div>
    </div>
  );
}
