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
  IconButton,
  InputAdornment,
  InputLabel,
  Menu,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import { MoreHorizRounded, SearchRounded } from '@mui/icons-material'
import { useNavigate } from 'react-router-dom'
import { apiRequest } from '../api/client.js'

const roleLabels = {
  STUDENT: 'Student',
  INSTRUCTOR: 'Instructor',
  TA: 'TA',
  GRADER: 'Grader',
}

const roleColors = {
  INSTRUCTOR: 'primary',
  TA: 'info',
  GRADER: 'secondary',
  STUDENT: 'default',
}

function MyCoursesPage({ user }) {
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingUnenroll, setPendingUnenroll] = useState(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [menuRow, setMenuRow] = useState(null)

  const loadCourses = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiRequest('/api/my-courses/')
      setRows(data)
    } catch (err) {
      setError(err.message || 'Unable to load your courses')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCourses()
  }, [])

  const requestUnenroll = (course) => {
    setPendingUnenroll(course)
    setConfirmOpen(true)
  }

  const handleUnenroll = async () => {
    if (!pendingUnenroll || !user?.id) return
    setSaving(true)
    setError('')
    try {
      await apiRequest(`/api/courses/${pendingUnenroll.id}/people/unenroll/`, {
        method: 'POST',
        body: { user_id: user.id },
      })
      setConfirmOpen(false)
      setPendingUnenroll(null)
      await loadCourses()
    } catch (err) {
      setError(err.message || 'Unable to unenroll from course')
    } finally {
      setSaving(false)
    }
  }

  const handleRoleChange = async (course, nextRole) => {
    if (!user?.id) return
    setSaving(true)
    setError('')
    try {
      await apiRequest(`/api/courses/${course.id}/people/enroll/`, {
        method: 'POST',
        body: { user_id: user.id, role: nextRole, status: 'ACTIVE' },
      })
      await loadCourses()
    } catch (err) {
      setError(err.message || 'Unable to change role')
    } finally {
      setSaving(false)
    }
  }

  const openMenu = (event, row) => {
    setMenuAnchor(event.currentTarget)
    setMenuRow(row)
  }

  const closeMenu = () => {
    setMenuAnchor(null)
    setMenuRow(null)
  }

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (roleFilter !== 'ALL' && row.role !== roleFilter) return false
      if (statusFilter !== 'ALL' && row.status !== statusFilter) return false
      if (!query) return true
      const haystack = [row.code, row.title, row.term, row.section]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [rows, roleFilter, search, statusFilter])

  const activeCount = useMemo(
    () => filteredRows.filter((row) => row.status === 'ACTIVE').length,
    [filteredRows],
  )

  const teachingCount = useMemo(
    () => filteredRows.filter((row) => ['INSTRUCTOR', 'TA'].includes(row.role)).length,
    [filteredRows],
  )

  const EmptyState = () => (
    <Stack
      height="100%"
      alignItems="center"
      justifyContent="center"
      spacing={1}
      sx={{ color: 'text.secondary' }}
    >
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        No courses found
      </Typography>
      <Typography variant="body2">
        Try adjusting search or filters, or refresh your enrollments.
      </Typography>
    </Stack>
  )

  const columns = useMemo(
    () => [
      { field: 'code', headerName: 'Code', flex: 1, minWidth: 120 },
      { field: 'title', headerName: 'Title', flex: 2, minWidth: 200 },
      { field: 'term', headerName: 'Term', flex: 1, minWidth: 120 },
      { field: 'section', headerName: 'Section', flex: 1, minWidth: 120 },
      {
        field: 'role',
        headerName: 'Role',
        minWidth: 140,
        renderCell: (params) => (
          <Chip
            label={roleLabels[params.value] || params.value}
            size="small"
            variant={params.value === 'STUDENT' ? 'outlined' : 'filled'}
            color={roleColors[params.value] || 'default'}
          />
        ),
      },
      {
        field: 'status',
        headerName: 'Status',
        minWidth: 120,
        renderCell: (params) => (
          <Chip
            label={params.value === 'ACTIVE' ? 'Active' : 'Dropped'}
            color={params.value === 'ACTIVE' ? 'success' : 'default'}
            variant={params.value === 'ACTIVE' ? 'filled' : 'outlined'}
            size="small"
          />
        ),
      },
      {
        field: 'actions',
        headerName: 'Actions',
        minWidth: 110,
        sortable: false,
        renderCell: (params) => {
          const course = params.row
          const isActive = course.status === 'ACTIVE'
          return (
            <IconButton
              size="small"
              onClick={(event) => {
                event.stopPropagation()
                openMenu(event, course)
              }}
              disabled={saving || !isActive}
              aria-label="More actions"
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
              }}
            >
              <MoreHorizRounded />
            </IconButton>
          )
        },
      },
    ],
    [saving],
  )

  return (
    <Box sx={{ py: { xs: 4, md: 6 } }}>
      <Stack spacing={3}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          alignItems={{ xs: 'flex-start', md: 'center' }}
          justifyContent="space-between"
        >
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 700 }}>
              My Courses
            </Typography>
            <Typography color="text.secondary">
              Click any row to open a course workspace.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Chip label={`${filteredRows.length} total`} variant="outlined" />
            <Chip label={`${activeCount} active`} color="success" variant="outlined" />
            <Chip label={`${teachingCount} teaching`} color="primary" variant="outlined" />
          </Stack>
        </Stack>

        <Stack spacing={2}>
          <Paper
            elevation={0}
            sx={{
              p: { xs: 2, md: 2.5 },
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              alignItems={{ xs: 'stretch', md: 'center' }}
            >
              <TextField
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by code, title, term, or section"
                size="small"
                fullWidth
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRounded fontSize="small" />
                    </InputAdornment>
                  ),
                }}
              />
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel id="role-filter-label">Role</InputLabel>
                <Select
                  labelId="role-filter-label"
                  label="Role"
                  value={roleFilter}
                  onChange={(event) => setRoleFilter(event.target.value)}
                >
                  <MenuItem value="ALL">All roles</MenuItem>
                  <MenuItem value="INSTRUCTOR">Instructor</MenuItem>
                  <MenuItem value="STUDENT">Student</MenuItem>
                  <MenuItem value="TA">TA</MenuItem>
                  <MenuItem value="GRADER">Grader</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel id="status-filter-label">Status</InputLabel>
                <Select
                  labelId="status-filter-label"
                  label="Status"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <MenuItem value="ALL">All statuses</MenuItem>
                  <MenuItem value="ACTIVE">Active</MenuItem>
                  <MenuItem value="DROPPED">Dropped</MenuItem>
                </Select>
              </FormControl>
              <Button variant="outlined" onClick={loadCourses} sx={{ minWidth: 110 }}>
                Refresh
              </Button>
            </Stack>
          </Paper>
        </Stack>

        {error ? <Alert severity="error">{error}</Alert> : null}

        <Box sx={{ height: 520 }}>
          <DataGrid
            rows={filteredRows}
            columns={columns}
            loading={loading}
            disableRowSelectionOnClick
            slots={{
              toolbar: GridToolbar,
              noRowsOverlay: EmptyState,
              noResultsOverlay: EmptyState,
            }}
            slotProps={{
              toolbar: {
                showQuickFilter: true,
                quickFilterProps: { debounceMs: 300 },
              },
            }}
            pageSizeOptions={[10, 25, 50]}
            onRowClick={(params) => {
              if (params?.row?.id && params.row.status === 'ACTIVE') {
                navigate(`/course/${params.row.id}/overview`)
              }
            }}
            sx={{
              borderRadius: 3,
              '& .MuiDataGrid-row': {
                cursor: 'pointer',
              },
              '& .MuiDataGrid-row[data-id]': {
                '&.status-dropped': {
                  opacity: 0.65,
                },
              },
            }}
            getRowClassName={(params) => (params.row.status === 'DROPPED' ? 'status-dropped' : '')}
          />
        </Box>
      </Stack>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Leave course</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to unenroll from{' '}
            <strong>
              {pendingUnenroll?.code} {pendingUnenroll?.title ? `- ${pendingUnenroll.title}` : ''}
            </strong>
            ?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleUnenroll} disabled={saving}>
            {saving ? 'Leaving…' : 'Leave'}
          </Button>
        </DialogActions>
      </Dialog>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        {menuRow && (user?.is_instructor || user?.is_superuser) && menuRow.role === 'STUDENT' ? (
          <MenuItem
            onClick={() => {
              closeMenu()
              handleRoleChange(menuRow, 'INSTRUCTOR')
            }}
          >
            Switch to instructor
          </MenuItem>
        ) : null}
        {menuRow && (user?.is_instructor || user?.is_superuser) && menuRow.role === 'INSTRUCTOR' ? (
          <MenuItem
            onClick={() => {
              closeMenu()
              handleRoleChange(menuRow, 'STUDENT')
            }}
          >
            Switch to student
          </MenuItem>
        ) : null}
        {menuRow ? (
          <MenuItem
            onClick={() => {
              closeMenu()
              requestUnenroll(menuRow)
            }}
            sx={{ color: 'error.main' }}
          >
            Leave course
          </MenuItem>
        ) : null}
      </Menu>
    </Box>
  )
}

export default MyCoursesPage
