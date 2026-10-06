import { useNavigate } from 'react-router-dom';
import { ChevronRight, Plus } from 'lucide-react';
import type { FolderWithStats } from '../api';
import { useFolders } from '../state';
import { FolderIcon, plural } from './ui';

export function FolderTile({ folder }: { folder: FolderWithStats }) {
  const navigate = useNavigate();
  const { childrenOf } = useFolders();
  const subfolders = childrenOf(folder.id).length;

  return (
    <div className={`tile c-${folder.color}`} onClick={() => navigate(`/folders/${folder.id}`)}>
      <div className="tile-art">
        <FolderIcon id={folder.id} size={46} />
      </div>
      <div className="tile-body">
        <h3 title={folder.name}>{folder.name}</h3>
        <div className="muted small">
          {plural(folder.card_count, 'card')}
          {subfolders > 0 && ` · ${plural(subfolders, 'subfolder')}`}
        </div>
      </div>
      <div className="tile-foot">
        <span className={`badge ${folder.due_count ? 'due' : ''}`}>
          {folder.due_count ? `${folder.due_count} to study` : 'All caught up'}
        </span>
        <button
          className="tile-arrow"
          aria-label={`Study ${folder.name}`}
          title="Study now"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/study/${folder.id}`);
          }}
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

export function AddTile({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="tile add" onClick={onClick}>
      <Plus size={26} />
      <span>{label}</span>
    </button>
  );
}
