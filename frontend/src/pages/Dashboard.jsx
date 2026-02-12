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
  FormControlLabel,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import {
  AddRounded,
  ChevronLeftRounded,
  ChevronRightRounded,
  DeleteOutlineRounded,
  EditRounded,
} from '@mui/icons-material'
import { apiRequest } from '../api/client.js'

const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const eventTypeOptions = [
  { value: 'CUSTOM', label: 'Custom' },
  { value: 'EXAM', label: 'Exam' },
  { value: 'MEETING', label: 'Meeting' },
  { value: 'REMINDER', label: 'Reminder' },
]

const emptyEventForm = {
  title: '',
  description: '',
  start_at: '',
  end_at: '',
  all_day: false,
  is_important: false,
  event_type: 'CUSTOM',
}

const toDateKey = (date) => {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

const toLocalInputValue = (iso) => {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const tzOffset = date.getTimezoneOffset() * 60000
  const local = new Date(date.getTime() - tzOffset)
  return local.toISOString().slice(0, 16)
}

const toUtcIso = (localDateTime) => {
  if (!localDateTime) return null
  const parsed = new Date(localDateTime)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

const formatDateTime = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown time'
  return date.toLocaleString()
}

const getUrgency = (value) => {
  const now = new Date()
  const due = new Date(value)
  if (Number.isNaN(due.getTime())) {
    return { label: 'Unknown', color: 'default' }
  }
  const startNow = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startDue = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  const dayDelta = Math.round((startDue - startNow) / (24 * 60 * 60 * 1000))
  if (dayDelta < 0) {
    return { label: 'Overdue', color: 'error' }
  }
  if (dayDelta === 0) {
    return { label: 'Today', color: 'warning' }
  }
  if (dayDelta === 1) {
    return { label: 'Tomorrow', color: 'warning' }
  }
  if (dayDelta <= 7) {
    return { label: 'This week', color: 'primary' }
  }
  return { label: 'Upcoming', color: 'default' }
}

const getDefaultStart = (selectedDateKey) => {
  if (selectedDateKey) {
    return `${selectedDateKey}T09:00`
  }
  const now = new Date()
  now.setMinutes(0, 0, 0)
  now.setHours(now.getHours() + 1)
  return toLocalInputValue(now.toISOString())
}

function Dashboard({ busy }) {
  const [deadlines, setDeadlines] = useState([])
  const [deadlinesLoading, setDeadlinesLoading] = useState(true)
  const [deadlinesError, setDeadlinesError] = useState('')

  const [events, setEvents] = useState([])
  const [eventsLoading, setEventsLoading] = useState(true)
  const [eventsError, setEventsError] = useState('')

  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [selectedDateKey, setSelectedDateKey] = useState('')

  const [dialogOpen, setDialogOpen] = useState(false)
  const [eventForm, setEventForm] = useState(emptyEventForm)
  const [eventFormError, setEventFormError] = useState('')
  const [eventSaving, setEventSaving] = useState(false)
  const [editingEventId, setEditingEventId] = useState('')

  const loadDeadlines = async () => {
    setDeadlinesLoading(true)
    setDeadlinesError('')
    try {
      const data = await apiRequest('/api/assignments/')
      const normalized = (Array.isArray(data) ? data : [])
        .filter((assignment) => assignment?.due_at)
        .map((assignment) => ({
          id: assignment.id,
          title: assignment.title || 'Untitled assignment',
          dueAt: assignment.due_at,
          kind: 'deadline',
        }))
        .filter((assignment) => !Number.isNaN(new Date(assignment.dueAt).getTime()))
        .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))
      setDeadlines(normalized)
    } catch (err) {
      setDeadlinesError(err.message || 'Unable to load deadlines')
    } finally {
      setDeadlinesLoading(false)
    }
  }

  const loadEvents = async (cursor = monthCursor) => {
    setEventsLoading(true)
    setEventsError('')
    try {
      const rangeStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
      rangeStart.setDate(rangeStart.getDate() - 7)
      const rangeEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 2, 0, 23, 59, 59)

      const query = `?start=${encodeURIComponent(rangeStart.toISOString())}&end=${encodeURIComponent(
        rangeEnd.toISOString(),
      )}`
      const data = await apiRequest(`/api/calendar-events/${query}`)
      const normalized = (Array.isArray(data) ? data : [])
        .map((event) => ({
          id: event.id,
          title: event.title || 'Untitled event',
          description: event.description || '',
          startAt: event.start_at,
          endAt: event.end_at,
          allDay: Boolean(event.all_day),
          isImportant: Boolean(event.is_important),
          eventType: event.event_type || 'CUSTOM',
          canEdit: Boolean(event.can_edit),
          kind: 'event',
        }))
        .filter((event) => !Number.isNaN(new Date(event.startAt).getTime()))
        .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))
      setEvents(normalized)
    } catch (err) {
      setEventsError(err.message || 'Unable to load calendar events')
    } finally {
      setEventsLoading(false)
    }
  }

  useEffect(() => {
    loadDeadlines()
  }, [])

  useEffect(() => {
    loadEvents(monthCursor)
  }, [monthCursor])

  const deadlineBuckets = useMemo(() => {
    const map = new Map()
    deadlines.forEach((deadline) => {
      const key = toDateKey(new Date(deadline.dueAt))
      const current = map.get(key) || []
      current.push(deadline)
      map.set(key, current)
    })
    return map
  }, [deadlines])

  const eventBuckets = useMemo(() => {
    const map = new Map()
    events.forEach((event) => {
      const key = toDateKey(new Date(event.startAt))
      const current = map.get(key) || []
      current.push(event)
      map.set(key, current)
    })
    return map
  }, [events])

  const monthGrid = useMemo(() => {
    const monthStart = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1)
    const gridStart = new Date(monthStart)
    gridStart.setDate(monthStart.getDate() - monthStart.getDay())
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart)
      date.setDate(gridStart.getDate() + index)
      const key = toDateKey(date)
      const deadlineCount = (deadlineBuckets.get(key) || []).length
      const dayEvents = eventBuckets.get(key) || []
      const eventCount = dayEvents.length
      const hasImportantEvent = dayEvents.some((event) => event.isImportant)
      return {
        key,
        date,
        day: date.getDate(),
        inCurrentMonth: date.getMonth() === monthCursor.getMonth(),
        deadlineCount,
        eventCount,
        totalCount: deadlineCount + eventCount,
        hasImportantEvent,
      }
    })
  }, [monthCursor, deadlineBuckets, eventBuckets])

  const timelineItems = useMemo(() => {
    if (selectedDateKey) {
      const selectedDeadlines = deadlineBuckets.get(selectedDateKey) || []
      const selectedEvents = eventBuckets.get(selectedDateKey) || []
      return [...selectedDeadlines, ...selectedEvents].sort((a, b) => {
        const left = a.kind === 'deadline' ? a.dueAt : a.startAt
        const right = b.kind === 'deadline' ? b.dueAt : b.startAt
        return new Date(left) - new Date(right)
      })
    }

    const now = new Date()
    const deadlineItems = deadlines
      .filter((deadline) => new Date(deadline.dueAt) >= now)
      .map((deadline) => ({ ...deadline, at: deadline.dueAt }))
    const eventItems = events
      .filter((event) => new Date(event.startAt) >= now)
      .map((event) => ({ ...event, at: event.startAt }))

    return [...deadlineItems, ...eventItems]
      .sort((a, b) => new Date(a.at) - new Date(b.at))
      .slice(0, 10)
  }, [deadlines, events, deadlineBuckets, eventBuckets, selectedDateKey])

  const monthLabel = monthCursor.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })

  const goToPreviousMonth = () => {
    setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
  }

  const goToNextMonth = () => {
    setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
  }

  const goToCurrentMonth = () => {
    const now = new Date()
    setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1))
    setSelectedDateKey('')
  }

  const openCreateEventDialog = () => {
    setEditingEventId('')
    setEventForm({
      ...emptyEventForm,
      start_at: getDefaultStart(selectedDateKey),
    })
    setEventFormError('')
    setDialogOpen(true)
  }

  const openEditEventDialog = (event) => {
    setEditingEventId(event.id)
    setEventForm({
      title: event.title || '',
      description: event.description || '',
      start_at: toLocalInputValue(event.startAt),
      end_at: toLocalInputValue(event.endAt),
      all_day: Boolean(event.allDay),
      is_important: Boolean(event.isImportant),
      event_type: event.eventType || 'CUSTOM',
    })
    setEventFormError('')
    setDialogOpen(true)
  }

  const closeEventDialog = () => {
    setDialogOpen(false)
    setEditingEventId('')
    setEventForm(emptyEventForm)
    setEventFormError('')
  }

  const handleSaveEvent = async () => {
    if (!eventForm.title.trim()) {
      setEventFormError('Title is required.')
      return
    }

    const startAt = toUtcIso(eventForm.start_at)
    if (!startAt) {
      setEventFormError('Start date/time is required.')
      return
    }

    const endAt = eventForm.end_at ? toUtcIso(eventForm.end_at) : null
    if (endAt && new Date(endAt) < new Date(startAt)) {
      setEventFormError('End time must be after start time.')
      return
    }

    setEventSaving(true)
    setEventFormError('')
    try {
      const payload = {
        title: eventForm.title.trim(),
        description: eventForm.description || '',
        scope: 'PERSONAL',
        event_type: eventForm.event_type,
        start_at: startAt,
        end_at: endAt,
        all_day: Boolean(eventForm.all_day),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        is_important: Boolean(eventForm.is_important),
        priority: eventForm.is_important ? 3 : 2,
      }

      if (editingEventId) {
        await apiRequest(`/api/calendar-events/${editingEventId}/`, {
          method: 'PATCH',
          body: payload,
        })
      } else {
        await apiRequest('/api/calendar-events/', {
          method: 'POST',
          body: payload,
        })
      }

      closeEventDialog()
      await loadEvents()
    } catch (err) {
      setEventFormError(err.message || 'Unable to save event')
    } finally {
      setEventSaving(false)
    }
  }

  const handleDeleteEvent = async (eventId) => {
    const confirmed = window.confirm('Delete this event?')
    if (!confirmed) return
    try {
      await apiRequest(`/api/calendar-events/${eventId}/`, { method: 'DELETE' })
      await loadEvents()
    } catch (err) {
      setEventsError(err.message || 'Unable to delete event')
    }
  }

  return (
    <Box sx={{ py: { xs: 4, md: 6 } }}>
      <Stack spacing={3}>
        {busy ? <LinearProgress /> : null}

        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={3} alignItems="stretch">
          <Paper elevation={0} sx={{ p: 3, flex: 1.4 }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.25}
              alignItems={{ xs: 'flex-start', sm: 'center' }}
              justifyContent="space-between"
            >
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                Calendar
              </Typography>
              <Stack direction="row" spacing={0.75} alignItems="center">
                <Button size="small" variant="outlined" startIcon={<AddRounded />} onClick={openCreateEventDialog}>
                  Add event
                </Button>
                <Button size="small" variant="text" onClick={goToCurrentMonth}>
                  Today
                </Button>
                <IconButton size="small" onClick={goToPreviousMonth} aria-label="Previous month">
                  <ChevronLeftRounded fontSize="small" />
                </IconButton>
                <IconButton size="small" onClick={goToNextMonth} aria-label="Next month">
                  <ChevronRightRounded fontSize="small" />
                </IconButton>
              </Stack>
            </Stack>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              {monthLabel}
            </Typography>

            {deadlinesError ? (
              <Alert severity="error" sx={{ mt: 2 }}>
                {deadlinesError}
              </Alert>
            ) : null}
            {eventsError ? (
              <Alert severity="error" sx={{ mt: 2 }}>
                {eventsError}
              </Alert>
            ) : null}

            {deadlinesLoading || eventsLoading ? (
              <Box sx={{ mt: 2 }}>
                <LinearProgress />
              </Box>
            ) : (
              <Box sx={{ mt: 2 }}>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                    gap: 1,
                    mb: 1,
                  }}
                >
                  {weekDays.map((day) => (
                    <Typography key={day} variant="caption" color="text.secondary" sx={{ px: 1 }}>
                      {day}
                    </Typography>
                  ))}
                </Box>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                    gap: 1,
                  }}
                >
                  {monthGrid.map((cell) => (
                    <Button
                      key={cell.key}
                      variant={selectedDateKey === cell.key ? 'contained' : 'text'}
                      onClick={() => setSelectedDateKey(cell.key)}
                      sx={{
                        minHeight: 72,
                        px: 1,
                        py: 1,
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        flexDirection: 'column',
                        borderRadius: 2,
                        border: selectedDateKey === cell.key ? 'none' : '1px solid',
                        borderColor: 'divider',
                        opacity: cell.inCurrentMonth ? 1 : 0.45,
                      }}
                    >
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {cell.day}
                      </Typography>
                      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minHeight: 20 }}>
                        {cell.deadlineCount > 0 ? (
                          <Chip
                            label={cell.deadlineCount === 1 ? '1 due' : `${cell.deadlineCount} due`}
                            size="small"
                            color={selectedDateKey === cell.key ? 'default' : 'primary'}
                            variant={selectedDateKey === cell.key ? 'filled' : 'outlined'}
                          />
                        ) : null}
                        {cell.eventCount > 0 ? (
                          <Chip
                            label={cell.eventCount === 1 ? '1 event' : `${cell.eventCount} events`}
                            size="small"
                            color={cell.hasImportantEvent ? 'error' : 'secondary'}
                            variant={selectedDateKey === cell.key ? 'filled' : 'outlined'}
                          />
                        ) : null}
                      </Stack>
                    </Button>
                  ))}
                </Box>
              </Box>
            )}
          </Paper>

          <Paper elevation={0} sx={{ p: 3, flex: 1 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                {selectedDateKey ? 'Selected day timeline' : 'Upcoming timeline'}
              </Typography>
              {selectedDateKey ? (
                <Button size="small" variant="text" onClick={() => setSelectedDateKey('')}>
                  Clear filter
                </Button>
              ) : null}
            </Stack>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              {selectedDateKey
                ? new Date(`${selectedDateKey}T00:00:00`).toLocaleDateString()
                : 'Assignments and personal events in chronological order.'}
            </Typography>
            <Divider sx={{ my: 2 }} />

            {deadlinesLoading || eventsLoading ? (
              <Typography color="text.secondary">Loading timeline…</Typography>
            ) : timelineItems.length === 0 ? (
              <Typography color="text.secondary">
                {selectedDateKey ? 'No items on this day.' : 'No upcoming items.'}
              </Typography>
            ) : (
              <Stack spacing={1.25}>
                {timelineItems.map((item) => {
                  const isDeadline = item.kind === 'deadline'
                  const timestamp = isDeadline ? item.dueAt : item.startAt
                  const urgency = getUrgency(timestamp)
                  return (
                    <Paper
                      key={`${item.kind}-${item.id}`}
                      variant="outlined"
                      sx={{
                        p: 1.5,
                        borderRadius: 2,
                        borderColor: 'divider',
                        boxShadow: 'none',
                      }}
                    >
                      <Stack spacing={1}>
                        <Stack direction="row" spacing={1.25} alignItems="flex-start" justifyContent="space-between">
                          <Box sx={{ flex: 1 }}>
                            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                              <Typography sx={{ fontWeight: 700 }}>{item.title}</Typography>
                              <Chip
                                label={isDeadline ? 'Assignment' : 'Event'}
                                size="small"
                                variant="outlined"
                              />
                              {!isDeadline && item.isImportant ? (
                                <Chip label="Important" size="small" color="error" />
                              ) : null}
                            </Stack>
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25, display: 'block' }}>
                              {formatDateTime(timestamp)}
                            </Typography>
                            {!isDeadline && item.description ? (
                              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                {item.description}
                              </Typography>
                            ) : null}
                          </Box>
                          <Chip
                            label={urgency.label}
                            color={urgency.color}
                            size="small"
                            variant={urgency.color === 'default' ? 'outlined' : 'filled'}
                          />
                        </Stack>
                        {!isDeadline && item.canEdit ? (
                          <Stack direction="row" spacing={1}>
                            <Button
                              size="small"
                              variant="text"
                              startIcon={<EditRounded fontSize="small" />}
                              onClick={() => openEditEventDialog(item)}
                            >
                              Edit
                            </Button>
                            <Button
                              size="small"
                              color="error"
                              variant="text"
                              startIcon={<DeleteOutlineRounded fontSize="small" />}
                              onClick={() => handleDeleteEvent(item.id)}
                            >
                              Delete
                            </Button>
                          </Stack>
                        ) : null}
                      </Stack>
                    </Paper>
                  )
                })}
              </Stack>
            )}
          </Paper>
        </Stack>
      </Stack>

      <Dialog open={dialogOpen} onClose={closeEventDialog} fullWidth maxWidth="sm">
        <DialogTitle>{editingEventId ? 'Edit event' : 'Add event'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {eventFormError ? <Alert severity="error">{eventFormError}</Alert> : null}
            <TextField
              label="Title"
              value={eventForm.title}
              onChange={(event) => setEventForm((prev) => ({ ...prev, title: event.target.value }))}
              required
              fullWidth
            />
            <TextField
              label="Description"
              value={eventForm.description}
              onChange={(event) => setEventForm((prev) => ({ ...prev, description: event.target.value }))}
              multiline
              minRows={3}
              fullWidth
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Start"
                type="datetime-local"
                value={eventForm.start_at}
                onChange={(event) => setEventForm((prev) => ({ ...prev, start_at: event.target.value }))}
                InputLabelProps={{ shrink: true }}
                fullWidth
              />
              <TextField
                label="End"
                type="datetime-local"
                value={eventForm.end_at}
                onChange={(event) => setEventForm((prev) => ({ ...prev, end_at: event.target.value }))}
                InputLabelProps={{ shrink: true }}
                fullWidth
              />
            </Stack>
            <TextField
              select
              label="Type"
              value={eventForm.event_type}
              onChange={(event) => setEventForm((prev) => ({ ...prev, event_type: event.target.value }))}
              fullWidth
            >
              {eventTypeOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <FormControlLabel
                control={
                  <Switch
                    checked={eventForm.all_day}
                    onChange={(event) =>
                      setEventForm((prev) => ({
                        ...prev,
                        all_day: event.target.checked,
                      }))
                    }
                  />
                }
                label="All day"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={eventForm.is_important}
                    onChange={(event) =>
                      setEventForm((prev) => ({
                        ...prev,
                        is_important: event.target.checked,
                      }))
                    }
                  />
                }
                label="Mark as important"
              />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEventDialog} disabled={eventSaving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSaveEvent} disabled={eventSaving}>
            {eventSaving ? 'Saving…' : editingEventId ? 'Save changes' : 'Create event'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default Dashboard
