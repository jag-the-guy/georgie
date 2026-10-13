import { useEffect, useState } from 'react';
import { NavLink, useMatch, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, LayoutDashboard, LogOut, Plus, X } from 'lucide-react';
import { useAuth, useFolders } from '../state';
import type { FolderWithStats } from '../api';
import { Logo } from './ui';
import { ThemeToggle } from '../themes/ThemeToggle'; // design experiment (temporary)

export function Sidebar({ open, onClose, onNewFolder }: { open: boolean; onClose: () => void; onNewFolder: () => void }) {
  const { logout } = useAuth();
  const { childrenOf } = useFolders();

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`} onClick={(e) => (e.target as HTMLElement).closest('a') && onClose()}>
      <div className="brand">
        <Logo />
        <span style={{ flex: 1 }}>Georgie</span>
        {open && (
          <button className="icon-btn plain" onClick={onClose} aria-label="Close menu">
            <X size={18} />
          </button>
        )}
      </div>
      <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <LayoutDashboard size={18} /> Dashboard
      </NavLink>

      <div className="nav-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Folders
        <button className="icon-btn plain" style={{ width: 24, height: 24 }} onClick={onNewFolder} aria-label="New folder" title="New folder">
          <Plus size={15} />
        </button>
      </div>
      <nav className="tree" aria-label="Folders">
        {childrenOf(null).map((f) => (
          <TreeNode key={f.id} folder={f} depth={0} />
        ))}
        {childrenOf(null).length === 0 && <div className="muted small" style={{ padding: '4px 14px' }}>No folders yet</div>}
      </nav>

      <ThemeToggle /> {/* design experiment (temporary) */}
      <button className="nav-item" onClick={logout}>
        <LogOut size={18} /> Log out
      </button>
    </aside>
  );
}

function TreeNode({ folder, depth }: { folder: FolderWithStats; depth: number }) {
  const { childrenOf, pathTo } = useFolders();
  const navigate = useNavigate();
  const folderMatch = useMatch('/folders/:id');
  const studyMatch = useMatch('/study/:id');
  const browseMatch = useMatch('/browse/:id');
  const match = folderMatch ?? studyMatch ?? browseMatch;
  const activeId = match ? Number(match.params.id) : null;
  const kids = childrenOf(folder.id);
  const containsActive = activeId !== null && activeId !== folder.id && pathTo(activeId).some((f) => f.id === folder.id);
  const [open, setOpen] = useState(containsActive);
  // Expand when navigating to a folder inside this one.
  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);

  return (
    <>
      <div
        className={`tree-row ${activeId === folder.id ? 'active' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => navigate(`/folders/${folder.id}`)}
      >
        {kids.length > 0 ? (
          <button
            className="tree-toggle"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(!open);
            }}
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="tree-toggle" />
        )}
        <span className={`dot c-${folder.color}`} />
        <span className="name" title={folder.name}>
          {folder.name}
        </span>
        {folder.due_count > 0 && <span className="count-pill">{folder.due_count}</span>}
      </div>
      {open && kids.map((k) => <TreeNode key={k.id} folder={k} depth={depth + 1} />)}
    </>
  );
}
