import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  LinearProgress,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import {
  AddRounded,
  CheckCircleRounded,
  CloudUploadRounded,
  CodeRounded,
  DeleteRounded,
  ErrorOutlineRounded,
  InsertDriveFileRounded,
  ScheduleRounded,
  VisibilityRounded,
  DownloadRounded,
} from '@mui/icons-material'
import { useNavigate, useParams } from 'react-router-dom'
import { apiRequest, API_BASE } from '../api/client.js'
import RowActionsMenu from '../components/RowActionsMenu.jsx'
import {
  allowsUploadSubmission,
  allowsWorkspaceSubmission,
} from '../utils/assignmentSubmissionMode.js'

const MAX_LOCAL_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024
const TEXT_PREVIEW_EXTENSIONS = new Set([
  '.py', '.java', '.js', '.ts', '.jsx', '.tsx', '.json', '.md', '.txt', '.yaml', '.yml',
  '.xml', '.csv', '.sql', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.kt', '.swift',
  '.sh', '.html', '.css',
])
const DESKTOP_DIALOG_CONTENT_INSET = '292px'

const formatBytes = (bytes) => {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

const formatScoreValue = (value) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return '0'
  const rounded = Math.round(number * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, '')
}

const formatMemberPreview = (usernames, limit = 3) => {
  const list = Array.isArray(usernames) ? usernames.filter(Boolean) : []
  if (!list.length) return 'No members assigned'
  if (list.length <= limit) return list.join(', ')
  return `${list.slice(0, limit).join(', ')} +${list.length - limit} more`
}

const submissionOutcomeMeta = (statusRaw) => {
  const status = String(statusRaw || '')
  if (status === 'GRADED') {
    return { label: 'PASS', color: 'success' }
  }
  if (status === 'FAILED') {
    return { label: 'FAIL', color: 'error' }
  }
  if (status === 'RUNNING' || status === 'QUEUED') {
    return { label: status, color: 'warning' }
  }
  return { label: status || '—', color: 'default' }
}

const classRunStatusMeta = (statusRaw) => {
  const status = String(statusRaw || '')
  if (status === 'COMPLETED') return { label: 'Completed', color: 'success' }
  if (status === 'RUNNING') return { label: 'Running', color: 'warning' }
  if (status === 'QUEUED') return { label: 'Queued', color: 'info' }
  return { label: status || '—', color: 'default' }
}

const classRunOutcomeMeta = (outcomeRaw) => {
  const outcome = String(outcomeRaw || '')
  if (outcome === 'PASS') return { label: 'Pass', color: 'success' }
  if (outcome === 'FAIL') return { label: 'Fail', color: 'error' }
  if (outcome === 'INCOMPLETE') return { label: 'Incomplete', color: 'warning' }
  return { label: outcome || '—', color: 'default' }
}

