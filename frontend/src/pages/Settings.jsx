import { useMemo, useState } from 'react'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Divider,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { VisibilityOffRounded, VisibilityRounded } from '@mui/icons-material'
import { apiRequest } from '../api/client.js'

function SettingsPage({ user }) {
  const [form, setForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  })
  const [touched, setTouched] = useState({
    current_password: false,
    new_password: false,
    confirm_password: false,
  })
  const [visibility, setVisibility] = useState({
    current_password: false,
    new_password: false,
    confirm_password: false,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const validation = useMemo(() => {
    const next = {
      current_password: '',
      new_password: '',
      confirm_password: '',
    }

    if (!form.current_password) {
      next.current_password = 'Current password is required.'
    }

    if (!form.new_password) {
      next.new_password = 'New password is required.'
    } else if (form.new_password.length < 8) {
      next.new_password = 'Use at least 8 characters.'
    } else if (form.new_password === form.current_password) {
      next.new_password = 'New password must be different from the current password.'
    }

    if (!form.confirm_password) {
      next.confirm_password = 'Confirm the new password.'
    } else if (form.confirm_password !== form.new_password) {
      next.confirm_password = 'Confirmation must match the new password.'
    }

    return next
  }, [form.confirm_password, form.current_password, form.new_password])

  const passwordsMatch = useMemo(
    () => form.new_password && form.confirm_password && form.new_password === form.confirm_password,
    [form.confirm_password, form.new_password],
  )

  const roleLabel = useMemo(() => {
    if (user?.is_superuser) return 'Admin'
    if (user?.is_instructor) return 'Instructor'
    if (user?.is_ta) return 'TA'
    return 'Student'
  }, [user?.is_superuser, user?.is_instructor, user?.is_ta])

  const canSubmit = useMemo(
    () =>
      Boolean(
        form.current_password &&
        form.new_password &&
        form.confirm_password &&
        !validation.current_password &&
        !validation.new_password &&
        !validation.confirm_password,
      ),
    [form.confirm_password, form.current_password, form.new_password, validation],
  )

  const handleChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }))
    setError('')
    setSuccess('')
  }

  const handleBlur = (field) => () => {
    setTouched((prev) => ({ ...prev, [field]: true }))
  }

  const toggleVisibility = (field) => () => {
    setVisibility((prev) => ({ ...prev, [field]: !prev[field] }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setTouched({
      current_password: true,
      new_password: true,
      confirm_password: true,
    })
    if (!canSubmit) return

    setBusy(true)
    setError('')
    setSuccess('')
    try {
      await apiRequest('/api/change-password/', {
        method: 'POST',
        body: form,
      })
      setSuccess('Password updated.')
      setForm({
        current_password: '',
        new_password: '',
        confirm_password: '',
      })
      setTouched({
        current_password: false,
        new_password: false,
        confirm_password: false,
      })
    } catch (err) {
      setError(err.message || 'Unable to update password.')
    } finally {
      setBusy(false)
    }
  }

  const passwordInputProps = (field) => ({
    endAdornment: (
      <InputAdornment position="end">
        <IconButton
          edge="end"
          onClick={toggleVisibility(field)}
          onMouseDown={(event) => event.preventDefault()}
          aria-label={visibility[field] ? 'Hide password' : 'Show password'}
        >
          {visibility[field] ? <VisibilityOffRounded /> : <VisibilityRounded />}
        </IconButton>
      </InputAdornment>
    ),
  })

  return (
    <Box sx={{ py: { xs: 1, md: 2 } }}>
      <Stack spacing={2.5}>
        <Stack spacing={0.4}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Account
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Profile and password settings.
          </Typography>
        </Stack>

        <Stack direction={{ xs: 'column', xl: 'row' }} spacing={2.5} alignItems="stretch">
          <Paper
            elevation={0}
            sx={{
              p: { xs: 2, md: 2.4 },
              flex: 0.85,
              borderRadius: 2.5,
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Stack spacing={2}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Avatar
                  sx={{
                    width: 56,
                    height: 56,
                    fontWeight: 800,
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                  }}
                >
                  {(user?.username || 'U').slice(0, 1).toUpperCase()}
                </Avatar>
                <Stack spacing={0.2}>
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>
                    {user?.username || '—'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {user?.email || '—'}
                  </Typography>
                  <Box
                    sx={{
                      mt: 0.4,
                      display: 'inline-flex',
                      alignItems: 'center',
                      px: 1,
                      py: 0.3,
                      borderRadius: 999,
                      bgcolor: 'rgba(99, 102, 241, 0.12)',
                      color: 'primary.main',
                      fontSize: 12,
                      fontWeight: 700,
                      width: 'fit-content',
                    }}
                  >
                    {roleLabel}
                  </Box>
                </Stack>
              </Stack>

              <Divider />

              <Stack spacing={1}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Username
                  </Typography>
                  <Typography variant="body1" sx={{ fontWeight: 700 }}>
                    {user?.username || '—'}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Email
                  </Typography>
                  <Typography variant="body1" sx={{ fontWeight: 700 }}>
                    {user?.email || '—'}
                  </Typography>
                </Box>
              </Stack>
            </Stack>
          </Paper>

          <Paper
            elevation={0}
            component="form"
            onSubmit={handleSubmit}
            sx={{
              p: { xs: 2, md: 2.4 },
              flex: 1.35,
              borderRadius: 2.5,
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Stack spacing={2}>
              <Stack spacing={0.35}>
                <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                  Password
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Enter your current password, then choose a new one.
                </Typography>
              </Stack>

              {error ? <Alert severity="error">{error}</Alert> : null}
              {success ? <Alert severity="success">{success}</Alert> : null}

              <TextField
                label="Current password"
                type={visibility.current_password ? 'text' : 'password'}
                value={form.current_password}
                onChange={handleChange('current_password')}
                onBlur={handleBlur('current_password')}
                autoComplete="current-password"
                error={touched.current_password && Boolean(validation.current_password)}
                helperText={
                  touched.current_password && validation.current_password
                    ? validation.current_password
                    : ' '
                }
                InputProps={passwordInputProps('current_password')}
                fullWidth
              />
              <TextField
                label="New password"
                type={visibility.new_password ? 'text' : 'password'}
                value={form.new_password}
                onChange={handleChange('new_password')}
                onBlur={handleBlur('new_password')}
                autoComplete="new-password"
                error={touched.new_password && Boolean(validation.new_password)}
                helperText={
                  touched.new_password && validation.new_password
                    ? validation.new_password
                    : 'Use at least 8 characters and do not reuse the current password.'
                }
                InputProps={passwordInputProps('new_password')}
                fullWidth
              />
              <TextField
                label="Confirm new password"
                type={visibility.confirm_password ? 'text' : 'password'}
                value={form.confirm_password}
                onChange={handleChange('confirm_password')}
                onBlur={handleBlur('confirm_password')}
                autoComplete="new-password"
                error={touched.confirm_password && Boolean(validation.confirm_password)}
                helperText={
                  touched.confirm_password && validation.confirm_password
                    ? validation.confirm_password
                    : passwordsMatch
                      ? 'Passwords match.'
                      : ' '
                }
                InputProps={passwordInputProps('confirm_password')}
                fullWidth
              />

              <Stack direction="row" justifyContent="flex-end">
                <Button type="submit" variant="contained" disabled={!canSubmit || busy}>
                  {busy ? 'Saving…' : 'Update password'}
                </Button>
              </Stack>
            </Stack>
          </Paper>
        </Stack>
      </Stack>
    </Box>
  )
}

export default SettingsPage
