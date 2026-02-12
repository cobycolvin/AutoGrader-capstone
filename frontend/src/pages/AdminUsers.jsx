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
  FormControl,
  InputLabel,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
  FormControlLabel,
} from '@mui/material'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import { AddRounded } from '@mui/icons-material'
import { apiRequest } from '../api/client.js'
import RowActionsMenu from '../components/RowActionsMenu.jsx'

const emptyUser = {
  first_name: '',
  middle_name: '',
  last_name: '',
  username: '',
  email: '',
  cwid: '',
  password: '',
  is_active: true,
  is_staff: false,
  groups: [],
}

function AdminUsersPage() {
  const [rows, setRows] = useState([])
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [form, setForm] = useState(emptyUser)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [userData, groupData] = await Promise.all([
        apiRequest('/api/admin/users/'),
        apiRequest('/api/admin/groups/'),
      ])
      setRows(userData)
      setGroups(groupData)
    } catch (err) {
      setError(err.message || 'Unable to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyUser)
    setDialogOpen(true)
  }

  const openEdit = (user) => {
    setEditingId(user.id)
    setForm({
      first_name: user.first_name || '',
      middle_name: user.middle_name || '',
      last_name: user.last_name || '',
      username: user.username || '',
      email: user.email || '',
      cwid: user.cwid || '',
      password: '',
      is_active: Boolean(user.is_active),
      is_staff: Boolean(user.is_staff),
      groups: user.groups || [],
    })
    setDialogOpen(true)
  }

  const handleSave = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = {
        first_name: form.first_name,
        middle_name: form.middle_name,
        last_name: form.last_name,
        username: form.username,
        email: form.email,
        cwid: form.cwid,
        is_active: form.is_active,
        is_staff: form.is_staff,
        groups: form.groups,
      }
      if (form.password) {
        payload.password = form.password
      }

      if (editingId) {
        await apiRequest(`/api/admin/users/${editingId}/`, {
          method: 'PATCH',
          body: payload,
        })
      } else {
        await apiRequest('/api/admin/users/', {
          method: 'POST',
          body: payload,
        })
      }
      setDialogOpen(false)
      await loadData()
    } catch (err) {
      setError(err.message || 'Unable to save user')
    } finally {
      setSaving(false)
    }
  }

  const requestDelete = (user) => {
    setPendingDelete(user)
    setConfirmOpen(true)
  }

  const handleDelete = async () => {
    if (!pendingDelete) return
    setSaving(true)
    setError('')
    try {
      await apiRequest(`/api/admin/users/${pendingDelete.id}/`, { method: 'DELETE' })
      setConfirmOpen(false)
      setPendingDelete(null)
      await loadData()
    } catch (err) {
      setError(err.message || 'Unable to delete user')
    } finally {
      setSaving(false)
    }
  }

  const columns = useMemo(
    () => [
      { field: 'username', headerName: 'Username', flex: 1, minWidth: 140 },
      { field: 'email', headerName: 'Email', flex: 1.5, minWidth: 200 },
      { field: 'cwid', headerName: 'CWID', flex: 1, minWidth: 120 },
      {
        field: 'groups_display',
        headerName: 'Groups',
        flex: 1.5,
        minWidth: 180,
        renderCell: (params) => (
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
            {(params.value || []).map((name) => (
              <Chip key={name} label={name} size="small" variant="outlined" />
            ))}
          </Stack>
        ),
      },
      {
        field: 'is_active',
        headerName: 'Active',
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
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="flex-end">
          <Button variant="contained" startIcon={<AddRounded />} onClick={openCreate}>
            New user
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
        <DialogTitle>{editingId ? 'Edit user' : 'Create user'}</DialogTitle>
        <DialogContent>
          <Stack component="form" spacing={2} sx={{ mt: 1 }} onSubmit={handleSave}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="First name"
                value={form.first_name}
                onChange={(event) => setForm({ ...form, first_name: event.target.value })}
                fullWidth
                required
              />
              <TextField
                label="Middle name"
                value={form.middle_name}
                onChange={(event) => setForm({ ...form, middle_name: event.target.value })}
                fullWidth
              />
              <TextField
                label="Last name"
                value={form.last_name}
                onChange={(event) => setForm({ ...form, last_name: event.target.value })}
                fullWidth
                required
              />
            </Stack>
            <TextField
              label="Username"
              value={form.username}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
              fullWidth
              required
            />
            <TextField
              label="Email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              fullWidth
              required
              type="email"
            />
            <TextField
              label="CWID"
              value={form.cwid}
              onChange={(event) => setForm({ ...form, cwid: event.target.value })}
              fullWidth
              required
            />
            <TextField
              label={editingId ? 'Reset password (optional)' : 'Password'}
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              fullWidth
              required={!editingId}
              type="password"
            />

            <FormControl fullWidth>
              <InputLabel id="group-select-label">Groups</InputLabel>
              <Select
                labelId="group-select-label"
                multiple
                value={form.groups}
                onChange={(event) => setForm({ ...form, groups: event.target.value })}
                input={<OutlinedInput label="Groups" />}
                renderValue={(selected) =>
                  groups
                    .filter((group) => selected.includes(group.id))
                    .map((group) => group.name)
                    .join(', ')
                }
              >
                {groups.map((group) => (
                  <MenuItem key={group.id} value={group.id}>
                    {group.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.is_active}
                    onChange={(event) => setForm({ ...form, is_active: event.target.checked })}
                  />
                }
                label="Active"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={form.is_staff}
                    onChange={(event) => setForm({ ...form, is_staff: event.target.checked })}
                  />
                }
                label="Staff"
              />
            </Stack>
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
        <DialogTitle>Delete user</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">
            This will remove the user and their profile. This can’t be undone.
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

export default AdminUsersPage
