import { createContext, useContext, useState } from 'react';
import { Outlet, useMatch, useNavigate } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Sidebar } from '../components/Sidebar';
import { RightPanel } from '../components/RightPanel';
import { FolderDialog } from '../components/FolderDialog';
import { Logo } from '../components/ui';
import { useFolders } from '../state';

interface LayoutApi {
  /** Opens the "new folder" dialog; parentId null creates a top-level folder. */
  newFolder: (parentId: number | null) => void;
}
const LayoutContext = createContext<LayoutApi>(null!);
export const useLayout = () => useContext(LayoutContext);

export function Layout() {
  const { refresh } = useFolders();
  const navigate = useNavigate();
  const studyMatch = useMatch('/study/:id');
  const browseMatch = useMatch('/browse/:id');
  const importMatch = useMatch('/import');
  const notesMatch = useMatch('/notes');
  const studying = studyMatch ?? browseMatch ?? importMatch ?? notesMatch;
  const [menuOpen, setMenuOpen] = useState(false);
  const [creating, setCreating] = useState<{ parentId: number | null } | null>(null);

  return (
    <LayoutContext.Provider value={{ newFolder: (parentId) => setCreating({ parentId }) }}>
      <div className={`shell ${studying ? 'no-right' : ''}`}>
        <div className="mobile-bar">
          <div className="brand" style={{ padding: 0 }}>
            <Logo /> Georgie
          </div>
          <button className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
        </div>
        <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} onNewFolder={() => setCreating({ parentId: null })} />
        <main className="main">
          <Outlet />
        </main>
        {!studying && <RightPanel />}
      </div>
      {creating && (
        <FolderDialog
          parentId={creating.parentId}
          onClose={() => setCreating(null)}
          onSaved={async (f) => {
            setCreating(null);
            await refresh();
            navigate(`/folders/${f.id}`);
          }}
        />
      )}
    </LayoutContext.Provider>
  );
}
