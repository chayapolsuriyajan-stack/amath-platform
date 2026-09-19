import { Navigate, Route, Routes } from 'react-router-dom';
import { Game } from './pages/Game';
import { History } from './pages/History';
import { Home } from './pages/Home';
import { Rules } from './pages/Rules';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/rules" element={<Rules />} />
      <Route path="/history" element={<History />} />
      <Route path="/room/:code" element={<Game />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
