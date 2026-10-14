import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, UserPlus, Activity, Users, Layers } from 'lucide-react';
import { api, ApiError, type OwnerOverview, type OwnerUser } from '../api';

type Sort = 'joined' | 'active' | 'reviews';

const DAY = 86_400_000;

/** "just now", "5 min ago", "3 h ago", "2 d ago", then a date. */
function ago(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / 3_600_000)} h ago`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)} d ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
const dateTime = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function AdminPage() {
  const [overview, setOverview] = useState<OwnerOverview | null>(null);
  const [users, setUsers] = useState<OwnerUser[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [sort, setSort] = useState<Sort>('joined');
  const [q, setQ] = useState('');
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [o, u] = await Promise.all([api.ownerOverview(), api.ownerUsers()]);
      setOverview(o);
      setUsers(u.users);
      setTruncated(u.truncated);
      setNow(Date.now());
      setState('ready');
    } catch (err) {
      setState(err instanceof ApiError && err.status === 404 ? 'denied' : 'error');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 60_000);
    return () => clearInterval(id);
  }, [load]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? users.filter((u) => u.email.includes(needle)) : [...users];
    if (sort === 'active') list.sort((a, b) => (b.lastActive ?? -1) - (a.lastActive ?? -1));
    else if (sort === 'reviews') list.sort((a, b) => b.reviews - a.reviews);
    else list.sort((a, b) => b.createdAt - a.createdAt);
    return list;
  }, [users, q, sort]);

  if (state === 'denied') {
    return (
      <div className="empty">
        <h2>Page not found</h2>
        <p>There's nothing here.</p>
      </div>
    );
  }

  return (
    <>
      <div className="topbar">
        <h1>Admin</h1>
        <button className="btn ghost small" onClick={() => void load()} disabled={refreshing}>
          <RefreshCw size={14} className={refreshing ? 'spin' : ''} /> {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {state === 'loading' && <p className="muted">Loading…</p>}
      {state === 'error' && <div className="error">Couldn't load the dashboard. Try Refresh.</div>}

      {overview && (
        <>
          <section className="admin-stats" aria-label="Summary">
            <Stat icon={<Users size={16} />} label="People signed up" value={overview.totals.users} note={`${overview.totals.neverStudied} haven't studied yet`} />
            <Stat icon={<UserPlus size={16} />} label="New in the last 7 days" value={overview.newUsers.last7d} note={`${overview.newUsers.last24h} in the last 24 h · ${overview.newUsers.last30d} in 30 days`} />
            <Stat icon={<Activity size={16} />} label="Active in the last 7 days" value={overview.activeUsers.last7d} note={`${overview.activeUsers.last24h} in the last 24 h · ${overview.activeUsers.last30d} in 30 days`} />
            <Stat icon={<Layers size={16} />} label="Cards made" value={overview.totals.cards} note={`${overview.totals.reviews.toLocaleString()} reviews · ${overview.totals.folders} folders`} />
          </section>

          <section className="admin-charts">
            <Bars title="New signups per day" series={overview.series.map((d) => ({ date: d.date, value: d.signups }))} tone="primary" />
            <Bars title="People active per day" series={overview.series.map((d) => ({ date: d.date, value: d.active }))} tone="good" />
          </section>
          <p className="muted small admin-note">
            "Active" means they answered at least one card. Days are UTC. Updated {ago(overview.generatedAt, now)}. This page never shows anyone's cards.
          </p>
        </>
      )}

      {overview && (
        <section className="section">
          <div className="section-head">
            <h2>Everyone ({users.length}{truncated ? ` of ${overview.totals.users}` : ''})</h2>
            <div className="admin-tools">
              <input className="input admin-search" placeholder="Search by email" aria-label="Search by email" value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="admin-sort" role="group" aria-label="Sort by">
                {([['joined', 'Newest'], ['active', 'Last active'], ['reviews', 'Most reviews']] as [Sort, string][]).map(([value, label]) => (
                  <button key={value} className={sort === value ? 'on' : ''} aria-pressed={sort === value} onClick={() => setSort(value)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="admin-table-wrap">
            <table className="table admin-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Joined</th>
                  <th>Last active</th>
                  <th>Status</th>
                  <th className="num">Folders</th>
                  <th className="num">Cards</th>
                  <th className="num">Reviews (7 d)</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((u) => {
                  const isNew = now - u.createdAt < 7 * DAY;
                  const status = u.lastActive === null ? 'new' : now - u.lastActive < 7 * DAY ? 'review' : 'learning';
                  return (
                    <tr key={u.id}>
                      <td>
                        <span className="admin-email">{u.email}</span>
                        {u.isYou && <span className="admin-badge">You</span>}
                        {isNew && !u.isYou && <span className="admin-badge new">New</span>}
                      </td>
                      <td title={dateTime(u.createdAt)}>{ago(u.createdAt, now)}</td>
                      <td title={u.lastActive ? dateTime(u.lastActive) : undefined}>{u.lastActive ? ago(u.lastActive, now) : 'Never'}</td>
                      <td>
                        <span className={`state-tag state-${status}`}>{status === 'review' ? 'Active' : status === 'learning' ? 'Quiet' : 'Not started'}</span>
                      </td>
                      <td className="num">{u.folders}</td>
                      <td className="num">{u.cards}</td>
                      <td className="num">
                        {u.reviewsLast7Days} <span className="muted">({u.reviews.toLocaleString()} total)</span>
                      </td>
                    </tr>
                  );
                })}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                      {q ? 'Nobody matches that.' : 'No accounts yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {truncated && <p className="muted small">Showing the newest {users.length}. Search covers only these.</p>}
        </section>
      )}
    </>
  );
}

function Stat({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: number; note: string }) {
  return (
    <div className="admin-stat">
      <div className="admin-stat-label">
        {icon} {label}
      </div>
      <div className="admin-stat-value">{value.toLocaleString()}</div>
      <div className="admin-stat-note">{note}</div>
    </div>
  );
}

/** A small bar chart, one bar per day. Bars have tooltips; the whole chart has a plain-text summary for screen readers. */
function Bars({ title, series, tone }: { title: string; series: { date: string; value: number }[]; tone: 'primary' | 'good' }) {
  const max = Math.max(1, ...series.map((d) => d.value));
  const total = series.reduce((sum, d) => sum + d.value, 0);
  const W = 300;
  const H = 84;
  const gap = 3;
  const bw = (W - gap * (series.length - 1)) / series.length;
  return (
    <figure className="admin-chart">
      <figcaption>
        <b>{title}</b>
        <span className="muted"> · {total} in 30 days</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H + 16}`} role="img" aria-label={`${title}: ${total} in the last 30 days, busiest day ${max}`} preserveAspectRatio="none">
        <line x1="0" x2={W} y1={H + 0.5} y2={H + 0.5} className="admin-axis" />
        {series.map((d, i) => {
          const h = d.value === 0 ? 0 : Math.max(3, (d.value / max) * (H - 6));
          return (
            <rect key={d.date} x={i * (bw + gap)} y={H - h} width={bw} height={h} rx="2" className={`admin-bar ${tone}`}>
              <title>
                {d.date}: {d.value}
              </title>
            </rect>
          );
        })}
        <text x="0" y={H + 13} className="admin-tick">{series[0]?.date.slice(5)}</text>
        <text x={W} y={H + 13} textAnchor="end" className="admin-tick">{series[series.length - 1]?.date.slice(5)}</text>
      </svg>
    </figure>
  );
}
