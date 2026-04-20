import { useEffect, useMemo, useState } from 'react'
import {
  Autocomplete,
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  TextField,
  Paper,
  Typography,
} from '@mui/material'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import {
  AddRounded,
  EventRounded,
  GradeRounded,
  CodeRounded,
  GroupWorkRounded,
  OpenInNewRounded,
} from '@mui/icons-material'
import { Link as RouterLink, useParams } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { apiRequest } from '../api/client.js'
import AssignmentInstructionsEditor from '../components/AssignmentInstructionsEditor.jsx'
import RowActionsMenu from '../components/RowActionsMenu.jsx'
import {
  ASSIGNMENT_SUBMISSION_MODE,
  allowsWorkspaceSubmission,
  getAssignmentSubmissionModeLabel,
} from '../utils/assignmentSubmissionMode.js'

const emptyAssignment = {
  title: '',
  description: '',
  instructions: '',
  due_at: '',
  max_score: '',
  language_id: '',
  allow_groups: false,
  group_mode: 'REUSABLE_SET',
  group_source: 'SET',
  group_set_id: '',
  assignment_group_ids: [],
  submission_mode: ASSIGNMENT_SUBMISSION_MODE.UPLOAD,
  submission_file_types: '',
  submission_max_size_mb: 25,
  submission_max_attempts: 3,
}

const toLocalInputValue = (iso) => {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const tzOffset = date.getTimezoneOffset() * 60000
  const local = new Date(date.getTime() - tzOffset)
  return local.toISOString().slice(0, 16)
}

const formatDateTime = (value) => {
  if (!value) return 'No due date'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'No due date' : date.toLocaleString()
}

const buildGroupScopeOptions = (groupSets) => {
  const setOptions = groupSets.map((groupSet) => ({
    id: `set:${groupSet.id}`,
    type: 'SET',
    value: groupSet.id,
    label: groupSet.name,
    helper: 'All groups in this set',
  }))
  const groupOptions = groupSets.flatMap((groupSet) =>
    (groupSet.groups || []).map((group) => ({
      id: `group:${group.id}`,
      type: 'GROUP',
      value: group.id,
      label: group.name,
      helper: groupSet.name,
    })),
  )
  return [...setOptions, ...groupOptions]
}

