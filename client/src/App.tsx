import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Game } from './pages/Game';
import { History } from './pages/History';
import { Home } from './pages/Home';
import { Rules } from './pages/Rules';

const ComboDemo = import.meta.env.DEV ? lazy(() => import('./pages/ComboDemo').then((m) => ({ default: m.ComboDemo }))) : null;

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/rules" element={<Rules />} />
      <Route path="/history" element={<History />} />
      <Route path="/room/:code" element={<Game />} />
      {ComboDemo ? (
        <Route path="/combo-demo" element={<Suspense fallback={null}><ComboDemo /></Suspense>} />
      ) : null}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
