import { Routes, Route, NavLink } from 'react-router-dom'
import MarketplaceList from './pages/MarketplaceList'
import MarketplaceDetail from './pages/MarketplaceDetail'
import TaskList from './pages/TaskList'
import ExportNew from './pages/ExportNew'
import ExportList from './pages/ExportList'
import ExportDetail from './pages/ExportDetail'
import Settings from './pages/Settings'
import { ToastProvider } from './components/Toast'

export default function App() {
  return (
    <ToastProvider>
    <div style={{ fontFamily: 'sans-serif', maxWidth: 1100, margin: '0 auto', padding: '0 16px' }}>
      <nav style={{ borderBottom: '1px solid #e5e7eb', padding: '12px 0', display: 'flex', gap: 24, marginBottom: 24 }}>
        <strong style={{ marginRight: 16 }}>CC Plugin Marketplace</strong>
        <NavLink to="/" end style={navStyle}>Marketplaces</NavLink>
        <NavLink to="/tasks" style={navStyle}>Tasks</NavLink>
        <NavLink to="/export" style={navStyle}>Exports</NavLink>
        <NavLink to="/settings" style={navStyle}>Settings</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<MarketplaceList />} />
        <Route path="/marketplace/:id" element={<MarketplaceDetail />} />
        <Route path="/tasks" element={<TaskList />} />
        <Route path="/export" element={<ExportList />} />
        <Route path="/export/new" element={<ExportNew />} />
        <Route path="/export/:id" element={<ExportDetail />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </div>
    </ToastProvider>
  )
}

function navStyle({ isActive }: { isActive: boolean }) {
  return { color: isActive ? '#2563eb' : '#374151', textDecoration: 'none', fontWeight: isActive ? 600 : 400 }
}
