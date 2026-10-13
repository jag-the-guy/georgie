import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../api';
import { useAuth, useFolders } from '../state';
import { studyDay } from '../../shared/time';
import { DEFAULT_CONFIG } from '../../shared/srsConfig';
import { Ring, plural } from './ui';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function RightPanel() {
  const { user } = useAuth();
  const { folders, childrenOf } = useFolders();
  const navigate = useNavigate();
  const today = studyDay(Date.now(), user!.timezone, DEFAULT_CONFIG.dayStartHour);
  const [view, setView] = useState({ year: today.year, month: today.month });
  const [days, setDays] = useState<Record<number, number>>({});
  const [reviewedToday, setReviewedToday] = useState(0);

  useEffect(() => {
    api
      .calendar(view.year, view.month)
      .then((r) => {
        setDays(r.days);
        setReviewedToday(r.reviewedToday);
      })
      .catch(() => {});
  }, [view, folders]);

  const roots = childrenOf(null);
  const totalCards = roots.reduce((n, f) => n + f.card_count, 0);
  const dueNow = roots.reduce((n, f) => n + f.due_count, 0);

  // Calendar grid: leading days from the previous month, then this month, padded to full weeks.
  const first = new Date(Date.UTC(view.year, view.month - 1, 1));
  const daysInMonth = new Date(Date.UTC(view.year, view.month, 0)).getUTCDate();
  const daysInPrev = new Date(Date.UTC(view.year, view.month - 1, 0)).getUTCDate();
  const lead = first.getUTCDay();
  const cells: { day: number; current: boolean }[] = [];
  for (let i = lead - 1; i >= 0; i--) cells.push({ day: daysInPrev - i, current: false });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, current: true });
  while (cells.length % 7) cells.push({ day: cells.length - lead - daysInMonth + 1, current: false });

  const shift = (delta: number) => {
    const m = view.month - 1 + delta;
    setView({ year: view.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 + 1 });
  };
  const isToday = (d: number) => view.year === today.year && view.month === today.month && d === today.day;

  return (
    <aside className="right">
      <section className="profile">
        <h2 style={{ textAlign: 'left' }}>Profile</h2>
        <div className="avatar">{user!.email[0].toUpperCase()}</div>
        <div className="email" title={user!.email}>
          {user!.email}
        </div>
        <div className="stat-row">
          <div className="stat">
            <b>{dueNow}</b>
            <span>to study</span>
          </div>
          <div className="stat">
            <b>{reviewedToday}</b>
            <span>reviewed today</span>
          </div>
          <div className="stat">
            <b>{totalCards}</b>
            <span>cards</span>
          </div>
        </div>
      </section>

      <section>
        <div className="calendar-head">
          <h3>
            {MONTHS[view.month - 1]} {view.year}
          </h3>
          <div style={{ display: 'flex' }}>
            <button className="icon-btn plain" onClick={() => shift(-1)} aria-label="Previous month">
              <ChevronLeft size={18} />
            </button>
            <button className="icon-btn plain" onClick={() => shift(1)} aria-label="Next month">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
        <div className="calendar">
          {DOW.map((d) => (
            <div className="dow" key={d}>
              {d}
            </div>
          ))}
          {cells.map((c, i) => (
            <div
              key={i}
              className={`day ${c.current ? '' : 'other'} ${c.current && isToday(c.day) ? 'today' : ''} ${c.current && days[c.day] ? 'has-due' : ''}`}
              title={c.current && days[c.day] ? `${plural(days[c.day], 'review')} due` : undefined}
            >
              <span>{c.day}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ marginBottom: 14 }}>Review progress</h2>
        <div className="progress-list">
          {roots.length === 0 && <div className="muted small">Create a folder to start tracking progress.</div>}
          {roots.map((f, i) => {
            const pct = f.card_count ? (f.learned_count / f.card_count) * 100 : 0;
            const highlight = i === 0;
            return (
              <button key={f.id} className={`progress-item ${highlight ? 'highlight' : ''}`} onClick={() => navigate(`/folders/${f.id}`)}>
                <Ring percent={pct} color={highlight ? 'var(--color-on-primary)' : 'var(--color-primary)'} track={highlight ? 'var(--color-on-primary-track)' : 'var(--color-border)'} />
                <div className="grow">
                  <div>{f.name}</div>
                  <div className="muted small">
                    {f.learned_count} of {plural(f.card_count, 'card')} learned
                  </div>
                </div>
                <ChevronRight size={18} />
              </button>
            );
          })}
        </div>
      </section>
    </aside>
  );
}
