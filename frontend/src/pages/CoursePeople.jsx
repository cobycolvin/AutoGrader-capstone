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
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import { AddRounded, DeleteRounded } from '@mui/icons-material'
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

  useEffect(() => {
    loadPeople()
  }, [courseId])

  const openEnroll = () => {
    setForm(emptyForm)
    setSearchQuery('')
    setSearchOptions([])
    setSearchError('')
    setSelectedUser(null)
    setDialogOpen(true)
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
      await loadPeople()
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
      await loadPeople()
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

  const columns = useMemo(
    () => [
      {
        field: 'display_name',
        headerName: 'Name',
        flex: 1.4,
        minWidth: 180,
        valueGetter: (params) => {
          const row = params?.row
          if (!row) return ''
          return row.display_name || row.username || ''
        },
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
      {
        field: 'actions',
        headerName: 'Actions',
        minWidth: 150,
        sortable: false,
        renderCell: (params) => {
          const row = params.row
          const isSelf = row.user_id === user?.id
          const canUnenroll = (canEnroll || isSelf) && row.status === 'ACTIVE'
          return (
            <Button
              size="small"
              color="error"
              variant="outlined"
              startIcon={<DeleteRounded />}
              onClick={() => requestUnenroll(row)}
              disabled={!canUnenroll}
            >
              Unenroll
            </Button>
          )
        },
      },
    ],
    [canEnroll, user],
  )

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
            <Button
              variant="contained"
              startIcon={<AddRounded />}
              onClick={openEnroll}
              disabled={!canEnroll}
            >
              Enroll people
            </Button>
          </Stack>
        </Stack>

        {!canEnroll ? (
          <Alert severity="info">Only instructors or TAs in this course can enroll people.</Alert>
        ) : null}

        {error ? <Alert severity="error">{error}</Alert> : null}

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
    </Box>
  )
}

export default CoursePeople
