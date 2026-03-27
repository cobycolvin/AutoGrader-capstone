import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import { AddRounded, AutoAwesomeRounded, SendRounded } from '@mui/icons-material'
import { apiRequest } from '../api/client.js'

const emptyAssignment = { title: '', description: '', max_score: 100 }

function ScoreBar({ score, maxScore }) {
  const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0
  const color = pct >= 80 ? 'success' : pct >= 60 ? 'warning' : 'error'
  return (
    <Box sx={{ width: '100%' }}>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {score} / {maxScore} pts
        </Typography>
        <Typography variant="caption" fontWeight={700} color={`${color}.main`}>
          {pct}%
        </Typography>
      </Stack>
      <LinearProgress variant="determinate" value={pct} color={color} sx={{ borderRadius: 2, height: 8 }} />
    </Box>
  )
}

function GradeResultPanel({ result, onClose }) {
  if (!result) return null
  return (
    <Box sx={{ mt: 2, p: 2, bgcolor: 'background.paper', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutoAwesomeRounded color="primary" fontSize="small" /> AI Grading Result
        </Typography>
        <Button size="small" onClick={onClose}>Dismiss</Button>
      </Stack>

      <ScoreBar score={result.score} maxScore={result.max_score} />

      <Divider sx={{ my: 2 }} />

      <Stack spacing={1.5}>
        {result.rubric_scores.map((s, i) => (
          <Box key={i} sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1.5 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
              <Typography variant="body2" fontWeight={600}>{s.criterion}</Typography>
              <Chip
                label={`${s.points_awarded} / ${s.max_points}`}
                size="small"
                color={s.points_awarded / s.max_points >= 0.8 ? 'success' : s.points_awarded / s.max_points >= 0.5 ? 'warning' : 'error'}
                variant="outlined"
              />
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              {s.comment}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Box>
  )
}

function SubmitDialog({ assignment, open, onClose }) {
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [grading, setGrading] = useState(false)
  const [error, setError] = useState('')
  const [gradeResult, setGradeResult] = useState(null)

  const handleSubmitAndGrade = async () => {
    if (!content.trim()) return
    setSubmitting(true)
    setError('')
    setGradeResult(null)
    try {
      const submission = await apiRequest('/api/submissions/', {
        method: 'POST',
        body: { assignment: assignment.id, content },
      })
      setSubmitting(false)
      setGrading(true)
      const result = await apiRequest(`/api/submissions/${submission.id}/grade/`, { method: 'POST' })
      setGradeResult(result)
    } catch (err) {
      setError(err.message || 'Failed to submit or grade')
    } finally {
      setSubmitting(false)
      setGrading(false)
    }
  }

  const handleClose = () => {
    setContent('')
    setError('')
    setGradeResult(null)
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Submit & Grade — <span style={{ fontWeight: 400 }}>{assignment?.title}</span>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Your submission (code or essay)"
            multiline
            minRows={10}
            fullWidth
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Paste your code or essay here..."
            disabled={submitting || grading}
          />
          {grading && (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">
                Claude is grading your submission...
              </Typography>
            </Stack>
          )}
          <Collapse in={Boolean(gradeResult)}>
            <GradeResultPanel result={gradeResult} onClose={() => setGradeResult(null)} />
          </Collapse>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={handleClose}>Close</Button>
        <Button
          variant="contained"
          startIcon={grading ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeRounded />}
          onClick={handleSubmitAndGrade}
          disabled={!content.trim() || submitting || grading}
        >
          {submitting ? 'Submitting...' : grading ? 'Grading...' : 'Submit & Grade with AI'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function AssignmentsPage() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState(emptyAssignment)
  const [saving, setSaving] = useState(false)
  const [submitTarget, setSubmitTarget] = useState(null)

  const loadAssignments = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiRequest('/api/assignments/')
      setRows(Array.isArray(data) ? data : data.results || [])
    } catch (err) {
      setError(err.message || 'Unable to load assignments')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAssignments() }, [])

  const handleCreate = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await apiRequest('/api/assignments/', { method: 'POST', body: form })
      setCreateOpen(false)
      setForm(emptyAssignment)
      await loadAssignments()
    } catch (err) {
      setError(err.message || 'Unable to create assignment')
    } finally {
      setSaving(false)
    }
  }

  const columns = useMemo(() => [
    { field: 'title', headerName: 'Title', flex: 2, minWidth: 200 },
    { field: 'max_score', headerName: 'Max Score', flex: 1, minWidth: 120 },
    {
      field: 'due_at',
      headerName: 'Due',
      flex: 1,
      minWidth: 150,
      renderCell: (params) =>
        params.value ? new Date(params.value).toLocaleDateString() : '—',
    },
    {
      field: 'actions',
      headerName: 'Actions',
      minWidth: 200,
      sortable: false,
      renderCell: (params) => (
        <Button
          size="small"
          variant="contained"
          startIcon={<AutoAwesomeRounded />}
          onClick={() => setSubmitTarget(params.row)}
        >
          Submit & Grade
        </Button>
      ),
    },
  ], [])

  return (
    <Box sx={{ py: { xs: 4, md: 6 } }}>
      <Stack spacing={3}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          justifyContent="space-between"
        >
          <Box>
            <Typography variant="h3" sx={{ fontWeight: 900, letterSpacing: -0.8 }}>
              Assignments
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              Submit work and get instant AI feedback.
            </Typography>
          </Box>
          <Button variant="contained" startIcon={<AddRounded />} onClick={() => setCreateOpen(true)}>
            New Assignment
          </Button>
        </Stack>

        {error && <Alert severity="error">{error}</Alert>}

        <Box sx={{ height: 520 }}>
          <DataGrid
            rows={rows}
            columns={columns}
            loading={loading}
            disableRowSelectionOnClick
            slots={{ toolbar: GridToolbar }}
            sx={{ backgroundColor: 'background.paper', borderRadius: 3 }}
          />
        </Box>
      </Stack>

      {/* Create Assignment Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New Assignment</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Title"
              fullWidth
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <TextField
              label="Description"
              fullWidth
              multiline
              minRows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <TextField
              label="Max Score"
              type="number"
              fullWidth
              value={form.max_score}
              onChange={(e) => setForm({ ...form, max_score: e.target.value })}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={saving || !form.title.trim()}>
            {saving ? 'Saving...' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Submit & Grade Dialog */}
      {submitTarget && (
        <SubmitDialog
          assignment={submitTarget}
          open={Boolean(submitTarget)}
          onClose={() => setSubmitTarget(null)}
        />
      )}
    </Box>
  )
}

export default AssignmentsPage
