import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Drawer,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import { useNavigate, useParams } from 'react-router-dom'
import { apiRequest, downloadFile } from '../api/client.js'
import {
  buildEditableGradeRows,
  formatGradeStateLabel,
  formatNumber,
  formatPercent,
  formatRunLabel,
  gradeStateChip,
  InlineNumberCell,
  resolveGradeState,
  renderSaveState,
  statusChip,
} from '../components/courseGradesShared.jsx'

function formatSelectionSummary(selected, total, singularLabel) {
  if (!total) {
    return `No ${singularLabel}s`
  }
  if (!selected.length || selected.length === total) {
    return `All ${total} ${singularLabel}${total === 1 ? '' : 's'}`
  }
  return `${selected.length} ${singularLabel}${selected.length === 1 ? '' : 's'} selected`
}

function formatMemberPreview(usernames, limit = 3) {
  if (!Array.isArray(usernames) || usernames.length === 0) {
    return 'No members listed'
  }
  if (usernames.length <= limit) {
    return usernames.join(', ')
  }
  return `${usernames.slice(0, limit).join(', ')} +${usernames.length - limit}`
}

function CourseGrades({ user }) {
  const { courseId } = useParams()
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [assignments, setAssignments] = useState([])
  const [viewMode, setViewMode] = useState('OVERALL')
  const [assignmentId, setAssignmentId] = useState('')
  const [studentOptions, setStudentOptions] = useState([])
  const [reportRows, setReportRows] = useState([])
  const [reportAssignments, setReportAssignments] = useState([])
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState('')
  const [selectedReportUserIds, setSelectedReportUserIds] = useState([])
  const [selectedReportAssignmentIds, setSelectedReportAssignmentIds] = useState([])
  const [reportIncludeAllAssignments, setReportIncludeAllAssignments] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exportingOverall, setExportingOverall] = useState(false)
  const [exportingReport, setExportingReport] = useState(false)
  const [reportDetailOpen, setReportDetailOpen] = useState(false)
  const [selectedReportCell, setSelectedReportCell] = useState(null)

  const canViewAllByRole = Boolean(user?.is_superuser || user?.is_instructor || user?.is_ta || user?.is_grader)
  const canViewAllByData = rows.some(
    (row) =>
      Object.prototype.hasOwnProperty.call(row, 'user_id') &&
      Object.prototype.hasOwnProperty.call(row, 'display_name'),
  )
  const canViewAll = canViewAllByRole || canViewAllByData
  const effectiveViewMode = canViewAll ? viewMode : 'ASSIGNMENT'
  const showInstructorAssignmentView = canViewAll && effectiveViewMode === 'ASSIGNMENT'
  const showReportView = canViewAll && effectiveViewMode === 'REPORT'
  const showStudentAssignmentView = !canViewAll
  const hasGroupedAssignmentRows = useMemo(
    () => showInstructorAssignmentView && rows.some((row) => row.group_name),
    [rows, showInstructorAssignmentView],
  )

  useEffect(() => {
    if (!canViewAll) {
      return
    }
    let mounted = true

    const loadAssignments = async () => {
      try {
        const [assignmentData, peopleData] = await Promise.all([
          apiRequest(`/api/assignments/?course_id=${courseId}`),
          apiRequest(`/api/courses/${courseId}/people/`),
        ])
        if (!mounted) return
        const list = Array.isArray(assignmentData) ? assignmentData : []
        const students = (Array.isArray(peopleData) ? peopleData : []).filter((person) => person.role === 'STUDENT')
        setAssignments(list)
        setStudentOptions(students)
        setAssignmentId((prev) => {
          const hasCurrent = prev && list.some((assignment) => String(assignment.id) === String(prev))
          if (hasCurrent) return prev
          return list.length > 0 ? list[0].id : ''
        })
        setSelectedReportUserIds((prev) => {
          const validSelected = prev.filter((value) => students.some((student) => String(student.user_id) === String(value)))
          if (validSelected.length) return validSelected
          return students.map((student) => String(student.user_id))
        })
        setSelectedReportAssignmentIds((prev) => {
          const validSelected = prev.filter((value) => list.some((assignment) => String(assignment.id) === String(value)))
          if (validSelected.length) return validSelected
          return list.map((assignment) => String(assignment.id))
        })
      } catch (_err) {
        if (!mounted) return
        setAssignments([])
        setStudentOptions([])
        setSelectedReportUserIds([])
        setSelectedReportAssignmentIds([])
      }
    }

    loadAssignments()
    return () => {
      mounted = false
    }
  }, [courseId, canViewAll])

  useEffect(() => {
    let mounted = true

    const loadGrades = async () => {
      if (showReportView) {
        if (mounted) {
          setLoading(false)
          setRows([])
          setError('')
        }
        return
      }
      setLoading(true)
      setError('')
      try {
        let path = `/api/courses/${courseId}/grades/`
        if (showInstructorAssignmentView) {
          if (!assignmentId) {
            if (mounted) setRows([])
            return
          }
          path = `/api/courses/${courseId}/grades/?view=assignment&assignment_id=${assignmentId}`
        }
        const data = await apiRequest(path)
        if (!mounted) return
        const list = Array.isArray(data) ? data : []
        setRows(showInstructorAssignmentView ? buildEditableGradeRows(list) : list)
      } catch (err) {
        if (!mounted) return
        setError(err.message || 'Unable to load grades')
        setRows([])
      } finally {
        if (mounted) setLoading(false)
      }
    }

    loadGrades()
    return () => {
      mounted = false
    }
  }, [courseId, assignmentId, showInstructorAssignmentView, effectiveViewMode, refreshKey, showReportView])

  useEffect(() => {
    if (!showReportView) {
      setReportRows([])
      setReportAssignments([])
      setReportError('')
      setReportLoading(false)
      return
    }

    if (!selectedReportUserIds.length) {
      setReportRows([])
      setReportAssignments([])
      setReportError('')
      setReportLoading(false)
      return
    }

    if (!reportIncludeAllAssignments && !selectedReportAssignmentIds.length) {
      setReportRows([])
      setReportAssignments([])
      setReportError('')
      setReportLoading(false)
      return
    }

    let mounted = true
    const loadReport = async () => {
      setReportLoading(true)
      setReportError('')
      try {
        const payload = await apiRequest(`/api/courses/${courseId}/grades/report/`, {
          method: 'POST',
          body: {
            user_ids: selectedReportUserIds.map((value) => Number(value)),
            assignment_ids: reportIncludeAllAssignments ? [] : selectedReportAssignmentIds,
            include_all_assignments: reportIncludeAllAssignments,
          },
        })
        if (!mounted) return
        setReportRows(Array.isArray(payload?.rows) ? payload.rows : [])
        setReportAssignments(Array.isArray(payload?.assignments) ? payload.assignments : [])
      } catch (err) {
        if (!mounted) return
        setReportRows([])
        setReportAssignments([])
        setReportError(err.message || 'Unable to load grade report.')
      } finally {
        if (mounted) {
          setReportLoading(false)
        }
      }
    }

    loadReport()
    return () => {
      mounted = false
    }
  }, [
    courseId,
    showReportView,
    selectedReportUserIds,
    selectedReportAssignmentIds,
    reportIncludeAllAssignments,
    refreshKey,
  ])

  const assignmentTotals = useMemo(() => {
    if (!showStudentAssignmentView) {
      return null
    }
    let score = 0
    let max = 0
    rows.forEach((row) => {
      score += Number(row.score || 0)
      max += Number(row.max_score || 0)
    })
    const percent = max > 0 ? (score / max) * 100 : 0
    return { score, max, percent }
  }, [rows, showStudentAssignmentView])

  const selectedAssignment = useMemo(
    () => assignments.find((assignment) => String(assignment.id) === String(assignmentId)) || null,
    [assignments, assignmentId],
  )

  const openStudentGradePage = (row, focusedAssignment = '') => {
    if (!canViewAll || !row?.user_id) {
      return
    }
    const search = focusedAssignment ? `?assignmentId=${encodeURIComponent(String(focusedAssignment))}` : ''
    navigate(`/course/${courseId}/grades/student/${row.user_id}${search}`, {
      state: {
        student: {
          user_id: row.user_id,
          display_name: row.display_name,
          email: row.email,
          cwid: row.cwid,
        },
      },
    })
  }

  const handleOpenReportCellDetail = (row, assignment) => {
    const cell = row?.cells?.[String(assignment.assignment_id)]
    if (!cell) {
      return
    }
    setSelectedReportCell({
      student: {
        user_id: row.user_id,
        display_name: row.display_name,
        email: row.email,
        cwid: row.cwid,
      },
      assignment: {
        assignment_id: String(assignment.assignment_id),
        title: assignment.title,
        due_at: assignment.due_at,
      },
      cell,
    })
    setReportDetailOpen(true)
  }

  const updateAssignmentRow = (rowId, updater) => {
    setRows((prev) => prev.map((row) => (String(row.id) === String(rowId) ? updater(row) : row)))
  }

  const saveInlineEdit = async (row, field, rawValue) => {
    const rowId = row.id
    const targetUserId = row.user_id
    if (!targetUserId) {
      updateAssignmentRow(rowId, (current) => ({ ...current, _error: 'Unable to resolve the target student.' }))
      return
    }
    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed)) {
      updateAssignmentRow(rowId, (current) => ({ ...current, _error: 'Enter a valid number.' }))
      return
    }

    const currentScore = Number(row.score || 0)
    const currentMax = Number(row.max_score || 0)
    const nextScore = field === 'score' ? parsed : currentScore
    const nextMax = field === 'max_score' ? parsed : currentMax

    if (nextScore < 0) {
      updateAssignmentRow(rowId, (current) => ({ ...current, _error: 'Score must be zero or positive.' }))
      return
    }
    if (nextMax <= 0) {
      updateAssignmentRow(rowId, (current) => ({ ...current, _error: 'Max score must be greater than zero.' }))
      return
    }
    if (nextScore === currentScore && nextMax === currentMax) {
      return
    }

    const previous = row
    const optimisticPercent = nextMax > 0 ? (nextScore / nextMax) * 100 : 0

    updateAssignmentRow(rowId, (current) => ({
      ...current,
      score: nextScore,
      max_score: nextMax,
      percent: optimisticPercent,
      _saving: true,
      _error: '',
    }))

    try {
      const payload = await apiRequest(`/api/courses/${courseId}/grades/override/`, {
        method: 'POST',
        body: {
          assignment_id: row.assignment_id,
          user_id: targetUserId,
          score: nextScore,
          max_score: nextMax,
        },
      })

      const savedScore = Number(payload.score ?? nextScore)
      const savedMax = Number(payload.max_score ?? nextMax)
      const savedPercent = Number(payload.percent ?? (savedMax > 0 ? (savedScore / savedMax) * 100 : 0))

      updateAssignmentRow(rowId, (current) => ({
        ...current,
        score: savedScore,
        max_score: savedMax,
        percent: savedPercent,
        grade_state: 'GRADED',
        _saving: false,
        _error: '',
        _dirty: false,
        _original_score: savedScore,
        _original_max_score: savedMax,
      }))
      setRefreshKey((prev) => prev + 1)
    } catch (err) {
      updateAssignmentRow(rowId, () => ({
        ...previous,
        _saving: false,
        _error: err.message || 'Save failed.',
      }))
    }
  }

  const handleExportOverall = async () => {
    setExportingOverall(true)
    setError('')
    try {
      await downloadFile(`/api/courses/${courseId}/grades/export/?view=overall`, {
        filename: `course-${courseId}-overall-grades.csv`,
      })
    } catch (err) {
      setError(err.message || 'Unable to export overall grades.')
    } finally {
      setExportingOverall(false)
    }
  }

  const handleExportReport = async () => {
    if (!selectedReportUserIds.length) {
      return
    }
    if (!reportIncludeAllAssignments && !selectedReportAssignmentIds.length) {
      return
    }
    setExportingReport(true)
    setReportError('')
    try {
      await downloadFile(`/api/courses/${courseId}/grades/report/export/`, {
        method: 'POST',
        body: {
          user_ids: selectedReportUserIds.map((value) => Number(value)),
          assignment_ids: reportIncludeAllAssignments ? [] : selectedReportAssignmentIds,
          include_all_assignments: reportIncludeAllAssignments,
        },
        filename: `course-${courseId}-grade-report.csv`,
      })
    } catch (err) {
      setReportError(err.message || 'Unable to export grade report.')
    } finally {
      setExportingReport(false)
    }
  }

  const reportColumns = useMemo(() => {
    const baseColumns = [
      {
        field: 'display_name',
        headerName: 'Student',
        flex: 1.1,
        minWidth: 180,
      },
      { field: 'email', headerName: 'Email', flex: 1.2, minWidth: 220 },
      { field: 'cwid', headerName: 'CWID', flex: 0.65, minWidth: 120 },
      {
        field: 'total_score',
        headerName: 'Overall',
        minWidth: 160,
        sortable: false,
        renderCell: (params) => (
          <Stack spacing={0.1} sx={{ py: 0.6 }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {`${formatNumber(params.row.total_score)} / ${formatNumber(params.row.total_max_score)}`}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {formatPercent(params.row.percent)}
            </Typography>
          </Stack>
        ),
      },
    ]

    const assignmentColumns = reportAssignments.map((assignment) => ({
      field: `assignment:${assignment.assignment_id}`,
      headerName: assignment.title,
      minWidth: 190,
      sortable: false,
      cellClassName: 'grade-report-assignment-cell',
      renderCell: (params) => {
        const cell = params.row?.cells?.[String(assignment.assignment_id)]
        if (!cell) {
          return '—'
        }
        const gradeLabel = formatGradeStateLabel(cell.grade_state, cell)
        const runLabel = formatRunLabel(cell.status)
        const primary = resolveGradeState(cell.grade_state, cell) === 'GRADED'
          ? `${formatNumber(cell.score)} / ${formatNumber(cell.max_score)}`
          : gradeLabel
        const secondary = resolveGradeState(cell.grade_state, cell) === 'GRADED'
          ? `${formatPercent(cell.percent)}${runLabel !== '—' ? ` • ${runLabel}` : ''}`
          : runLabel !== '—'
            ? runLabel
            : cell.submitted_at
              ? 'Submitted'
              : '—'
        return (
          <Stack spacing={0.1} sx={{ py: 0.6, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap title={primary}>
              {primary}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap title={secondary}>
              {secondary}
            </Typography>
          </Stack>
        )
      },
    }))

    return [...baseColumns, ...assignmentColumns]
  }, [reportAssignments])

  const columns = useMemo(() => {
    if (showStudentAssignmentView) {
      return [
        {
          field: 'assignment_title',
          headerName: 'Assignment',
          flex: 1.4,
          minWidth: 220,
        },
        {
          field: 'due_at',
          headerName: 'Due',
          flex: 0.9,
          minWidth: 160,
          renderCell: (params) => {
            if (!params.value) return '—'
            const date = new Date(params.value)
            return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
          },
        },
        {
          field: 'status',
          headerName: 'Status',
          flex: 0.8,
          minWidth: 140,
          renderCell: (params) => statusChip(params.value),
        },
        {
          field: 'score',
          headerName: 'Score',
          flex: 0.75,
          minWidth: 128,
          sortable: false,
        renderCell: (params) => (
          <InlineNumberCell
            value={params.row.score}
            disabled={Boolean(params.row._saving) || !params.row.attempt_number}
            onCommit={(nextValue) => saveInlineEdit(params.row, 'score', nextValue)}
          />
        ),
      },
        {
          field: 'max_score',
          headerName: 'Max',
          flex: 0.75,
          minWidth: 128,
          sortable: false,
        renderCell: (params) => (
          <InlineNumberCell
            value={params.row.max_score}
            disabled={Boolean(params.row._saving) || !params.row.attempt_number}
            onCommit={(nextValue) => saveInlineEdit(params.row, 'max_score', nextValue)}
          />
        ),
      },
        {
          field: 'percent',
          headerName: 'Percent',
          flex: 0.7,
          minWidth: 120,
          renderCell: (params) => <Chip label={formatPercent(params.value)} size="small" variant="outlined" />,
        },
        {
          field: 'save_state',
          headerName: 'Save',
          flex: 0.9,
          minWidth: 150,
          sortable: false,
          filterable: false,
          renderCell: (params) => renderSaveState(params.row),
        },
      ]
    }

    if (showInstructorAssignmentView) {
      const assignmentColumns = [
        {
          field: 'display_name',
          headerName: 'Student',
          flex: 1.1,
          minWidth: 180,
        },
        { field: 'email', headerName: 'Email', flex: 1.2, minWidth: 200 },
        { field: 'cwid', headerName: 'CWID', flex: 0.7, minWidth: 110 },
        {
          field: 'grade_state',
          headerName: 'Grade status',
          flex: 0.8,
          minWidth: 150,
          renderCell: (params) => gradeStateChip(params.value, params.row),
        },
        {
          field: 'status',
          headerName: 'Run',
          flex: 0.7,
          minWidth: 130,
          renderCell: (params) => (params.row.attempt_number ? statusChip(params.value) : '—'),
        },
        {
          field: 'attempt_number',
          headerName: 'Attempt',
          flex: 0.5,
          minWidth: 90,
          renderCell: (params) => params.value || '—',
        },
        {
          field: 'submitted_at',
          headerName: 'Submitted',
          flex: 0.9,
          minWidth: 160,
          renderCell: (params) => {
            if (!params.value) return '—'
            const date = new Date(params.value)
            return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
          },
        },
        {
          field: 'score',
          headerName: 'Score',
          flex: 0.6,
          minWidth: 110,
          renderCell: (params) => formatNumber(params.value),
        },
        {
          field: 'max_score',
          headerName: 'Max',
          flex: 0.6,
          minWidth: 110,
          renderCell: (params) => formatNumber(params.value),
        },
        {
          field: 'percent',
          headerName: 'Percent',
          flex: 0.7,
          minWidth: 120,
          renderCell: (params) => <Chip label={formatPercent(params.value)} size="small" variant="outlined" />,
        },
      ]
      if (hasGroupedAssignmentRows) {
        assignmentColumns.splice(3, 0, {
          field: 'submission_context',
          headerName: 'Submission',
          flex: 1.15,
          minWidth: 240,
          sortable: false,
          renderCell: (params) => {
            if (!params.row.group_name) {
              return 'Individual'
            }
            return (
              <Stack spacing={0.15} sx={{ py: 0.4, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {params.row.group_name}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.25 }}>
                  {`Submitted by ${params.row.submitted_by_username || '—'}`}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.25 }}>
                  {formatMemberPreview(params.row.group_member_usernames)}
                </Typography>
              </Stack>
            )
          },
        })
      }
      return assignmentColumns
    }

    const base = [
      {
        field: 'total_score',
        headerName: 'Total score',
        flex: 0.8,
        minWidth: 120,
        renderCell: (params) => formatNumber(params.value),
      },
      {
        field: 'total_max_score',
        headerName: 'Max',
        flex: 0.8,
        minWidth: 120,
        renderCell: (params) => formatNumber(params.value),
      },
      {
        field: 'percent',
        headerName: 'Percent',
        flex: 0.8,
        minWidth: 120,
        renderCell: (params) => <Chip label={formatPercent(params.value)} size="small" variant="outlined" />,
      },
    ]

    if (!canViewAll) {
      return base
    }

    return [
      {
        field: 'display_name',
        headerName: 'Student',
        flex: 1.2,
        minWidth: 180,
      },
      { field: 'email', headerName: 'Email', flex: 1.3, minWidth: 200 },
      { field: 'cwid', headerName: 'CWID', flex: 0.8, minWidth: 120 },
      ...base,
    ]
  }, [canViewAll, hasGroupedAssignmentRows, showStudentAssignmentView, showInstructorAssignmentView, saveInlineEdit])

  return (
    <Box sx={{ py: { xs: 2, md: 3 } }}>
      <Stack spacing={3}>
        {canViewAll ? (
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            alignItems={{ xs: 'stretch', md: 'center' }}
            justifyContent="space-between"
          >
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={viewMode}
                onChange={(_event, nextValue) => {
                  if (!nextValue) return
                  setViewMode(nextValue)
                }}
              >
                <ToggleButton value="OVERALL">Overall</ToggleButton>
                <ToggleButton value="ASSIGNMENT">By assignment</ToggleButton>
                <ToggleButton value="REPORT">Report</ToggleButton>
              </ToggleButtonGroup>
              {effectiveViewMode === 'ASSIGNMENT' ? (
                <FormControl size="small" sx={{ minWidth: 260 }}>
                  <InputLabel id="grade-assignment-select-label">Assignment</InputLabel>
                  <Select
                    labelId="grade-assignment-select-label"
                    label="Assignment"
                    value={assignmentId}
                    onChange={(event) => setAssignmentId(event.target.value)}
                  >
                    {assignments.map((assignment) => (
                      <MenuItem key={assignment.id} value={assignment.id}>
                        {assignment.title}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              ) : null}
              {showReportView ? (
                <>
                  <FormControl size="small" sx={{ minWidth: 280 }}>
                    <InputLabel id="grade-report-students-label">Students</InputLabel>
                    <Select
                      multiple
                      labelId="grade-report-students-label"
                      label="Students"
                      value={selectedReportUserIds}
                      onChange={(event) => {
                        const nextValue = event.target.value
                        setSelectedReportUserIds(typeof nextValue === 'string' ? nextValue.split(',') : nextValue)
                      }}
                      renderValue={(selected) =>
                        formatSelectionSummary(
                          Array.isArray(selected) ? selected : [],
                          studentOptions.length,
                          'student',
                        )
                      }
                    >
                      {studentOptions.map((student) => (
                        <MenuItem key={student.user_id} value={String(student.user_id)}>
                          {student.display_name || student.username}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl size="small" sx={{ minWidth: 220 }}>
                    <InputLabel id="grade-report-assignment-scope-label">Assignments</InputLabel>
                    <Select
                      labelId="grade-report-assignment-scope-label"
                      label="Assignments"
                      value={reportIncludeAllAssignments ? 'ALL' : 'SELECTED'}
                      onChange={(event) => {
                        const useAll = event.target.value === 'ALL'
                        setReportIncludeAllAssignments(useAll)
                        if (!useAll && !selectedReportAssignmentIds.length && assignments.length) {
                          setSelectedReportAssignmentIds([String(assignments[0].id)])
                        }
                      }}
                    >
                      <MenuItem value="ALL">All assignments</MenuItem>
                      <MenuItem value="SELECTED">Selected assignments</MenuItem>
                    </Select>
                  </FormControl>
                  {!reportIncludeAllAssignments ? (
                    <FormControl size="small" sx={{ minWidth: 280 }}>
                      <InputLabel id="grade-report-assignments-label">Selected assignments</InputLabel>
                      <Select
                        multiple
                        labelId="grade-report-assignments-label"
                        label="Selected assignments"
                        value={selectedReportAssignmentIds}
                        onChange={(event) => {
                          const nextValue = event.target.value
                          setSelectedReportAssignmentIds(typeof nextValue === 'string' ? nextValue.split(',') : nextValue)
                        }}
                        renderValue={(selected) =>
                          formatSelectionSummary(
                            Array.isArray(selected) ? selected : [],
                            assignments.length,
                            'assignment',
                          )
                        }
                      >
                        {assignments.map((assignment) => (
                          <MenuItem key={assignment.id} value={String(assignment.id)}>
                            {assignment.title}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  ) : null}
                </>
              ) : null}
            </Stack>
            {effectiveViewMode === 'OVERALL' ? (
              <Button variant="outlined" onClick={handleExportOverall} disabled={exportingOverall}>
                {exportingOverall ? 'Exporting...' : 'Export overall CSV'}
              </Button>
            ) : null}
            {showReportView ? (
              <Button
                variant="outlined"
                onClick={handleExportReport}
                disabled={
                  exportingReport ||
                  !selectedReportUserIds.length ||
                  (!reportIncludeAllAssignments && !selectedReportAssignmentIds.length)
                }
              >
                {exportingReport ? 'Exporting...' : 'Export report CSV'}
              </Button>
            ) : null}
          </Stack>
        ) : null}

        {showStudentAssignmentView && assignmentTotals ? (
          <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap">
            <Chip label={`Total ${assignmentTotals.score.toFixed(2)} / ${assignmentTotals.max.toFixed(2)}`} />
            <Chip label={`Percent ${assignmentTotals.percent.toFixed(1)}%`} color="primary" variant="outlined" />
          </Stack>
        ) : null}

        {showInstructorAssignmentView && selectedAssignment ? (
          <Chip
            label={`Assignment: ${selectedAssignment.title}`}
            variant="outlined"
            color="primary"
            sx={{ width: 'fit-content' }}
          />
        ) : null}

        {showReportView ? (
          <Typography variant="body2" color="text.secondary">
            {`${formatSelectionSummary(selectedReportUserIds, studentOptions.length, 'student')} • ${
              reportIncludeAllAssignments
                ? `All ${assignments.length} assignment${assignments.length === 1 ? '' : 's'}`
                : formatSelectionSummary(selectedReportAssignmentIds, assignments.length, 'assignment')
            }`}
          </Typography>
        ) : null}

        {error ? <Alert severity="error">{error}</Alert> : null}
        {showReportView && reportError ? <Alert severity="error">{reportError}</Alert> : null}

        {showReportView ? (
          <Box sx={{ height: 560 }}>
            <DataGrid
              rows={reportRows}
              columns={reportColumns}
              loading={reportLoading}
              disableRowSelectionOnClick
              onCellClick={(params) => {
                if (String(params.field).startsWith('assignment:')) {
                  const assignmentIdValue = String(params.field).split(':')[1]
                  const assignment = reportAssignments.find(
                    (item) => String(item.assignment_id) === assignmentIdValue,
                  )
                  if (assignment) {
                    handleOpenReportCellDetail(params.row, assignment)
                  }
                }
              }}
              slots={{ toolbar: GridToolbar }}
              sx={{
                backgroundColor: 'background.paper',
                borderRadius: 3,
                '& .grade-report-assignment-cell': {
                  cursor: 'pointer',
                },
                '& .grade-report-assignment-cell:hover': {
                  backgroundColor: 'rgba(79, 70, 229, 0.04)',
                },
              }}
            />
          </Box>
        ) : (
          <Box sx={{ height: 520 }}>
            <DataGrid
              rows={rows}
              columns={columns}
              loading={loading}
              rowHeight={showInstructorAssignmentView && hasGroupedAssignmentRows ? 78 : 52}
              disableRowSelectionOnClick
              onRowClick={(params) => {
                if (!canViewAll || showInstructorAssignmentView) {
                  return
                }
                openStudentGradePage(params.row)
              }}
              slots={{ toolbar: GridToolbar }}
              sx={{
                backgroundColor: 'background.paper',
                borderRadius: 3,
                '& .MuiDataGrid-row': {
                  cursor: canViewAll && !showInstructorAssignmentView ? 'pointer' : 'default',
                },
              }}
            />
          </Box>
        )}
      </Stack>

      <Drawer
        anchor="right"
        open={reportDetailOpen}
        onClose={() => {
          setReportDetailOpen(false)
          setSelectedReportCell(null)
        }}
        PaperProps={{
          sx: {
            width: { xs: '100%', md: 460 },
            p: 2,
          },
        }}
      >
        <Stack spacing={2} sx={{ height: '100%' }}>
          <Stack spacing={0.4}>
            <Typography variant="h6" fontWeight={700}>
              Assignment detail
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {selectedReportCell?.assignment?.title || 'Selected assignment'}
            </Typography>
          </Stack>

          {selectedReportCell ? (
            <>
              <Paper
                elevation={0}
                sx={{
                  p: 1.5,
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                  <Stack spacing={1.25}>
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                        Student
                    </Typography>
                    <Typography variant="body1" sx={{ fontWeight: 700 }}>
                      {selectedReportCell.student.display_name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {selectedReportCell.student.email || '—'}
                    </Typography>
                    {selectedReportCell.cell.group_name ? (
                      <Stack spacing={0.2} sx={{ mt: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {selectedReportCell.cell.group_name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {`Submitted by ${selectedReportCell.cell.submitted_by_username || '—'}`}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatMemberPreview(selectedReportCell.cell.group_member_usernames)}
                        </Typography>
                      </Stack>
                    ) : null}
                  </Box>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {gradeStateChip(selectedReportCell.cell.grade_state, selectedReportCell.cell)}
                    {selectedReportCell.cell.attempt_number ? statusChip(selectedReportCell.cell.status) : null}
                  </Stack>
                  <Stack spacing={0.9}>
                    <Stack direction="row" justifyContent="space-between" spacing={2}>
                      <Typography variant="body2" color="text.secondary">
                        Score
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {`${formatNumber(selectedReportCell.cell.score)} / ${formatNumber(selectedReportCell.cell.max_score)}`}
                      </Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between" spacing={2}>
                      <Typography variant="body2" color="text.secondary">
                        Percent
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {formatPercent(selectedReportCell.cell.percent)}
                      </Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between" spacing={2}>
                      <Typography variant="body2" color="text.secondary">
                        Grade status
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {formatGradeStateLabel(selectedReportCell.cell.grade_state, selectedReportCell.cell)}
                      </Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between" spacing={2}>
                      <Typography variant="body2" color="text.secondary">
                        Run
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {formatRunLabel(selectedReportCell.cell.status)}
                      </Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between" spacing={2}>
                      <Typography variant="body2" color="text.secondary">
                        Attempt
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {selectedReportCell.cell.attempt_number || '—'}
                      </Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between" spacing={2}>
                      <Typography variant="body2" color="text.secondary">
                        Submitted
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700, textAlign: 'right' }}>
                        {selectedReportCell.cell.submitted_at
                          ? new Date(selectedReportCell.cell.submitted_at).toLocaleString()
                          : '—'}
                      </Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between" spacing={2}>
                      <Typography variant="body2" color="text.secondary">
                        Due
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700, textAlign: 'right' }}>
                        {selectedReportCell.assignment.due_at
                          ? new Date(selectedReportCell.assignment.due_at).toLocaleString()
                          : '—'}
                      </Typography>
                    </Stack>
                  </Stack>
                  <Box
                    sx={{
                      mt: 0.5,
                      pt: 1.25,
                      borderTop: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <Typography
                      variant="overline"
                      sx={{
                        display: 'block',
                        mb: 0.75,
                        color: 'primary.main',
                        fontWeight: 700,
                        letterSpacing: '0.12em',
                      }}
                    >
                      Instructor comment
                    </Typography>
                    <Paper
                      elevation={0}
                      sx={{
                        p: 1.25,
                        borderRadius: 2,
                        backgroundColor: 'background.default',
                        border: '1px solid',
                        borderColor: 'divider',
                      }}
                    >
                      <Typography
                        variant="body2"
                        sx={{
                          color: selectedReportCell.cell.feedback?.trim() ? 'text.primary' : 'text.secondary',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          minHeight: 48,
                        }}
                      >
                        {selectedReportCell.cell.feedback?.trim() || 'No instructor comment added yet.'}
                      </Typography>
                    </Paper>
                  </Box>
                </Stack>
              </Paper>

              <Stack direction="row" spacing={1} justifyContent="space-between">
                <Button
                  variant="outlined"
                  onClick={() => {
                    openStudentGradePage(selectedReportCell.student, selectedReportCell.assignment.assignment_id)
                    setReportDetailOpen(false)
                    setSelectedReportCell(null)
                  }}
                >
                  Open student gradebook
                </Button>
                <Button
                  onClick={() => {
                    setReportDetailOpen(false)
                    setSelectedReportCell(null)
                  }}
                >
                  Close
                </Button>
              </Stack>
            </>
          ) : null}
        </Stack>
      </Drawer>
    </Box>
  )
}

export default CourseGrades
