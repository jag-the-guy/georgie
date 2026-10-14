import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler, type FolderWithStats, type User } from './api';

interface AuthState {
  user: User | null;
  loading: boolean;
  /** True for the site owner (listed in ADMIN_EMAILS): shows the Admin link. */
  isAdmin: boolean;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // Ask whenever the signed-in person changes (also clears the flag on logout, so the next login can't inherit it).
  const userId = user?.id;
  useEffect(() => {
    setIsAdmin(false);
    if (userId === undefined) return;
    let current = true;
    api.ownerMe().then((r) => current && setIsAdmin(r.admin)).catch(() => {});
    return () => {
      current = false;
    };
  }, [userId]);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, isAdmin, setUser, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

interface FoldersState {
  folders: FolderWithStats[];
  loaded: boolean;
  refresh: () => Promise<void>;
  byId: Map<number, FolderWithStats>;
  childrenOf: (id: number | null) => FolderWithStats[];
  pathTo: (id: number) => FolderWithStats[];
}

const FoldersContext = createContext<FoldersState>(null!);

export function FoldersProvider({ children }: { children: ReactNode }) {
  const [folders, setFolders] = useState<FolderWithStats[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const r = await api.folders();
    setFolders(r.folders);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh().catch(() => setLoaded(true));
  }, [refresh]);

  const value = useMemo(() => {
    const byId = new Map(folders.map((f) => [f.id, f]));
    const childrenOf = (id: number | null) => folders.filter((f) => f.parent_id === id);
    const pathTo = (id: number) => {
      const path: FolderWithStats[] = [];
      for (let f = byId.get(id); f; f = f.parent_id ? byId.get(f.parent_id) : undefined) path.unshift(f);
      return path;
    };
    return { folders, loaded, refresh, byId, childrenOf, pathTo };
  }, [folders, loaded, refresh]);

  return <FoldersContext.Provider value={value}>{children}</FoldersContext.Provider>;
}

export const useFolders = () => useContext(FoldersContext);
