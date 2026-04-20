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
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  AddRounded,
  DeleteRounded,
  EditRounded,
  GroupWorkRounded,
  RefreshRounded,
} from '@mui/icons-material'
import { useParams } from 'react-router-dom'
import { apiRequest } from '../api/client.js'

const emptySetForm = { name: '' }
const emptyGroupForm = { name: '', group_set_id: '' }

const personLabel = (person) =>
  person?.display_name || `${person?.first_name || ''} ${person?.last_name || ''}`.trim() || person?.username || person?.email || 'Person'

function CompactCard({ title, subtitle, action, children, selected = false, onClick }) {
  return (
    <Paper
      elevation={0}
      onClick={onClick}
      sx={{
        p: 1.5,
        borderRadius: 1,
        border: '1px solid',
        borderColor: selected ? 'primary.main' : 'divider',
        bgcolor: selected ? 'action.selected' : 'background.paper',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <Stack spacing={1}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }} noWrap>
              {title}
            </Typography>
            {subtitle ? (
              <Typography variant="body2" color="text.secondary">
                {subtitle}
              </Typography>
            ) : null}
          </Box>
          {action ? <Box onClick={(event) => event.stopPropagation()}>{action}</Box> : null}
        </Stack>
        {children}
      </Stack>
    </Paper>
  )
}

