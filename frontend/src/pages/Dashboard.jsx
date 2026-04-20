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
import { useNavigate } from 'react-router-dom'
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

function Dashboard({ busy, user }) {
  const navigate = useNavigate()
  const [courses, setCourses] = useState([])
  const [coursesLoading, setCoursesLoading] = useState(true)
  const [coursesError, setCoursesError] = useState('')
  const [deadlines, setDeadlines] = useState([])
  const [deadlinesLoading, setDeadlinesLoading] = useState(true)
  const [deadlinesError, setDeadlinesError] = useState('')
  const [studentSubmissions, setStudentSubmissions] = useState([])
  const [studentSubmissionsLoading, setStudentSubmissionsLoading] = useState(false)
  const [studentSubmissionsError, setStudentSubmissionsError] = useState('')

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

  const isStaffDashboard = Boolean(user?.is_superuser || user?.is_instructor || user?.is_ta)

  const loadCourses = async () => {
    setCoursesLoading(true)
    setCoursesError('')
    try {
      const data = await apiRequest('/api/my-courses/')
      setCourses(Array.isArray(data) ? data : [])
    } catch (err) {
      setCoursesError(err.message || 'Unable to load courses')
    } finally {
      setCoursesLoading(false)
    }
  }

  const loadDeadlines = async () => {
    setDeadlinesLoading(true)
    setDeadlinesError('')
    try {
      const data = await apiRequest('/api/assignments/')
      const normalized = (Array.isArray(data) ? data : [])
        .filter((assignment) => assignment?.due_at)
        .map((assignment) => ({
          id: assignment.id,
          courseId: assignment.course || null,
          courseCode: assignment.course_code || '',
          courseTitle: assignment.course_title || '',
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

  const loadStudentSubmissions = async () => {
    setStudentSubmissionsLoading(true)
    setStudentSubmissionsError('')
    try {
      const data = await apiRequest('/api/submissions/')
      setStudentSubmissions(Array.isArray(data) ? data : [])
    } catch (err) {
      setStudentSubmissionsError(err.message || 'Unable to load submissions')
    } finally {
      setStudentSubmissionsLoading(false)
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
    loadCourses()
  }, [])

  useEffect(() => {
    loadDeadlines()
  }, [])

  useEffect(() => {
    if (!isStaffDashboard) {
      loadStudentSubmissions()
    }
  }, [isStaffDashboard])

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

  const teachingCourses = useMemo(() => {
    const allowedRoles = new Set(['INSTRUCTOR', 'TA'])
    return courses
      .filter((course) => course?.status === 'ACTIVE')
      .filter((course) => user?.is_superuser || allowedRoles.has(course?.role))
      .sort((a, b) => {
        const left = `${a?.term || ''} ${a?.code || ''} ${a?.title || ''}`.trim()
        const right = `${b?.term || ''} ${b?.code || ''} ${b?.title || ''}`.trim()
        return left.localeCompare(right)
      })
  }, [courses, user?.is_superuser])

  const studentCourses = useMemo(() => {
    const staffRoles = new Set(['INSTRUCTOR', 'TA'])
    return courses
      .filter((course) => course?.status === 'ACTIVE')
      .filter((course) => !staffRoles.has(course?.role))
      .sort((a, b) => {
        const left = `${a?.term || ''} ${a?.code || ''} ${a?.title || ''}`.trim()
        const right = `${b?.term || ''} ${b?.code || ''} ${b?.title || ''}`.trim()
        return left.localeCompare(right)
      })
  }, [courses])

  const upcomingDeadlines = useMemo(() => {
    const now = new Date()
    return deadlines.filter((deadline) => new Date(deadline.dueAt) >= now).slice(0, 8)
  }, [deadlines])

  const submittedAssignmentIds = useMemo(() => {
    const set = new Set()
    studentSubmissions.forEach((submission) => {
      if (submission?.assignment_id || submission?.assignment_uuid) {
        set.add(String(submission.assignment_id || submission.assignment_uuid))
      }
    })
    return set
  }, [studentSubmissions])

  const nextDueAssignment = useMemo(() => {
    if (!upcomingDeadlines.length) return null
    const notSubmitted = upcomingDeadlines.find(
      (deadline) => !submittedAssignmentIds.has(String(deadline.id)),
    )
    return notSubmitted || upcomingDeadlines[0]
  }, [submittedAssignmentIds, upcomingDeadlines])

  const upcomingEvents = useMemo(() => {
    const now = new Date()
    return events.filter((event) => new Date(event.startAt) >= now).slice(0, 6)
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
  const todayKey = toDateKey(new Date())
  const nextDueSubmitted = nextDueAssignment
    ? submittedAssignmentIds.has(String(nextDueAssignment.id))
    : false
  const nextDueIsPast = nextDueAssignment
    ? new Date(nextDueAssignment.dueAt) < new Date()
    : false
  const nextDueActionLabel = nextDueSubmitted
    ? 'View submission'
    : nextDueIsPast
      ? 'Open assignment'
      : 'Submit now'
  const nextDueActionPath = nextDueAssignment
    ? `/course/${nextDueAssignment.courseId}/assignments/${nextDueAssignment.id}${
        nextDueSubmitted ? '?tab=submissions' : ''
      }`
    : ''

  const monthSummary = useMemo(() => {
    return monthGrid.reduce(
      (acc, cell) => {
        if (!cell.inCurrentMonth) return acc
        acc.deadlineCount += cell.deadlineCount
        acc.eventCount += cell.eventCount
        return acc
      },
      { deadlineCount: 0, eventCount: 0 },
    )
  }, [monthGrid])

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

  if (isStaffDashboard) {
    return (
      <Box sx={{ py: { xs: 1, md: 2 } }}>
        <Stack spacing={3}>
          {busy ? <LinearProgress /> : null}

          <Stack direction={{ xs: 'column', xl: 'row' }} spacing={3} alignItems="stretch">
            <Paper
              elevation={0}
              sx={{
                p: { xs: 2, md: 2.5 },
                flex: 1.6,
                borderRadius: 3,
                border: '1px solid',
                borderColor: 'divider',
                minWidth: 0,
              }}
            >
              <Stack spacing={2}>
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={1}
                  justifyContent="space-between"
                  alignItems={{ xs: 'flex-start', md: 'center' }}
                >
                  <Stack spacing={0.35}>
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>
                      Courses
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Open a course workspace directly from here.
                    </Typography>
                  </Stack>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                    <Chip
                      size="small"
                      variant="outlined"
                      color="primary"
                      label={`${teachingCourses.length} active course${teachingCourses.length === 1 ? '' : 's'}`}
                    />
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`${upcomingDeadlines.length} upcoming deadline${upcomingDeadlines.length === 1 ? '' : 's'}`}
                    />
                  </Stack>
                </Stack>

                {coursesError ? <Alert severity="error">{coursesError}</Alert> : null}

                {coursesLoading ? (
                  <Stack spacing={1.2}>
                    <LinearProgress />
                    <Typography color="text.secondary">Loading courses…</Typography>
                  </Stack>
                ) : teachingCourses.length === 0 ? (
                  <Alert severity="info" variant="outlined">
                    No active instructor or TA courses are available yet.
                  </Alert>
                ) : (
                  <Box
                    sx={{
                      display: 'grid',
                      gap: 1.25,
                      gridTemplateColumns: {
                        xs: '1fr',
                        lg: 'repeat(2, minmax(0, 1fr))',
                      },
                    }}
                  >
                    {teachingCourses.map((course) => (
                      <Paper
                        key={course.id}
                        variant="outlined"
                        onClick={() => navigate(`/course/${course.id}`)}
                        sx={{
                          p: 1.5,
                          borderRadius: 2,
                          borderColor: 'divider',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 1.1,
                          minWidth: 0,
                          cursor: 'pointer',
                          transition: 'border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease',
                          '&:hover': {
                            borderColor: 'primary.main',
                            boxShadow: '0 12px 28px rgba(79,70,229,0.12)',
                            transform: 'translateY(-1px)',
                          },
                        }}
                      >
                        <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="flex-start">
                          <Stack spacing={0.35} sx={{ minWidth: 0 }}>
                            <Typography variant="overline" color="primary.main" sx={{ lineHeight: 1.1, fontWeight: 800 }}>
                              {course.code || 'Course'}
                            </Typography>
                            <Typography variant="h6" sx={{ fontWeight: 800 }} noWrap>
                              {course.title || 'Untitled course'}
                            </Typography>
                          </Stack>
                          <Chip
                            size="small"
                            color={course.role === 'INSTRUCTOR' ? 'primary' : 'info'}
                            label={course.role === 'INSTRUCTOR' ? 'Professor' : 'TA'}
                            variant="outlined"
                          />
                        </Stack>

                        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                          {course.term ? <Chip size="small" variant="outlined" label={course.term} /> : null}
                          {course.section ? <Chip size="small" variant="outlined" label={`Section ${course.section}`} /> : null}
                          <Chip
                            size="small"
                            color={course.status === 'ACTIVE' ? 'success' : 'default'}
                            variant={course.status === 'ACTIVE' ? 'filled' : 'outlined'}
                            label={course.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                          />
                        </Stack>

                        <Typography variant="body2" color="text.secondary">
                          Manage assignments, tests, grading, and people from the course workspace.
                        </Typography>
                      </Paper>
                    ))}
                  </Box>
                )}
              </Stack>
            </Paper>

            <Stack spacing={2} sx={{ flex: 1, minWidth: { xl: 360 } }}>
              <Paper
                elevation={0}
                sx={{
                  p: { xs: 2, md: 2.25 },
                  borderRadius: 3,
                  border: '1px solid',
                  borderColor: 'divider',
                  backgroundColor: 'rgba(15, 23, 42, 0.02)',
                }}
              >
                <Stack spacing={1.5}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>
                      Deadlines
                    </Typography>
                    <Chip size="small" variant="outlined" label={`${upcomingDeadlines.length} upcoming`} />
                  </Stack>

                  {deadlinesError ? <Alert severity="error">{deadlinesError}</Alert> : null}

                  {deadlinesLoading ? (
                    <LinearProgress />
                  ) : upcomingDeadlines.length === 0 ? (
                    <Stack spacing={1}>
                      <Typography color="text.secondary">No upcoming assignment deadlines.</Typography>
                      {teachingCourses[0]?.id ? (
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => navigate(`/course/${teachingCourses[0].id}/assignments`)}
                        >
                          View assignments
                        </Button>
                      ) : null}
                    </Stack>
                  ) : (
                    <Stack spacing={1}>
                      {upcomingDeadlines.map((deadline) => {
                        const urgency = getUrgency(deadline.dueAt)
                        return (
                          <Paper
                            key={deadline.id}
                            variant="outlined"
                            sx={{
                              p: 1.2,
                              borderRadius: 2,
                              borderColor: 'divider',
                              borderLeft: '4px solid',
                              borderLeftColor: urgency.color === 'error' ? 'error.main' : urgency.color === 'warning' ? 'warning.main' : 'primary.main',
                            }}
                          >
                            <Stack spacing={0.4}>
                              <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
                                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                  {deadline.title}
                                </Typography>
                                <Chip size="small" label={urgency.label} color={urgency.color} variant={urgency.color === 'default' ? 'outlined' : 'filled'} />
                              </Stack>
                              <Typography variant="caption" color="text.secondary">
                                Due {formatDateTime(deadline.dueAt)}
                              </Typography>
                            </Stack>
                          </Paper>
                        )
                      })}
                    </Stack>
                  )}
                </Stack>
              </Paper>

              <Paper
                elevation={0}
                sx={{
                  p: { xs: 2, md: 2.25 },
                  borderRadius: 3,
                  border: '1px solid',
                  borderColor: 'divider',
                  backgroundColor: 'rgba(15, 23, 42, 0.02)',
                }}
              >
                <Stack spacing={1.5}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Stack spacing={0.3}>
                      <Typography variant="h6" sx={{ fontWeight: 800 }}>
                        Schedule
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Personal calendar items and reminders.
                      </Typography>
                    </Stack>
                    <Button size="small" variant="outlined" startIcon={<AddRounded />} onClick={openCreateEventDialog}>
                      Add event
                    </Button>
                  </Stack>

                  {eventsError ? <Alert severity="error">{eventsError}</Alert> : null}

                  {eventsLoading ? (
                    <LinearProgress />
                  ) : upcomingEvents.length === 0 ? (
                    <Typography color="text.secondary">No upcoming events.</Typography>
                  ) : (
                    <Stack spacing={1}>
                      {upcomingEvents.map((event) => (
                        <Paper
                          key={event.id}
                          variant="outlined"
                          sx={{
                            p: 1.2,
                            borderRadius: 2,
                            borderColor: 'divider',
                          }}
                        >
                          <Stack spacing={0.45}>
                            <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
                              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                {event.title}
                              </Typography>
                              <Stack direction="row" spacing={0.6} alignItems="center">
                                {event.isImportant ? <Chip size="small" color="error" label="Important" /> : null}
                                <Chip size="small" variant="outlined" label={event.eventType} />
                              </Stack>
                            </Stack>
                            <Typography variant="caption" color="text.secondary">
                              {formatDateTime(event.startAt)}
                            </Typography>
                            {event.description ? (
                              <Typography variant="body2" color="text.secondary">
                                {event.description}
                              </Typography>
                            ) : null}
                            {event.canEdit ? (
                              <Stack direction="row" spacing={1}>
                                <Button size="small" variant="text" startIcon={<EditRounded fontSize="small" />} onClick={() => openEditEventDialog(event)}>
                                  Edit
                                </Button>
                                <Button
                                  size="small"
                                  color="error"
                                  variant="text"
                                  startIcon={<DeleteOutlineRounded fontSize="small" />}
                                  onClick={() => handleDeleteEvent(event.id)}
                                >
                                  Delete
                                </Button>
                              </Stack>
                            ) : null}
                          </Stack>
                        </Paper>
                      ))}
                    </Stack>
                  )}
                </Stack>
              </Paper>
            </Stack>
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

  return (
    <Box sx={{ py: { xs: 1, md: 2 } }}>
      <Stack spacing={3}>
        {busy ? <LinearProgress /> : null}

        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={3} alignItems="stretch">
          <Paper
            elevation={0}
            sx={{
              p: { xs: 2, md: 2.5 },
              flex: 1.5,
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Stack spacing={2}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', sm: 'center' }}
              >
                <Stack spacing={0.35}>
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>
                    My courses
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Open any enrolled course directly from here.
                  </Typography>
                </Stack>
                <Chip
                  size="small"
                  variant="outlined"
                  color="primary"
                  label={`${studentCourses.length} active course${studentCourses.length === 1 ? '' : 's'}`}
                />
              </Stack>

              {coursesError ? <Alert severity="error">{coursesError}</Alert> : null}

              {coursesLoading ? (
                <Stack spacing={1.2}>
                  <LinearProgress />
                  <Typography color="text.secondary">Loading courses…</Typography>
                </Stack>
              ) : studentCourses.length === 0 ? (
                <Alert severity="info" variant="outlined">
                  No active courses are available yet.
                </Alert>
              ) : (
                <Box
                  sx={{
                    display: 'grid',
                    gap: 1.25,
                    gridTemplateColumns: {
                      xs: '1fr',
                      lg: 'repeat(2, minmax(0, 1fr))',
                    },
                  }}
                >
                  {studentCourses.map((course) => (
                    <Paper
                      key={course.id}
                      variant="outlined"
                      onClick={() => navigate(`/course/${course.id}`)}
                      sx={{
                        p: 1.5,
                        borderRadius: 2,
                        borderColor: 'divider',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1,
                        minWidth: 0,
                        cursor: 'pointer',
                        transition: 'border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease',
                        '&:hover': {
                          borderColor: 'primary.main',
                          boxShadow: '0 12px 28px rgba(79,70,229,0.12)',
                          transform: 'translateY(-1px)',
                        },
                      }}
                    >
                      <Stack spacing={0.35} sx={{ minWidth: 0 }}>
                        <Typography variant="overline" color="primary.main" sx={{ lineHeight: 1.1, fontWeight: 800 }}>
                          {course.code || 'Course'}
                        </Typography>
                        <Typography variant="h6" sx={{ fontWeight: 800 }} noWrap>
                          {course.title || 'Untitled course'}
                        </Typography>
                      </Stack>

                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                        {course.term ? <Chip size="small" variant="outlined" label={course.term} /> : null}
                        {course.section ? <Chip size="small" variant="outlined" label={`Section ${course.section}`} /> : null}
                        <Chip size="small" color="success" variant="filled" label="Active" />
                      </Stack>

                      <Typography variant="body2" color="text.secondary">
                        Open assignments, submissions, and grades for this course.
                      </Typography>
                    </Paper>
                  ))}
                </Box>
              )}
            </Stack>
          </Paper>

          <Stack spacing={2} sx={{ flex: 1, minWidth: { lg: 360 } }}>
            <Paper
              elevation={0}
              sx={{
                p: { xs: 2, md: 2.25 },
                borderRadius: 3,
                border: '1px solid',
                borderColor: 'divider',
                backgroundColor: 'rgba(15, 23, 42, 0.02)',
              }}
            >
              <Stack spacing={1.4}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>
                    Next due
                  </Typography>
                  {nextDueAssignment ? (
                    <Chip size="small" variant="outlined" label={getUrgency(nextDueAssignment.dueAt).label} />
                  ) : null}
                </Stack>

                {deadlinesError || studentSubmissionsError ? (
                  <Alert severity="error">
                    {deadlinesError || studentSubmissionsError}
                  </Alert>
                ) : null}

                {deadlinesLoading || studentSubmissionsLoading ? (
                  <LinearProgress />
                ) : nextDueAssignment ? (
                  <Stack spacing={1}>
                    <Typography sx={{ fontWeight: 700 }}>
                      {nextDueAssignment.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {(nextDueAssignment.courseCode || 'Course')}{nextDueAssignment.courseTitle ? ` • ${nextDueAssignment.courseTitle}` : ''}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Due {formatDateTime(nextDueAssignment.dueAt)}
                    </Typography>
                    <Button
                      variant="contained"
                      onClick={() => navigate(nextDueActionPath)}
                      disabled={!nextDueActionPath}
                    >
                      {nextDueActionLabel}
                    </Button>
                  </Stack>
                ) : (
                  <Stack spacing={1}>
                    <Typography color="text.secondary">No upcoming assignments.</Typography>
                    {studentCourses[0]?.id ? (
                      <Button
                        variant="outlined"
                        onClick={() => navigate(`/course/${studentCourses[0].id}/assignments`)}
                      >
                        View assignments
                      </Button>
                    ) : null}
                  </Stack>
                )}
              </Stack>
            </Paper>
            <Paper
              elevation={0}
              sx={{
                p: { xs: 2, md: 2.25 },
                borderRadius: 3,
                border: '1px solid',
                borderColor: 'divider',
                backgroundColor: 'rgba(15, 23, 42, 0.02)',
              }}
            >
              <Stack spacing={1.5}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>
                    Upcoming deadlines
                  </Typography>
                  <Chip size="small" variant="outlined" label={`${upcomingDeadlines.length} upcoming`} />
                </Stack>

                {deadlinesError ? <Alert severity="error">{deadlinesError}</Alert> : null}

                {deadlinesLoading ? (
                  <LinearProgress />
                ) : upcomingDeadlines.length === 0 ? (
                  <Stack spacing={1}>
                    <Typography color="text.secondary">No upcoming assignment deadlines.</Typography>
                    {studentCourses[0]?.id ? (
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => navigate(`/course/${studentCourses[0].id}/assignments`)}
                      >
                        View assignments
                      </Button>
                    ) : null}
                  </Stack>
                ) : (
                  <Stack spacing={1}>
                    {upcomingDeadlines.map((deadline) => {
                      const urgency = getUrgency(deadline.dueAt)
                      return (
                        <Paper
                          key={deadline.id}
                          variant="outlined"
                          onClick={() => deadline.courseId && navigate(`/course/${deadline.courseId}/assignments/${deadline.id}`)}
                          sx={{
                            p: 1.2,
                            borderRadius: 2,
                            borderColor: 'divider',
                            borderLeft: '4px solid',
                            borderLeftColor:
                              urgency.color === 'error'
                                ? 'error.main'
                                : urgency.color === 'warning'
                                  ? 'warning.main'
                                  : 'primary.main',
                            cursor: deadline.courseId ? 'pointer' : 'default',
                            transition: deadline.courseId
                              ? 'border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease'
                              : 'none',
                            '&:hover': deadline.courseId
                              ? {
                                  borderColor: 'primary.main',
                                  boxShadow: '0 10px 22px rgba(79,70,229,0.10)',
                                  transform: 'translateY(-1px)',
                                }
                              : undefined,
                          }}
                        >
                          <Stack spacing={0.4}>
                            <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
                              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                {deadline.title}
                              </Typography>
                              <Chip
                                size="small"
                                label={urgency.label}
                                color={urgency.color}
                                variant={urgency.color === 'default' ? 'outlined' : 'filled'}
                              />
                            </Stack>
                            {deadline.courseCode || deadline.courseTitle ? (
                              <Typography variant="caption" color="text.secondary">
                                {(deadline.courseCode || 'Course')}{deadline.courseTitle ? ` • ${deadline.courseTitle}` : ''}
                              </Typography>
                            ) : null}
                            <Typography variant="caption" color="text.secondary">
                              Due {formatDateTime(deadline.dueAt)}
                            </Typography>
                          </Stack>
                        </Paper>
                      )
                    })}
                  </Stack>
                )}
              </Stack>
            </Paper>

            <Paper
              elevation={0}
              sx={{
                p: { xs: 2, md: 2.25 },
                borderRadius: 3,
                border: '1px solid',
                borderColor: 'divider',
                backgroundColor: 'rgba(15, 23, 42, 0.02)',
              }}
            >
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Stack spacing={0.3}>
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>
                    Upcoming timeline
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Assignments and personal events in chronological order.
                  </Typography>
                </Stack>
                <Button size="small" variant="outlined" startIcon={<AddRounded />} onClick={openCreateEventDialog}>
                  Add event
                </Button>
              </Stack>
              <Divider sx={{ my: 2 }} />

              {deadlinesLoading || eventsLoading ? (
                <Typography color="text.secondary">Loading timeline…</Typography>
              ) : timelineItems.length === 0 ? (
                <Typography color="text.secondary">No upcoming items.</Typography>
              ) : (
                <Stack spacing={1}>
                  {timelineItems.map((item) => {
                    const isDeadline = item.kind === 'deadline'
                    const timestamp = isDeadline ? item.dueAt : item.startAt
                    const urgency = getUrgency(timestamp)
                    const isClickable = isDeadline && item.courseId
                    return (
                      <Paper
                        key={`${item.kind}-${item.id}`}
                        variant="outlined"
                        onClick={isClickable ? () => navigate(`/course/${item.courseId}/assignments/${item.id}`) : undefined}
                        sx={{
                          p: 1.4,
                          borderRadius: 2,
                          borderColor: 'divider',
                          boxShadow: 'none',
                          borderLeftWidth: 4,
                          borderLeftStyle: 'solid',
                          borderLeftColor: isDeadline ? 'primary.main' : item.isImportant ? 'error.main' : 'secondary.main',
                          cursor: isClickable ? 'pointer' : 'default',
                          transition: isClickable
                            ? 'border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease'
                            : 'none',
                          '&:hover': isClickable
                            ? {
                                borderColor: 'primary.main',
                                boxShadow: '0 10px 22px rgba(79,70,229,0.10)',
                                transform: 'translateY(-1px)',
                              }
                            : undefined,
                        }}
                      >
                        <Stack spacing={1}>
                          <Stack direction="row" spacing={1.25} alignItems="flex-start" justifyContent="space-between">
                            <Box sx={{ flex: 1 }}>
                              <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                                <Typography sx={{ fontWeight: 700 }}>{item.title}</Typography>
                                <Chip label={isDeadline ? 'Assignment' : 'Event'} size="small" variant="outlined" />
                                {!isDeadline && item.isImportant ? <Chip label="Important" size="small" color="error" /> : null}
                              </Stack>
                              {isDeadline && (item.courseCode || item.courseTitle) ? (
                                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25, display: 'block' }}>
                                  {(item.courseCode || 'Course')}{item.courseTitle ? ` • ${item.courseTitle}` : ''}
                                </Typography>
                              ) : null}
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
