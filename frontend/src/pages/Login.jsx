import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Divider,
  Paper,
  Stack,
  TextField,
  Typography,
  InputAdornment,
  IconButton,
  Checkbox,
  FormControlLabel,
  Link,
  CircularProgress,
} from '@mui/material'
import {
  LockRounded,
  PersonRounded,
  VisibilityRounded,
  VisibilityOffRounded,
  ShieldRounded,
} from '@mui/icons-material'
import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'

// Pick any Unsplash photo you like (this one is clean + “tech/education” vibe).
// Tip: change the `.../photo-XXXX` id to another Unsplash image.
const HERO_IMAGE =
  'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1600&q=80'

function LoginPage({
  username,
  password,
  busy,
  error,
  canSubmit,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
}) {
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)

  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: 'background.default',
        display: 'grid',
        placeItems: 'center',
        position: 'relative',
        overflow: 'hidden',
        py: { xs: 5, md: 7 },
      }}
    >
      {/* soft glow */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at 18% 25%, rgba(122,0,38,0.20), transparent 48%), radial-gradient(circle at 78% 14%, rgba(248,136,32,0.14), transparent 40%), radial-gradient(circle at 60% 90%, rgba(122,0,38,0.12), transparent 52%)',
          pointerEvents: 'none',
        }}
      />

      <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 1 }}>
        <Paper
          elevation={0}
          sx={{
            borderRadius: 4,
            overflow: 'hidden',
          }}
        >
          <Stack direction={{ xs: 'column', md: 'row' }} sx={{ minHeight: { md: 560 } }}>
            {/* Left: photo panel (desktop) */}
            <Box
              sx={{
                flex: 1.1,
                display: { xs: 'none', md: 'block' },
                position: 'relative',
                backgroundImage: `url(${HERO_IMAGE})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
              {/* dark overlay for readability */}
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  background:
                    'linear-gradient(135deg, rgba(16,24,40,0.78) 0%, rgba(16,24,40,0.38) 60%, rgba(16,24,40,0.28) 100%)',
                }}
              />
              <Box sx={{ position: 'relative', height: '100%', p: 4, display: 'flex' }}>
                <Stack spacing={1.5} sx={{ mt: 'auto', maxWidth: 420 }}>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                    <Chip
                      icon={<ShieldRounded />}
                      label="Secure sign-in"
                      color="primary"
                      variant="filled"
                      sx={{
                        bgcolor: 'rgba(255,255,255,0.12)',
                        color: '#fff',
                        '& .MuiChip-icon': { color: '#fff' },
                      }}
                    />
                    <Chip
                      label="Fast access"
                      variant="outlined"
                      sx={{
                        borderColor: 'rgba(255,255,255,0.26)',
                        color: '#fff',
                      }}
                    />
                  </Stack>

                  <Typography variant="h3" sx={{ color: '#fff', fontWeight: 900, letterSpacing: -0.8 }}>
                    Gradeforge
                  </Typography>
                  <Typography sx={{ color: 'rgba(255,255,255,0.82)' }}>
                    A clean, focused workspace for your courses and assignments.
                  </Typography>

             
                </Stack>
              </Box>
            </Box>

            {/* Right: form */}
            <Box sx={{ flex: 0.9, p: { xs: 3, sm: 4 } }}>
              <Stack spacing={2.25} sx={{ maxWidth: 440 }}>
                {/* Mobile header (since image is hidden) */}
                <Box sx={{ display: { xs: 'block', md: 'none' } }}>
                  <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: -0.6 }}>
                    Gradeforge
                  </Typography>
                  <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                    Sign in to continue.
                  </Typography>
                </Box>

                <Box sx={{ display: { xs: 'none', md: 'block' } }}>
                  <Typography variant="h5" sx={{ fontWeight: 900 }}>
                    Sign in
                  </Typography>
                  <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                    Use your account credentials.
                  </Typography>
                </Box>

                <Divider />

                <Stack component="form" spacing={2} onSubmit={onSubmit} noValidate>
                  <TextField
                    label="Username"
                    value={username}
                    onChange={onUsernameChange}
                    autoComplete="username"
                    fullWidth
                    autoFocus
                    placeholder="Enter your username"
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <PersonRounded fontSize="small" />
                        </InputAdornment>
                      ),
                    }}
                  />

                  <TextField
                    label="Password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={onPasswordChange}
                    autoComplete="current-password"
                    fullWidth
                    placeholder="Enter your password"
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <LockRounded fontSize="small" />
                        </InputAdornment>
                      ),
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            edge="end"
                            onClick={() => setShowPassword((v) => !v)}
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                          >
                            {showPassword ? <VisibilityOffRounded /> : <VisibilityRounded />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    }}
                  />

                  <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={remember}
                          onChange={(e) => setRemember(e.target.checked)}
                        />
                      }
                      label="Remember me"
                    />

                    <Link
                      component="button"
                      type="button"
                      underline="hover"
                      sx={{ fontWeight: 700 }}
                      onClick={() => {
                        // hook up later (route / modal). keep UX link visible.
                      }}
                    >
                      Forgot password?
                    </Link>
                  </Stack>

                  {error ? (
                    <Alert severity="error" role="alert">
                      {error}
                    </Alert>
                  ) : null}

                  <Button
                    type="submit"
                    variant="contained"
                    size="large"
                    disabled={!canSubmit || busy}
                    sx={{ py: 1.2 }}
                    startIcon={
                      busy ? <CircularProgress size={18} color="inherit" /> : <LockRounded />
                    }
                  >
                    {busy ? 'Signing in…' : 'Sign in'}
                  </Button>

                  <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
                    If you can’t access your account, contact your administrator.
                  </Typography>

                  <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
                    New here?{' '}
                    <Link component={RouterLink} to="/register" underline="hover" sx={{ fontWeight: 700 }}>
                      Create an account
                    </Link>
                  </Typography>
                </Stack>
              </Stack>
            </Box>
          </Stack>
        </Paper>
      </Container>
    </Box>
  )
}

export default LoginPage
