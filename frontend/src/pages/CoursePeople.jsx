import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  CircularProgress,
  FormControl,
  IconButton,
  InputLabel,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import { AddRounded, DeleteRounded, MoreVertRounded, UploadFileRounded } from '@mui/icons-material'
import { useParams } from 'react-router-dom'
import { apiRequest } from '../api/client.js'

const emptyForm = {
  role: 'STUDENT',
  status: 'ACTIVE',
}

const roleLabels = {
  STUDENT: 'Student',
  INSTRUCTOR: 'Instructor',
  TA: 'TA',
  GRADER: 'Grader',
}

const importActionMeta = {
  ADD_PENDING_ENROLLMENT: { label: 'Add pending', color: 'warning' },
  REFRESH_PENDING_ENROLLMENT: { label: 'Refresh pending', color: 'info' },
  ENROLL_EXISTING_USER: { label: 'Enroll existing', color: 'primary' },
  REACTIVATE_ENROLLMENT: { label: 'Reactivate', color: 'warning' },
  ALREADY_ENROLLED: { label: 'Already enrolled', color: 'default' },
  CONFLICT: { label: 'Conflict', color: 'error' },
  INVALID: { label: 'Invalid', color: 'error' },
}

function PeopleRowActions({ onUnenroll, disableUnenroll = false }) {
  const [anchorEl, setAnchorEl] = useState(null)
  const open = Boolean(anchorEl)

  const handleOpen = (event) => {
    setAnchorEl(event.currentTarget)
  }

  const handleClose = () => {
    setAnchorEl(null)
  }

  const handleUnenroll = () => {
    handleClose()
    onUnenroll?.()
  }

  return (
    <>
      <IconButton
        size="small"
        onClick={handleOpen}
        aria-label="Open row actions"
      >
        <MoreVertRounded fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem onClick={handleUnenroll} disabled={disableUnenroll}>
          <ListItemIcon>
            <DeleteRounded fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText>Unenroll</ListItemText>
        </MenuItem>
      </Menu>
    </>
  )
}

