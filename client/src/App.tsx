import { Navigate, Route, Routes } from 'react-router';
import { AdminDashboard } from './pages/AdminDashboard.tsx';
import { AdminLayout } from './pages/AdminLayout.tsx';
import { AdminLogin } from './pages/AdminLogin.tsx';
import { AdminQuestions } from './pages/AdminQuestions.tsx';
import { Home } from './pages/Home.tsx';
import { Join } from './pages/Join.tsx';
import { Play } from './pages/Play.tsx';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/join/:code" element={<Join />} />
      <Route path="/play" element={<Play />} />
      <Route path="/admin" element={<AdminLogin />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route path="game" element={<AdminDashboard />} />
        <Route path="questions" element={<AdminQuestions />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
