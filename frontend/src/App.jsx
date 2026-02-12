import { useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './layout/AppLayout.jsx'
import { apiRequest } from './api/client.js'
import AdminGroupsPage from './pages/AdminGroups.jsx'
import AdminLanguagesPage from './pages/AdminLanguages.jsx'
import AdminUsersPage from './pages/AdminUsers.jsx'
import ComingSoon from './pages/ComingSoon.jsx'
import CourseWorkspace from './pages/CourseWorkspace.jsx'
import CourseCatalogPage from './pages/CourseCatalog.jsx'
import CoursesPage from './pages/Courses.jsx'
import Dashboard from './pages/Dashboard.jsx'
import LoginPage from './pages/Login.jsx'
import MyCoursesPage from './pages/MyCourses.jsx'
import RegisterPage from './pages/Register.jsx'

function App({ mode, onToggleMode }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [registerValues, setRegisterValues] = useState({
    first_name: '',
    middle_name: '',
    last_name: '',
    username: '',
    email: '',
    cwid: '',
    password: '',
    confirmPassword: '',
  })
  const [status, setStatus] = useState('Checking session...')
  const [error, setError] = useState('')
  const [registerError, setRegisterError] = useState('')
  const [busy, setBusy] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [checking, setChecking] = useState(true)
  const [user, setUser] = useState(null)

  const hasCredentials = useMemo(() => username.trim() && password.trim(), [username, password])
  const canRegister = useMemo(() => {
    const {
      first_name: firstName,
      last_name: lastName,
      username: regUser,
      email,
      cwid,
      password: regPass,
      confirmPassword,
    } = registerValues
    return (
      firstName.trim() &&
      lastName.trim() &&
      regUser.trim() &&
      email.trim() &&
      cwid.trim() &&
      regPass &&
      confirmPassword &&
      regPass === confirmPassword
    )
  }, [registerValues])

  const fetchMe = async () => {
    try {
      const data = await apiRequest('/api/me/')
      setUser(data)
      setIsAuthenticated(true)
      setStatus(`Logged in as ${data.username || 'user'}`)
    } catch (err) {
      setUser(null)
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
      setUser(null)
      setStatus('Not logged in')
    } finally {
      setBusy(false)
    }
  }

  const handleRegister = async (event) => {
    event.preventDefault()
    setRegisterError('')
    setBusy(true)
    try {
      await apiRequest('/api/register/', {
        method: 'POST',
        body: {
          first_name: registerValues.first_name,
          middle_name: registerValues.middle_name,
          last_name: registerValues.last_name,
          username: registerValues.username,
          email: registerValues.email,
          password: registerValues.password,
          cwid: registerValues.cwid,
        },
      })
      await fetchMe()
    } catch (err) {
      setRegisterError(err.message || 'Unable to create account')
      setIsAuthenticated(false)
      setUser(null)
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
      setUser(null)
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
      <Routes>
        <Route
          path="/login"
          element={
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
          }
        />
        <Route
          path="/register"
          element={
            <RegisterPage
              values={registerValues}
              busy={busy}
              error={registerError}
              canSubmit={canRegister}
              onChange={(field, value) =>
                setRegisterValues((prev) => ({
                  ...prev,
                  [field]: value,
                }))
              }
              onSubmit={handleRegister}
            />
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <AppLayout
      user={user}
      onLogout={handleLogout}
      busy={busy}
      mode={mode}
      onToggleMode={onToggleMode}
    >
      <Routes>
        <Route path="/" element={<Dashboard busy={busy} />} />
        <Route path="/my-courses" element={<MyCoursesPage user={user} />} />
        <Route path="/course/:courseId/*" element={<CourseWorkspace user={user} />} />
        <Route path="/catalog" element={<CourseCatalogPage />} />
        <Route path="/courses" element={<CoursesPage />} />
        <Route
          path="/admin/users"
          element={user?.is_superuser ? <AdminUsersPage /> : <Navigate to="/" replace />}
        />
        <Route
          path="/admin/groups"
          element={user?.is_superuser ? <AdminGroupsPage /> : <Navigate to="/" replace />}
        />
        <Route
          path="/admin/languages"
          element={user?.is_superuser ? <AdminLanguagesPage /> : <Navigate to="/" replace />}
        />
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
