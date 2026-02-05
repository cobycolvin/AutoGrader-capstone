import { useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './layout/AppLayout.jsx'
import { apiRequest } from './api/client.js'
import ComingSoon from './pages/ComingSoon.jsx'
import CoursesPage from './pages/Courses.jsx'
import Dashboard from './pages/Dashboard.jsx'
import LoginPage from './pages/Login.jsx'

function App() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState('Checking session...')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [checking, setChecking] = useState(true)

  const hasCredentials = useMemo(() => username.trim() && password.trim(), [username, password])

  const fetchMe = async () => {
    try {
      const data = await apiRequest('/api/me/')
      setIsAuthenticated(true)
      setStatus(`Logged in as ${data.username || 'user'}`)
    } catch (err) {
      setIsAuthenticated(false)
      if (err.status === 401) {
        setStatus('Not logged in')
      } else {
        setStatus('Backend unreachable')
      }
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    fetchMe()
  }, [])

  const handleLogin = async (event) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      await apiRequest('/api/login/', {
        method: 'POST',
        body: { username, password },
      })
      await fetchMe()
      setPassword('')
    } catch (err) {
      setError(err.message || 'Unable to reach backend')
      setIsAuthenticated(false)
      setStatus('Not logged in')
    } finally {
      setBusy(false)
    }
  }

  const handleLogout = async () => {
    setError('')
    setBusy(true)
    try {
      await apiRequest('/api/logout/', { method: 'POST' })
      setIsAuthenticated(false)
      setStatus('Not logged in')
    } catch (err) {
      setError(err.message || 'Unable to reach backend')
    } finally {
      setBusy(false)
    }
  }

  if (checking) {
    return (
      <LoginPage
        username=""
        password=""
        busy
        error=""
        canSubmit={false}
        onUsernameChange={() => {}}
        onPasswordChange={() => {}}
        onSubmit={(event) => event.preventDefault()}
      />
    )
  }

  if (!isAuthenticated) {
    return (
      <LoginPage
        username={username}
        password={password}
        busy={busy}
        error={error}
        canSubmit={hasCredentials}
        onUsernameChange={(event) => setUsername(event.target.value)}
        onPasswordChange={(event) => setPassword(event.target.value)}
        onSubmit={handleLogin}
      />
    )
  }

  return (
    <AppLayout status={status}>
      <Routes>
        <Route path="/" element={<Dashboard busy={busy} onLogout={handleLogout} />} />
        <Route path="/courses" element={<CoursesPage />} />
        <Route path="/assignments" element={<ComingSoon title="Assignments" />} />
        <Route path="/submissions" element={<ComingSoon title="Submissions" />} />
        <Route path="/integrity" element={<ComingSoon title="Integrity" />} />
        <Route path="/settings" element={<ComingSoon title="Settings" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppLayout>
  )
}

export default App
