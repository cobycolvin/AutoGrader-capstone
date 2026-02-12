import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import { AssignmentRounded, CloudUploadRounded, EventRounded } from '@mui/icons-material'
import { Link as RouterLink, useParams } from 'react-router-dom'
import { apiRequest } from '../api/client.js'

function CourseOverviewStudent() {
  const { courseId } = useParams()
  const [assignments, setAssignments] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [assignmentData, submissionData] = await Promise.all([
        apiRequest(`/api/assignments/?course_id=${courseId}`),
        apiRequest(`/api/submissions/?course_id=${courseId}`),
      ])
      setAssignments(assignmentData || [])
      setSubmissions(submissionData || [])
    } catch (err) {
      setError(err.message || 'Unable to load course overview')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [courseId])

  const submittedTitles = useMemo(
    () => new Set(submissions.map((submission) => submission.assignment_title)),
    [submissions],
  )

  const upcoming = useMemo(() => {
    const now = new Date()
    return assignments
      .filter((assignment) => assignment.due_at)
      .map((assignment) => ({ ...assignment, due_date: new Date(assignment.due_at) }))
      .filter((assignment) => !Number.isNaN(assignment.due_date.getTime()))
      .filter((assignment) => assignment.due_date >= now)
      .sort((a, b) => a.due_date - b.due_date)
      .slice(0, 4)
  }, [assignments])

  const recentSubmissions = useMemo(
    () =>
      [...submissions]
        .filter((submission) => submission.submitted_at)
        .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))
        .slice(0, 4),
    [submissions],
  )

  const stats = useMemo(() => {
    const total = assignments.length
    const submitted = submittedTitles.size
    const pending = Math.max(total - submitted, 0)
    return { total, submitted, pending }
  }, [assignments.length, submittedTitles])

  if (loading) {
    return (
      <Box sx={{ py: { xs: 2, md: 3 } }}>
        <Typography color="text.secondary">Loading overview…</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ py: { xs: 2, md: 3 } }}>
      <Stack spacing={3}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems={{ xs: 'stretch', sm: 'center' }}
          justifyContent="flex-end"
        >
          <Stack direction="row" spacing={1}>
            <Button
              component={RouterLink}
              to={`/course/${courseId}/assignments`}
              variant="outlined"
              startIcon={<AssignmentRounded />}
            >
              View assignments
            </Button>
            <Button
              component={RouterLink}
              to={`/course/${courseId}/submissions`}
              variant="contained"
              startIcon={<CloudUploadRounded />}
            >
              Upload submission
            </Button>
          </Stack>
        </Stack>

        {error ? <Alert severity="error">{error}</Alert> : null}

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, flex: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Total assignments
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 800, mt: 0.5 }}>
              {stats.total}
            </Typography>
          </Paper>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, flex: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Submitted
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 800, mt: 0.5 }}>
              {stats.submitted}
            </Typography>
          </Paper>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, flex: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Pending
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 800, mt: 0.5 }}>
              {stats.pending}
            </Typography>
          </Paper>
        </Stack>

        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2}>
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, flex: 1 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                Upcoming deadlines
              </Typography>
              <Chip label={`${upcoming.length} upcoming`} size="small" variant="outlined" />
            </Stack>
            <Stack spacing={1.5} sx={{ mt: 2 }}>
              {upcoming.length === 0 ? (
                <Typography color="text.secondary">No upcoming due dates.</Typography>
              ) : (
                upcoming.map((assignment) => {
                  const submitted = submittedTitles.has(assignment.title)
                  return (
                    <Paper
                      key={assignment.id}
                      variant="outlined"
                      sx={{
                        p: 1.5,
                        borderRadius: 2,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 2,
                      }}
                    >
                      <Stack spacing={0.5}>
                        <Typography sx={{ fontWeight: 700 }}>{assignment.title}</Typography>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <EventRounded fontSize="small" color="action" />
                          <Typography variant="body2" color="text.secondary">
                            {assignment.due_at ? new Date(assignment.due_at).toLocaleString() : 'No due date'}
                          </Typography>
                        </Stack>
                      </Stack>
                      <Chip
                        label={submitted ? 'Submitted' : 'Open'}
                        size="small"
                        color={submitted ? 'success' : 'default'}
                        variant={submitted ? 'filled' : 'outlined'}
                      />
                    </Paper>
                  )
                })
              )}
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, flex: 1 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                Recent submissions
              </Typography>
              <Chip label={`${recentSubmissions.length} recent`} size="small" variant="outlined" />
            </Stack>
            <Stack spacing={1.5} sx={{ mt: 2 }}>
              {recentSubmissions.length === 0 ? (
                <Typography color="text.secondary">No submissions yet.</Typography>
              ) : (
                recentSubmissions.map((submission) => (
                  <Paper
                    key={submission.id}
                    variant="outlined"
                    sx={{ p: 1.5, borderRadius: 2 }}
                  >
                    <Typography sx={{ fontWeight: 700 }}>{submission.assignment_title}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {submission.submitted_at
                        ? new Date(submission.submitted_at).toLocaleString()
                        : '—'}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                      <Chip label={submission.status} size="small" variant="outlined" />
                      <Chip
                        label={
                          submission.grade_score != null && submission.grade_max_score != null
                            ? `${submission.grade_score}/${submission.grade_max_score}`
                            : 'Not graded'
                        }
                        size="small"
                        variant="outlined"
                      />
                    </Stack>
                  </Paper>
                ))
              )}
            </Stack>
          </Paper>
        </Stack>
      </Stack>
    </Box>
  )
}

export default CourseOverviewStudent