const formatRunTimestamp = (value) => {
  if (!value) return 'Recent run'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recent run'
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const PROCESS_FAILURE_KINDS = new Set([
  'TIMEOUT',
  'COMPILE_ERROR',
  'RUNTIME_ERROR',
  'MISSING_ENTRYPOINT',
  'MISSING_SOURCE_FILES',
  'EXECUTION_TOOL_MISSING',
  'UNSUPPORTED_LANGUAGE',
])

const formatIdentifierLabel = (value) =>
  String(value || '')
    .split('_')
    .filter(Boolean)
    .map((segment) => segment.charAt(0) + segment.slice(1).toLowerCase())
    .join(' ')

const normalizeFeedbackResult = (entry, index) => {
  const fallbackSummary = entry?.summary || entry?.message || ''
  return {
    ...entry,
    id: entry?.id ?? `feedback-${index}`,
    test_name: entry?.test_name || entry?.name || `Check ${index + 1}`,
    status: String(entry?.status || '').toUpperCase(),
    message: entry?.message || '',
    summary: fallbackSummary,
    failure_kind: entry?.failure_kind || '',
    details: entry?.details || {},
    time_ms: entry?.time_ms ?? null,
  }
}

const mergeFeedbackResults = (detailData) => {
  const serializedResults = Array.isArray(detailData?.test_results) ? detailData.test_results : []
  const runTests = Array.isArray(detailData?.grading_run?.result_json?.tests)
    ? detailData.grading_run.result_json.tests
    : []

  if (!serializedResults.length && !runTests.length) {
    return []
  }

  const runTestsByName = new Map()
  runTests.forEach((entry) => {
    const name = String(entry?.name || '')
    if (!runTestsByName.has(name)) {
      runTestsByName.set(name, [])
    }
    runTestsByName.get(name).push(entry)
  })

  if (serializedResults.length) {
    return serializedResults.map((row, index) => {
      let runEntry = null
      if (index < runTests.length && String(runTests[index]?.name || '') === String(row?.test_name || '')) {
        runEntry = runTests[index]
      } else {
        const bucket = runTestsByName.get(String(row?.test_name || ''))
        if (bucket?.length) {
          runEntry = bucket.shift()
        }
      }

      return normalizeFeedbackResult(
        {
          ...runEntry,
          ...row,
          test_name: row?.test_name || runEntry?.name,
          message: row?.message || runEntry?.message || '',
          summary: row?.summary || runEntry?.summary || row?.message || runEntry?.message || '',
          failure_kind: row?.failure_kind || runEntry?.failure_kind || '',
          details: row?.details || runEntry?.details || {},
          time_ms: row?.time_ms ?? runEntry?.time_ms ?? null,
        },
        index,
      )
    })
  }

  return runTests.map(
    (entry, index) =>
      normalizeFeedbackResult(
        {
          ...entry,
          test_name: entry?.name,
        },
        index,
      ),
  )
}

const feedbackStatusMeta = (result) => {
  if (result?.status === 'PASS') {
    return { label: 'Passed', color: 'success', severity: 'success' }
  }
  if (PROCESS_FAILURE_KINDS.has(result?.failure_kind || '')) {
    return { label: 'Did not complete', color: 'warning', severity: 'warning' }
  }
  return { label: 'Failed', color: 'error', severity: 'error' }
}

const feedbackSortValue = (result) => {
  if (PROCESS_FAILURE_KINDS.has(result?.failure_kind || '')) return 0
  if (result?.status !== 'PASS') return 1
  return 2
}

const sortFeedbackResults = (results) =>
  [...results].sort((left, right) => feedbackSortValue(left) - feedbackSortValue(right))

const feedbackListHint = (result) => {
  if (!result) return ''
  if (result.status === 'PASS') {
    return 'Completed successfully'
  }
  const details = result.details || {}
  const target = result.details?.target
  const hasExitMismatch = details.expected_exit_code != null
    && details.actual_exit_code != null
    && String(details.expected_exit_code) !== String(details.actual_exit_code)
  if (hasExitMismatch) {
    return target ? `Exit code mismatch • ${target}` : 'Exit code mismatch'
  }
  if (result.failure_kind === 'TIMEOUT' && result.details?.timeout_ms) {
    return `Timed out after ${result.details.timeout_ms} ms`
  }
  if (result.failure_kind === 'COMPILE_ERROR') {
    return 'Compile error'
  }
  if (result.failure_kind === 'RUNTIME_ERROR') {
    return 'Runtime error'
  }
  if (result.failure_kind === 'MISSING_OUTPUT_FILE' && target) {
    return `Missing ${target}`
  }
  if (result.failure_kind === 'OUTPUT_MISMATCH' && target) {
    return `Output mismatch • ${target}`
  }
  if (target) {
    return `Target: ${target}`
  }
  if (result.failure_kind) {
    return formatIdentifierLabel(result.failure_kind)
  }
  return result.summary || result.message || 'Review this check for more detail.'
}

const feedbackDetailMessage = (result) => {
  if (!result) return ''
  if (result.status === 'PASS') {
    return 'This check completed successfully. No action is needed.'
  }
  return result.summary || result.message || 'This check did not pass.'
}

const extractApiErrorMessage = (err, fallback) => {
  const payload = err?.payload
  if (payload && typeof payload === 'object') {
    const queue = [payload]
    while (queue.length) {
      const current = queue.shift()
      if (Array.isArray(current)) {
        const firstText = current.find((entry) => typeof entry === 'string' && entry.trim())
        if (firstText) return firstText
        current.forEach((entry) => {
          if (entry && typeof entry === 'object') queue.push(entry)
        })
        continue
      }
      if (!current || typeof current !== 'object') continue
      for (const value of Object.values(current)) {
        if (typeof value === 'string' && value.trim()) return value
        if (Array.isArray(value) || (value && typeof value === 'object')) queue.push(value)
      }
    }
  }
  return err?.message || fallback
}

const buildRubricDraft = (rubric) => {
  if (!rubric?.available) return null
  return {
    version_id: rubric.version_id || '',
    version_number: rubric.version_number || 0,
    is_weighted: Boolean(rubric.is_weighted),
    total_points: Number(rubric.total_points || 0),
    total_weight: Number(rubric.total_weight || 0),
    computed_max_score: Number(rubric.computed_max_score || 0),
    criteria: Array.isArray(rubric.criteria)
      ? rubric.criteria.map((criterion) => ({
          criterion_id: String(criterion.criterion_id || ''),
          name: criterion.name || '',
          max_points: Number(criterion.max_points || 0),
          weight: criterion.weight == null || criterion.weight === '' ? '' : String(criterion.weight),
          points_awarded: criterion.points_awarded == null || criterion.points_awarded === '' ? '0' : String(criterion.points_awarded),
          comment: criterion.comment || '',
          order_index: Number(criterion.order_index || 0),
        }))
      : [],
  }
}

const serializeRubricDraft = (draft) =>
  JSON.stringify({
    version_id: draft?.version_id || '',
    criteria: (draft?.criteria || []).map((criterion) => ({
      criterion_id: criterion.criterion_id,
      points_awarded: String(criterion.points_awarded ?? ''),
      comment: criterion.comment || '',
    })),
  })

const computeRubricDraftSummary = (draft) => {
  if (!draft?.criteria?.length) {
    return { score: 0, maxScore: 0 }
  }

  const totalPoints = draft.criteria.reduce((sum, criterion) => {
    const maxPoints = Number(criterion.max_points)
    return sum + (Number.isFinite(maxPoints) ? maxPoints : 0)
  }, 0)
  const maxScoreBase = Number(draft.computed_max_score || 0)

  if (draft.is_weighted) {
    const totalWeight = draft.criteria.reduce((sum, criterion) => {
      const weight = Number(criterion.weight)
      return sum + (Number.isFinite(weight) ? weight : 0)
    }, 0)
    if (totalWeight <= 0 || maxScoreBase <= 0) {
      return { score: 0, maxScore: maxScoreBase > 0 ? maxScoreBase : 0 }
    }
    const weightedRatio = draft.criteria.reduce((sum, criterion) => {
      const weight = Number(criterion.weight)
      const maxPoints = Number(criterion.max_points)
      const awarded = Number(criterion.points_awarded)
      if (!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(maxPoints) || maxPoints <= 0) {
        return sum
      }
      const boundedAwarded = Math.min(Math.max(Number.isFinite(awarded) ? awarded : 0, 0), maxPoints)
      return sum + (boundedAwarded / maxPoints) * (weight / totalWeight)
    }, 0)
    return {
      score: Math.round(weightedRatio * maxScoreBase * 100) / 100,
      maxScore: maxScoreBase,
    }
  }

  if (totalPoints <= 0) {
    return { score: 0, maxScore: maxScoreBase > 0 ? maxScoreBase : 0 }
  }
  const awardedTotal = draft.criteria.reduce((sum, criterion) => {
    const maxPoints = Number(criterion.max_points)
    const awarded = Number(criterion.points_awarded)
    if (!Number.isFinite(maxPoints) || maxPoints <= 0) return sum
    const boundedAwarded = Math.min(Math.max(Number.isFinite(awarded) ? awarded : 0, 0), maxPoints)
    return sum + boundedAwarded
  }, 0)
  const maxScore = maxScoreBase > 0 ? maxScoreBase : totalPoints
  return {
    score: Math.round((awardedTotal / totalPoints) * maxScore * 100) / 100,
    maxScore,
  }
}

const buildFeedbackSummary = (results) => {
  const total = results.length
  const passed = results.filter((result) => result.status === 'PASS').length
  const incomplete = results.filter((result) => PROCESS_FAILURE_KINDS.has(result.failure_kind || '')).length
  const failed = total - passed - incomplete

  if (!total) {
    return {
      severity: 'info',
      title: 'No verification details available',
      description: 'This submission does not have structured check results yet.',
      passed,
      failed,
      incomplete,
      total,
    }
  }

  if (incomplete > 0) {
    return {
      severity: 'warning',
      title: incomplete === 1 ? 'One check did not complete' : `${incomplete} checks did not complete`,
      description: `${passed}/${total} checks passed. Review the selected check for the execution failure.`,
      passed,
      failed,
      incomplete,
      total,
    }
  }

  if (failed > 0) {
    return {
      severity: 'error',
      title: failed === 1 ? 'One check failed' : `${failed} checks failed`,
      description: `${passed}/${total} checks passed. Review the selected check for the mismatch details.`,
      passed,
      failed,
      incomplete,
      total,
    }
  }

  return {
    severity: 'success',
    title: 'All checks passed',
    description: `${passed}/${total} checks passed successfully.`,
    passed,
    failed,
    incomplete,
    total,
  }
}

const cleanSubmissionEntryName = (name) =>
  String(name || '')
    .split('/')
    .map((segment) => segment.replace(/^[0-9a-f]{32}_/i, ''))
    .join('/')

const mergeFiles = (existing, incoming) => {
  const next = [...existing]
  const seen = new Set(existing.map((file) => `${file.name}:${file.size}:${file.lastModified}`))
  incoming.forEach((file) => {
    const key = `${file.name}:${file.size}:${file.lastModified}`
    if (!seen.has(key)) {
      seen.add(key)
      next.push(file)
    }
  })
  return next
}

const fileKey = (file) => `${file.name}:${file.size}:${file.lastModified}`

const extensionOf = (name) => {
  const dotIndex = String(name || '').lastIndexOf('.')
  if (dotIndex < 0) return ''
  return String(name || '').slice(dotIndex).toLowerCase()
}

const submissionGroupKey = (entry, fallbackAssignmentId = '') => {
  const assignmentId = String(entry?.assignment_uuid || entry?.assignment_id || fallbackAssignmentId || '')
  const groupId = String(entry?.group || entry?.group_id || '')
  if (groupId) {
    return `${assignmentId}:group:${groupId}`
  }
  const submitterId = String(entry?.submitted_by || '')
  return `${assignmentId}:user:${submitterId}`
}

const submissionRecencyValue = (entry) => {
  const attemptNumber = Number(entry?.attempt_number || 0)
  const submittedAt = new Date(entry?.submitted_at || 0).getTime()
  return {
    attemptNumber,
    submittedAt: Number.isNaN(submittedAt) ? 0 : submittedAt,
  }
}

const compareSubmissionsNewestFirst = (left, right) => {
  const leftMeta = submissionRecencyValue(left)
  const rightMeta = submissionRecencyValue(right)
  if (leftMeta.attemptNumber !== rightMeta.attemptNumber) {
    return rightMeta.attemptNumber - leftMeta.attemptNumber
  }
  if (leftMeta.submittedAt !== rightMeta.submittedAt) {
    return rightMeta.submittedAt - leftMeta.submittedAt
  }
  return String(right?.id || '').localeCompare(String(left?.id || ''))
}

const detectLocalPreviewMode = (file) => {
  const type = String(file?.type || '').toLowerCase()
  const ext = extensionOf(file?.name)
  if (type.startsWith('image/')) return 'image'
  if (type === 'application/pdf' || ext === '.pdf') return 'pdf'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  if (type.startsWith('text/') || type.includes('json') || TEXT_PREVIEW_EXTENSIONS.has(ext)) {
    return 'text'
  }
  return 'embed'
}

function CourseSubmissions({
  user,
  fixedAssignmentId = '',
  assignmentTitle = '',
  assignment = null,
  embedded = false,
}) {
  const { courseId } = useParams()
  const navigate = useNavigate()
  const isAssignmentScoped = Boolean(fixedAssignmentId)
  const [rows, setRows] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [assignmentId, setAssignmentId] = useState('')
  const [files, setFiles] = useState([])
  const [uploadGroupOptions, setUploadGroupOptions] = useState([])
  const [uploadGroupId, setUploadGroupId] = useState('')
  const [uploadGroupLoading, setUploadGroupLoading] = useState(false)
  const [uploadGroupError, setUploadGroupError] = useState('')
  const [uploadGroupNotice, setUploadGroupNotice] = useState('')
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [previewFileKey, setPreviewFileKey] = useState('')
  const [previewFileName, setPreviewFileName] = useState('')
  const [previewMode, setPreviewMode] = useState('none')
  const [previewTextContent, setPreviewTextContent] = useState('')
  const [previewObjectUrl, setPreviewObjectUrl] = useState('')
  const [previewTruncated, setPreviewTruncated] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [detailData, setDetailData] = useState(null)
  const [gradingDialogOpen, setGradingDialogOpen] = useState(false)
  const [selectedFeedbackIndex, setSelectedFeedbackIndex] = useState(0)
  const [submissionManifest, setSubmissionManifest] = useState(null)
  const [submissionManifestLoading, setSubmissionManifestLoading] = useState(false)
  const [submissionManifestError, setSubmissionManifestError] = useState('')
  const [submittedPreviewFileName, setSubmittedPreviewFileName] = useState('')
  const [submittedPreviewMode, setSubmittedPreviewMode] = useState('none')
  const [submittedPreviewTextContent, setSubmittedPreviewTextContent] = useState('')
  const [submittedPreviewObjectUrl, setSubmittedPreviewObjectUrl] = useState('')
  const [submittedPreviewTruncated, setSubmittedPreviewTruncated] = useState(false)
  const [submittedPreviewLoading, setSubmittedPreviewLoading] = useState(false)
  const [submittedPreviewError, setSubmittedPreviewError] = useState('')
  const [submittedPreviewMime, setSubmittedPreviewMime] = useState('')
  const [reviewFeedback, setReviewFeedback] = useState('')
  const [reviewFeedbackSaving, setReviewFeedbackSaving] = useState(false)
  const [reviewFeedbackError, setReviewFeedbackError] = useState('')
  const [rubricDraft, setRubricDraft] = useState(null)
  const [rubricSaving, setRubricSaving] = useState(false)
  const [rubricError, setRubricError] = useState('')
  const [rerunSubmissionId, setRerunSubmissionId] = useState('')
  const [classRuns, setClassRuns] = useState([])
  const [classRunsLoading, setClassRunsLoading] = useState(false)
  const [classRunsError, setClassRunsError] = useState('')
  const [classRunStarting, setClassRunStarting] = useState(false)
  const [selectedClassRunId, setSelectedClassRunId] = useState('')
  const [classRunFocusView, setClassRunFocusView] = useState('datasets')
  const [classRunPanelOpen, setClassRunPanelOpen] = useState(false)
  const [classRunDetail, setClassRunDetail] = useState(null)
  const [classRunDetailLoading, setClassRunDetailLoading] = useState(false)
  const [classRunDetailError, setClassRunDetailError] = useState('')
  const fileInputRef = useRef(null)
  const contentCenteredDialogSx = {
    '& .MuiBackdrop-root': {
      left: { md: DESKTOP_DIALOG_CONTENT_INSET },
      width: { md: `calc(100% - ${DESKTOP_DIALOG_CONTENT_INSET})` },
    },
    '& .MuiDialog-container': {
      pl: { md: DESKTOP_DIALOG_CONTENT_INSET },
      boxSizing: 'border-box',
    },
  }

  const canSubmit = Boolean(user && !user?.is_grader)
  const canViewAllByRole = Boolean(user?.is_superuser || user?.is_instructor || user?.is_ta || user?.is_grader)
  const canViewAllByData = rows.some(
    (row) =>
      !row?.group &&
      Object.prototype.hasOwnProperty.call(row, 'submitted_by') &&
      user?.id != null &&
      Number(row.submitted_by) !== Number(user.id),
  )
  const canViewAll = canViewAllByRole || canViewAllByData
  const canViewClassRuns = Boolean(canViewAll && isAssignmentScoped)
  const canStartClassRun = Boolean((user?.is_superuser || user?.is_instructor || user?.is_ta) && isAssignmentScoped)
  const tableRows = useMemo(() => {
    const sortedRows = [...rows].sort(compareSubmissionsNewestFirst)
    const seen = new Set()
    return sortedRows.filter((row) => {
      const key = submissionGroupKey(row, fixedAssignmentId)
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
  }, [fixedAssignmentId, rows])
  const attemptHistoryByGroup = useMemo(() => {
    const sortedRows = [...rows].sort(compareSubmissionsNewestFirst)
    const groups = new Map()
    sortedRows.forEach((row) => {
      const key = submissionGroupKey(row, fixedAssignmentId)
      const bucket = groups.get(key) || []
      bucket.push(row)
      groups.set(key, bucket)
    })
    return groups
  }, [fixedAssignmentId, rows])
  const selectedAttemptHistory = useMemo(() => {
    if (!detailData?.submission) return []
    const key = submissionGroupKey(
      {
        assignment_uuid: detailData.submission.assignment_uuid,
        group: detailData.submission.group,
        submitted_by: detailData.submission.submitted_by,
      },
      fixedAssignmentId,
    )
    return attemptHistoryByGroup.get(key) || []
  }, [
    attemptHistoryByGroup,
    detailData?.submission,
    fixedAssignmentId,
  ])
  const feedbackResults = useMemo(() => sortFeedbackResults(mergeFeedbackResults(detailData)), [detailData])
  const feedbackSummary = useMemo(() => buildFeedbackSummary(feedbackResults), [feedbackResults])
  const reviewFeedbackDirty = useMemo(
    () => reviewFeedback !== (detailData?.grade?.feedback || ''),
    [detailData?.grade?.feedback, reviewFeedback],
  )
  const selectedAssignment = useMemo(() => {
    if (isAssignmentScoped) return assignment
    return assignments.find((item) => String(item.id) === String(assignmentId || '')) || null
  }, [assignment, assignmentId, assignments, isAssignmentScoped])
  const uploadEligibleAssignments = useMemo(
    () => assignments.filter((item) => allowsUploadSubmission(item)),
    [assignments],
  )
  const canUploadSelectedAssignment = allowsUploadSubmission(selectedAssignment)
  const canWorkspaceSelectedAssignment = allowsWorkspaceSubmission(selectedAssignment)
  const activeUploadAssignmentId = isAssignmentScoped ? fixedAssignmentId : assignmentId
  const uploadRequiresGroup = Boolean(selectedAssignment?.allow_groups)
  const uploadHasMultipleGroupChoices = uploadGroupOptions.length > 1
  const selectedUploadGroup = useMemo(
    () => uploadGroupOptions.find((group) => String(group.id) === String(uploadGroupId || '')) || null,
    [uploadGroupId, uploadGroupOptions],
  )
  const selectedUploadGroupMemberPreview = useMemo(
    () => formatMemberPreview(selectedUploadGroup?.member_usernames || [], 4),
    [selectedUploadGroup],
  )
  const loadedRubricDraft = useMemo(() => buildRubricDraft(detailData?.rubric), [detailData?.rubric])
  const rubricDraftDirty = useMemo(
    () => serializeRubricDraft(rubricDraft) !== serializeRubricDraft(loadedRubricDraft),
    [loadedRubricDraft, rubricDraft],
  )
  const rubricSummary = useMemo(() => computeRubricDraftSummary(rubricDraft), [rubricDraft])
  const attentionFeedbackResults = useMemo(
    () => feedbackResults.filter((result) => result.status !== 'PASS'),
    [feedbackResults],
  )
  const passedFeedbackResults = useMemo(
    () => feedbackResults.filter((result) => result.status === 'PASS'),
    [feedbackResults],
  )
  const selectedFeedback = feedbackResults[selectedFeedbackIndex] || null
  const activeClassRun = useMemo(
    () => classRuns.find((run) => ['QUEUED', 'RUNNING'].includes(String(run.status || '').toUpperCase())) || null,
    [classRuns],
  )
  const latestClassRun = useMemo(() => classRuns[0] || null, [classRuns])
  const classRunItemRows = useMemo(() => Array.isArray(classRunDetail?.items) ? classRunDetail.items : [], [classRunDetail])
  const classRunTestRows = useMemo(() => Array.isArray(classRunDetail?.tests) ? classRunDetail.tests : [], [classRunDetail])
  const classRunSummaryStats = useMemo(() => {
    const run = classRunDetail?.run
    if (!run) return []
    return [
      {
        key: 'pass',
        label: 'Passed',
        value: run.pass_count ?? 0,
        helper: `${run.completed_items ?? 0} completed`,
        color: 'success.main',
      },
      {
        key: 'review',
        label: 'Needs review',
        value: (run.fail_count ?? 0) + (run.incomplete_count ?? 0),
        helper: `${run.fail_count ?? 0} fail • ${run.incomplete_count ?? 0} incomplete`,
        color: 'warning.main',
      },
      {
        key: 'missing',
        label: 'Missing',
        value: run.missing_submissions ?? 0,
        helper: `${run.total_students ?? 0} enrolled`,
        color: 'text.primary',
      },
    ]
  }, [classRunDetail])
  const canEditSelectedSubmissionGrade = Boolean(detailData?.permissions?.can_edit_grade)
  const currentGradeLabel = detailData?.grade
    ? `${formatScoreValue(detailData.grade.score)}/${formatScoreValue(detailData.grade.max_score)}`
    : 'Not graded'

  useEffect(() => {
    setRubricDraft(loadedRubricDraft)
    setRubricSaving(false)
    setRubricError('')
  }, [loadedRubricDraft, detailData?.submission?.id])

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const submissionQuery = isAssignmentScoped
        ? `/api/submissions/?assignment_id=${fixedAssignmentId}`
        : `/api/submissions/?course_id=${courseId}`
      const requests = [apiRequest(submissionQuery)]
      if (!isAssignmentScoped) {
        requests.push(apiRequest(`/api/assignments/?course_id=${courseId}`))
      }
      const [submissionData, assignmentData] = await Promise.all(requests)
      setRows(Array.isArray(submissionData) ? submissionData : [])
      setAssignments(Array.isArray(assignmentData) ? assignmentData : [])
    } catch (err) {
      setError(err.message || 'Unable to load submissions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [courseId, fixedAssignmentId, isAssignmentScoped])

  useEffect(() => {
    if (!dialogOpen || !activeUploadAssignmentId || !selectedAssignment?.allow_groups) {
      setUploadGroupOptions([])
      setUploadGroupId('')
      setUploadGroupLoading(false)
      setUploadGroupError('')
      setUploadGroupNotice('')
      return
    }

    let active = true
    const loadSubmissionGroups = async () => {
      setUploadGroupLoading(true)
      setUploadGroupError('')
      setUploadGroupNotice('')
      try {
        const data = await apiRequest(`/api/assignments/${activeUploadAssignmentId}/submission-groups/`)
        if (!active) return
        const groups = Array.isArray(data?.groups) ? data.groups : []
        setUploadGroupOptions(groups)
        setUploadGroupId((current) => {
          if (current && groups.some((group) => String(group.id) === String(current))) {
            return current
          }
          return groups.length === 1 ? String(groups[0].id) : ''
        })
        if (data?.reason) {
          setUploadGroupError(data.reason)
        } else if (!groups.length) {
          setUploadGroupError('You are not assigned to a valid group for this assignment yet.')
        } else if (groups.length === 1) {
          setUploadGroupNotice(`Submitting for ${groups[0].name}.`)
        } else {
          setUploadGroupNotice('Choose which group this submission belongs to.')
        }
      } catch (err) {
        if (!active) return
        setUploadGroupOptions([])
        setUploadGroupId('')
        setUploadGroupError(err.message || 'Unable to load your groups for this assignment')
        setUploadGroupNotice('')
      } finally {
        if (active) {
          setUploadGroupLoading(false)
        }
      }
    }

    loadSubmissionGroups()
    return () => {
      active = false
    }
  }, [
    activeUploadAssignmentId,
    dialogOpen,
    selectedAssignment?.allow_groups,
  ])

  const loadClassRuns = async (preferredRunId = '') => {
    if (!canViewClassRuns || !fixedAssignmentId) {
      setClassRuns([])
      setSelectedClassRunId('')
      setClassRunDetail(null)
      return
    }
    setClassRunsLoading(true)
    setClassRunsError('')
    try {
      const data = await apiRequest(`/api/assignments/${fixedAssignmentId}/class-runs/`)
      const rows = Array.isArray(data) ? data : []
      setClassRuns(rows)
      const nextSelectedId =
        preferredRunId ||
        (rows.some((row) => row.id === selectedClassRunId) ? selectedClassRunId : '') ||
        rows[0]?.id ||
        ''
      setSelectedClassRunId(nextSelectedId)
      if (!rows.length) {
        setClassRunDetail(null)
      }
    } catch (err) {
      setClassRuns([])
      setClassRunsError(err.message || 'Unable to load class execution runs')
    } finally {
      setClassRunsLoading(false)
    }
  }

  useEffect(() => {
    loadClassRuns()
  }, [canViewClassRuns, fixedAssignmentId])

  useEffect(() => {
    if (!canViewClassRuns || !fixedAssignmentId || !selectedClassRunId) {
      setClassRunDetail(null)
      setClassRunDetailError('')
      return
    }

    let active = true
    const run = async () => {
      setClassRunDetailLoading(true)
      setClassRunDetailError('')
      try {
        const data = await apiRequest(`/api/assignments/${fixedAssignmentId}/class-runs/${selectedClassRunId}/`)
        if (!active) return
        setClassRunDetail(data)
      } catch (err) {
        if (!active) return
        setClassRunDetail(null)
        setClassRunDetailError(err.message || 'Unable to load class execution detail')
      } finally {
        if (active) {
          setClassRunDetailLoading(false)
        }
      }
    }
    run()
    return () => {
      active = false
    }
  }, [canViewClassRuns, fixedAssignmentId, selectedClassRunId])

  useEffect(() => {
    if (isAssignmentScoped) {
      setAssignmentId(fixedAssignmentId)
    }
  }, [fixedAssignmentId, isAssignmentScoped])

  const handleStartClassRun = async () => {
    if (!fixedAssignmentId) return
    setClassRunPanelOpen(true)
    setClassRunStarting(true)
    setClassRunsError('')
    try {
      const data = await apiRequest(`/api/assignments/${fixedAssignmentId}/class-runs/`, {
        method: 'POST',
        body: {},
      })
      const runId = data?.run?.id || ''
      await loadClassRuns(runId)
      await loadData()
    } catch (err) {
      setClassRunsError(err.message || 'Unable to start class execution run')
    } finally {
      setClassRunStarting(false)
    }
  }

  const openSubmissionPage = (submissionId, options = {}) => {
    const targetAssignmentId =
      options.assignmentId || fixedAssignmentId || detailData?.submission?.assignment_uuid || assignmentId
    if (!targetAssignmentId || !submissionId) return
    const search = options.focus === 'grading' ? '?focus=grading' : ''
    navigate(`/course/${courseId}/assignments/${targetAssignmentId}/submissions/${submissionId}${search}`)
  }

  const resetPreview = () => {
    if (previewObjectUrl) {
      window.URL.revokeObjectURL(previewObjectUrl)
    }
    setPreviewFileKey('')
    setPreviewFileName('')
    setPreviewMode('none')
    setPreviewTextContent('')
    setPreviewObjectUrl('')
    setPreviewTruncated(false)
    setPreviewLoading(false)
    setPreviewError('')
  }

  const closeUploadDialog = () => {
    setDialogOpen(false)
    setFiles([])
    setUploadGroupOptions([])
    setUploadGroupId('')
    setUploadGroupLoading(false)
    setUploadGroupError('')
    setUploadGroupNotice('')
    setIsDraggingFiles(false)
    resetPreview()
  }

  const openUpload = () => {
    setAssignmentId(isAssignmentScoped ? fixedAssignmentId : (uploadEligibleAssignments[0]?.id || ''))
    setFiles([])
    setUploadGroupOptions([])
    setUploadGroupId('')
    setUploadGroupLoading(false)
    setUploadGroupError('')
    setUploadGroupNotice('')
    setIsDraggingFiles(false)
    resetPreview()
    setDialogOpen(true)
  }

  const openWorkspace = () => {
    const targetAssignmentId = isAssignmentScoped ? fixedAssignmentId : selectedAssignment?.id
    if (!targetAssignmentId) return
    navigate(`/course/${courseId}/assignments/${targetAssignmentId}/workspace`)
  }

  const loadSubmissionDetails = async (
    submissionId,
    { openDetailDialog = false, openGradingDialog = false, loadManifest = true } = {},
  ) => {
    setDetailOpen(openDetailDialog)
    setDetailLoading(true)
    setDetailError('')
    setDetailData(null)
    setGradingDialogOpen(openGradingDialog)
    setSubmissionManifest(null)
    setSubmissionManifestLoading(false)
    setSubmissionManifestError('')
    if (submittedPreviewObjectUrl) {
      window.URL.revokeObjectURL(submittedPreviewObjectUrl)
    }
    setSubmittedPreviewFileName('')
    setSubmittedPreviewMode('none')
    setSubmittedPreviewTextContent('')
    setSubmittedPreviewObjectUrl('')
    setSubmittedPreviewTruncated(false)
    setSubmittedPreviewLoading(false)
    setSubmittedPreviewError('')
    setSubmittedPreviewMime('')
    setReviewFeedback('')
    setReviewFeedbackSaving(false)
    setReviewFeedbackError('')
    setRubricDraft(null)
    setRubricSaving(false)
    setRubricError('')
    try {
      const data = await apiRequest(`/api/submissions/${submissionId}/details/`)
      setDetailData(data)
      setReviewFeedback(data?.grade?.feedback || '')
      setReviewFeedbackError('')
      const initialFeedback = sortFeedbackResults(mergeFeedbackResults(data))
      const firstFailedIndex = initialFeedback.findIndex((entry) => entry.status !== 'PASS')
      setSelectedFeedbackIndex(firstFailedIndex >= 0 ? firstFailedIndex : 0)
      if (loadManifest) {
        setSubmissionManifestLoading(true)
        try {
          const manifestData = await apiRequest(`/api/submissions/${submissionId}/manifest/`)
          setSubmissionManifest(manifestData)
        } catch (manifestErr) {
          setSubmissionManifest(null)
          setSubmissionManifestError(manifestErr.message || 'Unable to load submitted files')
        } finally {
          setSubmissionManifestLoading(false)
        }
      }
    } catch (err) {
      setDetailError(err.message || 'Unable to load details')
    } finally {
      setDetailLoading(false)
    }
  }

  const openDetails = async (submissionId, options = {}) =>
    openSubmissionPage(submissionId, {
      assignmentId: options.assignmentId,
    })

  const openGradingForSubmission = async (submissionId, options = {}) =>
    openSubmissionPage(submissionId, {
      assignmentId: options.assignmentId,
      focus: 'grading',
    })

  const handleRerunSubmission = async (submissionId, options = {}) => {
    if (!submissionId) return
    setRerunSubmissionId(submissionId)
    if (options.fromDetail) {
      setDetailError('')
    } else {
      setError('')
    }
    try {
      await apiRequest(`/api/submissions/${submissionId}/rerun/`, {
        method: 'POST',
      })
      await loadData()
      if (detailOpen && detailData?.submission?.id === submissionId) {
        await openDetails(submissionId)
      }
    } catch (err) {
      if (options.fromDetail) {
        setDetailError(err.message || 'Unable to queue rerun')
      } else {
        setError(err.message || 'Unable to queue rerun')
      }
    } finally {
      setRerunSubmissionId('')
    }
  }

  const openSubmittedFilePreview = async (fileName) => {
    const submissionId = detailData?.submission?.id
    if (!submissionId || !fileName) return
    if (submittedPreviewObjectUrl) {
      window.URL.revokeObjectURL(submittedPreviewObjectUrl)
      setSubmittedPreviewObjectUrl('')
    }
    setSubmittedPreviewFileName(fileName)
    setSubmittedPreviewLoading(true)
    setSubmittedPreviewError('')
    setSubmittedPreviewTextContent('')
    setSubmittedPreviewTruncated(false)
    setSubmittedPreviewMode('none')
    setSubmittedPreviewMime('')
    try {
      const data = await apiRequest(
        `/api/submissions/${submissionId}/file/?name=${encodeURIComponent(fileName)}`,
      )
      setSubmittedPreviewFileName(data.name || fileName)
      setSubmittedPreviewTruncated(Boolean(data.truncated))
      const encoding = String(data.encoding || '').toLowerCase()
      const mimeType = data.mime_type || 'application/octet-stream'
      setSubmittedPreviewMime(mimeType)
      if (encoding === 'base64') {
        const binary = window.atob(data.content || '')
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index)
        }
        const blob = new Blob([bytes], { type: mimeType })
        const objectUrl = window.URL.createObjectURL(blob)
        setSubmittedPreviewObjectUrl(objectUrl)
        setSubmittedPreviewMode('binary')
      } else {
        setSubmittedPreviewTextContent(data.content || '')
        setSubmittedPreviewMode('text')
      }
    } catch (err) {
      setSubmittedPreviewError(err.message || 'Unable to load submitted file preview')
      setSubmittedPreviewMode('none')
    } finally {
      setSubmittedPreviewLoading(false)
    }
  }

  const closeDetailDialog = () => {
    if (submittedPreviewObjectUrl) {
      window.URL.revokeObjectURL(submittedPreviewObjectUrl)
    }
    setDetailOpen(false)
    setGradingDialogOpen(false)
    setDetailData(null)
    setSelectedFeedbackIndex(0)
    setDetailError('')
    setSubmissionManifest(null)
    setSubmissionManifestLoading(false)
    setSubmissionManifestError('')
    setSubmittedPreviewFileName('')
    setSubmittedPreviewMode('none')
    setSubmittedPreviewTextContent('')
    setSubmittedPreviewObjectUrl('')
    setSubmittedPreviewTruncated(false)
    setSubmittedPreviewLoading(false)
    setSubmittedPreviewError('')
    setSubmittedPreviewMime('')
    setReviewFeedback('')
    setReviewFeedbackSaving(false)
    setReviewFeedbackError('')
    setRubricDraft(null)
    setRubricSaving(false)
    setRubricError('')
  }

  const saveReviewFeedback = async () => {
    const submissionId = detailData?.submission?.id
    if (!submissionId) return
    const scoreNumber = detailData?.grade?.score != null ? Number(detailData.grade.score) : 0
    if (!Number.isFinite(scoreNumber) || scoreNumber < 0) {
      setReviewFeedbackError('Current score is invalid. Set a grade first.')
      return
    }
    setReviewFeedbackSaving(true)
    setReviewFeedbackError('')
    try {
      const data = await apiRequest(`/api/submissions/${submissionId}/grade/`, {
        method: 'POST',
        body: {
          score: scoreNumber,
          feedback: reviewFeedback,
        },
      })
      setDetailData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          submission: {
            ...prev.submission,
            status: data.status || prev.submission?.status,
          },
          grade: {
            ...(prev.grade || {}),
            score: data.score,
            max_score: data.max_score,
            feedback: data.feedback ?? '',
          },
        }
      })
      setReviewFeedback(data.feedback ?? '')
      await loadData()
    } catch (err) {
      setReviewFeedbackError(err.message || 'Unable to save feedback')
    } finally {
      setReviewFeedbackSaving(false)
    }
  }

  const updateRubricCriterion = (criterionId, field, value) => {
    setRubricDraft((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        criteria: prev.criteria.map((criterion) =>
          criterion.criterion_id === criterionId
            ? { ...criterion, [field]: value }
            : criterion
        ),
      }
    })
  }

  const saveRubricGrade = async () => {
    const submissionId = detailData?.submission?.id
    if (!submissionId || !rubricDraft?.version_id) return
    setRubricSaving(true)
    setRubricError('')
    try {
      const payload = {
        rubric_version_id: rubricDraft.version_id,
        criteria: rubricDraft.criteria.map((criterion) => ({
          criterion_id: criterion.criterion_id,
          points_awarded: Number(criterion.points_awarded) || 0,
          comment: criterion.comment || '',
        })),
      }
      const data = await apiRequest(`/api/submissions/${submissionId}/rubric-grade/`, {
        method: 'POST',
        body: payload,
      })
      setDetailData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          rubric: data.rubric,
          grade: {
            ...(prev.grade || {}),
            score: data.grade?.score ?? prev.grade?.score ?? 0,
            max_score: data.grade?.max_score ?? prev.grade?.max_score ?? 0,
            feedback: data.grade?.feedback ?? prev.grade?.feedback ?? '',
          },
        }
      })
      setRubricDraft(buildRubricDraft(data.rubric))
      await loadData()
    } catch (err) {
      setRubricError(extractApiErrorMessage(err, 'Unable to save rubric grade'))
    } finally {
      setRubricSaving(false)
    }
  }

  const closeGradingDialog = () => {
    setGradingDialogOpen(false)
  }

  const handleUpload = async (event) => {
    event.preventDefault()
    const targetAssignmentId = activeUploadAssignmentId
    if (!targetAssignmentId || files.length === 0) return
    if (!canUploadSelectedAssignment) {
      setError('This assignment accepts submissions through the workspace editor only.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('assignment_id', targetAssignmentId)
      if (uploadRequiresGroup) {
        if (!uploadGroupId) {
          throw new Error(uploadGroupError || 'Choose a group before uploading.')
        }
        formData.append('group_id', uploadGroupId)
      }
      if (files.length === 1) {
        const selectedFile = files[0]
        if (/\.zip$/i.test(selectedFile?.name || '')) {
          formData.append('file', selectedFile)
        } else {
          formData.append('files', selectedFile)
        }
      } else {
        files.forEach((selectedFile) => formData.append('files', selectedFile))
      }
      await apiRequest('/api/submissions/', {
        method: 'POST',
        body: formData,
      })
      closeUploadDialog()
      await loadData()
    } catch (err) {
      setError(err.message || 'Unable to upload submission')
    } finally {
      setSaving(false)
    }
  }

  const openLocalPreview = async (selectedFile) => {
    if (!selectedFile) return
    if (previewObjectUrl) {
      window.URL.revokeObjectURL(previewObjectUrl)
      setPreviewObjectUrl('')
    }
    setPreviewFileKey(fileKey(selectedFile))
    setPreviewFileName(selectedFile.name || 'file')
    setPreviewLoading(true)
    setPreviewError('')
    setPreviewTextContent('')
    setPreviewTruncated(false)
    setPreviewMode('none')
    try {
      const mode = detectLocalPreviewMode(selectedFile)
      if (mode === 'text') {
        const truncated = (selectedFile.size || 0) > MAX_LOCAL_TEXT_PREVIEW_BYTES
        const textChunk = selectedFile.slice(0, MAX_LOCAL_TEXT_PREVIEW_BYTES)
        const text = await textChunk.text()
        setPreviewMode('text')
        setPreviewTextContent(text)
        setPreviewTruncated(truncated)
      } else {
        const objectUrl = window.URL.createObjectURL(selectedFile)
        setPreviewObjectUrl(objectUrl)
        setPreviewMode(mode)
      }
    } catch (err) {
      setPreviewError(err?.message || 'Unable to preview this file')
      setPreviewMode('none')
    } finally {
      setPreviewLoading(false)
    }
  }

  const addFiles = (nextFiles) => {
    const incoming = Array.from(nextFiles || [])
    if (incoming.length === 0) return
    setFiles((prev) => mergeFiles(prev, incoming))
  }

  const removeFileAt = (index) => {
    const removed = files[index]
    if (removed && fileKey(removed) === previewFileKey) {
      resetPreview()
    }
    setFiles((prev) => prev.filter((_file, fileIndex) => fileIndex !== index))
  }

  const clearFiles = () => {
    setFiles([])
    resetPreview()
  }

  const totalSelectedBytes = useMemo(
    () => files.reduce((sum, file) => sum + (file.size || 0), 0),
    [files],
  )

  useEffect(
    () => () => {
      if (previewObjectUrl) {
        window.URL.revokeObjectURL(previewObjectUrl)
      }
    },
    [previewObjectUrl],
  )

  useEffect(
    () => () => {
      if (submittedPreviewObjectUrl) {
        window.URL.revokeObjectURL(submittedPreviewObjectUrl)
      }
    },
    [submittedPreviewObjectUrl],
  )

  useEffect(() => {
    if (!feedbackResults.length) {
      if (selectedFeedbackIndex !== 0) setSelectedFeedbackIndex(0)
      return
    }
    if (selectedFeedbackIndex > feedbackResults.length - 1) {
      setSelectedFeedbackIndex(0)
    }
  }, [feedbackResults.length, selectedFeedbackIndex])

  const columns = useMemo(() => {
    const cols = []
    if (!isAssignmentScoped) {
      cols.push({ field: 'assignment_title', headerName: 'Assignment', flex: 2, minWidth: 200 })
    }
    if (rows.some((row) => Boolean(row?.group_name))) {
      cols.push({
        field: 'group_name',
        headerName: 'Group',
        flex: 1.2,
        minWidth: 190,
        renderCell: (params) => {
          const row = params?.row
          if (!row?.group_name) return '—'
          const members = row?.group_member_usernames || []
          return (
            <Stack spacing={0.15} sx={{ py: 0.6, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap title={row.group_name}>
                {row.group_name}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap title={members.join(', ')}>
                {members.length ? `${members.length} members · ${formatMemberPreview(members, 2)}` : 'No members assigned'}
              </Typography>
            </Stack>
          )
        },
      })
    }
    if (canViewAll) {
      cols.push({
        field: 'submitted_by_username',
        headerName: 'Submitted by',
        flex: 1,
        minWidth: 140,
        renderCell: (params) => {
          const row = params?.row
          if (!row?.submitted_by_username) return '—'
          return (
            <Stack spacing={0.15} sx={{ py: 0.6, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap title={row.submitted_by_username}>
                {row.submitted_by_username}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {row?.group_name ? 'Clicked submit for the group' : 'Individual submission'}
              </Typography>
            </Stack>
          )
        },
      })
    }
    cols.push(
      {
        field: 'submitted_at',
        headerName: 'Submitted',
        flex: 1.2,
        minWidth: 160,
        renderCell: (params) => {
          if (!params.value) return '—'
          const date = new Date(params.value)
          return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
        },
      },
      {
        field: 'attempt_number',
        headerName: 'Attempts',
        width: 96,
        valueGetter: (_value, row) => row?.attempt_number || 0,
      },
      {
        field: 'status',
        headerName: 'Status',
        flex: 0.8,
        minWidth: 120,
        renderCell: (params) => {
          const meta = submissionOutcomeMeta(params.value)
          return <Chip label={meta.label} color={meta.color} size="small" variant="outlined" />
        },
      },
      {
        field: 'grade',
        headerName: 'Grade',
        flex: 1,
        minWidth: 160,
        valueGetter: (_value, row) => {
          if (!row) return '—'
          if (row.grade_score == null || row.grade_max_score == null) return 'Grade pending'
          return `${row.grade_score}/${row.grade_max_score}`
        },
      },
      {
        field: 'actions',
        headerName: 'Actions',
        width: 90,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        align: 'center',
        headerAlign: 'center',
        renderCell: (params) => {
          const row = params?.row
          if (!row) return '—'
          const items = []
          if (canViewAll) {
            items.push({
              key: 'rerun',
              label: 'Run again',
              onClick: () => handleRerunSubmission(row.id),
              icon: <ScheduleRounded fontSize="small" />,
              disabled:
                rerunSubmissionId === row.id ||
                row.status === 'QUEUED' ||
                row.status === 'RUNNING',
            })
          }
          if (row.source_bundle_key) {
            const url = `${API_BASE}/media/${row.source_bundle_key}`
            items.push({
              key: 'download',
              label: 'Download submission',
              onClick: () => window.open(url, '_blank', 'noopener,noreferrer'),
              icon: <DownloadRounded fontSize="small" />,
            })
          }
          return <RowActionsMenu items={items} />
        },
      },
    )
    return cols
  }, [canViewAll, detailData?.submission?.id, detailOpen, isAssignmentScoped, rerunSubmissionId, rows])

  const classRunColumns = useMemo(
    () => [
      {
        field: 'student_username',
        headerName: 'Student',
        flex: 1,
        minWidth: 160,
      },
      {
        field: 'attempt_number',
        headerName: 'Attempt',
        width: 90,
      },
      {
        field: 'outcome',
        headerName: 'Outcome',
        width: 120,
        renderCell: (params) => {
          const meta = classRunOutcomeMeta(params.value)
          return (
            <Typography
              variant="body2"
              sx={{
                fontWeight: 700,
                color:
                  meta.color === 'success'
                    ? 'success.main'
                    : meta.color === 'error'
                      ? 'error.main'
                      : meta.color === 'warning'
                        ? 'warning.main'
                        : 'text.secondary',
              }}
            >
              {meta.label}
            </Typography>
          )
        },
      },
      {
        field: 'checks',
        headerName: 'Checks',
        width: 110,
        valueGetter: (_value, row) => `${row?.passed_tests ?? 0}/${row?.total_tests ?? 0}`,
      },
      {
        field: 'status',
        headerName: 'Run status',
        width: 130,
        renderCell: (params) => {
          const meta = classRunStatusMeta(params.value)
          return (
            <Typography
              variant="body2"
              sx={{
                fontWeight: 700,
                color:
                  meta.color === 'success'
                    ? 'success.main'
                    : meta.color === 'warning'
                      ? 'warning.main'
                      : meta.color === 'info'
                        ? 'info.main'
                        : 'text.secondary',
              }}
            >
              {meta.label}
            </Typography>
          )
        },
      },
      {
        field: 'summary',
        headerName: 'Summary',
        flex: 1.6,
        minWidth: 240,
        valueGetter: (_value, row) => row?.summary || '—',
      },
    ],
    [],
  )

  return (
    <Box sx={{ py: embedded ? 0 : { xs: 2, md: 3 } }}>
      <Stack spacing={3}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems={{ xs: 'stretch', sm: 'center' }}
          justifyContent="space-between"
        >
          {isAssignmentScoped ? (
            <Stack spacing={0.5}>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                Submissions
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {assignmentTitle
                  ? `Review the latest submission per student for ${assignmentTitle}.`
                  : 'Review the latest submission per student for this assignment.'}
              </Typography>
            </Stack>
          ) : (
            <Box />
          )}
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {canWorkspaceSelectedAssignment ? (
              <Button
                variant={canUploadSelectedAssignment ? 'outlined' : 'contained'}
                startIcon={<CodeRounded />}
                onClick={openWorkspace}
                disabled={!canSubmit}
              >
                Open workspace
              </Button>
            ) : null}
            {(!isAssignmentScoped || canUploadSelectedAssignment) ? (
              <Button
                variant="contained"
                startIcon={<AddRounded />}
                onClick={openUpload}
                disabled={!canSubmit || (!isAssignmentScoped && !uploadEligibleAssignments.length)}
              >
                {isAssignmentScoped ? 'Add submission' : 'Upload submission'}
              </Button>
            ) : null}
          </Stack>
        </Stack>

        {error ? <Alert severity="error">{error}</Alert> : null}
        {canViewClassRuns ? (
          <Paper
            elevation={0}
            sx={{
              p: { xs: 1.75, md: 2 },
              borderRadius: 2.75,
              border: '1px solid',
              borderColor: 'divider',
              background: 'rgba(255,255,255,0.96)',
            }}
          >
            <Stack spacing={1.5}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={1}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', md: 'center' }}
              >
                <Stack spacing={0.3}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
                    Class execution
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 720 }}>
                    {latestClassRun
                      ? `Latest run: ${formatRunTimestamp(latestClassRun.created_at)} • ${classRunStatusMeta(latestClassRun.status).label.toLowerCase()} • ${latestClassRun.completed_items}/${latestClassRun.total_submissions} processed`
                      : 'Run the active suite against each student’s latest submission when you need a class-level report.'}
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={0.25} alignItems="center">
                  {classRuns.length ? (
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => setClassRunPanelOpen((open) => !open)}
                    >
                      {classRunPanelOpen ? 'Hide report' : 'View report'}
                    </Button>
                  ) : null}
                  <RowActionsMenu
                    items={[
                      classRuns.length
                        ? {
                            key: 'toggle-report',
                            label: classRunPanelOpen ? 'Hide report' : 'View report',
                            onClick: () => setClassRunPanelOpen((open) => !open),
                            icon: <VisibilityRounded fontSize="small" />,
                          }
                        : null,
                      canStartClassRun
                        ? {
                            key: 'new-run',
                            label: classRunStarting ? 'Queueing…' : activeClassRun ? 'Run in progress' : 'Run across class',
                            onClick: handleStartClassRun,
                            icon: <ScheduleRounded fontSize="small" />,
                            disabled: classRunStarting || Boolean(activeClassRun),
                          }
                        : null,
                    ].filter(Boolean)}
                  />
                </Stack>
              </Stack>

              {classRunsError ? <Alert severity="error">{classRunsError}</Alert> : null}

              {classRunsLoading && !classRunPanelOpen ? (
                <Stack spacing={1}>
                  <LinearProgress sx={{ borderRadius: 999, height: 6 }} />
                  <Typography variant="body2" color="text.secondary">
                    Loading class runs…
                  </Typography>
                </Stack>
              ) : (
                <Paper
                  elevation={0}
                  sx={{
                    p: 0,
                    borderRadius: 0,
                    border: 0,
                    backgroundColor: 'transparent',
                  }}
                >
                  <Stack spacing={1.1}>
                    <Collapse in={classRunPanelOpen} timeout="auto" unmountOnExit>
                      {classRunsLoading ? (
                        <Stack spacing={1}>
                          <LinearProgress sx={{ borderRadius: 999, height: 6 }} />
                          <Typography variant="body2" color="text.secondary">
                            Loading class runs…
                          </Typography>
                        </Stack>
                      ) : classRuns.length ? (
                        <Stack spacing={1.25} sx={{ pt: 0.25 }}>
                          {classRunDetailLoading ? (
                            <Stack spacing={1}>
                              <LinearProgress sx={{ borderRadius: 999, height: 6 }} />
                              <Typography variant="body2" color="text.secondary">
                                Loading run details…
                              </Typography>
                            </Stack>
                          ) : classRunDetailError ? (
                            <Alert severity="error">{classRunDetailError}</Alert>
                          ) : classRunDetail?.run ? (
                            <>
                              <Paper
                                elevation={0}
                                sx={{
                                  p: 1.15,
                                  borderRadius: 2,
                                  border: '1px solid',
                                  borderColor: 'divider',
                                  backgroundColor: '#fff',
                                }}
                              >
                                <Stack spacing={1}>
                                  <Stack
                                    direction={{ xs: 'column', sm: 'row' }}
                                    spacing={0.8}
                                    justifyContent="space-between"
                                    alignItems={{ xs: 'flex-start', sm: 'center' }}
                                  >
                                    <Stack spacing={0.45} sx={{ minWidth: 0, flex: 1 }}>
                                      <Stack
                                        direction={{ xs: 'column', md: 'row' }}
                                        spacing={1}
                                        alignItems={{ xs: 'flex-start', md: 'center' }}
                                        justifyContent="space-between"
                                      >
                                        <FormControl size="small" sx={{ minWidth: { xs: '100%', md: 280 } }}>
                                          <InputLabel id="class-run-select-label">Run</InputLabel>
                                          <Select
                                            labelId="class-run-select-label"
                                            label="Run"
                                            value={selectedClassRunId}
                                            onChange={(event) => setSelectedClassRunId(event.target.value)}
                                          >
                                            {classRuns.map((run) => (
                                              <MenuItem key={run.id} value={run.id}>
                                                {`${formatRunTimestamp(run.created_at)} • ${classRunStatusMeta(run.status).label}`}
                                              </MenuItem>
                                            ))}
                                          </Select>
                                        </FormControl>
                                        <FormControl size="small" sx={{ minWidth: { xs: '100%', md: 170 } }}>
                                          <InputLabel id="class-run-view-label">View</InputLabel>
                                          <Select
                                            labelId="class-run-view-label"
                                            label="View"
                                            value={classRunFocusView}
                                            onChange={(event) => setClassRunFocusView(event.target.value)}
                                          >
                                            <MenuItem value="datasets">Datasets</MenuItem>
                                            <MenuItem value="students">Students</MenuItem>
                                          </Select>
                                        </FormControl>
                                      </Stack>
                                      <Typography variant="body2" color="text.secondary">
                                        {[
                                          formatRunTimestamp(classRunDetail.run.created_at),
                                          classRunDetail.run.triggered_by ? `Started by ${classRunDetail.run.triggered_by}` : '',
                                          classRunStatusMeta(classRunDetail.run.status).label,
                                          `${classRunDetail.run.completed_items}/${classRunDetail.run.total_submissions} processed`,
                                          `Suite v${classRunDetail.run.test_suite_version?.version_number || '—'}`,
                                        ].filter(Boolean).join(' • ')}
                                      </Typography>
                                      <Stack
                                        direction={{ xs: 'column', sm: 'row' }}
                                        spacing={{ xs: 0.35, sm: 1.75 }}
                                        divider={<Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' } }} />}
                                        useFlexGap
                                      >
                                        {classRunSummaryStats.map((stat) => (
                                          <Stack key={stat.key} spacing={0.05}>
                                            <Typography variant="caption" color="text.secondary">
                                              {stat.label}
                                            </Typography>
                                            <Typography variant="body2" sx={{ fontWeight: 800, color: stat.color }}>
                                              {stat.value}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
                                              {stat.helper}
                                            </Typography>
                                          </Stack>
                                        ))}
                                      </Stack>
                                    </Stack>
                                  </Stack>

                                  {classRunFocusView === 'datasets' ? (
                                    classRunTestRows.length ? (
                                      <Stack divider={<Divider flexItem sx={{ borderColor: 'rgba(226,232,240,0.8)' }} />}>
                                        {classRunTestRows.map((row) => {
                                          const rate = Math.max(0, Math.min(100, Number(row.pass_rate || 0)))
                                          const tone = rate >= 70 ? 'success' : rate >= 40 ? 'warning' : 'error'
                                          return (
                                            <Stack key={row.name} spacing={0.8} sx={{ py: 0.9 }}>
                                              <Stack
                                                direction={{ xs: 'column', sm: 'row' }}
                                                spacing={1}
                                                justifyContent="space-between"
                                                alignItems={{ xs: 'flex-start', sm: 'center' }}
                                              >
                                                <Box sx={{ minWidth: 0 }}>
                                                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                                    {row.name}
                                                  </Typography>
                                                  <Typography variant="caption" color="text.secondary">
                                                    {row.pass_count} pass • {row.fail_count} fail • {row.incomplete_count} incomplete
                                                  </Typography>
                                                </Box>
                                                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                                                  {`${rate}% pass${row.avg_time_ms != null ? ` • ${row.avg_time_ms} ms avg` : ''}`}
                                                </Typography>
                                              </Stack>
                                              <LinearProgress
                                                variant="determinate"
                                                value={rate}
                                                color={tone}
                                                sx={{
                                                  height: 7,
                                                  borderRadius: 999,
                                                  backgroundColor: 'rgba(148,163,184,0.16)',
                                                }}
                                              />
                                            </Stack>
                                          )
                                        })}
                                      </Stack>
                                    ) : (
                                      <Typography variant="body2" color="text.secondary">
                                        No dataset-level results yet.
                                      </Typography>
                                    )
                                  ) : (
                                    <Box sx={{ height: 340 }}>
                                      <DataGrid
                                        rows={classRunItemRows}
                                        columns={classRunColumns}
                                        disableRowSelectionOnClick
                                        hideFooter
                                        density="compact"
                                        sx={{
                                          border: 0,
                                          '& .MuiDataGrid-columnHeaders': {
                                            backgroundColor: 'rgba(248,250,252,0.9)',
                                            borderBottom: '1px solid rgba(226,232,240,0.8)',
                                          },
                                          '& .MuiDataGrid-cell': {
                                            borderColor: 'rgba(226,232,240,0.76)',
                                          },
                                          '& .MuiDataGrid-row:hover': {
                                            backgroundColor: 'rgba(79,70,229,0.035)',
                                          },
                                        }}
                                      />
                                    </Box>
                                  )}
                                </Stack>
                              </Paper>
                            </>
                          ) : null}
                        </Stack>
                      ) : (
                        <Box sx={{ pt: 0.25 }}>
                          <Typography variant="body2" color="text.secondary">
                            No class execution runs yet.
                          </Typography>
                          {canStartClassRun ? (
                            <Button
                              sx={{ mt: 1 }}
                              variant="text"
                              size="small"
                              onClick={handleStartClassRun}
                              disabled={classRunStarting}
                            >
                              {classRunStarting ? 'Queueing…' : 'Start first run'}
                            </Button>
                          ) : null}
                        </Box>
                      )}
                    </Collapse>
                  </Stack>
                </Paper>
              )}
            </Stack>
          </Paper>
        ) : null}

        <Box sx={{ height: embedded ? 480 : 520 }}>
          <DataGrid
            rows={tableRows}
            columns={columns}
            loading={loading}
            disableRowSelectionOnClick
            onRowClick={(params) => {
              openSubmissionPage(params.row.id, {
                assignmentId: params.row.assignment_uuid || params.row.assignment_id,
              })
            }}
            slots={{ toolbar: GridToolbar }}
            sx={{
              backgroundColor: 'background.paper',
              borderRadius: 3,
              '& .MuiDataGrid-row': {
                cursor: 'pointer',
              },
            }}
          />
        </Box>
      </Stack>

      <Dialog open={dialogOpen} onClose={closeUploadDialog} maxWidth="md" fullWidth sx={contentCenteredDialogSx}>
        <DialogTitle>Upload submission</DialogTitle>
        <DialogContent>
          <Stack component="form" spacing={2} sx={{ mt: 1 }} onSubmit={handleUpload}>
            {isAssignmentScoped ? (
              <Stack spacing={0.5}>
                <Typography variant="caption" color="text.secondary">
                  Assignment
                </Typography>
                <Typography sx={{ fontWeight: 700 }}>
                  {assignmentTitle || 'Current assignment'}
                </Typography>
              </Stack>
            ) : (
              <FormControl fullWidth size="small">
                <InputLabel id="assignment-select-label">Assignment</InputLabel>
                <Select
                  labelId="assignment-select-label"
                  label="Assignment"
                  value={assignmentId}
                  onChange={(event) => {
                    setAssignmentId(event.target.value)
                    setUploadGroupId('')
                    setUploadGroupOptions([])
                    setUploadGroupError('')
                    setUploadGroupNotice('')
                  }}
                >
                  {uploadEligibleAssignments.map((assignment) => (
                    <MenuItem key={assignment.id} value={assignment.id}>
                      {assignment.title}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {!isAssignmentScoped && !uploadEligibleAssignments.length ? (
              <Alert severity="info" variant="outlined">
                There are no assignments in this course that currently accept file uploads.
              </Alert>
            ) : null}

            {uploadRequiresGroup ? (
              <Stack spacing={1}>
                {uploadGroupError ? (
                  <Alert severity="error" variant="outlined">
                    {uploadGroupError}
                  </Alert>
                ) : null}
                {uploadHasMultipleGroupChoices ? (
                  <FormControl fullWidth size="small" disabled={uploadGroupLoading}>
                    <InputLabel id="submission-group-select-label">Submit for group</InputLabel>
                    <Select
                      labelId="submission-group-select-label"
                      label="Submit for group"
                      value={uploadGroupId}
                      onChange={(event) => setUploadGroupId(event.target.value)}
                    >
                      {uploadGroupOptions.map((group) => (
                        <MenuItem key={group.id} value={group.id}>
                          {group.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                ) : null}
                {!uploadGroupError ? (
                  <Paper variant="outlined" sx={{ p: 1.1, borderRadius: 1.5 }}>
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={1}
                      justifyContent="space-between"
                      alignItems={{ xs: 'flex-start', sm: 'center' }}
                    >
                      <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 800 }}>
                          {selectedUploadGroup?.name || (uploadHasMultipleGroupChoices ? 'Choose a group' : 'Group submission')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {selectedUploadGroup
                            ? `${selectedUploadGroup.member_usernames?.length || 0} member${selectedUploadGroup.member_usernames?.length === 1 ? '' : 's'} • ${selectedUploadGroupMemberPreview}`
                            : uploadGroupNotice || 'One shared submission per group'}
                        </Typography>
                      </Stack>
                      {selectedUploadGroup ? (
                        <Chip
                          size="small"
                          variant="outlined"
                          label={`Submitting for ${selectedUploadGroup.name}`}
                        />
                      ) : null}
                    </Stack>
                  </Paper>
                ) : null}
              </Stack>
            ) : null}

            <Box
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  fileInputRef.current?.click()
                }
              }}
              onDragOver={(event) => {
                event.preventDefault()
                setIsDraggingFiles(true)
              }}
              onDragEnter={(event) => {
                event.preventDefault()
                setIsDraggingFiles(true)
              }}
              onDragLeave={(event) => {
                event.preventDefault()
                setIsDraggingFiles(false)
              }}
              onDrop={(event) => {
                event.preventDefault()
                setIsDraggingFiles(false)
                addFiles(event.dataTransfer?.files)
              }}
              sx={{
                border: '1px dashed',
                borderColor: isDraggingFiles ? 'primary.main' : 'divider',
                backgroundColor: isDraggingFiles
                  ? 'rgba(67, 56, 202, 0.08)'
                  : 'rgba(248, 250, 252, 0.75)',
                borderRadius: 2,
                p: 2,
                cursor: 'pointer',
                outline: 'none',
                transition: 'all 0.18s ease',
              }}
            >
              <Stack direction="row" spacing={1.5} alignItems="center">
                <CloudUploadRounded color={isDraggingFiles ? 'primary' : 'action'} />
                <Stack spacing={0.3} sx={{ flex: 1 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography sx={{ fontWeight: 700 }}>
                      {files.length ? 'Add more files' : 'Drop files or browse'}
                    </Typography>
                    {uploadRequiresGroup && selectedUploadGroup ? (
                      <Chip size="small" variant="outlined" label={selectedUploadGroup.name} />
                    ) : null}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {files.length
                      ? `${files.length} selected • ${formatBytes(totalSelectedBytes)}`
                      : uploadRequiresGroup && selectedUploadGroup
                        ? `Submitting for ${selectedUploadGroup.name} • Multiple files are zipped automatically`
                        : 'ZIP or source files • Multiple files are zipped automatically'}
                  </Typography>
                </Stack>
                <Button variant="outlined" size="small">
                  Browse
                </Button>
              </Stack>
              <input
                type="file"
                multiple
                hidden
                ref={fileInputRef}
                onChange={(event) => {
                  addFiles(event.target.files)
                  // Allow re-selecting the same file again.
                  event.target.value = ''
                }}
              />
            </Box>

            {files.length ? (
              <Stack spacing={1}>
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    Selected files
                  </Typography>
                  <Button
                    size="small"
                    color="inherit"
                    startIcon={<DeleteRounded />}
                    onClick={clearFiles}
                  >
                    Clear all
                  </Button>
                </Stack>
                <Box
                  sx={{
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 2,
                    maxHeight: 210,
                    overflow: 'auto',
                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                  }}
                >
                  <Stack divider={<Divider flexItem />}>
                    {files.map((selectedFile, index) => (
                      <Stack
                        key={`${selectedFile.name}-${selectedFile.size}-${selectedFile.lastModified}-${index}`}
                        direction="row"
                        alignItems="center"
                        spacing={1}
                        sx={{
                          px: 1.25,
                          py: 1,
                          backgroundColor:
                            previewFileKey === fileKey(selectedFile)
                              ? 'rgba(67, 56, 202, 0.06)'
                              : 'transparent',
                        }}
                      >
                        <InsertDriveFileRounded fontSize="small" color="action" />
                        <Typography
                          variant="body2"
                          sx={{ flex: 1, minWidth: 0 }}
                          noWrap
                          title={selectedFile.name}
                        >
                          {selectedFile.name}
                        </Typography>
                        <Chip size="small" label={formatBytes(selectedFile.size || 0)} variant="outlined" />
                        <Tooltip title="Preview file">
                          <IconButton size="small" onClick={() => openLocalPreview(selectedFile)}>
                            <VisibilityRounded
                              fontSize="small"
                              color={previewFileKey === fileKey(selectedFile) ? 'primary' : 'inherit'}
                            />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Remove file">
                          <IconButton size="small" onClick={() => removeFileAt(index)}>
                            <DeleteRounded fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    ))}
                  </Stack>
                </Box>
              </Stack>
            ) : null}

            {previewFileKey ? (
              <Stack spacing={1}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    Preview: {previewFileName}
                  </Typography>
                  {previewObjectUrl ? (
                    <Button
                      size="small"
                      component="a"
                      href={previewObjectUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open in new tab
                    </Button>
                  ) : null}
                </Stack>
                {previewTruncated ? (
                  <Alert severity="warning" variant="outlined">
                    Showing first {formatBytes(MAX_LOCAL_TEXT_PREVIEW_BYTES)} only.
                  </Alert>
                ) : null}
                {previewError ? <Alert severity="error">{previewError}</Alert> : null}
                {previewLoading ? (
                  <Typography variant="body2" color="text.secondary">
                    Loading preview...
                  </Typography>
                ) : previewMode === 'text' ? (
                  <Box
                    component="pre"
                    sx={{
                      m: 0,
                      p: 1.25,
                      maxHeight: 280,
                      overflow: 'auto',
                      borderRadius: 1.5,
                      border: '1px solid',
                      borderColor: 'divider',
                      backgroundColor: 'rgba(15, 23, 42, 0.04)',
                      fontSize: 12,
                      lineHeight: 1.5,
                      fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {previewTextContent || '(empty file)'}
                  </Box>
                ) : previewMode === 'image' && previewObjectUrl ? (
                  <Box
                    component="img"
                    src={previewObjectUrl}
                    alt={previewFileName}
                    sx={{
                      maxWidth: '100%',
                      maxHeight: 320,
                      objectFit: 'contain',
                      borderRadius: 1.5,
                      border: '1px solid',
                      borderColor: 'divider',
                      backgroundColor: 'rgba(248, 250, 252, 0.8)',
                    }}
                  />
                ) : previewMode === 'video' && previewObjectUrl ? (
                  <Box
                    component="video"
                    src={previewObjectUrl}
                    controls
                    sx={{
                      width: '100%',
                      maxHeight: 320,
                      borderRadius: 1.5,
                      border: '1px solid',
                      borderColor: 'divider',
                      backgroundColor: 'rgba(15, 23, 42, 0.8)',
                    }}
                  />
                ) : previewMode === 'audio' && previewObjectUrl ? (
                  <Box
                    sx={{
                      borderRadius: 1.5,
                      border: '1px solid',
                      borderColor: 'divider',
                      p: 1.25,
                      backgroundColor: 'rgba(248, 250, 252, 0.8)',
                    }}
                  >
                    <audio src={previewObjectUrl} controls style={{ width: '100%' }} />
                  </Box>
                ) : previewObjectUrl ? (
                  <Box
                    component="iframe"
                    title={previewFileName}
                    src={previewObjectUrl}
                    sx={{
                      width: '100%',
                      height: 320,
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1.5,
                      backgroundColor: 'rgba(248, 250, 252, 0.8)',
                    }}
                  />
                ) : null}
              </Stack>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeUploadDialog}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleUpload}
            disabled={
              !activeUploadAssignmentId ||
              files.length === 0 ||
              saving ||
              uploadGroupLoading ||
              (uploadRequiresGroup && !uploadGroupId)
            }
          >
            {saving ? 'Uploading…' : 'Upload'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={detailOpen}
        onClose={closeDetailDialog}
        maxWidth="lg"
        fullWidth
        sx={contentCenteredDialogSx}
        PaperProps={{
          sx: {
            borderRadius: 2.5,
            border: '1px solid',
            borderColor: 'rgba(15, 23, 42, 0.08)',
            backgroundColor: '#fff',
            boxShadow: '0 22px 56px rgba(15, 23, 42, 0.14)',
          },
        }}
      >
        <DialogTitle
          sx={{
            pb: 0.75,
            pt: 1.5,
            fontSize: '1.1rem',
            fontWeight: 800,
          }}
        >
          Submission details
        </DialogTitle>
        <DialogContent sx={{ pb: 2, pt: 0.5 }}>
          {detailLoading ? (
            <Typography color="text.secondary">Loading details…</Typography>
          ) : detailError ? (
            <Alert severity="error">{detailError}</Alert>
          ) : detailData ? (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Paper
                variant="outlined"
                sx={{
                  borderRadius: 2.25,
                  p: { xs: 1.25, md: 1.5 },
                  borderColor: 'rgba(15, 23, 42, 0.08)',
                  backgroundColor: '#fff',
                }}
              >
                <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'flex-start', lg: 'center' }}>
                  <Stack spacing={0.2} sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 800, fontSize: { xs: '1.15rem', md: '1.25rem' }, lineHeight: 1.2 }}>
                      {detailData.submission?.assignment_title || '—'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.9rem' }}>
                      Submitted {detailData.submission?.submitted_at ? new Date(detailData.submission.submitted_at).toLocaleString() : '—'}
                    </Typography>
                  </Stack>
                  <Stack
                    direction="row"
                    spacing={1.25}
                    flexWrap="wrap"
                    useFlexGap
                    alignItems="center"
                    sx={{ width: { xs: '100%', lg: 'auto' }, justifyContent: { xs: 'flex-start', lg: 'flex-end' } }}
                  >
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <Typography variant="caption" color="text.secondary">Verification</Typography>
                      {(() => {
                        const meta = submissionOutcomeMeta(detailData.submission?.status)
                        return <Chip label={meta.label} color={meta.color} size="small" sx={{ height: 24 }} />
                      })()}
                    </Stack>
                    {detailData.grading_run?.exit_status ? (
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <Typography variant="caption" color="text.secondary">Run</Typography>
                        <Chip
                          label={formatIdentifierLabel(detailData.grading_run.exit_status)}
                          size="small"
                          variant="outlined"
                          sx={{ height: 24 }}
                        />
                      </Stack>
                    ) : null}
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <Typography variant="caption" color="text.secondary">Grade</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {detailData.grade
                          ? `${detailData.grade.score}/${detailData.grade.max_score}`
                          : 'Not graded'}
                      </Typography>
                    </Stack>
                  </Stack>
                </Stack>
              </Paper>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.6fr) 300px' },
                  gap: 1.75,
                  alignItems: 'start',
                }}
              >
                <Paper
                  variant="outlined"
                  sx={{
                    borderRadius: 2.25,
                    p: 1.5,
                    borderColor: 'rgba(15, 23, 42, 0.08)',
                    backgroundColor: '#fff',
                  }}
                >
                  <Stack spacing={1.25}>
                    <Stack
                      direction={{ xs: 'column', md: 'row' }}
                      spacing={1}
                      justifyContent="space-between"
                      alignItems={{ xs: 'flex-start', md: 'flex-start' }}
                    >
                      <Stack spacing={0.25}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                          Verification
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Review the latest automated checks and open only the item that needs attention.
                        </Typography>
                      </Stack>
                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                        <Chip size="small" variant="outlined" label={`${feedbackSummary.passed}/${feedbackSummary.total} passed`} />
                        {feedbackSummary.failed ? (
                          <Chip size="small" color="error" variant="outlined" label={`${feedbackSummary.failed} failed`} />
                        ) : null}
                        {feedbackSummary.incomplete ? (
                          <Chip size="small" color="warning" variant="outlined" label={`${feedbackSummary.incomplete} incomplete`} />
                        ) : null}
                      </Stack>
                    </Stack>

                    {detailData?.submission?.status === 'QUEUED' && detailData?.grading_run?.finished_at && feedbackResults.length ? (
                      <Alert severity="info" variant="outlined">
                        This submission is queued to run again. The feedback below is from the previous completed run.
                      </Alert>
                    ) : null}

                    <Box
                      sx={{
                        borderRadius: 1.75,
                        border: '1px solid',
                        borderColor: feedbackSummary.severity === 'error'
                          ? 'rgba(239, 68, 68, 0.18)'
                          : feedbackSummary.severity === 'warning'
                            ? 'rgba(245, 158, 11, 0.2)'
                            : 'rgba(34, 197, 94, 0.18)',
                        backgroundColor: feedbackSummary.severity === 'error'
                          ? 'rgba(254, 242, 242, 0.72)'
                          : feedbackSummary.severity === 'warning'
                            ? 'rgba(255, 251, 235, 0.78)'
                            : 'rgba(240, 253, 244, 0.72)',
                        px: 1.25,
                        py: 1,
                      }}
                    >
                      <Stack direction="row" spacing={1} alignItems="flex-start">
                        {feedbackSummary.severity === 'success' ? (
                          <CheckCircleRounded color="success" sx={{ mt: 0.05, fontSize: 20 }} />
                        ) : feedbackSummary.severity === 'warning' ? (
                          <ScheduleRounded color="warning" sx={{ mt: 0.05, fontSize: 20 }} />
                        ) : (
                          <ErrorOutlineRounded color={feedbackSummary.severity === 'error' ? 'error' : 'primary'} sx={{ mt: 0.05, fontSize: 20 }} />
                        )}
                        <Stack spacing={0.2}>
                          <Typography sx={{ fontWeight: 800, fontSize: '0.95rem' }}>{feedbackSummary.title}</Typography>
                          <Typography variant="body2" color="text.secondary">
                            {feedbackSummary.description}
                          </Typography>
                        </Stack>
                      </Stack>
                    </Box>

                    {feedbackResults.length ? (
                      <Box
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: { xs: '1fr', lg: '260px minmax(0, 1fr)' },
                          gap: 1.25,
                        }}
                      >
                        <Box
                          sx={{
                            maxHeight: 460,
                            overflow: 'auto',
                            borderRadius: 1.75,
                            border: '1px solid',
                            borderColor: 'rgba(15, 23, 42, 0.08)',
                            backgroundColor: 'rgba(248, 250, 252, 0.55)',
                            p: 0.75,
                          }}
                        >
                          <Stack spacing={0.7}>
                            {[
                              { title: 'Needs attention', items: attentionFeedbackResults },
                              { title: 'Passed', items: passedFeedbackResults },
                            ].filter((group) => group.items.length > 0).map((group) => (
                              <Stack key={group.title} spacing={0.45}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, px: 0.25 }}>
                                  {group.title}
                                </Typography>
                                {group.items.map((result) => {
                                  const index = feedbackResults.findIndex((entry) => entry.id === result.id)
                                  const meta = feedbackStatusMeta(result)
                                  const selected = index === selectedFeedbackIndex
                                  return (
                                    <Box
                                      key={result.id || `${result.test_name}-${index}`}
                                      onClick={() => setSelectedFeedbackIndex(index)}
                                      sx={{
                                        cursor: 'pointer',
                                        borderRadius: 1.25,
                                        border: '1px solid',
                                        borderColor: selected ? 'rgba(79, 70, 229, 0.22)' : 'rgba(15, 23, 42, 0.08)',
                                        px: 0.85,
                                        py: 0.75,
                                        backgroundColor: selected ? 'rgba(79, 70, 229, 0.05)' : '#fff',
                                        transition: 'all 160ms ease',
                                      }}
                                    >
                                      <Stack spacing={0.25}>
                                        <Stack direction="row" spacing={0.75} alignItems="flex-start" justifyContent="space-between">
                                          <Typography
                                            sx={{
                                              fontWeight: 700,
                                              fontSize: '0.9rem',
                                              pr: 0.8,
                                              lineHeight: 1.25,
                                              flex: 1,
                                              minWidth: 0,
                                            }}
                                            noWrap
                                          >
                                            {result.test_name}
                                          </Typography>
                                          <Chip
                                            label={meta.label}
                                            color={meta.color}
                                            size="small"
                                            variant={selected ? 'filled' : 'outlined'}
                                            sx={{
                                              height: 20,
                                              '& .MuiChip-label': {
                                                px: 0.8,
                                                fontSize: '0.7rem',
                                                fontWeight: 700,
                                              },
                                            }}
                                          />
                                        </Stack>
                                        <Typography
                                          variant="body2"
                                          color="text.secondary"
                                          sx={{
                                            fontSize: '0.78rem',
                                            lineHeight: 1.35,
                                            display: '-webkit-box',
                                            WebkitLineClamp: 2,
                                            WebkitBoxOrient: 'vertical',
                                            overflow: 'hidden',
                                          }}
                                        >
                                          {feedbackListHint(result)}
                                        </Typography>
                                      </Stack>
                                    </Box>
                                  )
                                })}
                              </Stack>
                            ))}
                          </Stack>
                        </Box>
                        <Box
                          sx={{
                            minWidth: 0,
                            borderRadius: 1.75,
                            border: '1px solid',
                            borderColor: 'rgba(15, 23, 42, 0.08)',
                            backgroundColor: '#fff',
                            p: 1.35,
                          }}
                        >
                          {selectedFeedback ? (() => {
                          const meta = feedbackStatusMeta(selectedFeedback)
                          const feedbackDetails = selectedFeedback.details || {}
                          const issues = Array.isArray(feedbackDetails.issues) ? feedbackDetails.issues : []
                          const runInfoParts = []
                          if (selectedFeedback.time_ms != null) {
                            runInfoParts.push(`${selectedFeedback.time_ms} ms`)
                          }
                          if (selectedFeedback.failure_kind && selectedFeedback.status !== 'PASS') {
                            runInfoParts.push(formatIdentifierLabel(selectedFeedback.failure_kind))
                          }
                          if (feedbackDetails.target) {
                            runInfoParts.push(`Target: ${feedbackDetails.target}`)
                          }
                          if (
                            feedbackDetails.expected_exit_code != null
                            && feedbackDetails.actual_exit_code != null
                          ) {
                            runInfoParts.push(`Exit ${feedbackDetails.actual_exit_code} (expected ${feedbackDetails.expected_exit_code})`)
                          } else if (feedbackDetails.comparison_mode) {
                            runInfoParts.push(`Comparison: ${feedbackDetails.comparison_mode}`)
                          }
                          if (
                            selectedFeedback.failure_kind === 'TIMEOUT'
                            && feedbackDetails.timeout_ms != null
                          ) {
                            runInfoParts.push(`Limit ${feedbackDetails.timeout_ms} ms`)
                          }

                          const previewBlock = (label, value) =>
                            value ? (
                              <Stack spacing={0.6} sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="caption" color="text.secondary">
                                  {label}
                                </Typography>
                                <Box
                                  component="pre"
                                  sx={{
                                    m: 0,
                                    p: 1.1,
                                    minHeight: 80,
                                    maxHeight: 220,
                                    overflow: 'auto',
                                    borderRadius: 1.5,
                                    border: '1px solid',
                                    borderColor: 'divider',
                                    backgroundColor: 'rgba(15, 23, 42, 0.04)',
                                    fontSize: 12,
                                    lineHeight: 1.5,
                                    fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                  }}
                                >
                                  {value}
                                </Box>
                              </Stack>
                            ) : null

                          const renderIssue = (issue, index) => (
                            <Paper key={`${issue.kind || 'issue'}-${index}`} variant="outlined" sx={{ p: 1.1, borderRadius: 1.5 }}>
                              <Stack spacing={0.9}>
                                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                                  <Typography sx={{ fontWeight: 700 }}>
                                    {issue.summary || 'Verification issue'}
                                  </Typography>
                                  {issue.kind ? (
                                    <Chip size="small" variant="outlined" label={formatIdentifierLabel(issue.kind)} />
                                  ) : null}
                                </Stack>
                                {(() => {
                                  const issueParts = []
                                  if (issue.target) issueParts.push(`Target: ${issue.target}`)
                                  if (issue.actual_exit_code != null && issue.expected_exit_code != null) {
                                    issueParts.push(`Exit ${issue.actual_exit_code} (expected ${issue.expected_exit_code})`)
                                  } else if (issue.comparison_mode) {
                                    issueParts.push(`Comparison: ${issue.comparison_mode}`)
                                  }
                                  if (issue.timeout_ms != null) issueParts.push(`Limit ${issue.timeout_ms} ms`)
                                  return issueParts.length ? (
                                    <Typography variant="caption" color="text.secondary">
                                      {issueParts.join(' • ')}
                                    </Typography>
                                  ) : null
                                })()}
                                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                                  {previewBlock('Expected', issue.expected_preview)}
                                  {previewBlock('Actual', issue.actual_preview)}
                                </Stack>
                                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                                  {previewBlock('Stdout', issue.stdout_preview)}
                                  {previewBlock('Stderr', issue.stderr_preview)}
                                </Stack>
                              </Stack>
                            </Paper>
                          )

                          return (
                            <Stack spacing={1.25}>
                              <Stack
                                direction={{ xs: 'column', md: 'row' }}
                                spacing={1}
                                justifyContent="space-between"
                                alignItems={{ xs: 'flex-start', md: 'center' }}
                              >
                                <Stack spacing={0.25}>
                                  <Typography variant="h6" sx={{ fontWeight: 800 }}>
                                    {selectedFeedback.test_name}
                                  </Typography>
                                  {runInfoParts.length ? (
                                    <Typography variant="caption" color="text.secondary">
                                      {runInfoParts.join(' • ')}
                                    </Typography>
                                  ) : null}
                                </Stack>
                                <Chip label={meta.label} color={meta.color} size="small" />
                              </Stack>

                              {selectedFeedback.status === 'PASS' ? (
                                <Box
                                  sx={{
                                    borderRadius: 1.5,
                                    border: '1px solid rgba(34, 197, 94, 0.18)',
                                    backgroundColor: 'rgba(240, 253, 244, 0.65)',
                                    px: 1.2,
                                    py: 1,
                                  }}
                                >
                                  <Typography variant="body2" color="text.secondary">
                                    {feedbackDetailMessage(selectedFeedback)}
                                  </Typography>
                                </Box>
                              ) : (
                                <Box
                                  sx={{
                                    borderRadius: 1.5,
                                    border: meta.severity === 'warning'
                                      ? '1px solid rgba(245, 158, 11, 0.18)'
                                      : '1px solid rgba(239, 68, 68, 0.18)',
                                    backgroundColor: meta.severity === 'warning'
                                      ? 'rgba(255, 251, 235, 0.68)'
                                      : 'rgba(254, 242, 242, 0.68)',
                                    px: 1.2,
                                    py: 1,
                                  }}
                                >
                                  <Typography variant="body2" color="text.secondary">
                                    {feedbackDetailMessage(selectedFeedback)}
                                  </Typography>
                                </Box>
                              )}

                              {selectedFeedback.status !== 'PASS' ? (
                                <Stack spacing={1}>
                                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                                    {previewBlock('Expected', feedbackDetails.expected_preview)}
                                    {previewBlock('Actual', feedbackDetails.actual_preview)}
                                  </Stack>
                                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                                    {previewBlock('Stdout', feedbackDetails.stdout_preview)}
                                    {previewBlock('Stderr', feedbackDetails.stderr_preview)}
                                  </Stack>
                                </Stack>
                              ) : null}

                              {selectedFeedback.status !== 'PASS' && issues.length ? (
                                <Stack spacing={0.9}>
                                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                                    Failure details
                                  </Typography>
                                  {issues.map(renderIssue)}
                                </Stack>
                              ) : null}
                            </Stack>
                          )
                        })() : (
                          <Typography color="text.secondary">Select a check to inspect its feedback.</Typography>
                        )}
                        </Box>
                      </Box>
                    ) : (
                      <Typography color="text.secondary">No verification results available.</Typography>
                    )}
                  </Stack>
                </Paper>

                <Stack spacing={1}>
                  <Paper
                    variant="outlined"
                    sx={{
                      borderRadius: 2.25,
                      p: 1.35,
                      borderColor: 'rgba(15, 23, 42, 0.08)',
                      backgroundColor: '#fff',
                    }}
                  >
                      <Stack spacing={1.25}>
                        <Stack spacing={0.2}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                            Review
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Grade summary and instructor note
                          </Typography>
                        </Stack>
                      <Stack spacing={0.9}>
                        <Stack direction="row" justifyContent="space-between" spacing={1}>
                          <Typography variant="body2" color="text.secondary">Verification</Typography>
                          {(() => {
                            const meta = submissionOutcomeMeta(detailData.submission?.status)
                            return <Chip label={meta.label} color={meta.color} size="small" />
                          })()}
                        </Stack>
                        {detailData.grading_run?.exit_status ? (
                          <Stack direction="row" justifyContent="space-between" spacing={1}>
                            <Typography variant="body2" color="text.secondary">Run status</Typography>
                            <Chip
                              label={formatIdentifierLabel(detailData.grading_run.exit_status)}
                              size="small"
                              variant="outlined"
                            />
                          </Stack>
                        ) : null}
                        <Stack direction="row" justifyContent="space-between" spacing={1}>
                          <Typography variant="body2" color="text.secondary">Grade</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            {detailData.grade
                              ? `${detailData.grade.score}/${detailData.grade.max_score}`
                              : 'Not graded'}
                          </Typography>
                        </Stack>
                      </Stack>
                      <Divider />
                      {(detailData?.permissions?.can_edit_grade || detailData?.grade?.feedback || detailData?.rubric?.available) ? (
                        <Stack
                          spacing={0.85}
                          sx={{
                            borderRadius: 2,
                            p: 1.1,
                            border: '1px solid rgba(79, 70, 229, 0.16)',
                            background: 'linear-gradient(180deg, rgba(79, 70, 229, 0.06) 0%, rgba(79, 70, 229, 0.02) 100%)',
                          }}
                        >
                          <Typography variant="body2" color="text.secondary">
                            Instructor notes and rubric scoring now open in a separate grading panel.
                          </Typography>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() =>
                              openGradingForSubmission(detailData?.submission?.id, {
                                assignmentId: detailData?.submission?.assignment_uuid,
                              })
                            }
                            sx={{ alignSelf: 'flex-start' }}
                          >
                            {detailData?.permissions?.can_edit_grade ? 'Open grading' : 'View grading'}
                          </Button>
                        </Stack>
                      ) : null}
                    </Stack>
                  </Paper>

                  {selectedAttemptHistory.length > 1 ? (
                    <Paper
                      variant="outlined"
                      sx={{
                        borderRadius: 2.25,
                        p: 1.35,
                        borderColor: 'rgba(15, 23, 42, 0.08)',
                        backgroundColor: '#fff',
                      }}
                    >
                      <Stack spacing={1}>
                        <Stack spacing={0.2}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                            Attempt history
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            The table shows the latest attempt. Open any earlier submission here when needed.
                          </Typography>
                        </Stack>
                        <Stack spacing={0.75}>
                          {selectedAttemptHistory.map((attempt) => {
                            const meta = submissionOutcomeMeta(attempt.status)
                            const isSelected = attempt.id === detailData?.submission?.id
                            const submittedAt = attempt.submitted_at
                              ? new Date(attempt.submitted_at)
                              : null
                            const submittedLabel =
                              submittedAt && !Number.isNaN(submittedAt.getTime())
                                ? submittedAt.toLocaleString()
                                : 'Unknown time'
                            return (
                              <Button
                                key={attempt.id}
                                variant="text"
                                size="small"
                                onClick={() => {
                                  if (!isSelected) {
                                    openDetails(attempt.id)
                                  }
                                }}
                                sx={{
                                  justifyContent: 'space-between',
                                  textTransform: 'none',
                                  borderRadius: 1.5,
                                  px: 1,
                                  py: 0.95,
                                  color: 'text.primary',
                                  border: '1px solid',
                                  borderColor: isSelected ? 'rgba(79, 70, 229, 0.22)' : 'rgba(15, 23, 42, 0.08)',
                                  backgroundColor: isSelected ? 'rgba(79, 70, 229, 0.05)' : '#fff',
                                }}
                              >
                                <Stack spacing={0.1} sx={{ minWidth: 0, textAlign: 'left' }}>
                                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                    Attempt {attempt.attempt_number || '—'}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary" noWrap>
                                    {submittedLabel}
                                  </Typography>
                                </Stack>
                                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ ml: 1 }}>
                                  {attempt.grade_score != null && attempt.grade_max_score != null ? (
                                    <Typography variant="caption" color="text.secondary">
                                      {attempt.grade_score}/{attempt.grade_max_score}
                                    </Typography>
                                  ) : null}
                                  <Chip label={meta.label} color={meta.color} size="small" variant="outlined" />
                                </Stack>
                              </Button>
                            )
                          })}
                        </Stack>
                      </Stack>
                    </Paper>
                  ) : null}

                  {(detailData.grading_run?.stdout_key || detailData.grading_run?.stderr_key) ? (
                    <Paper
                      variant="outlined"
                      sx={{
                        borderRadius: 2.25,
                        p: 1.35,
                        borderColor: 'rgba(15, 23, 42, 0.08)',
                        backgroundColor: '#fff',
                      }}
                    >
                      <Stack spacing={1}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                          Technical logs
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Open raw logs only if you need low-level output.
                        </Typography>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          {detailData.grading_run?.stdout_key ? (
                            <Button
                              size="small"
                              variant="outlined"
                              component="a"
                              href={`${API_BASE}/media/${detailData.grading_run.stdout_key}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Stdout
                            </Button>
                          ) : null}
                          {detailData.grading_run?.stderr_key ? (
                            <Button
                              size="small"
                              variant="outlined"
                              component="a"
                              href={`${API_BASE}/media/${detailData.grading_run.stderr_key}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Stderr
                            </Button>
                          ) : null}
                        </Stack>
                      </Stack>
                    </Paper>
                  ) : null}
                </Stack>
              </Box>

              <Stack spacing={1}>
                {submissionManifestLoading ? (
                  <Typography color="text.secondary">Loading submitted files…</Typography>
                ) : submissionManifestError ? (
                  <Alert severity="error">{submissionManifestError}</Alert>
                ) : submissionManifest?.files?.length ? (
                  <Paper
                    variant="outlined"
                    sx={{
                      borderRadius: 2.25,
                      p: 1.35,
                      borderColor: 'rgba(15, 23, 42, 0.08)',
                      backgroundColor: '#fff',
                    }}
                  >
                    <Stack spacing={1.25}>
                      <Stack
                        direction={{ xs: 'column', md: 'row' }}
                        spacing={1}
                        justifyContent="space-between"
                        alignItems={{ xs: 'flex-start', md: 'center' }}
                      >
                        <Stack spacing={0.2}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                            Submitted files
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Preview source files without leaving the submission review.
                          </Typography>
                        </Stack>
                        <Chip size="small" variant="outlined" label={`${submissionManifest.files.length} file${submissionManifest.files.length === 1 ? '' : 's'}`} />
                      </Stack>

                      <Box
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: { xs: '1fr', md: '300px minmax(0, 1fr)' },
                          gap: 1.25,
                        }}
                      >
                        <Stack
                          spacing={0.75}
                          sx={{
                            maxHeight: 300,
                            overflow: 'auto',
                            border: '1px solid',
                            borderColor: 'rgba(15, 23, 42, 0.08)',
                            borderRadius: 1.75,
                            p: 0.9,
                            backgroundColor: 'rgba(248, 250, 252, 0.55)',
                          }}
                        >
                          {submissionManifest.files.map((entry, index) => (
                            <Button
                              key={`${entry.name}-${index}`}
                              variant="text"
                              size="small"
                              sx={{
                                justifyContent: 'space-between',
                                textTransform: 'none',
                                borderRadius: 1.5,
                                px: 1,
                                py: 0.9,
                                color: 'text.primary',
                                border: '1px solid',
                                borderColor: submittedPreviewFileName === entry.name ? 'rgba(79, 70, 229, 0.22)' : 'rgba(15, 23, 42, 0.08)',
                                backgroundColor: submittedPreviewFileName === entry.name ? 'rgba(79, 70, 229, 0.05)' : '#fff',
                              }}
                              onClick={() => openSubmittedFilePreview(entry.name)}
                              disabled={entry.is_dir}
                            >
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{cleanSubmissionEntryName(entry.name)}</span>
                              <span style={{ marginLeft: 8, opacity: 0.75 }}>{formatBytes(entry.size || 0)}</span>
                            </Button>
                          ))}
                        </Stack>
                        <Stack
                          spacing={1}
                          sx={{
                            minWidth: 0,
                            border: '1px solid',
                            borderColor: 'rgba(15, 23, 42, 0.08)',
                            borderRadius: 1.75,
                            p: 1.1,
                            backgroundColor: '#fff',
                          }}
                        >
                          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>
                              {submittedPreviewFileName ? cleanSubmissionEntryName(submittedPreviewFileName) : 'Select a file to preview'}
                            </Typography>
                            {submittedPreviewTruncated ? <Chip size="small" color="warning" label="Truncated" /> : null}
                          </Stack>
                          {submittedPreviewError ? <Alert severity="error">{submittedPreviewError}</Alert> : null}
                          {submittedPreviewLoading ? (
                            <Typography color="text.secondary">Loading file preview…</Typography>
                          ) : submittedPreviewError ? null : submittedPreviewFileName && submittedPreviewMode === 'text' ? (
                            <Box
                              component="pre"
                              sx={{
                                m: 0,
                                p: 1.1,
                                maxHeight: 300,
                                overflow: 'auto',
                                borderRadius: 1.5,
                                border: '1px solid',
                                borderColor: 'divider',
                                backgroundColor: 'rgba(15, 23, 42, 0.04)',
                                fontSize: 12,
                                lineHeight: 1.5,
                                fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                              }}
                            >
                              {submittedPreviewTextContent || '(empty file)'}
                            </Box>
                          ) : submittedPreviewFileName && submittedPreviewMode === 'binary' ? (
                            <Box
                              sx={{
                                border: '1px solid',
                                borderColor: 'divider',
                                borderRadius: 1.5,
                                p: 1,
                                backgroundColor: 'rgba(248, 250, 252, 0.8)',
                              }}
                            >
                              {submittedPreviewMime.startsWith('image/') ? (
                                <Box
                                  component="img"
                                  src={submittedPreviewObjectUrl}
                                  alt={submittedPreviewFileName}
                                  sx={{
                                    width: '100%',
                                    maxHeight: 300,
                                    objectFit: 'contain',
                                    borderRadius: 1,
                                  }}
                                />
                              ) : (
                                <Box
                                  component="iframe"
                                  title={submittedPreviewFileName}
                                  src={submittedPreviewObjectUrl}
                                  sx={{
                                    width: '100%',
                                    minHeight: 300,
                                    border: 0,
                                    borderRadius: 1,
                                    backgroundColor: 'white',
                                  }}
                                />
                              )}
                            </Box>
                          ) : (
                            <Typography color="text.secondary">Choose a file from the list to inspect its contents.</Typography>
                          )}
                        </Stack>
                      </Box>
                    </Stack>
                  </Paper>
                ) : (
                  <Typography color="text.secondary">No submitted files found.</Typography>
                )}
              </Stack>
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDetailDialog}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={gradingDialogOpen}
        onClose={closeGradingDialog}
        maxWidth="md"
        fullWidth
        sx={contentCenteredDialogSx}
        PaperProps={{
          sx: {
            borderRadius: 2.5,
            border: '1px solid',
            borderColor: 'rgba(15, 23, 42, 0.08)',
            backgroundColor: '#fff',
            boxShadow: '0 22px 56px rgba(15, 23, 42, 0.14)',
          },
        }}
      >
        <DialogTitle
          sx={{
            pb: 0.75,
            pt: 1.5,
            fontSize: '1.1rem',
            fontWeight: 800,
          }}
        >
          {canEditSelectedSubmissionGrade ? 'Grading' : 'Feedback'}
        </DialogTitle>
        <DialogContent sx={{ pb: 2, pt: 0.5 }}>
          {detailLoading ? (
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              Loading grading…
            </Typography>
          ) : detailError ? (
            <Alert severity="error" sx={{ mt: 1 }}>{detailError}</Alert>
          ) : detailData ? (
            canEditSelectedSubmissionGrade ? (
              <Stack spacing={1.5} sx={{ mt: 1 }}>
                <Paper
                  variant="outlined"
                  sx={{
                    borderRadius: 2.25,
                    p: { xs: 1.25, md: 1.5 },
                    borderColor: 'rgba(15, 23, 42, 0.08)',
                    backgroundColor: '#fff',
                  }}
                >
                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={1}
                    justifyContent="space-between"
                    alignItems={{ xs: 'flex-start', md: 'center' }}
                  >
                    <Stack spacing={0.2} sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 800, fontSize: { xs: '1.05rem', md: '1.15rem' }, lineHeight: 1.2 }}>
                        {detailData.submission?.assignment_title || 'Submission'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {detailData.submission?.submitted_at
                          ? `Submitted ${new Date(detailData.submission.submitted_at).toLocaleString()}`
                          : 'Submission review'}
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                      <Chip size="small" label={`Grade ${currentGradeLabel}`} />
                      {(() => {
                        const meta = submissionOutcomeMeta(detailData.submission?.status)
                        return <Chip size="small" color={meta.color} label={meta.label} />
                      })()}
                    </Stack>
                  </Stack>
                </Paper>

                <Paper
                  variant="outlined"
                  sx={{
                    borderRadius: 2.25,
                    p: 1.35,
                    borderColor: 'rgba(15, 23, 42, 0.08)',
                    backgroundColor: '#fff',
                  }}
                >
                  <Stack spacing={1}>
                    <Stack spacing={0.3}>
                      <Typography
                        variant="overline"
                        sx={{
                          color: 'primary.main',
                          fontWeight: 800,
                          letterSpacing: '0.08em',
                          lineHeight: 1.2,
                        }}
                      >
                        Instructor note
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Keep student-facing feedback with the saved grade in one place.
                      </Typography>
                    </Stack>

                    <TextField
                      value={reviewFeedback}
                      onChange={(event) => setReviewFeedback(event.target.value)}
                      placeholder="Add concise instructor feedback for this submission."
                      multiline
                      minRows={5}
                      fullWidth
                      sx={{
                        '& .MuiOutlinedInput-root': {
                          backgroundColor: 'rgba(255, 255, 255, 0.92)',
                        },
                      }}
                    />
                    {reviewFeedbackError ? <Alert severity="error">{reviewFeedbackError}</Alert> : null}
                    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                      <Typography variant="caption" color="text.secondary">
                        Feedback is saved with the current grade record.
                      </Typography>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={saveReviewFeedback}
                        disabled={reviewFeedbackSaving || !reviewFeedbackDirty}
                      >
                        {reviewFeedbackSaving ? 'Saving…' : 'Save feedback'}
                      </Button>
                    </Stack>
                  </Stack>
                </Paper>

                {(canEditSelectedSubmissionGrade || detailData?.rubric?.available) ? (
                  <Paper
                    variant="outlined"
                    sx={{
                      borderRadius: 2.25,
                      p: 1.35,
                      borderColor: 'rgba(15, 23, 42, 0.08)',
                      backgroundColor: '#fff',
                    }}
                  >
                    <Stack spacing={1.1}>
                      <Stack spacing={0.2}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                          Rubric grading
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Review the rubric here and score criteria when grading access is available.
                        </Typography>
                      </Stack>

                      {detailData?.rubric?.available ? (
                        <>
                          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                            <Chip size="small" label={`v${rubricDraft?.version_number || detailData.rubric.version_number || 0}`} />
                            <Chip
                              size="small"
                              variant="outlined"
                              label={detailData.rubric.is_weighted ? 'Weighted' : 'Unweighted'}
                            />
                            <Chip
                              size="small"
                              variant="outlined"
                              label={`Grade ${formatScoreValue(rubricSummary.score)}/${formatScoreValue(rubricSummary.maxScore)}`}
                            />
                          </Stack>

                          {rubricError ? <Alert severity="error">{rubricError}</Alert> : null}

                          <Stack spacing={1}>
                            {(rubricDraft?.criteria || []).map((criterion) => (
                              <Paper
                                key={criterion.criterion_id}
                                variant="outlined"
                                sx={{
                                  p: 1,
                                  borderRadius: 1.75,
                                  borderColor: 'rgba(15, 23, 42, 0.08)',
                                  backgroundColor: 'rgba(248, 250, 252, 0.72)',
                                }}
                              >
                                <Stack spacing={0.9}>
                                  <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="flex-start">
                                    <Stack spacing={0.2} sx={{ minWidth: 0 }}>
                                      <Typography variant="body2" sx={{ fontWeight: 800 }}>
                                        {criterion.name}
                                      </Typography>
                                      <Typography variant="caption" color="text.secondary">
                                        {detailData.rubric.is_weighted && criterion.weight !== ''
                                          ? `${criterion.max_points} pts • ${criterion.weight} wt`
                                          : `${criterion.max_points} pts`}
                                      </Typography>
                                    </Stack>
                                    <TextField
                                      label="Score"
                                      type="number"
                                      size="small"
                                      value={criterion.points_awarded}
                                      onChange={(event) => updateRubricCriterion(criterion.criterion_id, 'points_awarded', event.target.value)}
                                      inputProps={{
                                        min: 0,
                                        max: criterion.max_points,
                                        step: '0.01',
                                      }}
                                      sx={{ width: 120, flexShrink: 0 }}
                                    />
                                  </Stack>
                                  <TextField
                                    label="Criterion note"
                                    size="small"
                                    value={criterion.comment}
                                    onChange={(event) => updateRubricCriterion(criterion.criterion_id, 'comment', event.target.value)}
                                    multiline
                                    minRows={2}
                                    fullWidth
                                  />
                                </Stack>
                              </Paper>
                            ))}
                          </Stack>

                          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                            <Typography variant="caption" color="text.secondary">
                              {detailData.rubric.is_weighted
                                ? `Weights total ${Number(rubricDraft?.total_weight || 0).toFixed(2)}. Final grade is normalized to ${formatScoreValue(rubricSummary.maxScore)}.`
                                : `Rubric points total ${Number(rubricDraft?.total_points || 0).toFixed(2)}. Final grade is scaled to ${formatScoreValue(rubricSummary.maxScore)}.`}
                            </Typography>
                            <Button
                              size="small"
                              variant="contained"
                              onClick={saveRubricGrade}
                              disabled={rubricSaving || !rubricDraftDirty}
                            >
                              {rubricSaving ? 'Saving…' : 'Save rubric'}
                            </Button>
                          </Stack>
                        </>
                      ) : (
                        <Alert severity="info" variant="outlined">
                          No active rubric is available for this assignment yet.
                        </Alert>
                      )}
                    </Stack>
                  </Paper>
                ) : null}
              </Stack>
            ) : (
              <Stack spacing={1.5} sx={{ mt: 1 }}>
                <Paper
                  variant="outlined"
                  sx={{
                    borderRadius: 3,
                    p: { xs: 1.35, md: 1.6 },
                    borderColor: 'rgba(79, 70, 229, 0.14)',
                    background: 'linear-gradient(145deg, rgba(255,255,255,1) 0%, rgba(248,250,255,0.96) 60%, rgba(238,242,255,0.92) 100%)',
                    boxShadow: '0 16px 36px rgba(15, 23, 42, 0.06)',
                  }}
                >
                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={1.25}
                    justifyContent="space-between"
                    alignItems={{ xs: 'flex-start', md: 'center' }}
                  >
                    <Stack spacing={0.3} sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 900, fontSize: { xs: '1.25rem', md: '1.45rem' }, lineHeight: 1.15 }}>
                        {detailData.submission?.assignment_title || 'Submission feedback'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {detailData.submission?.submitted_at
                          ? `Submitted ${new Date(detailData.submission.submitted_at).toLocaleString()}`
                          : 'Submission review'}
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.8} flexWrap="wrap" useFlexGap alignItems="center">
                      <Chip
                        size="medium"
                        label={currentGradeLabel === 'Not graded' ? currentGradeLabel : `Grade ${currentGradeLabel}`}
                        sx={{
                          height: 42,
                          px: 0.7,
                          borderRadius: 999,
                          fontWeight: 800,
                          fontSize: '0.95rem',
                          backgroundColor: 'rgba(79, 70, 229, 0.12)',
                          color: 'text.primary',
                        }}
                      />
                      {(() => {
                        const meta = submissionOutcomeMeta(detailData.submission?.status)
                        return (
                          <Chip
                            size="medium"
                            color={meta.color}
                            label={meta.label}
                            sx={{ height: 42, borderRadius: 999, fontWeight: 800, fontSize: '0.95rem' }}
                          />
                        )
                      })()}
                    </Stack>
                  </Stack>
                </Paper>

                <Paper
                  variant="outlined"
                  sx={{
                    borderRadius: 3,
                    p: { xs: 1.3, md: 1.55 },
                    borderColor: 'rgba(79, 70, 229, 0.14)',
                    background: 'linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(247,248,255,0.96) 100%)',
                  }}
                >
                  <Stack spacing={1}>
                    <Stack spacing={0.2}>
                      <Typography
                        variant="overline"
                        sx={{
                          color: 'primary.main',
                          fontWeight: 900,
                          letterSpacing: '0.08em',
                          lineHeight: 1.1,
                        }}
                      >
                        Instructor note
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Your instructor feedback is kept here with the saved grade.
                      </Typography>
                    </Stack>
                    {detailData?.grade?.feedback ? (
                      <Box
                        sx={{
                          borderRadius: 2.5,
                          px: 1.25,
                          py: 1.1,
                          border: '1px solid rgba(99, 102, 241, 0.18)',
                          backgroundColor: 'rgba(255, 255, 255, 0.92)',
                        }}
                      >
                        <Typography
                          variant="body1"
                          sx={{
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            lineHeight: 1.65,
                            fontWeight: 700,
                            fontSize: '1rem',
                          }}
                        >
                          {detailData.grade.feedback}
                        </Typography>
                      </Box>
                    ) : (
                      <Alert severity="info" variant="outlined">
                        No instructor note has been added yet.
                      </Alert>
                    )}
                  </Stack>
                </Paper>

                {Array.isArray(detailData?.rubric?.attachments) && detailData.rubric.attachments.length ? (
                  <Paper
                    variant="outlined"
                    sx={{
                      borderRadius: 3,
                      p: { xs: 1.25, md: 1.45 },
                      borderColor: 'rgba(15, 23, 42, 0.08)',
                      backgroundColor: '#fff',
                    }}
                  >
                    <Stack spacing={1}>
                      <Stack spacing={0.2}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
                          Rubric reference files
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          These files are shared for reference only and do not change the saved grade.
                        </Typography>
                      </Stack>
                      <Stack spacing={0.85}>
                        {detailData.rubric.attachments.map((asset) => (
                          <Paper
                            key={asset.id}
                            variant="outlined"
                            sx={{
                              p: 1,
                              borderRadius: 2,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 1,
                            }}
                          >
                            <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                              <InsertDriveFileRounded fontSize="small" color="action" />
                              <Stack spacing={0.15} sx={{ minWidth: 0 }}>
                                <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                                  {asset.original_name}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {formatBytes(asset.file_size)}
                                </Typography>
                              </Stack>
                            </Stack>
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<DownloadRounded />}
                              onClick={() => window.open(asset.download_url, '_blank', 'noopener,noreferrer')}
                            >
                              Download
                            </Button>
                          </Paper>
                        ))}
                      </Stack>
                    </Stack>
                  </Paper>
                ) : null}

                {detailData?.rubric?.available ? (
                  <Paper
                    variant="outlined"
                    sx={{
                      borderRadius: 3,
                      p: { xs: 1.3, md: 1.55 },
                      borderColor: 'rgba(15, 23, 42, 0.08)',
                      backgroundColor: '#fff',
                    }}
                  >
                    <Stack spacing={1.2}>
                      <Stack spacing={0.25}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
                          Rubric breakdown
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          See how each criterion contributed to the saved grade.
                        </Typography>
                      </Stack>

                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                        <Chip size="small" label={`v${rubricDraft?.version_number || detailData.rubric.version_number || 0}`} />
                        <Chip
                          size="small"
                          variant="outlined"
                          label={detailData.rubric.is_weighted ? 'Weighted rubric' : 'Unweighted rubric'}
                        />
                        <Chip
                          size="small"
                          variant="outlined"
                          label={`Overall ${formatScoreValue(rubricSummary.score)}/${formatScoreValue(rubricSummary.maxScore)}`}
                        />
                      </Stack>

                      <Stack spacing={1}>
                        {(rubricDraft?.criteria || []).map((criterion) => {
                          const maxPoints = Number(criterion.max_points || 0)
                          const awarded = Number(criterion.points_awarded || 0)
                          const boundedAwarded = Math.min(Math.max(Number.isFinite(awarded) ? awarded : 0, 0), maxPoints > 0 ? maxPoints : 0)
                          const ratio = maxPoints > 0 ? (boundedAwarded / maxPoints) * 100 : 0
                          return (
                            <Paper
                              key={criterion.criterion_id}
                              variant="outlined"
                              sx={{
                                p: 1.15,
                                borderRadius: 2.25,
                                borderColor: 'rgba(15, 23, 42, 0.08)',
                                backgroundColor: 'rgba(248, 250, 252, 0.86)',
                              }}
                            >
                              <Stack spacing={0.95}>
                                <Stack
                                  direction={{ xs: 'column', sm: 'row' }}
                                  spacing={1}
                                  justifyContent="space-between"
                                  alignItems={{ xs: 'flex-start', sm: 'center' }}
                                >
                                  <Stack spacing={0.2} sx={{ minWidth: 0 }}>
                                    <Typography variant="body1" sx={{ fontWeight: 800, lineHeight: 1.25 }}>
                                      {criterion.name}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                      {detailData.rubric.is_weighted && criterion.weight !== ''
                                        ? `${formatScoreValue(criterion.max_points)} pts • ${criterion.weight} wt`
                                        : `${formatScoreValue(criterion.max_points)} pts`}
                                    </Typography>
                                  </Stack>
                                  <Stack spacing={0.2} alignItems={{ xs: 'flex-start', sm: 'flex-end' }}>
                                    <Chip
                                      size="small"
                                      label={`${formatScoreValue(boundedAwarded)}/${formatScoreValue(maxPoints)}`}
                                      sx={{
                                        borderRadius: 999,
                                        fontWeight: 800,
                                        backgroundColor: 'rgba(15, 23, 42, 0.06)',
                                      }}
                                    />
                                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                                      {`${Math.round(ratio)}%`}
                                    </Typography>
                                  </Stack>
                                </Stack>
                                <LinearProgress
                                  variant="determinate"
                                  value={ratio}
                                  sx={{
                                    height: 8,
                                    borderRadius: 999,
                                    backgroundColor: 'rgba(148, 163, 184, 0.18)',
                                    '& .MuiLinearProgress-bar': {
                                      borderRadius: 999,
                                      background: 'linear-gradient(90deg, #4f46e5 0%, #7c3aed 100%)',
                                    },
                                  }}
                                />
                                {criterion.comment ? (
                                  <Box
                                    sx={{
                                      borderRadius: 2,
                                      px: 1,
                                      py: 0.9,
                                      backgroundColor: 'rgba(255,255,255,0.94)',
                                      border: '1px solid rgba(15, 23, 42, 0.06)',
                                    }}
                                  >
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.35 }}>
                                      Criterion note
                                    </Typography>
                                    <Typography
                                      variant="body2"
                                      sx={{
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word',
                                        lineHeight: 1.65,
                                      }}
                                    >
                                      {criterion.comment}
                                    </Typography>
                                  </Box>
                                ) : (
                                  <Typography variant="caption" color="text.secondary">
                                    No rubric note added for this criterion.
                                  </Typography>
                                )}
                              </Stack>
                            </Paper>
                          )
                        })}
                      </Stack>

                      <Typography variant="caption" color="text.secondary">
                        {detailData.rubric.is_weighted
                          ? `Weights total ${Number(rubricDraft?.total_weight || 0).toFixed(2)}. Final grade is normalized to ${formatScoreValue(rubricSummary.maxScore)}.`
                          : `Rubric points total ${Number(rubricDraft?.total_points || 0).toFixed(2)}. Final grade is scaled to ${formatScoreValue(rubricSummary.maxScore)}.`}
                      </Typography>
                    </Stack>
                  </Paper>
                ) : null}
              </Stack>
            )
          ) : (
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              No grading data available.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeGradingDialog}>Close</Button>
        </DialogActions>
      </Dialog>

    </Box>
  )
}

export default CourseSubmissions
