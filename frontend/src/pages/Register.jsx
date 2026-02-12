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
  Link,
  CircularProgress,
} from '@mui/material'
import {
  BadgeRounded,
  EmailRounded,
  LockRounded,
  PersonRounded,
  ShieldRounded,
  VisibilityOffRounded,
  VisibilityRounded,
} from '@mui/icons-material'
import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'

const HERO_IMAGE =
  'https://images.unsplash.com/photo-1513258496099-48168024aec0?auto=format&fit=crop&w=1600&q=80'

function RegisterPage({
  values,
  busy,
  error,
  canSubmit,
  onChange,
  onSubmit,
}) {
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

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
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at 12% 22%, rgba(122,0,38,0.20), transparent 48%), radial-gradient(circle at 80% 16%, rgba(248,136,32,0.12), transparent 42%), radial-gradient(circle at 60% 90%, rgba(122,0,38,0.14), transparent 52%)',
          pointerEvents: 'none',
        }}
      />

      <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 1 }}>
        <Paper elevation={0} sx={{ borderRadius: 4, overflow: 'hidden' }}>
          <Stack direction={{ xs: 'column', md: 'row' }} sx={{ minHeight: { md: 560 } }}>
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
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  background:
                    'linear-gradient(135deg, rgba(16,24,40,0.8) 0%, rgba(16,24,40,0.35) 60%, rgba(16,24,40,0.2) 100%)',
                }}
              />
              <Box sx={{ position: 'relative', height: '100%', p: 4, display: 'flex' }}>
                <Stack spacing={1.5} sx={{ mt: 'auto', maxWidth: 420 }}>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                    <Chip
                      icon={<ShieldRounded />}
                      label="Fast onboarding"
                      color="primary"
                      variant="filled"
                      sx={{
                        bgcolor: 'rgba(255,255,255,0.12)',
                        color: '#fff',
                        '& .MuiChip-icon': { color: '#fff' },
                      }}
                    />
                    <Chip
                      label="Course-ready"
                      variant="outlined"
                      sx={{
                        borderColor: 'rgba(255,255,255,0.26)',
                        color: '#fff',
                      }}
                    />
                  </Stack>

                  <Typography variant="h3" sx={{ color: '#fff', fontWeight: 900, letterSpacing: -0.8 }}>
                    Create your account
                  </Typography>
                  <Typography sx={{ color: 'rgba(255,255,255,0.82)' }}>
                    Get access to course management, grading pipelines, and analytics.
                  </Typography>
                </Stack>
              </Box>
            </Box>

            <Box sx={{ flex: 0.9, p: { xs: 3, sm: 4 } }}>
              <Stack spacing={2.25} sx={{ maxWidth: 440 }}>
                <Box sx={{ display: { xs: 'block', md: 'none' } }}>
                  <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: -0.6 }}>
                    Create account
                  </Typography>
                  <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                    Start managing your courses.
                  </Typography>
                </Box>

                <Box sx={{ display: { xs: 'none', md: 'block' } }}>
                  <Typography variant="h5" sx={{ fontWeight: 900 }}>
                    Sign up
                  </Typography>
                  <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                    Create an account to continue.
                  </Typography>
                </Box>

                <Divider />

                <Stack component="form" spacing={2} onSubmit={onSubmit} noValidate>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField
                      label="First name"
                      value={values.first_name}
                      onChange={(event) => onChange('first_name', event.target.value)}
                      autoComplete="given-name"
                      fullWidth
                      autoFocus
                      placeholder="First name"
                      required
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <PersonRounded fontSize="small" />
                          </InputAdornment>
                        ),
                      }}
                    />
                    <TextField
                      label="Middle name"
                      value={values.middle_name}
                      onChange={(event) => onChange('middle_name', event.target.value)}
                      autoComplete="additional-name"
                      fullWidth
                      placeholder="Middle name"
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <PersonRounded fontSize="small" />
                          </InputAdornment>
                        ),
                      }}
                    />
                  </Stack>

                  <TextField
                    label="Last name"
                    value={values.last_name}
                    onChange={(event) => onChange('last_name', event.target.value)}
                    autoComplete="family-name"
                    fullWidth
                    placeholder="Last name"
                    required
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <PersonRounded fontSize="small" />
                        </InputAdornment>
                      ),
                    }}
                  />

                  <TextField
                    label="Username"
                    value={values.username}
                    onChange={(event) => onChange('username', event.target.value)}
                    autoComplete="username"
                    fullWidth
                    placeholder="Choose a username"
                    required
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <PersonRounded fontSize="small" />
                        </InputAdornment>
                      ),
                    }}
                  />

                  <TextField
                    label="Email"
                    type="email"
                    value={values.email}
                    onChange={(event) => onChange('email', event.target.value)}
                    autoComplete="email"
                    fullWidth
                    placeholder="name@university.edu"
                    required
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <EmailRounded fontSize="small" />
                        </InputAdornment>
                      ),
                    }}
                  />

                  <TextField
                    label="CWID"
                    value={values.cwid}
                    onChange={(event) => onChange('cwid', event.target.value)}
                    fullWidth
                    placeholder="Campus-wide ID"
                    required
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <BadgeRounded fontSize="small" />
                        </InputAdornment>
                      ),
                    }}
                  />

                  <TextField
                    label="Password"
                    type={showPassword ? 'text' : 'password'}
                    value={values.password}
                    onChange={(event) => onChange('password', event.target.value)}
                    autoComplete="new-password"
                    fullWidth
                    placeholder="Create a password"
                    required
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

                  <TextField
                    label="Confirm password"
                    type={showConfirm ? 'text' : 'password'}
                    value={values.confirmPassword}
                    onChange={(event) => onChange('confirmPassword', event.target.value)}
                    autoComplete="new-password"
                    fullWidth
                    placeholder="Re-enter your password"
                    required
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
                            onClick={() => setShowConfirm((v) => !v)}
                            aria-label={showConfirm ? 'Hide password' : 'Show password'}
                          >
                            {showConfirm ? <VisibilityOffRounded /> : <VisibilityRounded />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    }}
                  />

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
                    {busy ? 'Creating account…' : 'Create account'}
                  </Button>

                  <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
                    Already have an account?{' '}
                    <Link component={RouterLink} to="/login" underline="hover" sx={{ fontWeight: 700 }}>
                      Sign in
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

export default RegisterPage
