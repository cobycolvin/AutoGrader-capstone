import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import {
  AddRounded,
  CloudUploadRounded,
  VisibilityRounded,
  DownloadRounded,
} from '@mui/icons-material'
import { useParams } from 'react-router-dom'
import { apiRequest, API_BASE } from '../api/client.js'

function CourseSubmissions({ user }) {
  const { courseId } = useParams()
  const [rows, setRows] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [assignmentId, setAssignmentId] = useState('')
  const [file, setFile] = useState(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [detailData, setDetailData] = useState(null)

  const canSubmit = Boolean(user)
  const canViewAll = Boolean(user?.is_superuser || user?.is_instructor)

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [submissionData, assignmentData] = await Promise.all([
        apiRequest(`/api/submissions/?course_id=${courseId}`),
        apiRequest(`/api/assignments/?course_id=${courseId}`),
      ])
      setRows(submissionData)
      setAssignments(assignmentData)
    } catch (err) {
      setError(err.message || 'Unable to load submissions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [courseId])

  const openUpload = () => {
    setAssignmentId('')
    setFile(null)
    setDialogOpen(true)
  }

  const openDetails = async (submissionId) => {
    setDetailOpen(true)
    setDetailLoading(true)
    setDetailError('')
    setDetailData(null)
    try {
      const data = await apiRequest(`/api/submissions/${submissionId}/details/`)
      setDetailData(data)
    } catch (err) {
      setDetailError(err.message || 'Unable to load details')
    } finally {
      setDetailLoading(false)
    }
  }

  const handleUpload = async (event) => {
    event.preventDefault()
    if (!assignmentId || !file) return
    setSaving(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('assignment_id', assignmentId)
      formData.append('file', file)
      await apiRequest('/api/submissions/', {
        method: 'POST',
        body: formData,
      })
      setDialogOpen(false)
      await loadData()
    } catch (err) {
      setError(err.message || 'Unable to upload submission')
    } finally {
      setSaving(false)
    }
  }

  const columns = useMemo(() => {
    const base = [
      { field: 'assignment_title', headerName: 'Assignment', flex: 2, minWidth: 200 },
      {
        field: 'submitted_at',
        headerName: 'Submitted',
        flex: 1.2,
        minWidth: 160,
        renderCell: (params) => {
          if (!params.value) return '—'
          const date = new Date(params.value)
          return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
        },
      },
      {
        field: 'status',
        headerName: 'Status',
        flex: 0.8,
        minWidth: 120,
        renderCell: (params) => (
          <Chip label={params.value} size="small" variant="outlined" />
        ),
      },
      {
        field: 'grade',
        headerName: 'Grade',
        flex: 0.8,
        minWidth: 120,
        valueGetter: (params) => {
          const row = params?.row
          if (!row) return '—'
          if (row.grade_score == null || row.grade_max_score == null) return '—'
          return `${row.grade_score}/${row.grade_max_score}`
        },
      },
      {
        field: 'download',
        headerName: 'File',
        minWidth: 140,
        sortable: false,
        renderCell: (params) => {
          const row = params?.row
          if (!row || !row.source_bundle_key) return '—'
          const url = `${API_BASE}/media/${row.source_bundle_key}`
          return (
            <Button size="small" component="a" href={url} target="_blank" rel="noreferrer" startIcon={<DownloadRounded />}>
              Download
            </Button>
          )
        },
      },
      {
        field: 'details',
        headerName: 'Details',
        minWidth: 140,
        sortable: false,
        renderCell: (params) => (
          <Button size="small" variant="outlined" startIcon={<VisibilityRounded />} onClick={() => openDetails(params.row.id)}>
            View
          </Button>
        ),
      },
    ]

    if (!canViewAll) {
      return base
    }

    return [
      { field: 'assignment_title', headerName: 'Assignment', flex: 2, minWidth: 200 },
      {
        field: 'submitted_by_username',
        headerName: 'Submitted by',
        flex: 1,
        minWidth: 140,
        valueGetter: (params) => params.row.submitted_by_username || '—',
      },
      ...base.slice(1),
    ]
  }, [canViewAll])

  return (
    <Box sx={{ py: { xs: 2, md: 3 } }}>
      <Stack spacing={3}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems={{ xs: 'stretch', sm: 'center' }}
          justifyContent="flex-end"
        >
          <Button
            variant="contained"
            startIcon={<AddRounded />}
            onClick={openUpload}
            disabled={!canSubmit}
          >
            Upload submission
          </Button>
        </Stack>

        {error ? <Alert severity="error">{error}</Alert> : null}

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

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Upload submission</DialogTitle>
        <DialogContent>
          <Stack component="form" spacing={2} sx={{ mt: 1 }} onSubmit={handleUpload}>
            <FormControl fullWidth size="small">
              <InputLabel id="assignment-select-label">Assignment</InputLabel>
              <Select
                labelId="assignment-select-label"
                label="Assignment"
                value={assignmentId}
                onChange={(event) => setAssignmentId(event.target.value)}
              >
                {assignments.map((assignment) => (
                  <MenuItem key={assignment.id} value={assignment.id}>
                    {assignment.title}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Button
              variant="outlined"
              component="label"
              startIcon={<CloudUploadRounded />}
            >
              {file ? file.name : 'Choose file'}
              <input
                type="file"
                hidden
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleUpload}
            disabled={!assignmentId || !file || saving}
          >
            {saving ? 'Uploading…' : 'Upload'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={detailOpen} onClose={() => setDetailOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Submission details</DialogTitle>
        <DialogContent>
          {detailLoading ? (
            <Typography color="text.secondary">Loading details…</Typography>
          ) : detailError ? (
            <Alert severity="error">{detailError}</Alert>
          ) : detailData ? (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <Stack spacing={0.5} sx={{ flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Assignment
                  </Typography>
                  <Typography sx={{ fontWeight: 700 }}>
                    {detailData.submission?.assignment_title || '—'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Submitted {detailData.submission?.submitted_at ? new Date(detailData.submission.submitted_at).toLocaleString() : '—'}
                  </Typography>
                </Stack>
                <Stack spacing={0.5}>
                  <Typography variant="caption" color="text.secondary">
                    Status
                  </Typography>
                  <Chip
                    label={detailData.submission?.status || '—'}
                    size="small"
                    variant="outlined"
                  />
                </Stack>
                <Stack spacing={0.5}>
                  <Typography variant="caption" color="text.secondary">
                    Grade
                  </Typography>
                  <Typography sx={{ fontWeight: 700 }}>
                    {detailData.grade
                      ? `${detailData.grade.score}/${detailData.grade.max_score}`
                      : '—'}
                  </Typography>
                </Stack>
              </Stack>

              <Divider />

              <Stack spacing={1}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                  Test results
                </Typography>
                {detailData.test_results?.length ? (
                  <Stack spacing={1}>
                    {detailData.test_results.map((result) => (
                      <Stack
                        key={result.id}
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        justifyContent="space-between"
                      >
                        <Typography sx={{ fontWeight: 600 }}>{result.test_name}</Typography>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Chip label={result.status} size="small" variant="outlined" />
                          <Typography variant="body2" color="text.secondary">
                            {result.points_awarded} pts
                          </Typography>
                        </Stack>
                      </Stack>
                    ))}
                  </Stack>
                ) : (
                  <Typography color="text.secondary">No test results available.</Typography>
                )}
              </Stack>

              <Divider />

              <Stack spacing={1}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                  Logs
                </Typography>
                <Stack direction="row" spacing={1}>
                  {detailData.grading_run?.stdout_key ? (
                    <Button
                      size="small"
                      component="a"
                      href={`${API_BASE}/media/${detailData.grading_run.stdout_key}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Stdout
                    </Button>
                  ) : (
                    <Chip label="No stdout" size="small" variant="outlined" />
                  )}
                  {detailData.grading_run?.stderr_key ? (
                    <Button
                      size="small"
                      component="a"
                      href={`${API_BASE}/media/${detailData.grading_run.stderr_key}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Stderr
                    </Button>
                  ) : (
                    <Chip label="No stderr" size="small" variant="outlined" />
                  )}
                </Stack>
              </Stack>
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default CourseSubmissions
