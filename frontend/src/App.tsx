import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Layout from './components/Layout';
import { PageLoader } from './components/ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import TasksList from './pages/TasksList';
import TaskForm from './pages/TaskForm';
import TaskDetail from './pages/TaskDetail';
import Reports from './pages/Reports';
import Queries from './pages/Queries';
import QueryDetail from './pages/QueryDetail';
import People from './pages/People';
import PersonProfile from './pages/PersonProfile';
import Stipends from './pages/Stipends';
import Leaves from './pages/Leaves';
import Streaks from './pages/Streaks';
import Videos from './pages/Videos';
import VideoPlayer from './pages/VideoPlayer';
import Vault from './pages/Vault';
import Announcements from './pages/Announcements';
import Activity from './pages/Activity';
import SearchPage from './pages/SearchPage';
import Settings from './pages/Settings';

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-100"><PageLoader /></div>;
  if (!user) return <Login />;
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/tasks" element={<TasksList />} />
        <Route path="/tasks/new" element={<TaskForm />} />
        <Route path="/tasks/:id" element={<TaskDetail />} />
        <Route path="/tasks/:id/breakdown" element={<TaskForm />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/queries" element={<Queries />} />
        <Route path="/queries/:id" element={<QueryDetail />} />
        <Route path="/people" element={<People />} />
        <Route path="/people/:id" element={<PersonProfile />} />
        <Route path="/stipends" element={<Stipends />} />
        <Route path="/leaves" element={<Leaves />} />
        <Route path="/streaks" element={<Streaks />} />
        <Route path="/videos" element={<Videos />} />
        <Route path="/videos/:id" element={<VideoPlayer />} />
        <Route path="/vault" element={<Vault />} />
        <Route path="/announcements" element={<Announcements />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  );
}
