import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import { ArrowBackRounded, DownloadRounded } from '@mui/icons-material'
import { DataGrid } from '@mui/x-data-grid'
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { apiRequest, downloadFile } from '../api/client.js'
import {
  buildEditableGradeRows,
  formatNumber,
  formatPercent,
  InlineNumberCell,
  renderSaveState,
  statusChip,
} from '../components/courseGradesShared.jsx'

function formatMemberPreview(usernames, limit = 3) {
  if (!Array.isArray(usernames) || usernames.length === 0) {
    return 'No members listed'
  }
  if (usernames.length <= limit) {
    return usernames.join(', ')
  }
  return `${usernames.slice(0, limit).join(', ')} +${usernames.length - limit}`
}

function CourseStudentGrades({ user }) {
  const { courseId, userId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const focusedAssignmentId = searchParams.get('assignmentId') || ''
  const canViewAll = Boolean(user?.is_superuser || user?.is_instructor || user?.is_ta || user?.is_grader)

  const [student, setStudent] = useState(location.state?.student || null)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exportingStudent, setExportingStudent] = useState(false)
  const [batchEditMode, setBatchEditMode] = useState(false)
  const [batchSaving, setBatchSaving] = useState(false)
  const [batchSummary, setBatchSummary] = useState('')

  useEffect(() => {
    if (location.state?.student) {
      setStudent(location.state.student)
    }
  }, [location.state])

  useEffect(() => {
    let mounted = true

    const loadStudentGradebook = async () => {
      setLoading(true)
      setError('')
      setBatchSummary('')
      setBatchSaving(false)
      try {
        const [gradesData, peopleData] = await Promise.all([
          apiRequest(`/api/courses/${courseId}/grades/?view=student&user_id=${userId}`),
          apiRequest(`/api/courses/${courseId}/people/`),
        ])
        if (!mounted) return

        const list = Array.isArray(gradesData) ? gradesData : []
        const people = Array.isArray(peopleData) ? peopleData : []
        const matchedStudent = people.find((person) => String(person.user_id) === String(userId))

        setRows(buildEditableGradeRows(list))
        setBatchEditMode(false)
        setStudent((prev) => {
          if (matchedStudent) {
            return {
              user_id: matchedStudent.user_id,
              display_name: matchedStudent.display_name || matchedStudent.username || prev?.display_name || 'Student gradebook',
              email: matchedStudent.email || prev?.email || '',
              cwid: matchedStudent.cwid || prev?.cwid || '',
            }
          }
          return prev || {
            user_id,
            display_name: 'Student gradebook',
            email: '',
            cwid: '',
          }
        })
      } catch (err) {
        if (!mounted) return
        setRows([])
        setError(err.message || 'Unable to load student assignment grades.')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    loadStudentGradebook()
    return () => {
      mounted = false
    }
  }, [courseId, userId])

  const totals = useMemo(() => {
    let score = 0
    let maxScore = 0
    rows.forEach((row) => {
      score += Number(row.score || 0)
      maxScore += Number(row.max_score || 0)
    })
    const percent = maxScore > 0 ? (score / maxScore) * 100 : 0
    return { score, maxScore, percent }
  }, [rows])

  const dirtyCount = useMemo(
    () => rows.filter((row) => row._dirty && row.attempt_number).length,
    [rows],
  )
  const hasGroupedRows = useMemo(
    () => rows.some((row) => row.group_name),
    [rows],
  )

  const updateRow = (rowId, updater) => {
    setRows((prev) => prev.map((row) => (String(row.id) === String(rowId) ? updater(row) : row)))
  }

  const saveInlineEdit = async (row, field, rawValue) => {
    const rowId = row.id
    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed)) {
      updateRow(rowId, (current) => ({ ...current, _error: 'Enter a valid number.' }))
      return
    }

    const currentScore = Number(row.score || 0)
    const currentMax = Number(row.max_score || 0)
    const nextScore = field === 'score' ? parsed : currentScore
    const nextMax = field === 'max_score' ? parsed : currentMax

    if (nextScore < 0) {
      updateRow(rowId, (current) => ({ ...current, _error: 'Score must be zero or positive.' }))
      return
    }
    if (nextMax <= 0) {
      updateRow(rowId, (current) => ({ ...current, _error: 'Max score must be greater than zero.' }))
      return
    }
    if (nextScore === currentScore && nextMax === currentMax) {
      return
    }

    const optimisticPercent = nextMax > 0 ? (nextScore / nextMax) * 100 : 0
    const previous = row

    if (batchEditMode) {
      setBatchSummary('')
      updateRow(rowId, (current) => ({
        ...current,
        score: nextScore,
        max_score: nextMax,
        percent: optimisticPercent,
        _dirty: true,
        _error: '',
      }))
      return
    }

    updateRow(rowId, (current) => ({
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
          user_id: userId,
          score: nextScore,
          max_score: nextMax,
        },
      })

      const savedScore = Number(payload.score ?? nextScore)
      const savedMax = Number(payload.max_score ?? nextMax)
      const savedPercent = Number(payload.percent ?? (savedMax > 0 ? (savedScore / savedMax) * 100 : 0))

      updateRow(rowId, (current) => ({
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
    } catch (err) {
      updateRow(rowId, () => ({
        ...previous,
        _saving: false,
        _error: err.message || 'Save failed.',
      }))
    }
  }

  const saveAllBatchEdits = async () => {
    if (batchSaving) {
      return
    }
    const pendingRows = rows.filter((row) => row._dirty && row.attempt_number)
    if (pendingRows.length === 0) {
      return
    }

    setBatchSaving(true)
    setError('')
    setBatchSummary('')

    let successCount = 0
    let failureCount = 0

    for (const row of pendingRows) {
      const rowId = row.id
      updateRow(rowId, (current) => ({ ...current, _saving: true, _error: '' }))
      try {
        const payload = await apiRequest(`/api/courses/${courseId}/grades/override/`, {
          method: 'POST',
          body: {
            assignment_id: row.assignment_id,
            user_id: userId,
            score: Number(row.score || 0),
            max_score: Number(row.max_score || 0),
          },
        })

        const savedScore = Number(payload.score ?? row.score ?? 0)
        const savedMax = Number(payload.max_score ?? row.max_score ?? 0)
        const savedPercent = Number(payload.percent ?? (savedMax > 0 ? (savedScore / savedMax) * 100 : 0))
        updateRow(rowId, (current) => ({
          ...current,
          score: savedScore,
          max_score: savedMax,
          percent: savedPercent,
          grade_state: 'GRADED',
          _saving: false,
          _dirty: false,
          _error: '',
          _original_score: savedScore,
          _original_max_score: savedMax,
        }))
        successCount += 1
      } catch (err) {
        failureCount += 1
        updateRow(rowId, (current) => ({
          ...current,
          _saving: false,
          _error: err.message || 'Save failed.',
        }))
      }
    }

    if (failureCount === 0) {
      setBatchSummary(`Saved ${successCount} change${successCount === 1 ? '' : 's'}.`)
    } else {
      setBatchSummary(`Saved ${successCount}, failed ${failureCount}.`)
    }

    setBatchSaving(false)
  }

  const discardBatchEdits = () => {
    if (batchSaving) {
      return
    }
    setRows((prev) =>
      prev.map((row) => {
        if (!row._dirty) {
          return row
        }
        const restoredScore = Number(row._original_score ?? 0)
        const restoredMax = Number(row._original_max_score ?? 0)
        const restoredPercent = restoredMax > 0 ? (restoredScore / restoredMax) * 100 : 0
        return {
          ...row,
          score: restoredScore,
          max_score: restoredMax,
          percent: restoredPercent,
          _dirty: false,
          _error: '',
        }
      }),
    )
    setBatchSummary('Unsaved changes discarded.')
  }

  const handleExportStudent = async () => {
    setExportingStudent(true)
    setError('')
    try {
      await downloadFile(`/api/courses/${courseId}/grades/export/?view=student&user_id=${userId}`, {
        filename: `course-${courseId}-student-${userId}-grades.csv`,
      })
    } catch (err) {
      setError(err.message || 'Unable to export student grades.')
    } finally {
      setExportingStudent(false)
    }
  }

  const columns = useMemo(
    () => {
      const baseColumns = [
        {
          field: 'assignment_title',
          headerName: 'Assignment',
          flex: 1.2,
          minWidth: 220,
        },
        {
          field: 'due_at',
          headerName: 'Due',
          flex: 0.9,
          minWidth: 170,
          renderCell: (params) => {
            if (!params.value) return '—'
            const date = new Date(params.value)
            return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
          },
        },
      ]

      if (hasGroupedRows) {
        baseColumns.push({
          field: 'submission_context',
          headerName: 'Submission',
          flex: 1.25,
          minWidth: 240,
          sortable: false,
          renderCell: (params) => {
            if (!params.row.group_name) {
              return (
                <Typography variant="body2" color="text.secondary">
                  Individual
                </Typography>
              )
            }
            return (
              <Stack spacing={0.2} sx={{ py: 0.6, minWidth: 0 }}>
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

      return [
        ...baseColumns,
        {
          field: 'status',
          headerName: 'Status',
          flex: 0.7,
          minWidth: 128,
          renderCell: (params) => statusChip(params.value),
        },
        {
          field: 'attempt_number',
          headerName: 'Attempt',
          flex: 0.55,
          minWidth: 92,
          renderCell: (params) => params.value || '—',
        },
        {
          field: 'score',
          headerName: 'Score',
          flex: 0.72,
          minWidth: 128,
          sortable: false,
          renderCell: (params) => (
            <InlineNumberCell
              value={params.row.score}
              disabled={Boolean(params.row._saving) || !params.row.attempt_number || batchSaving}
              onCommit={(nextValue) => saveInlineEdit(params.row, 'score', nextValue)}
            />
          ),
        },
        {
          field: 'max_score',
          headerName: 'Max',
          flex: 0.72,
          minWidth: 128,
          sortable: false,
          renderCell: (params) => (
            <InlineNumberCell
              value={params.row.max_score}
              disabled={Boolean(params.row._saving) || !params.row.attempt_number || batchSaving}
              onCommit={(nextValue) => saveInlineEdit(params.row, 'max_score', nextValue)}
            />
          ),
        },
        {
          field: 'percent',
          headerName: 'Percent',
          flex: 0.7,
          minWidth: 116,
          renderCell: (params) => <Chip label={formatPercent(params.value)} size="small" variant="outlined" />,
        },
        {
          field: 'save_state',
          headerName: 'Save',
          flex: 1,
          minWidth: 190,
          sortable: false,
          filterable: false,
          renderCell: (params) => renderSaveState(params.row),
        },
      ]
    },
    [batchSaving, hasGroupedRows, saveInlineEdit],
  )

  if (!canViewAll) {
    return <Navigate to={`/course/${courseId}/grades`} replace />
  }

  return (
    <Box sx={{ py: { xs: 2, md: 3 } }}>
      <Stack spacing={2.25}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1.5}>
          <Button
            variant="text"
            startIcon={<ArrowBackRounded />}
            onClick={() => navigate(`/course/${courseId}/grades`)}
            sx={{ width: 'fit-content' }}
          >
            Back to grades
          </Button>
          <Button
            variant="outlined"
            startIcon={<DownloadRounded />}
            onClick={handleExportStudent}
            disabled={exportingStudent}
          >
            {exportingStudent ? 'Exporting...' : 'Export student CSV'}
          </Button>
        </Stack>

        <Paper
          elevation={0}
          sx={{
            p: { xs: 1.5, md: 1.75 },
            borderRadius: 2,
            border: '1px solid rgba(15, 23, 42, 0.08)',
          }}
        >
          <Stack spacing={1.1}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              justifyContent="space-between"
              alignItems={{ xs: 'flex-start', md: 'center' }}
              spacing={1}
            >
              <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: '-0.015em' }}>
                  {student?.display_name || 'Student gradebook'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {student?.email || 'No email available'}
                </Typography>
              </Stack>
              <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" justifyContent="flex-end">
                {student?.cwid ? <Chip size="small" label={`CWID ${student.cwid}`} variant="outlined" /> : null}
                <Chip size="small" label={`${rows.length} assignment${rows.length === 1 ? '' : 's'}`} variant="outlined" />
                <Chip size="small" label={`${formatNumber(totals.score)} / ${formatNumber(totals.maxScore)}`} />
                <Chip size="small" label={formatPercent(totals.percent)} color="primary" variant="outlined" />
              </Stack>
            </Stack>

            <Stack
              direction={{ xs: 'column', lg: 'row' }}
              spacing={0.75}
              alignItems={{ xs: 'stretch', lg: 'center' }}
              justifyContent="space-between"
            >
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.75} alignItems={{ xs: 'stretch', sm: 'center' }}>
                <Button
                  size="small"
                  variant={batchEditMode ? 'contained' : 'outlined'}
                  onClick={() => {
                    setBatchEditMode((prev) => !prev)
                    setBatchSummary('')
                  }}
                  disabled={loading || batchSaving}
                >
                  {batchEditMode ? 'Batch mode on' : 'Batch edit'}
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  onClick={saveAllBatchEdits}
                  disabled={dirtyCount === 0 || batchSaving}
                >
                  {batchSaving ? 'Saving all...' : `Save all (${dirtyCount})`}
                </Button>
                <Button
                  size="small"
                  variant="text"
                  onClick={discardBatchEdits}
                  disabled={dirtyCount === 0 || batchSaving}
                >
                  Discard changes
                </Button>
              </Stack>
              <Chip
                size="small"
                label={
                  batchEditMode
                    ? 'Batch: edits stay local until Save all'
                    : 'Autosave: Enter or blur saves immediately'
                }
                variant="outlined"
                color={batchEditMode ? 'warning' : 'default'}
              />
            </Stack>
          </Stack>
        </Paper>

        {batchSummary ? <Alert severity={batchSummary.includes('failed') ? 'warning' : 'success'}>{batchSummary}</Alert> : null}
        {error ? <Alert severity="error">{error}</Alert> : null}

        <Paper
          elevation={0}
          sx={{
            p: 1,
            borderRadius: 3,
            border: '1px solid rgba(15, 23, 42, 0.08)',
          }}
        >
          <Box sx={{ height: 640 }}>
            <DataGrid
              rows={rows}
              columns={columns}
              loading={loading}
              rowHeight={hasGroupedRows ? 78 : 52}
              disableRowSelectionOnClick
              pageSizeOptions={[10, 25, 50]}
              getRowClassName={(params) =>
                focusedAssignmentId && String(params.row.assignment_id) === String(focusedAssignmentId)
                  ? 'grade-focused-assignment-row'
                  : ''
              }
              sx={{
                backgroundColor: 'background.paper',
                borderRadius: 2.5,
                '& .grade-focused-assignment-row': {
                  backgroundColor: 'rgba(79, 70, 229, 0.06)',
                },
              }}
            />
          </Box>
        </Paper>
      </Stack>
    </Box>
  )
}

export default CourseStudentGrades
