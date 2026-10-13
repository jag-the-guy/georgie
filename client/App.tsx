import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, FoldersProvider, useAuth } from './state';
import { AuthPage } from './pages/Auth';
import { Layout } from './pages/Layout';
import { Dashboard } from './pages/Dashboard';
import { FolderPage } from './pages/FolderPage';
import { SearchPage } from './pages/SearchPage';
import { Study } from './pages/Study';
import { Browse } from './pages/Browse';
import { ImportPage } from './pages/Import';
import { NotesPage } from './pages/Notes';

function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  // Remount folders when the user changes so one account never sees another's cached data.
  return (
    <FoldersProvider key={user.id}>
      <Outlet />
    </FoldersProvider>
  );
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Navigate to="/" replace /> : <>{children}</>;
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<GuestOnly><AuthPage mode="login" /></GuestOnly>} />
        <Route path="/signup" element={<GuestOnly><AuthPage mode="signup" /></GuestOnly>} />
        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="folders/:id" element={<FolderPage />} />
            <Route path="study/:id" element={<Study />} />
            <Route path="browse/:id" element={<Browse />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="notes" element={<NotesPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
