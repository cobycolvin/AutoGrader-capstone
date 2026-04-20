import { useMemo, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Container,
  Divider,
  IconButton,
  InputAdornment,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { VisibilityOffRounded, VisibilityRounded } from '@mui/icons-material'
import { apiRequest } from '../api/client.js'

function ResetPasswordPage() {
  const { uid = '', token = '' } = useParams()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    new_password: '',
    confirm_password: '',
  })
  const [touched, setTouched] = useState({
    new_password: false,
    confirm_password: false,
  })
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const validation = useMemo(() => {
    const next = {
      new_password: '',
      confirm_password: '',
    }

    if (!form.new_password) {
      next.new_password = 'New password is required.'
    } else if (form.new_password.length < 8) {
      next.new_password = 'Use at least 8 characters.'
    }

    if (!form.confirm_password) {
      next.confirm_password = 'Confirm the new password.'
    } else if (form.confirm_password !== form.new_password) {
      next.confirm_password = 'Confirmation must match the new password.'
    }

    return next
  }, [form.confirm_password, form.new_password])

  const canSubmit = Boolean(
    uid &&
      token &&
      form.new_password &&
      form.confirm_password &&
      !validation.new_password &&
      !validation.confirm_password,
  )

  const handleSubmit = async (event) => {
    event.preventDefault()
    setTouched({ new_password: true, confirm_password: true })
    if (!canSubmit) return

    setBusy(true)
    setError('')
    setSuccess('')
    try {
      await apiRequest('/api/reset-password/', {
        method: 'POST',
        body: {
          uid,
          token,
          new_password: form.new_password,
          confirm_password: form.confirm_password,
        },
      })
      setSuccess('Password reset. Redirecting to sign in…')
      setTimeout(() => navigate('/login', { replace: true }), 1200)
    } catch (err) {
      setError(err.message || 'Unable to reset password.')
    } finally {
      setBusy(false)
    }
  }

  const passwordAdornment = (shown, toggle, label) => ({
    endAdornment: (
      <InputAdornment position="end">
        <IconButton edge="end" onClick={toggle} aria-label={label}>
          {shown ? <VisibilityOffRounded /> : <VisibilityRounded />}
        </IconButton>
      </InputAdornment>
    ),
  })

  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: 'background.default',
        display: 'grid',
        placeItems: 'center',
        py: { xs: 5, md: 7 },
      }}
    >
      <Container maxWidth="sm">
        <Paper elevation={0} sx={{ borderRadius: 4, overflow: 'hidden', p: { xs: 3, sm: 4 } }}>
          <Stack spacing={2.25}>
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 900 }}>
                Reset password
              </Typography>
              <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                Choose a new password for your account.
              </Typography>
            </Box>

            <Divider />

            <Stack component="form" spacing={2} onSubmit={handleSubmit} noValidate>
              {!uid || !token ? <Alert severity="error">This reset link is incomplete.</Alert> : null}
              {error ? <Alert severity="error">{error}</Alert> : null}
              {success ? <Alert severity="success">{success}</Alert> : null}

              <TextField
                label="New password"
                type={showPassword ? 'text' : 'password'}
                value={form.new_password}
                onChange={(event) => {
                  setForm((prev) => ({ ...prev, new_password: event.target.value }))
                  setError('')
                }}
                onBlur={() => setTouched((prev) => ({ ...prev, new_password: true }))}
                error={touched.new_password && Boolean(validation.new_password)}
                helperText={
                  touched.new_password && validation.new_password
                    ? validation.new_password
                    : 'Use at least 8 characters.'
                }
                autoComplete="new-password"
                InputProps={passwordAdornment(showPassword, () => setShowPassword((prev) => !prev), showPassword ? 'Hide password' : 'Show password')}
                fullWidth
              />

              <TextField
                label="Confirm new password"
                type={showConfirm ? 'text' : 'password'}
                value={form.confirm_password}
                onChange={(event) => {
                  setForm((prev) => ({ ...prev, confirm_password: event.target.value }))
                  setError('')
                }}
                onBlur={() => setTouched((prev) => ({ ...prev, confirm_password: true }))}
                error={touched.confirm_password && Boolean(validation.confirm_password)}
                helperText={
                  touched.confirm_password && validation.confirm_password
                    ? validation.confirm_password
                    : ' '
                }
                autoComplete="new-password"
                InputProps={passwordAdornment(showConfirm, () => setShowConfirm((prev) => !prev), showConfirm ? 'Hide password' : 'Show password')}
                fullWidth
              />

              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Link component={RouterLink} to="/login" underline="hover" sx={{ fontWeight: 700 }}>
                  Back to sign in
                </Link>
                <Button type="submit" variant="contained" disabled={busy || !canSubmit}>
                  {busy ? 'Saving…' : 'Reset password'}
                </Button>
              </Stack>
            </Stack>
          </Stack>
        </Paper>
      </Container>
    </Box>
  )
}

export default ResetPasswordPage