function CourseAssignments({ user }) {
  const { courseId } = useParams()
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [languages, setLanguages] = useState([])
  const [groupSets, setGroupSets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [form, setForm] = useState(emptyAssignment)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('ALL')

  const canManage = Boolean(user?.is_superuser || user?.is_instructor)

  const loadAssignments = async () => {
    setLoading(true)
    setError('')
    try {
      if (canManage) {
        const data = await apiRequest(`/api/assignments/?course_id=${courseId}`)
        setRows(data)
        setSubmissions([])
      } else {
        const [assignmentData, submissionData] = await Promise.all([
          apiRequest(`/api/assignments/?course_id=${courseId}`),
          apiRequest(`/api/submissions/?course_id=${courseId}`),
        ])
        setRows(assignmentData)
        setSubmissions(submissionData)
      }
    } catch (err) {
      setError(err.message || 'Unable to load assignments')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAssignments()
  }, [courseId, canManage])

  useEffect(() => {
    const loadLanguages = async () => {
      try {
        const data = await apiRequest('/api/programming-languages/')
        setLanguages(data)
      } catch (err) {
        // Non-blocking for now.
      }
    }
    if (canManage) {
      loadLanguages()
    }
  }, [canManage])

  useEffect(() => {
    const loadGroupSets = async () => {
      try {
        const data = await apiRequest(`/api/courses/${courseId}/groups/`)
        setGroupSets(Array.isArray(data?.group_sets) ? data.group_sets : [])
      } catch (_err) {
        setGroupSets([])
      }
    }
    if (canManage) {
      loadGroupSets()
    }
  }, [canManage, courseId])

  const submissionAttempts = useMemo(() => {
    const map = new Map()
    submissions.forEach((submission) => {
      const existing = map.get(submission.assignment_id) || 0
      map.set(submission.assignment_id, Math.max(existing, submission.attempt_number || 0))
    })
    return map
  }, [submissions])

  const groupScopeOptions = useMemo(() => buildGroupScopeOptions(groupSets), [groupSets])
  const selectedGroupScopeOptions = useMemo(() => {
    if (!form.allow_groups) return []
    if (form.group_source === 'SET' && form.group_set_id) {
      return groupScopeOptions.filter((option) => option.type === 'SET' && option.value === form.group_set_id)
    }
    if (form.group_source === 'GROUPS' && Array.isArray(form.assignment_group_ids)) {
      return groupScopeOptions.filter(
        (option) => option.type === 'GROUP' && form.assignment_group_ids.includes(option.value),
      )
    }
    return []
  }, [form.allow_groups, form.group_source, form.group_set_id, form.assignment_group_ids, groupScopeOptions])

  const submittedAssignments = useMemo(() => {
    const set = new Set()
    submissions.forEach((submission) => {
      if (submission.assignment_id) {
        set.add(submission.assignment_id)
      }
    })
    return set
  }, [submissions])

  const filteredAssignments = useMemo(() => {
    if (canManage) return rows
    const now = new Date()
    return rows.filter((assignment) => {
      if (filter === 'ALL') return true
      const due = assignment.due_at ? new Date(assignment.due_at) : null
      const hasDue = due && !Number.isNaN(due.getTime())
      if (filter === 'PAST') {
        return hasDue && due < now
      }
      if (filter === 'SOON') {
        if (!hasDue) return false
        const diffDays = (due - now) / (1000 * 60 * 60 * 24)
        return diffDays >= 0 && diffDays <= 7
      }
      return true
    })
  }, [rows, filter, canManage])

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyAssignment)
    setDialogOpen(true)
  }

  const openEdit = (assignment) => {
    setEditingId(assignment.id)
    setForm({
      title: assignment.title || '',
      description: assignment.description || '',
      instructions: assignment.instructions || '',
      due_at: toLocalInputValue(assignment.due_at),
      max_score: assignment.max_score ?? '',
      language_id: assignment.language || '',
      allow_groups: Boolean(assignment.allow_groups),
      group_mode: assignment.group_mode || (assignment.allow_groups ? 'REUSABLE_SET' : 'PER_ASSIGNMENT'),
      group_source:
        assignment.allow_groups && !assignment.group_set && (assignment.assignment_groups || []).length
          ? 'GROUPS'
          : 'SET',
      group_set_id: assignment.group_set || '',
      assignment_group_ids: (assignment.assignment_groups || []).map((group) => group.id),
      submission_mode: assignment.submission_mode || ASSIGNMENT_SUBMISSION_MODE.UPLOAD,
      submission_file_types: (assignment.submission_file_types || []).join(', '),
      submission_max_size_mb: assignment.submission_max_size_mb ?? 25,
      submission_max_attempts: assignment.submission_max_attempts ?? 3,
    })
    setDialogOpen(true)
  }

  const handleSave = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const derivedGroupMode = !form.allow_groups
        ? 'PER_ASSIGNMENT'
        : form.group_source === 'GROUPS'
          ? 'PER_ASSIGNMENT'
          : 'REUSABLE_SET'
      const payload = {
        title: form.title,
        description: form.description,
        instructions: form.instructions || '',
        due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
        max_score: form.max_score === '' ? 0 : Number(form.max_score),
        language_id: form.language_id || null,
        allow_groups: form.allow_groups,
        group_mode: derivedGroupMode,
        group_set_id: form.allow_groups && form.group_source === 'SET' ? form.group_set_id || null : null,
        assignment_group_ids:
          form.allow_groups && form.group_source === 'GROUPS' ? form.assignment_group_ids || [] : [],
        submission_mode: form.submission_mode || ASSIGNMENT_SUBMISSION_MODE.UPLOAD,
        submission_file_types: form.submission_file_types
          ? form.submission_file_types
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : [],
        submission_max_size_mb: Number(form.submission_max_size_mb) || 0,
        submission_max_attempts: Number(form.submission_max_attempts) || 0,
      }

      if (editingId) {
        await apiRequest(`/api/assignments/${editingId}/`, {
          method: 'PATCH',
          body: payload,
        })
      } else {
        await apiRequest('/api/assignments/', {
          method: 'POST',
          body: { ...payload, course_id: courseId },
        })
      }

      setDialogOpen(false)
      await loadAssignments()
    } catch (err) {
      setError(err.message || 'Unable to save assignment')
    } finally {
      setSaving(false)
    }
  }

  const requestDelete = (assignment) => {
    setPendingDelete(assignment)
    setConfirmOpen(true)
  }

  const handleDelete = async () => {
    if (!pendingDelete) return
    setSaving(true)
    setError('')
    try {
      await apiRequest(`/api/assignments/${pendingDelete.id}/`, { method: 'DELETE' })
      setConfirmOpen(false)
      setPendingDelete(null)
      await loadAssignments()
    } catch (err) {
      setError(err.message || 'Unable to delete assignment')
    } finally {
      setSaving(false)
    }
  }

  const columns = useMemo(() => {
    const base = [
      { field: 'title', headerName: 'Title', flex: 2, minWidth: 220 },
      {
        field: 'due_at',
        headerName: 'Due',
        flex: 1,
        minWidth: 160,
        renderCell: (params) => {
          if (!params.value) return '—'
          const date = new Date(params.value)
          return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
        },
      },
      {
        field: 'max_score',
        headerName: 'Max score',
        flex: 0.7,
        minWidth: 120,
      },
      {
        field: 'language_name',
        headerName: 'Language',
        flex: 1,
        minWidth: 140,
        valueGetter: (params) => {
          const row = params?.row
          if (!row) return '—'
          return row.language_name || '—'
        },
      },
      {
        field: 'allow_groups',
        headerName: 'Groups',
        flex: 0.7,
        minWidth: 120,
        renderCell: (params) => (
          <Chip label={params.value ? 'Enabled' : 'Off'} size="small" variant="outlined" />
        ),
      },
    ]

    const actions = {
      field: 'actions',
      headerName: 'Actions',
      minWidth: canManage ? 90 : 140,
      sortable: false,
      renderCell: (params) => (
        canManage ? (
          <RowActionsMenu
            onEdit={() => openEdit(params.row)}
            onDelete={() => requestDelete(params.row)}
          />
        ) : null
      ),
    }

    return [...base, actions]
  }, [canManage])

  return (
    <Box sx={{ py: { xs: 2, md: 3 } }}>
      <Stack spacing={3}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems={{ xs: 'stretch', sm: 'center' }}
          justifyContent="flex-end"
        >
          {canManage ? (
            <Button
              variant="contained"
              startIcon={<AddRounded />}
              onClick={openCreate}
            >
              New assignment
            </Button>
          ) : null}
        </Stack>

        {error ? <Alert severity="error">{error}</Alert> : null}

        {canManage ? (
          <Box sx={{ height: 520 }}>
            <DataGrid
              rows={rows}
              columns={columns}
              loading={loading}
              disableRowSelectionOnClick
              onRowClick={(params) => navigate(`/course/${courseId}/assignments/${params.id}`)}
              slots={{ toolbar: GridToolbar }}
              sx={{
                backgroundColor: 'background.paper',
                borderRadius: 3,
                '& .MuiDataGrid-row': {
                  cursor: 'pointer',
                },
              }}
            />
          </Box>
        ) : (
          <Stack spacing={2}>
            {loading ? <Typography color="text.secondary">Loading assignments…</Typography> : null}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={filter}
                onChange={(_event, value) => {
                  if (value) setFilter(value)
                }}
              >
                <ToggleButton value="ALL">All</ToggleButton>
                <ToggleButton value="SOON">Due soon</ToggleButton>
                <ToggleButton value="PAST">Past due</ToggleButton>
              </ToggleButtonGroup>
              <Box sx={{ flex: 1 }} />
              <Chip label={`${filteredAssignments.length} assignments`} size="small" variant="outlined" />
            </Stack>
            {rows.length === 0 && !loading ? (
              <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  No assignments yet
                </Typography>
                <Typography color="text.secondary" sx={{ mt: 1 }}>
                  Check back later for new work and due dates.
                </Typography>
              </Paper>
            ) : (
              <Box
                sx={{
                  display: 'grid',
                  gap: 2,
                  gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
                }}
              >
                {filteredAssignments.map((assignment) => {
                  const attemptsUsed = submissionAttempts.get(assignment.id) || 0
                  const attemptsAllowed = assignment.submission_max_attempts || 0
                  const attemptsLeft = attemptsAllowed
                    ? Math.max(attemptsAllowed - attemptsUsed, 0)
                    : null
                  const submitted = submittedAssignments.has(assignment.id)
                  const dueDate = assignment.due_at ? new Date(assignment.due_at) : null
                  const isPastDue = dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate < new Date() : false
                  const statusLabel = submitted ? 'Submitted' : isPastDue ? 'Past due' : 'Missing'
                  const statusColor = submitted ? 'success' : isPastDue ? 'error' : 'warning'

                  return (
                    <Paper key={assignment.id} variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
                      <Stack spacing={1.5}>
                        <Box>
                          <Typography variant="h6" sx={{ fontWeight: 800 }}>
                            {assignment.title}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {assignment.description || 'No description provided.'}
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={1} flexWrap="wrap">
                          <Chip
                            icon={<EventRounded fontSize="small" />}
                            label={formatDateTime(assignment.due_at)}
                            size="small"
                            variant="outlined"
                          />
                          <Chip
                            icon={<GradeRounded fontSize="small" />}
                            label={`Max ${assignment.max_score}`}
                            size="small"
                            variant="outlined"
                          />
                          <Chip
                            icon={<CodeRounded fontSize="small" />}
                            label={assignment.language_name || 'Language —'}
                            size="small"
                            variant="outlined"
                          />
                          <Chip
                            label={getAssignmentSubmissionModeLabel(assignment)}
                            size="small"
                            variant="outlined"
                          />
                      <Chip
                        icon={<GroupWorkRounded fontSize="small" />}
                        label={assignment.allow_groups ? 'Group submissions' : 'Individual'}
                        size="small"
                        variant="outlined"
                      />
                      {assignment.allow_groups && assignment.group_set_name ? (
                        <Chip
                          icon={<GroupWorkRounded fontSize="small" />}
                          label={assignment.group_set_name}
                          size="small"
                          variant="outlined"
                        />
                      ) : null}
                      {assignment.allow_groups && !assignment.group_set_name && (assignment.assignment_groups || []).length ? (
                        <Chip
                          icon={<GroupWorkRounded fontSize="small" />}
                          label={`${assignment.assignment_groups.length} selected groups`}
                          size="small"
                          variant="outlined"
                        />
                      ) : null}
                      <Chip
                        label={statusLabel}
                        color={statusColor}
                            size="small"
                            variant={submitted ? 'filled' : 'outlined'}
                          />
                        </Stack>
                        <Stack spacing={0.75}>
                          <Typography variant="body2" color="text.secondary">
                            Attempts left:{' '}
                            <strong>
                              {attemptsAllowed ? attemptsLeft : 'Unlimited'}
                            </strong>
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Allowed file types:{' '}
                            <strong>
                              {assignment.submission_file_types?.length
                                ? assignment.submission_file_types.join(', ')
                                : 'Any'}
                            </strong>
                          </Typography>
                        </Stack>
                        <Stack direction="row" spacing={1}>
                          <Button
                            variant="contained"
                            component={RouterLink}
                            to={`/course/${courseId}/assignments/${assignment.id}`}
                            startIcon={<OpenInNewRounded />}
                          >
                            Open assignment
                          </Button>
                          <Button
                            variant="outlined"
                            component={RouterLink}
                            to={`/course/${courseId}/assignments/${assignment.id}?tab=submissions`}
                          >
                            Submissions
                          </Button>
                          {allowsWorkspaceSubmission(assignment) ? (
                            <Button
                              variant="outlined"
                              component={RouterLink}
                              to={`/course/${courseId}/assignments/${assignment.id}/workspace`}
                              startIcon={<CodeRounded />}
                            >
                              Workspace
                            </Button>
                          ) : null}
                        </Stack>
                      </Stack>
                    </Paper>
                  )
                })}
              </Box>
            )}
          </Stack>
        )}
      </Stack>

      {canManage ? (
        <>
          <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
            <DialogTitle>{editingId ? 'Edit assignment' : 'Create assignment'}</DialogTitle>
            <DialogContent>
              <Stack component="form" spacing={2} sx={{ mt: 1 }} onSubmit={handleSave}>
                <TextField
                  label="Title"
                  value={form.title}
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                  fullWidth
                  required
                />
                <TextField
                  label="Description"
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  fullWidth
                  multiline
                  minRows={3}
                />
                <AssignmentInstructionsEditor
                  value={form.instructions}
                  onChange={(value) => setForm((current) => ({ ...current, instructions: value }))}
                  helperText="Optional. Add detailed instructions, submission format, starter guidance, or examples for students."
                />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    label="Due date"
                    type="datetime-local"
                    value={form.due_at}
                    onChange={(event) => setForm({ ...form, due_at: event.target.value })}
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                  />
                  <TextField
                    label="Max score"
                    type="number"
                    value={form.max_score}
                    onChange={(event) => setForm({ ...form, max_score: event.target.value })}
                    fullWidth
                  />
                </Stack>
                <FormControl size="small" fullWidth>
                  <InputLabel id="language-label">Programming language</InputLabel>
                  <Select
                    labelId="language-label"
                    label="Programming language"
                    value={form.language_id}
                    onChange={(event) => setForm({ ...form, language_id: event.target.value })}
                  >
                    <MenuItem value="">None</MenuItem>
                    {languages.map((language) => (
                      <MenuItem key={language.id} value={language.id}>
                        {language.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" fullWidth>
                  <InputLabel id="submission-type-label">Submission type</InputLabel>
                  <Select
                    labelId="submission-type-label"
                    label="Submission type"
                    value={form.allow_groups ? 'GROUP' : 'INDIVIDUAL'}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        allow_groups: event.target.value === 'GROUP',
                        group_mode: event.target.value === 'GROUP' ? 'REUSABLE_SET' : 'PER_ASSIGNMENT',
                        group_set_id: event.target.value === 'GROUP' ? form.group_set_id : '',
                        assignment_group_ids: event.target.value === 'GROUP' ? form.assignment_group_ids : [],
                      })
                    }
                  >
                    <MenuItem value="INDIVIDUAL">Individual submissions</MenuItem>
                    <MenuItem value="GROUP">Group submissions</MenuItem>
                  </Select>
                </FormControl>
                {form.allow_groups ? (
                  <Stack spacing={2}>
                    <Autocomplete
                      multiple
                      size="small"
                      options={groupScopeOptions}
                      value={selectedGroupScopeOptions}
                      onChange={(_event, value) => {
                        const selected = Array.isArray(value) ? value : []
                        const latestSet = [...selected].reverse().find((option) => option.type === 'SET')
                        if (latestSet) {
                          setForm({
                            ...form,
                            group_source: 'SET',
                            group_set_id: latestSet.value,
                            assignment_group_ids: [],
                          })
                          return
                        }
                        setForm({
                          ...form,
                          group_source: 'GROUPS',
                          group_set_id: '',
                          assignment_group_ids: selected
                            .filter((option) => option.type === 'GROUP')
                            .map((option) => option.value),
                        })
                      }}
                      isOptionEqualToValue={(option, value) => option.id === value.id}
                      getOptionLabel={(option) => option.label}
                      noOptionsText="Create course groups first"
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="Allowed groups"
                          placeholder="Choose one set or specific groups"
                        />
                      )}
                      renderOption={(props, option) => (
                        <Box component="li" {...props}>
                          <Stack spacing={0.15}>
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>
                              {option.label}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {option.type === 'SET' ? option.helper : `Specific group • ${option.helper}`}
                            </Typography>
                          </Stack>
                        </Box>
                      )}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {groupSets.length
                        ? 'Choose one reusable set, or choose the specific groups allowed to submit.'
                        : 'Create course groups first in the Groups tab.'}
                    </Typography>
                  </Stack>
                ) : null}
                <Stack spacing={2}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      Submission mode
                    </Typography>
                    <ToggleButtonGroup
                      exclusive
                      fullWidth
                      size="small"
                      value={form.submission_mode}
                      onChange={(_event, value) => {
                        if (!value) return
                        setForm({ ...form, submission_mode: value })
                      }}
                    >
                      <ToggleButton value={ASSIGNMENT_SUBMISSION_MODE.UPLOAD}>Upload only</ToggleButton>
                      <ToggleButton value={ASSIGNMENT_SUBMISSION_MODE.WORKSPACE}>Workspace only</ToggleButton>
                      <ToggleButton value={ASSIGNMENT_SUBMISSION_MODE.BOTH}>Both</ToggleButton>
                    </ToggleButtonGroup>
                    <Typography variant="caption" color="text.secondary">
                      Workspace mode requires a programming language and lets students write and submit code in-browser.
                    </Typography>
                  </Stack>
                  <TextField
                    label="Accepted file types"
                    value={form.submission_file_types}
                    onChange={(event) =>
                      setForm({ ...form, submission_file_types: event.target.value })
                    }
                    placeholder="e.g. .py, .java, .zip"
                    fullWidth
                    helperText="Comma-separated list. Leave empty to allow any."
                  />
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField
                      label="Max file size (MB)"
                      type="number"
                      value={form.submission_max_size_mb}
                      onChange={(event) =>
                        setForm({ ...form, submission_max_size_mb: event.target.value })
                      }
                      fullWidth
                    />
                    <TextField
                      label="Max attempts"
                      type="number"
                      value={form.submission_max_attempts}
                      onChange={(event) =>
                        setForm({ ...form, submission_max_attempts: event.target.value })
                      }
                      fullWidth
                      helperText="Use 0 for unlimited"
                    />
                  </Stack>
                </Stack>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button variant="contained" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : editingId ? 'Save' : 'Create'}
              </Button>
            </DialogActions>
          </Dialog>

          <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth>
            <DialogTitle>Delete assignment</DialogTitle>
            <DialogContent>
              <Typography>
                Delete <strong>{pendingDelete?.title}</strong>? This can’t be undone.
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
              <Button variant="contained" color="error" onClick={handleDelete} disabled={saving}>
                {saving ? 'Deleting…' : 'Delete'}
              </Button>
            </DialogActions>
          </Dialog>
        </>
      ) : null}
    </Box>
  )
}

export default CourseAssignments
