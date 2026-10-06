import { useNavigate } from 'react-router-dom';
import { Download, FolderPlus, Layers } from 'lucide-react';
import { api } from '../api';
import { useFolders } from '../state';
import { AddTile, FolderTile } from '../components/FolderTile';
import { TopBar } from '../components/TopBar';
import { FolderIcon, plural } from '../components/ui';
import { useLayout } from './Layout';

export function Dashboard() {
  const { childrenOf, loaded } = useFolders();
  const { newFolder } = useLayout();
  const navigate = useNavigate();
  const roots = childrenOf(null);
  const due = roots.filter((f) => f.due_count > 0).sort((a, b) => b.due_count - a.due_count);

  return (
    <>
      <TopBar title="Dashboard" />

      <section className="section">
        <div className="section-head">
          <h2>My Folders</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            {roots.length > 0 && (
              <a className="btn ghost small" href={api.exportUrl} download title="Download every card as a CSV file">
                <Download size={16} /> Export CSV
              </a>
            )}
            <button className="btn secondary small" onClick={() => newFolder(null)}>
              <FolderPlus size={16} /> New folder
            </button>
          </div>
        </div>
        {loaded && roots.length === 0 ? (
          <div className="empty">
            <Layers size={40} />
            <h3>Create your first folder</h3>
            <p>Folders hold subfolders and cards. Try one per subject, like “Biology” or “Spanish”.</p>
            <button className="btn" onClick={() => newFolder(null)}>
              <FolderPlus size={16} /> New folder
            </button>
          </div>
        ) : (
          <div className="tiles">
            {roots.map((f) => (
              <FolderTile key={f.id} folder={f} />
            ))}
            {loaded && <AddTile label="New folder" onClick={() => newFolder(null)} />}
          </div>
        )}
      </section>

      {due.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Due today</h2>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Folder</th>
                <th className="hide-sm">Subfolders</th>
                <th>To study</th>
                <th className="hide-sm">Learned</th>
              </tr>
            </thead>
            <tbody>
              {due.map((f) => {
                return (
                  <tr key={f.id} onClick={() => navigate(`/study/${f.id}`)}>
                    <td>
                      <div className="chip">
                        <div className={`chip-icon c-${f.color}`}>
                          <FolderIcon id={f.id} />
                        </div>
                        <div className="chip-text">
                          <div>{f.name}</div>
                          <div className="muted small">{plural(f.card_count, 'card')}</div>
                        </div>
                      </div>
                    </td>
                    <td className="hide-sm muted">{childrenOf(f.id).length || '—'}</td>
                    <td>{f.due_count}</td>
                    <td className="hide-sm">{f.card_count ? Math.round((f.learned_count / f.card_count) * 100) : 0}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
