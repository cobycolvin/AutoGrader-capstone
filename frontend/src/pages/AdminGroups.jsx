import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import { AddRounded } from '@mui/icons-material'
import { apiRequest } from '../api/client.js'
import RowActionsMenu from '../components/RowActionsMenu.jsx'

function AdminGroupsPage() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [form, setForm] = useState({ name: '' })
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)

  const loadGroups = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiRequest('/api/admin/groups/')
      setRows(data)
    } catch (err) {
      setError(err.message || 'Unable to load groups')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadGroups()
  }, [])

  const openCreate = () => {
    setEditingId(null)
    setForm({ name: '' })
    setDialogOpen(true)
  }

  const openEdit = (group) => {
    setEditingId(group.id)
    setForm({ name: group.name || '' })
    setDialogOpen(true)
  }

  const handleSave = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (editingId) {
        await apiRequest(`/api/admin/groups/${editingId}/`, {
          method: 'PATCH',
          body: { name: form.name },
        })
      } else {
        await apiRequest('/api/admin/groups/', {
          method: 'POST',
          body: { name: form.name },
        })
      }
      setDialogOpen(false)
      await loadGroups()
    } catch (err) {
      setError(err.message || 'Unable to save group')
    } finally {
      setSaving(false)
    }
  }

  const requestDelete = (group) => {
    setPendingDelete(group)
    setConfirmOpen(true)
  }

  const handleDelete = async () => {
    if (!pendingDelete) return
    setSaving(true)
    setError('')
    try {
      await apiRequest(`/api/admin/groups/${pendingDelete.id}/`, { method: 'DELETE' })
      setConfirmOpen(false)
      setPendingDelete(null)
      await loadGroups()
    } catch (err) {
      setError(err.message || 'Unable to delete group')
    } finally {
      setSaving(false)
    }
  }

  const columns = useMemo(
    () => [
      { field: 'name', headerName: 'Group name', flex: 1, minWidth: 200 },
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
            New group
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

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{editingId ? 'Edit group' : 'Create group'}</DialogTitle>
        <DialogContent>
          <Stack component="form" spacing={2} sx={{ mt: 1 }} onSubmit={handleSave}>
            <TextField
              label="Group name"
              value={form.name}
              onChange={(event) => setForm({ name: event.target.value })}
              fullWidth
              required
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
        <DialogTitle>Delete group</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">
            This will remove the group. Users will lose this role.
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

export default AdminGroupsPage
