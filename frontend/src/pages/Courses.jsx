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
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import { AddRounded } from '@mui/icons-material'
import { apiRequest } from '../api/client.js'
import RowActionsMenu from '../components/RowActionsMenu.jsx'

const emptyCourse = {
  code: '',
  title: '',
  term: '',
  section: '',
  is_active: true,
}

function CoursesPage() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [form, setForm] = useState(emptyCourse)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)

  const loadCourses = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiRequest('/api/courses/')
      setRows(data)
    } catch (err) {
      setError(err.message || 'Unable to load courses')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCourses()
  }, [])

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyCourse)
    setDialogOpen(true)
  }

  const openEdit = (course) => {
    setEditingId(course.id)
    setForm({
      code: course.code || '',
      title: course.title || '',
      term: course.term || '',
      section: course.section || '',
      is_active: Boolean(course.is_active),
    })
    setDialogOpen(true)
  }

  const handleSave = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (editingId) {
        await apiRequest(`/api/courses/${editingId}/`, {
          method: 'PATCH',
          body: JSON.stringify(form),
        })
      } else {
        await apiRequest('/api/courses/', {
          method: 'POST',
          body: JSON.stringify(form),
        })
      }
      setDialogOpen(false)
      await loadCourses()
    } catch (err) {
      setError(err.message || 'Unable to save course')
    } finally {
      setSaving(false)
    }
  }

  const requestDelete = (course) => {
    setPendingDelete(course)
    setConfirmOpen(true)
  }

  const handleDelete = async () => {
    if (!pendingDelete) return
    setSaving(true)
    setError('')
    try {
      await apiRequest(`/api/courses/${pendingDelete.id}/`, { method: 'DELETE' })
      setConfirmOpen(false)
      setPendingDelete(null)
      await loadCourses()
    } catch (err) {
      setError(err.message || 'Unable to delete course')
    } finally {
      setSaving(false)
    }
  }

  const columns = useMemo(
    () => [
      { field: 'code', headerName: 'Code', flex: 1, minWidth: 120 },
      { field: 'title', headerName: 'Title', flex: 2, minWidth: 200 },
      { field: 'term', headerName: 'Term', flex: 1, minWidth: 120 },
      { field: 'section', headerName: 'Section', flex: 1, minWidth: 120 },
      {
        field: 'is_active',
        headerName: 'Status',
        minWidth: 120,
        renderCell: (params) => (
          <Chip
            label={params.value ? 'Active' : 'Inactive'}
            color={params.value ? 'primary' : 'default'}
            variant={params.value ? 'filled' : 'outlined'}
            size="small"
          />
        ),
      },
      {
        field: 'actions',
        headerName: 'Actions',
        minWidth: 110,
        sortable: false,
        renderCell: (params) => (
          <RowActionsMenu
            onEdit={() => openEdit(params.row)}
            onDelete={() => requestDelete(params.row)}
          />
        ),
      },
    ],
    [],
  )

  return (
    <Box sx={{ py: { xs: 4, md: 6 } }}>
      <Stack spacing={3}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems={{ xs: 'stretch', sm: 'center' }}
          justifyContent="flex-end"
        >
          <Button variant="contained" startIcon={<AddRounded />} onClick={openCreate}>
            New course
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
            sx={{
              backgroundColor: 'background.paper',
              borderRadius: 3,
            }}
          />
        </Box>
      </Stack>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingId ? 'Edit course' : 'Create course'}</DialogTitle>
        <DialogContent>
          <Stack component="form" spacing={2} sx={{ mt: 1 }} onSubmit={handleSave}>
            <TextField
              label="Course code"
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
              fullWidth
            />
            <TextField
              label="Title"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              fullWidth
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Term"
                value={form.term}
                onChange={(event) => setForm({ ...form, term: event.target.value })}
                fullWidth
              />
              <TextField
                label="Section"
                value={form.section}
                onChange={(event) => setForm({ ...form, section: event.target.value })}
                fullWidth
              />
            </Stack>
            <FormControlLabel
              control={
                <Switch
                  checked={form.is_active}
                  onChange={(event) => setForm({ ...form, is_active: event.target.checked })}
                />
              }
              label="Active"
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete course</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">
            This will permanently remove the course and its related data.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete} disabled={saving}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default CoursesPage
