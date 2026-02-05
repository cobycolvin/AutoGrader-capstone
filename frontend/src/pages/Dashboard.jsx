import { Box, Button, Chip, Paper, Stack, Typography, Divider, LinearProgress } from '@mui/material'
import {
  SchoolRounded,
  AssignmentRounded,
  GroupsRounded,
  PlayCircleRounded,
  LogoutRounded,
} from '@mui/icons-material'

function Dashboard({ busy, onLogout }) {
  return (
    <Box sx={{ py: { xs: 4, md: 6 } }}>
      <Stack spacing={3}>
          {/* Header */}
          <Box>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              alignItems={{ xs: 'flex-start', sm: 'center' }}
              justifyContent="space-between"
            >
              <Box>
                <Typography variant="h3" sx={{ fontWeight: 900, letterSpacing: -0.8 }}>
                  Dashboard
                </Typography>
                <Typography sx={{ mt: 1 }} color="text.secondary">
                  Pick up where you left off.
                </Typography>
              </Box>

              <Button
                variant="outlined"
                onClick={onLogout}
                disabled={busy}
                startIcon={<LogoutRounded />}
              >
                Sign out
              </Button>
            </Stack>

            {busy ? (
              <Box sx={{ mt: 2 }}>
                <LinearProgress />
              </Box>
            ) : null}
          </Box>

          {/* Quick status chips (user-friendly) */}
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            <Chip icon={<SchoolRounded />} label="Courses" variant="outlined" />
            <Chip icon={<AssignmentRounded />} label="Assignments" variant="outlined" />
            <Chip icon={<GroupsRounded />} label="Groups" variant="outlined" />
            <Chip icon={<PlayCircleRounded />} label="Grading" variant="outlined" />
          </Stack>

          {/* Main cards */}
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems="stretch">
            <Paper elevation={0} sx={{ p: 3, flex: 1, minWidth: 280 }}>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                Your work
              </Typography>
              <Typography color="text.secondary" sx={{ mt: 1 }}>
                View your courses, create assignments, and keep everything organized in one place.
              </Typography>

              <Divider sx={{ my: 2 }} />

              <Stack spacing={1}>
                <Typography variant="body2" color="text.secondary">
                  • Manage course content
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  • Review submissions and feedback
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  • Track activity and progress
                </Typography>
              </Stack>
            </Paper>

            <Stack spacing={3} sx={{ flex: 1 }}>
              <Paper elevation={0} sx={{ p: 3 }}>
                <Typography variant="overline" color="secondary">
                  Quick actions
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  Get started
                </Typography>
                <Typography color="text.secondary" sx={{ mt: 1 }}>
                  Choose what you want to do next.
                </Typography>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 2 }}>
                  <Button variant="contained" disabled={busy} startIcon={<SchoolRounded />}>
                    Open courses
                  </Button>
                  <Button variant="outlined" disabled={busy} startIcon={<AssignmentRounded />}>
                    Create assignment
                  </Button>
                </Stack>
              </Paper>

              <Paper elevation={0} sx={{ p: 3 }}>
                <Typography variant="overline" color="secondary">
                  Recent activity
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  Nothing to show yet
                </Typography>
                <Typography color="text.secondary" sx={{ mt: 1 }}>
                  When you create courses, assignments, or review submissions, you’ll see updates here.
                </Typography>
              </Paper>
            </Stack>
          </Stack>
      </Stack>
    </Box>
  )
}

export default Dashboard
