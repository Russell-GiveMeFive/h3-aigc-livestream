import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

const StreamerPage = lazy(() => import('./pages/StreamerPage'))
const ViewerPage = lazy(() => import('./pages/ViewerPage'))

function RouteLoading() {
  return (
    <main className="route-loading" role="status" aria-live="polite">
      <span className="brand-mark">◤</span>
      <span>H3·LIVE 正在接入控制信号…</span>
    </main>
  )
}

export default function App() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="/" element={<Navigate to="/streamer" replace />} />
        <Route path="/streamer" element={<StreamerPage />} />
        <Route path="/viewer" element={<ViewerPage />} />
        <Route path="*" element={<Navigate to="/streamer" replace />} />
      </Routes>
    </Suspense>
  )
}
