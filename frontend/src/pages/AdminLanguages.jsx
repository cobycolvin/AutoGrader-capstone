import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
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

const emptyForm = {
  name: '',
  slug: '',
  docker_image: '',
  compile_cmd: '',
  run_cmd_template: '',
  is_enabled: true,
}

function AdminLanguagesPage() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})

  const loadLanguages = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiRequest('/api/admin/languages/')
      setRows(data)
    } catch (err) {
      setError(err.message || 'Unable to load languages')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadLanguages()
  }, [])

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm)
    setFieldErrors({})
    setDialogOpen(true)
  }

  const openEdit = (language) => {
    setEditingId(language.id)
    setFieldErrors({})
    setForm({
      name: language.name || '',
      slug: language.slug || '',
      docker_image: language.docker_image || '',
      compile_cmd: language.compile_cmd || '',
      run_cmd_template: language.run_cmd_template || '',
      is_enabled: Boolean(language.is_enabled),
    })
    setDialogOpen(true)
  }

  const handleSave = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setFieldErrors({})
    try {
      if (editingId) {
        await apiRequest(`/api/admin/languages/${editingId}/`, {
          method: 'PATCH',
          body: form,
        })
      } else {
        await apiRequest('/api/admin/languages/', {
          method: 'POST',
          body: form,
        })
      }
      setDialogOpen(false)
      await loadLanguages()
    } catch (err) {
      if (err.payload && typeof err.payload === 'object') {
        setFieldErrors(err.payload)
        const firstError = Object.values(err.payload)[0]
        const message = Array.isArray(firstError) ? firstError[0] : err.message
        setError(message || 'Unable to save language')
      } else {
        setError(err.message || 'Unable to save language')
      }
    } finally {
      setSaving(false)
    }
  }

  const requestDelete = (language) => {
    setPendingDelete(language)
    setConfirmOpen(true)
  }

  const handleDelete = async () => {
    if (!pendingDelete) return
    setSaving(true)
    setError('')
    try {
      await apiRequest(`/api/admin/languages/${pendingDelete.id}/`, { method: 'DELETE' })
      setConfirmOpen(false)
      setPendingDelete(null)
      await loadLanguages()
    } catch (err) {
      setError(err.message || 'Unable to delete language')
    } finally {
      setSaving(false)
    }
  }

  const columns = useMemo(
    () => [
      { field: 'name', headerName: 'Name', flex: 1, minWidth: 140 },
      { field: 'slug', headerName: 'Slug', flex: 0.8, minWidth: 120 },
      { field: 'docker_image', headerName: 'Docker image', flex: 1.2, minWidth: 180 },
      {
        field: 'is_enabled',
        headerName: 'Enabled',
        flex: 0.6,
        minWidth: 100,
        valueGetter: (params) => (params.value ? 'Yes' : 'No'),
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
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="flex-end">
          <Button variant="contained" startIcon={<AddRounded />} onClick={openCreate}>
            New language
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
        <DialogTitle>{editingId ? 'Edit language' : 'Create language'}</DialogTitle>
        <DialogContent>
          <Stack component="form" spacing={2} sx={{ mt: 1 }} onSubmit={handleSave}>
            <TextField
              label="Name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              fullWidth
              required
              error={Boolean(fieldErrors.name)}
              helperText={fieldErrors.name ? fieldErrors.name.join(' ') : ''}
            />
            <TextField
              label="Slug"
              value={form.slug}
              onChange={(event) => setForm({ ...form, slug: event.target.value })}
              fullWidth
              required
              error={Boolean(fieldErrors.slug)}
              helperText={fieldErrors.slug ? fieldErrors.slug.join(' ') : ''}
            />
            <TextField
              label="Docker image"
              value={form.docker_image}
              onChange={(event) => setForm({ ...form, docker_image: event.target.value })}
              fullWidth
              helperText={
                fieldErrors.docker_image ? fieldErrors.docker_image.join(' ') : 'Optional for local runner.'
              }
              error={Boolean(fieldErrors.docker_image)}
            />
            <TextField
              label="Compile command"
              value={form.compile_cmd}
              onChange={(event) => setForm({ ...form, compile_cmd: event.target.value })}
              fullWidth
              helperText="Leave blank if no compile step."
            />
            <TextField
              label="Run command template"
              value={form.run_cmd_template}
              onChange={(event) => setForm({ ...form, run_cmd_template: event.target.value })}
              fullWidth
              multiline
              minRows={2}
              required
              helperText={
                fieldErrors.run_cmd_template
                  ? fieldErrors.run_cmd_template.join(' ')
                  : 'Use {submission_dir}, {tests_dir}, {workspace} placeholders.'
              }
              error={Boolean(fieldErrors.run_cmd_template)}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={form.is_enabled}
                  onChange={(event) => setForm({ ...form, is_enabled: event.target.checked })}
                />
              }
              label="Enabled"
            />
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
        <DialogTitle>Delete language</DialogTitle>
        <DialogContent>
          <Typography>
            Delete <strong>{pendingDelete?.name}</strong>? This can’t be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleDelete} disabled={saving}>
            {saving ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default AdminLanguagesPage