function CourseGroups({ user }) {
  const { courseId } = useParams()
  const [groupSets, setGroupSets] = useState([])
  const [people, setPeople] = useState([])
  const [selectedSetId, setSelectedSetId] = useState('')
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [setDialogOpen, setSetDialogOpen] = useState(false)
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [memberDialogOpen, setMemberDialogOpen] = useState(false)
  const [setForm, setSetForm] = useState(emptySetForm)
  const [groupForm, setGroupForm] = useState(emptyGroupForm)
  const [editingSet, setEditingSet] = useState(null)
  const [editingGroup, setEditingGroup] = useState(null)
  const [selectedStudents, setSelectedStudents] = useState([])
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [groupsPayload, peoplePayload] = await Promise.all([
        apiRequest(`/api/courses/${courseId}/groups/`),
        apiRequest(`/api/courses/${courseId}/people/`),
      ])
      const nextSets = groupsPayload?.group_sets || []
      setGroupSets(nextSets)
      setPeople(peoplePayload || [])

      const nextSetId =
        nextSets.some((item) => item.id === selectedSetId) ? selectedSetId : nextSets[0]?.id || ''
      const nextSet = nextSets.find((item) => item.id === nextSetId)
      const nextGroups = nextSet?.groups || []
      const nextGroupId =
        nextGroups.some((item) => item.id === selectedGroupId) ? selectedGroupId : nextGroups[0]?.id || ''

      setSelectedSetId(nextSetId)
      setSelectedGroupId(nextGroupId)
    } catch (err) {
      setError(err.message || 'Unable to load course groups')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [courseId])

  const canManage = Boolean(user?.is_superuser || user?.is_instructor || user?.is_ta)

  const students = useMemo(
    () =>
      people.filter((person) => person.role === 'STUDENT' && person.status === 'ACTIVE'),
    [people],
  )

  const selectedSet = useMemo(
    () => groupSets.find((item) => item.id === selectedSetId) || null,
    [groupSets, selectedSetId],
  )

  const selectedGroup = useMemo(
    () => selectedSet?.groups?.find((item) => item.id === selectedGroupId) || null,
    [selectedSet, selectedGroupId],
  )

  const availableStudents = useMemo(() => {
    if (!selectedSet) return []
    const memberIdsInSet = new Set(
      (selectedSet.groups || []).flatMap((group) => (group.members || []).map((member) => member.user_id)),
    )
    return students.filter((student) => !memberIdsInSet.has(student.user_id))
  }, [selectedSet, students])

  const openCreateSet = () => {
    setEditingSet(null)
    setSetForm(emptySetForm)
    setSetDialogOpen(true)
  }

  const openEditSet = (groupSet) => {
    setEditingSet(groupSet)
    setSetForm({ name: groupSet.name || '' })
    setSetDialogOpen(true)
  }

  const openCreateGroup = () => {
    if (!selectedSet) return
    setEditingGroup(null)
    setGroupForm({ name: '', group_set_id: selectedSet.id })
    setGroupDialogOpen(true)
  }

  const openEditGroup = (group) => {
    setEditingGroup(group)
    setGroupForm({ name: group.name || '', group_set_id: group.group_set_id || selectedSet?.id || '' })
    setGroupDialogOpen(true)
  }

  const openAddMember = () => {
    setSelectedStudents([])
    setMemberDialogOpen(true)
  }

  const handleSetSubmit = async (event) => {
    event?.preventDefault?.()
    setSaving(true)
    setError('')
    try {
      if (editingSet) {
        await apiRequest(`/api/courses/${courseId}/groups/sets/${editingSet.id}/`, {
          method: 'PATCH',
          body: setForm,
        })
        setNotice('Group set updated.')
      } else {
        await apiRequest(`/api/courses/${courseId}/groups/sets/`, {
          method: 'POST',
          body: setForm,
        })
        setNotice('Group set created.')
      }
      setSetDialogOpen(false)
      await loadData()
    } catch (err) {
      setError(err.message || 'Unable to save group set')
    } finally {
      setSaving(false)
    }
  }

  const handleGroupSubmit = async (event) => {
    event?.preventDefault?.()
    setSaving(true)
    setError('')
    try {
      if (editingGroup) {
        await apiRequest(`/api/courses/${courseId}/groups/items/${editingGroup.id}/`, {
          method: 'PATCH',
          body: groupForm,
        })
        setNotice('Group updated.')
      } else {
        await apiRequest(`/api/courses/${courseId}/groups/items/`, {
          method: 'POST',
          body: groupForm,
        })
        setNotice('Group created.')
      }
      setGroupDialogOpen(false)
      await loadData()
    } catch (err) {
      setError(err.message || 'Unable to save group')
    } finally {
      setSaving(false)
    }
  }

  const handleAddMember = async () => {
    if (!selectedGroup || !selectedStudents.length) return
    setSaving(true)
    setError('')
    try {
      await apiRequest(`/api/courses/${courseId}/groups/items/${selectedGroup.id}/members/`, {
        method: 'POST',
        body: { user_ids: selectedStudents.map((student) => student.user_id) },
      })
      setMemberDialogOpen(false)
      setNotice(
        selectedStudents.length === 1
          ? 'Group member added.'
          : `${selectedStudents.length} group members added.`,
      )
      await loadData()
    } catch (err) {
      setError(err.message || 'Unable to add group member')
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return
    setSaving(true)
    setError('')
    try {
      if (pendingDelete.type === 'set') {
        await apiRequest(`/api/courses/${courseId}/groups/sets/${pendingDelete.id}/`, {
          method: 'DELETE',
        })
        setNotice('Group set deleted.')
      } else if (pendingDelete.type === 'group') {
        await apiRequest(`/api/courses/${courseId}/groups/items/${pendingDelete.id}/`, {
          method: 'DELETE',
        })
        setNotice('Group deleted.')
      } else if (pendingDelete.type === 'member') {
        await apiRequest(
          `/api/courses/${courseId}/groups/items/${pendingDelete.groupId}/members/${pendingDelete.id}/`,
          { method: 'DELETE' },
        )
        setNotice('Group member removed.')
      }
      setPendingDelete(null)
      await loadData()
    } catch (err) {
      setError(err.message || 'Unable to remove item')
    } finally {
      setSaving(false)
    }
  }

  const handleSelectSet = (groupSetId) => {
    setSelectedSetId(groupSetId)
    const nextSet = groupSets.find((item) => item.id === groupSetId)
    setSelectedGroupId(nextSet?.groups?.[0]?.id || '')
  }

  if (!canManage) {
    return <Alert severity="info">Only instructor and TA users can manage course groups.</Alert>
  }

  return (
    <Box sx={{ py: { xs: 2, md: 3 } }}>
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between">
          <Stack spacing={0.5}>
            <Typography variant="h6" sx={{ fontWeight: 900 }}>
              Groups
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Create reusable group sets, add teams, and assign students.
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" startIcon={<RefreshRounded />} onClick={loadData}>
              Refresh
            </Button>
            <Button variant="outlined" startIcon={<AddRounded />} onClick={openCreateSet}>
              New set
            </Button>
            <Button variant="contained" startIcon={<AddRounded />} onClick={openCreateGroup} disabled={!selectedSet}>
              New group
            </Button>
          </Stack>
        </Stack>

        {error ? <Alert severity="error">{error}</Alert> : null}
        {notice ? <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert> : null}

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '280px minmax(0, 1fr) minmax(0, 1fr)' },
            gap: 2,
          }}
        >
          <Paper elevation={0} sx={{ p: 2, borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
            <Stack spacing={1.25}>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                  Group sets
                </Typography>
                <Chip size="small" label={`${groupSets.length}`} variant="outlined" />
              </Stack>
              {loading ? <Typography color="text.secondary">Loading group sets…</Typography> : null}
              {!loading && !groupSets.length ? (
                <Typography variant="body2" color="text.secondary">
                  No group sets yet.
                </Typography>
              ) : null}
              {(groupSets || []).map((groupSet) => (
                <CompactCard
                  key={groupSet.id}
                  title={groupSet.name}
                  subtitle={`${groupSet.group_count} groups • ${groupSet.member_count} members`}
                  selected={groupSet.id === selectedSetId}
                  onClick={() => handleSelectSet(groupSet.id)}
                  action={
                    <Stack direction="row" spacing={0.25}>
                      <Tooltip title="Edit set">
                        <IconButton size="small" onClick={() => openEditSet(groupSet)}>
                          <EditRounded fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete set">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => setPendingDelete({ type: 'set', id: groupSet.id, name: groupSet.name })}
                        >
                          <DeleteRounded fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  }
                />
              ))}
            </Stack>
          </Paper>

          <Paper elevation={0} sx={{ p: 2, borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
            <Stack spacing={1.25}>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                    {selectedSet ? selectedSet.name : 'Groups'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {selectedSet ? 'Teams in the selected group set.' : 'Choose a group set first.'}
                  </Typography>
                </Box>
                {selectedSet ? <Chip size="small" label={`${selectedSet.groups?.length || 0} groups`} variant="outlined" /> : null}
              </Stack>
              {!selectedSet ? (
                <Typography variant="body2" color="text.secondary">
                  Create or select a group set to start adding groups.
                </Typography>
              ) : null}
              {(selectedSet?.groups || []).map((group) => (
                <CompactCard
                  key={group.id}
                  title={group.name}
                  subtitle={`${group.member_count} members`}
                  selected={group.id === selectedGroupId}
                  onClick={() => setSelectedGroupId(group.id)}
                  action={
                    <Stack direction="row" spacing={0.25}>
                      <Tooltip title="Edit group">
                        <IconButton size="small" onClick={() => openEditGroup(group)}>
                          <EditRounded fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete group">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => setPendingDelete({ type: 'group', id: group.id, name: group.name })}
                        >
                          <DeleteRounded fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  }
                >
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                    {(group.members || []).slice(0, 4).map((member) => (
                      <Chip
                        key={member.id}
                        size="small"
                        variant="outlined"
                        icon={<GroupWorkRounded />}
                        label={personLabel(member)}
                      />
                    ))}
                    {(group.members || []).length > 4 ? (
                      <Chip size="small" variant="outlined" label={`+${group.members.length - 4} more`} />
                    ) : null}
                  </Stack>
                </CompactCard>
              ))}
              {selectedSet && !(selectedSet.groups || []).length ? (
                <Typography variant="body2" color="text.secondary">
                  No groups in this set yet.
                </Typography>
              ) : null}
            </Stack>
          </Paper>

          <Paper elevation={0} sx={{ p: 2, borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
            <Stack spacing={1.25}>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                    {selectedGroup ? selectedGroup.name : 'Members'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {selectedGroup ? 'Add or remove students in this group.' : 'Choose a group to manage members.'}
                  </Typography>
                </Box>
                <Button variant="contained" size="small" startIcon={<AddRounded />} onClick={openAddMember} disabled={!selectedGroup}>
                  Add member
                </Button>
              </Stack>
              {!selectedGroup ? (
                <Typography variant="body2" color="text.secondary">
                  The member list will appear here after you select a group.
                </Typography>
              ) : null}
              {(selectedGroup?.members || []).map((member) => (
                <CompactCard
                  key={member.id}
                  title={personLabel(member)}
                  subtitle={`${member.username} • ${member.cwid || 'No CWID'}`}
                  action={
                    <Tooltip title="Remove member">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() =>
                          setPendingDelete({
                            type: 'member',
                            id: member.id,
                            groupId: selectedGroup.id,
                            name: personLabel(member),
                          })
                        }
                      >
                        <DeleteRounded fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  }
                >
                  <Typography variant="caption" color="text.secondary">
                    {member.email}
                  </Typography>
                </CompactCard>
              ))}
              {selectedGroup && !(selectedGroup.members || []).length ? (
                <Typography variant="body2" color="text.secondary">
                  No members yet.
                </Typography>
              ) : null}
            </Stack>
          </Paper>
        </Box>
      </Stack>

      <Dialog open={setDialogOpen} onClose={() => setSetDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{editingSet ? 'Edit group set' : 'Create group set'}</DialogTitle>
        <DialogContent>
          <Stack component="form" spacing={2} sx={{ mt: 1 }} onSubmit={handleSetSubmit}>
            <TextField
              label="Group set name"
              value={setForm.name}
              onChange={(event) => setSetForm({ name: event.target.value })}
              fullWidth
              required
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSetDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSetSubmit} disabled={saving || !setForm.name.trim()}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={groupDialogOpen} onClose={() => setGroupDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{editingGroup ? 'Edit group' : 'Create group'}</DialogTitle>
        <DialogContent>
          <Stack component="form" spacing={2} sx={{ mt: 1 }} onSubmit={handleGroupSubmit}>
            <TextField
              label="Group name"
              value={groupForm.name}
              onChange={(event) => setGroupForm((prev) => ({ ...prev, name: event.target.value }))}
              fullWidth
              required
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGroupDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleGroupSubmit}
            disabled={saving || !groupForm.name.trim() || !groupForm.group_set_id}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={memberDialogOpen} onClose={() => setMemberDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add group member</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Autocomplete
              multiple
              options={availableStudents}
              value={selectedStudents}
              onChange={(_event, value) => setSelectedStudents(value)}
              getOptionLabel={(option) => `${personLabel(option)} (${option.username})`}
              renderInput={(params) => <TextField {...params} label="Student" />}
              noOptionsText="No available students left in this set"
            />
            {selectedStudents.length ? (
              <Typography variant="body2" color="text.secondary">
                {selectedStudents.length} selected
              </Typography>
            ) : null}
            {!availableStudents.length ? (
              <Alert severity="info">Every active student in this set is already assigned to a group.</Alert>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMemberDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleAddMember} disabled={saving || !selectedStudents.length}>
            Add
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(pendingDelete)} onClose={() => setPendingDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {pendingDelete?.type === 'set'
            ? 'Delete group set'
            : pendingDelete?.type === 'group'
              ? 'Delete group'
              : 'Remove group member'}
        </DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">
            {pendingDelete?.type === 'member'
              ? `Remove ${pendingDelete?.name || 'this student'} from the selected group?`
              : `This will remove ${pendingDelete?.name || 'this item'}.`}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleConfirmDelete} disabled={saving}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default CourseGroups
