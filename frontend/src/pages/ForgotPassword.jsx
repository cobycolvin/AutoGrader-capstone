import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Container,
  Divider,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { apiRequest } from '../api/client.js'

function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!email.trim()) return

    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const data = await apiRequest('/api/forgot-password/', {
        method: 'POST',
        body: {
          email: email.trim(),
          reset_url_base: `${window.location.origin}/reset-password`,
        },
      })
      setSuccess(data.detail || 'If an account exists for that email, a password reset link has been sent.')
    } catch (err) {
      setError(err.message || 'Unable to request password reset.')
    } finally {
      setBusy(false)
    }
  }

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
                Forgot password
              </Typography>
              <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                Enter the email tied to your account. We will send a reset link if the account exists.
              </Typography>
            </Box>

            <Divider />

            <Stack component="form" spacing={2} onSubmit={handleSubmit} noValidate>
              {error ? <Alert severity="error">{error}</Alert> : null}
              {success ? <Alert severity="success">{success}</Alert> : null}

              <TextField
                label="Email"
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  setError('')
                  setSuccess('')
                }}
                autoComplete="email"
                fullWidth
                autoFocus
              />

              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Link component={RouterLink} to="/login" underline="hover" sx={{ fontWeight: 700 }}>
                  Back to sign in
                </Link>
                <Button type="submit" variant="contained" disabled={busy || !email.trim()}>
                  {busy ? 'Sending…' : 'Send reset link'}
                </Button>
              </Stack>
            </Stack>
          </Stack>
        </Paper>
      </Container>
    </Box>
  )
}

export default ForgotPasswordPage
