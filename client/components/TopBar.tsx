import { useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';

export function TopBar({ title, children }: { title: ReactNode; children?: ReactNode }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');

  return (
    <div className="topbar">
      <h1>{title}</h1>
      <form
        className="search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
        }}
      >
        <Search size={16} />
        <input placeholder="Search cards" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search cards" />
      </form>
      {children}
    </div>
  );
}
