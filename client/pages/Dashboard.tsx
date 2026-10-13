import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, FolderPlus, Layers, Sparkles } from 'lucide-react';
import { useFolders } from '../state';
import { AddTile, FolderTile } from '../components/FolderTile';
import { ImportButton } from '../components/ImportButton';
import { ExportDialog } from '../components/ExportDialog';
import { api } from '../api';
import { TopBar } from '../components/TopBar';
import { FolderIcon, plural } from '../components/ui';
import { useLayout } from './Layout';

export function Dashboard() {
  const { childrenOf, loaded } = useFolders();
  const { newFolder } = useLayout();
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);
  // "Turn notes into flashcards" is only offered to people it's been switched on for.
  const [notesAvailable, setNotesAvailable] = useState(false);
  useEffect(() => {
    api.notesStatus().then((s) => setNotesAvailable(s.available)).catch(() => setNotesAvailable(false));
  }, []);
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
              <button className="btn ghost small" onClick={() => setExporting(true)} title="Download cards as a CSV file: choose which folders">
                <Download size={16} /> Export CSV
              </button>
            )}
            <ImportButton />
            {notesAvailable && (
              <button className="btn secondary small" onClick={() => navigate('/notes')} title="Upload your notes and let AI turn them into flashcards">
                <Sparkles size={16} /> Notes to cards
              </button>
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
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
    </>
  );
}