function CoursePeople({ user }) {
  const { courseId } = useParams()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingUnenroll, setPendingUnenroll] = useState(null)
  const [unenrolling, setUnenrolling] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOptions, setSearchOptions] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [selectedUser, setSelectedUser] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importPreview, setImportPreview] = useState(null)
  const [importPreviewLoading, setImportPreviewLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importDialogError, setImportDialogError] = useState('')
  const [notice, setNotice] = useState('')
  const [pendingRows, setPendingRows] = useState([])
  const [pendingLoading, setPendingLoading] = useState(false)

  const loadPeople = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiRequest(`/api/courses/${courseId}/people/`)
      setRows(data)
    } catch (err) {
      setError(err.message || 'Unable to load people')
    } finally {
      setLoading(false)
    }
  }

  const canEnroll = useMemo(() => {
    if (user?.is_superuser) return true
    if (user?.is_instructor) return true
    const selfRow = rows.find((row) => {
      if (user?.id) {
        return row.user_id === user.id
      }
      if (user?.email) {
        return row.email === user.email
      }
      return row.username === user?.username
    })
    if (!selfRow) return false
    return ['INSTRUCTOR', 'TA'].includes(selfRow.role) && selfRow.status === 'ACTIVE'
  }, [rows, user])

  useEffect(() => {
    loadPeople()
  }, [courseId])

  const loadPendingPeople = async () => {
    setPendingLoading(true)
    try {
      const data = await apiRequest(`/api/courses/${courseId}/people/pending/`)
      setPendingRows(data)
    } catch {
      setPendingRows([])
    } finally {
      setPendingLoading(false)
    }
  }

  const openEnroll = () => {
    setForm(emptyForm)
    setSearchQuery('')
    setSearchOptions([])
    setSearchError('')
    setSelectedUser(null)
    setDialogOpen(true)
  }

  const openImport = () => {
    setImportFile(null)
    setImportPreview(null)
    setImportDialogError('')
    setImportOpen(true)
  }

  const handleEnroll = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = {
        role: form.role,
        status: form.status,
        user_id: selectedUser?.id,
      }
      await apiRequest(`/api/courses/${courseId}/people/enroll/`, {
        method: 'POST',
        body: payload,
      })
      setDialogOpen(false)
      setNotice('Enrollment updated.')
      await loadPeople()
      if (canEnroll) {
        await loadPendingPeople()
      }
    } catch (err) {
      setError(err.message || 'Unable to enroll user')
    } finally {
      setSaving(false)
    }
  }

  const requestUnenroll = (row) => {
    setPendingUnenroll(row)
    setConfirmOpen(true)
  }

  const handleUnenroll = async () => {
    if (!pendingUnenroll) return
    setUnenrolling(true)
    setError('')
    try {
      await apiRequest(`/api/courses/${courseId}/people/unenroll/`, {
        method: 'POST',
        body: { user_id: pendingUnenroll.user_id },
      })
      setConfirmOpen(false)
      setPendingUnenroll(null)
      setNotice('Enrollment updated.')
      await loadPeople()
      if (canEnroll) {
        await loadPendingPeople()
      }
    } catch (err) {
      setError(err.message || 'Unable to unenroll user')
    } finally {
      setUnenrolling(false)
    }
  }

  useEffect(() => {
    if (!dialogOpen) return
    const query = searchQuery.trim()
    if (query.length < 2) {
      setSearchOptions([])
      setSearchError('')
      return
    }
    let active = true
    setSearchLoading(true)
    setSearchError('')
    const timeout = setTimeout(async () => {
      try {
        const data = await apiRequest(
          `/api/courses/${courseId}/people/search/?q=${encodeURIComponent(query)}`,
        )
        if (active) {
          setSearchOptions(data)
        }
      } catch (err) {
        if (active) {
          setSearchError(err.message || 'Unable to search users')
        }
      } finally {
        if (active) {
          setSearchLoading(false)
        }
      }
    }, 250)
    return () => {
      active = false
      clearTimeout(timeout)
    }
  }, [courseId, dialogOpen, searchQuery])

  useEffect(() => {
    if (!canEnroll) {
      setPendingRows([])
      return
    }
    loadPendingPeople()
  }, [canEnroll, courseId])

  const handlePreviewImport = async () => {
    if (!importFile) {
      setImportDialogError('Choose a CSV file first.')
      return
    }
    setImportPreviewLoading(true)
    setImportDialogError('')
    try {
      const formData = new FormData()
      formData.append('file', importFile)
      const data = await apiRequest(`/api/courses/${courseId}/people/import-preview/`, {
        method: 'POST',
        body: formData,
      })
      setImportPreview(data)
    } catch (err) {
      setImportPreview(null)
      setImportDialogError(err.message || 'Unable to preview roster import.')
    } finally {
      setImportPreviewLoading(false)
    }
  }

  const handleConfirmImport = async () => {
    if (!importFile) {
      setImportDialogError('Choose a CSV file first.')
      return
    }
    setImporting(true)
    setImportDialogError('')
    try {
      const formData = new FormData()
      formData.append('file', importFile)
      const data = await apiRequest(`/api/courses/${courseId}/people/import/`, {
        method: 'POST',
        body: formData,
      })
      const summary = data?.summary || {}
      const parts = [
        summary.pending_count ? `${summary.pending_count} pending` : '',
        summary.refresh_pending_count ? `${summary.refresh_pending_count} refreshed` : '',
        summary.enrolled_count ? `${summary.enrolled_count} enrolled` : '',
        summary.reactivated_count ? `${summary.reactivated_count} reactivated` : '',
        summary.already_enrolled_count ? `${summary.already_enrolled_count} already enrolled` : '',
        summary.conflict_count ? `${summary.conflict_count} conflicts` : '',
        summary.invalid_count ? `${summary.invalid_count} invalid` : '',
      ].filter(Boolean)
      setNotice(parts.length ? `Roster import finished: ${parts.join(' • ')}` : 'Roster import finished.')
      setImportOpen(false)
      setImportFile(null)
      setImportPreview(null)
      await loadPeople()
      if (canEnroll) {
        await loadPendingPeople()
      }
    } catch (err) {
      setImportDialogError(err.message || 'Unable to import roster.')
    } finally {
      setImporting(false)
    }
  }

  const columns = useMemo(() => {
    const base = [
      {
        field: 'display_name',
        headerName: 'Name',
        flex: 1.4,
        minWidth: 180,
        valueGetter: (_value, row) => row?.display_name || row?.username || '',
      },
      { field: 'username', headerName: 'Username', flex: 1, minWidth: 140 },
      { field: 'email', headerName: 'Email', flex: 1.4, minWidth: 200 },
      { field: 'cwid', headerName: 'CWID', flex: 0.8, minWidth: 110 },
      {
        field: 'role',
        headerName: 'Role',
        flex: 0.8,
        minWidth: 120,
        renderCell: (params) => (
          <Chip
            label={roleLabels[params.value] || params.value}
            color={params.value === 'INSTRUCTOR' ? 'primary' : 'default'}
            variant={params.value === 'INSTRUCTOR' ? 'filled' : 'outlined'}
            size="small"
          />
        ),
      },
      {
        field: 'status',
        headerName: 'Status',
        flex: 0.8,
        minWidth: 120,
        renderCell: (params) => (
          <Chip
            label={params.value === 'ACTIVE' ? 'Active' : 'Dropped'}
            color={params.value === 'ACTIVE' ? 'primary' : 'default'}
            variant={params.value === 'ACTIVE' ? 'filled' : 'outlined'}
            size="small"
          />
        ),
      },
    ]

    if (!canEnroll) {
      return base
    }

    return [
      ...base,
      {
        field: 'actions',
        headerName: 'Actions',
        minWidth: 90,
        align: 'center',
        headerAlign: 'center',
        sortable: false,
        renderCell: (params) => {
          const row = params.row
          const disableUnenroll = row.status !== 'ACTIVE'
          return (
            <PeopleRowActions
              onUnenroll={() => requestUnenroll(row)}
              disableUnenroll={disableUnenroll}
            />
          )
        },
      },
    ]
  }, [canEnroll])

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
            <Button variant="outlined" onClick={loadPeople}>
              Refresh
            </Button>
            {canEnroll ? (
              <>
                <Button
                  variant="contained"
                  startIcon={<UploadFileRounded />}
                  onClick={openImport}
                >
                  Import CSV
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<AddRounded />}
                  onClick={openEnroll}
                >
                  Enroll people
                </Button>
              </>
            ) : null}
          </Stack>
        </Stack>

        {error ? <Alert severity="error">{error}</Alert> : null}
        {notice ? <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert> : null}

        <Box sx={{ height: 520 }}>
          <DataGrid
            rows={rows}
            columns={columns}
            loading={loading}
            disableRowSelectionOnClick
            slots={{ toolbar: GridToolbar }}
            sx={{ backgroundColor: 'background.paper', borderRadius: 0.5 }}
          />
        </Box>

        {canEnroll ? (
          <Stack spacing={1}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="h6">Pending roster</Typography>
              <Chip
                size="small"
                variant="outlined"
                label={`${pendingRows.length} waiting`}
              />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Students imported from CSV who have not registered an account yet.
            </Typography>
            <Box sx={{ height: 260 }}>
              <DataGrid
                rows={pendingRows}
                loading={pendingLoading}
                disableRowSelectionOnClick
                hideFooterSelectedRowCount
                pageSizeOptions={[5, 10, 25]}
                columns={[
                  {
                    field: 'display_name',
                    headerName: 'Student',
                    flex: 1.2,
                    minWidth: 180,
                    valueGetter: (_value, row) => row?.display_name || row?.student_name || '',
                  },
                  { field: 'cwid', headerName: 'CWID', flex: 0.7, minWidth: 110 },
                  { field: 'sis_login_id', headerName: 'Login', flex: 0.8, minWidth: 130 },
                  { field: 'section', headerName: 'Section', flex: 1, minWidth: 180 },
                  {
                    field: 'created_at',
                    headerName: 'Imported',
                    flex: 0.9,
                    minWidth: 160,
                    valueFormatter: (value) => (
                      value ? new Date(value).toLocaleString() : '—'
                    ),
                  },
                ]}
                sx={{ backgroundColor: 'background.paper', borderRadius: 0.5 }}
              />
            </Box>
          </Stack>
        ) : null}
      </Stack>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Enroll person</DialogTitle>
        <DialogContent>
          <Stack component="form" spacing={2} sx={{ mt: 1 }} onSubmit={handleEnroll}>
            <Autocomplete
              options={searchOptions}
              value={selectedUser}
              onChange={(_event, value) => setSelectedUser(value)}
              onInputChange={(_event, value) => setSearchQuery(value)}
              loading={searchLoading}
              getOptionLabel={(option) =>
                option?.display_name
                  ? `${option.display_name} (${option.username || option.email || option.id})`
                  : `${option?.username || option?.email || option?.id || ''}`
              }
              isOptionEqualToValue={(option, value) => option.id === value.id}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Search people"
                  placeholder="Search by name, CWID, username, or email"
                  fullWidth
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {searchLoading ? <CircularProgress color="inherit" size={18} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                  helperText={searchError || 'Type at least 2 characters to search'}
                  error={Boolean(searchError)}
                />
              )}
            />

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <FormControl fullWidth>
                <InputLabel id="role-label">Role</InputLabel>
                <Select
                  labelId="role-label"
                  label="Role"
                  value={form.role}
                  onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value }))}
                >
                  <MenuItem value="STUDENT">Student</MenuItem>
                  <MenuItem value="INSTRUCTOR">Instructor</MenuItem>
                  <MenuItem value="TA">TA</MenuItem>
                  <MenuItem value="GRADER">Grader</MenuItem>
                </Select>
              </FormControl>
              <FormControl fullWidth>
                <InputLabel id="status-label">Status</InputLabel>
                <Select
                  labelId="status-label"
                  label="Status"
                  value={form.status}
                  onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
                >
                  <MenuItem value="ACTIVE">Active</MenuItem>
                  <MenuItem value="DROPPED">Dropped</MenuItem>
                </Select>
              </FormControl>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleEnroll}
            disabled={!selectedUser || saving}
          >
            {saving ? 'Enrolling…' : 'Enroll'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Unenroll person</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to unenroll{' '}
            <strong>{pendingUnenroll?.display_name || pendingUnenroll?.username || 'this user'}</strong>?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleUnenroll}
            disabled={unenrolling}
          >
            {unenrolling ? 'Unenrolling…' : 'Unenroll'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={importOpen} onClose={() => !importPreviewLoading && !importing && setImportOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>Import roster from CSV</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="info" variant="outlined">
              Upload the registrar CSV with columns like <strong>Student</strong>, <strong>SIS User ID</strong>, and <strong>SIS Login ID</strong>. Existing users will be enrolled immediately. Unknown students will be added to the pending roster and enrolled automatically when they register.
            </Alert>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', md: 'center' }}>
              <Button variant="outlined" component="label">
                Choose CSV
                <input
                  hidden
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => {
                    const nextFile = event.target.files?.[0] || null
                    setImportFile(nextFile)
                    setImportPreview(null)
                    setImportDialogError('')
                  }}
                />
              </Button>
              <Typography variant="body2" color="text.secondary">
                {importFile ? importFile.name : 'No file selected'}
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Button
                variant="contained"
                onClick={handlePreviewImport}
                disabled={!importFile || importPreviewLoading}
              >
                {importPreviewLoading ? 'Previewing…' : 'Preview import'}
              </Button>
            </Stack>

            {importDialogError ? <Alert severity="error">{importDialogError}</Alert> : null}

            {importPreview ? (
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip label={`${importPreview.summary.total_rows || 0} rows`} size="small" />
                  <Chip label={`${importPreview.summary.pending_count || 0} pending`} size="small" color="warning" variant="outlined" />
                  <Chip label={`${importPreview.summary.refresh_pending_count || 0} refresh pending`} size="small" color="info" variant="outlined" />
                  <Chip label={`${importPreview.summary.enroll_count || 0} enroll`} size="small" color="primary" variant="outlined" />
                  <Chip label={`${importPreview.summary.reactivate_count || 0} reactivate`} size="small" color="warning" variant="outlined" />
                  <Chip label={`${importPreview.summary.already_enrolled_count || 0} already enrolled`} size="small" variant="outlined" />
                  <Chip label={`${importPreview.summary.conflict_count || 0} conflicts`} size="small" color="error" variant="outlined" />
                  <Chip label={`${importPreview.summary.invalid_count || 0} invalid`} size="small" color="error" variant="outlined" />
                </Stack>

                {Array.isArray(importPreview.sections) && importPreview.sections.length ? (
                  <Typography variant="body2" color="text.secondary">
                    Sections in file: {importPreview.sections.join(', ')}
                  </Typography>
                ) : null}

                <Box sx={{ height: 360 }}>
                  <DataGrid
                    rows={(importPreview.rows || []).map((row) => ({ ...row, id: row.row_number }))}
                    columns={[
                      { field: 'row_number', headerName: 'Row', width: 70 },
                      { field: 'student_name', headerName: 'Student', flex: 1.1, minWidth: 190 },
                      { field: 'cwid', headerName: 'CWID', minWidth: 110, flex: 0.7 },
                      { field: 'username', headerName: 'Login', minWidth: 130, flex: 0.8 },
                      { field: 'section', headerName: 'Section', minWidth: 180, flex: 1 },
                      {
                        field: 'action',
                        headerName: 'Result',
                        minWidth: 170,
                        flex: 0.9,
                        renderCell: (params) => {
                          const meta = importActionMeta[params.value] || { label: params.value || '—', color: 'default' }
                          return <Chip label={meta.label} size="small" color={meta.color} variant="outlined" />
                        },
                      },
                      { field: 'note', headerName: 'Note', flex: 1.6, minWidth: 260 },
                    ]}
                    disableRowSelectionOnClick
                    hideFooterSelectedRowCount
                    pageSizeOptions={[10, 25, 50]}
                    sx={{ backgroundColor: 'background.paper', borderRadius: 2 }}
                  />
                </Box>
              </Stack>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setImportOpen(false)} disabled={importPreviewLoading || importing}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleConfirmImport}
            disabled={!importPreview || importing || importPreviewLoading || !(importPreview.summary?.actionable_count > 0)}
          >
            {importing ? 'Importing…' : 'Confirm import'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default CoursePeople
