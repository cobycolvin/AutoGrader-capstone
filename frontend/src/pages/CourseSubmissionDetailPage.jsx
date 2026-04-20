import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Divider,
  IconButton,
  LinearProgress,
  Paper,
  Skeleton,
  Stack,
  TextField,
  Typography,
  Tooltip,
  useMediaQuery,
} from '@mui/material'
import {
  AddRounded,
  ArrowBackRounded,
  ArrowForwardRounded,
  CancelRounded,
  CheckCircleRounded,
  ChevronRightRounded,
  DeleteRounded,
  DownloadRounded,
  ExpandMoreRounded,
  InsertDriveFileRounded,
  RefreshRounded,
  ScheduleRounded,
  VisibilityRounded,
} from '@mui/icons-material'
import { useTheme } from '@mui/material/styles'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { apiRequest, API_BASE } from '../api/client.js'
import SubmissionSimilarityPanel from '../components/SubmissionSimilarityPanel.jsx'

const MAX_SUBMISSION_PREVIEW_BYTES = 5 * 1024 * 1024
const CARD_RADIUS = 1

const PROCESS_FAILURE_KINDS = new Set([
  'TIMEOUT',
  'COMPILE_ERROR',
  'RUNTIME_ERROR',
  'MISSING_ENTRYPOINT',
  'MISSING_SOURCE_FILES',
  'EXECUTION_TOOL_MISSING',
  'UNSUPPORTED_LANGUAGE',
])

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

const formatMemberPreview = (usernames, limit = 3) => {
  const list = Array.isArray(usernames) ? usernames.filter(Boolean) : []
  if (!list.length) return 'No members assigned'
  if (list.length <= limit) return list.join(', ')
  return `${list.slice(0, limit).join(', ')} +${list.length - limit} more`
}

const buildTerminalTextFieldSx = (isDark) => ({
  '& .MuiInputLabel-root': {
    color: isDark ? 'rgba(226, 232, 240, 0.85)' : 'rgba(71, 85, 105, 0.9)',
    fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
  },
  '& .MuiOutlinedInput-root': {
    alignItems: 'flex-start',
    backgroundColor: isDark ? '#0b1020' : '#f8fafc',
    color: isDark ? '#e2e8f0' : '#0f172a',
    fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
    fontSize: 13,
    lineHeight: 1.6,
    '& fieldset': {
      borderColor: isDark ? 'rgba(148, 163, 184, 0.25)' : 'rgba(148, 163, 184, 0.45)',
    },
    '&:hover fieldset': {
      borderColor: isDark ? 'rgba(129, 140, 248, 0.55)' : 'rgba(99, 102, 241, 0.5)',
    },
    '&.Mui-focused fieldset': {
      borderColor: isDark ? 'rgba(165, 180, 252, 0.88)' : 'rgba(79, 70, 229, 0.8)',
    },
    '& textarea': {
      whiteSpace: 'pre',
      overflowWrap: 'normal',
      caretColor: isDark ? '#a5b4fc' : '#4f46e5',
    },
    '& input': {
      caretColor: isDark ? '#a5b4fc' : '#4f46e5',
    },
  },
})

const formatCommandArg = (value) => {
  const text = String(value ?? '')
  if (!text) return '""'
  return /\s/.test(text) ? JSON.stringify(text) : text
}

const buildCommandLine = (base, args = []) => {
  const baseCommand = String(base || '').trim()
  const renderedArgs = (args || []).map((value) => formatCommandArg(value))
  return [baseCommand, ...renderedArgs].filter(Boolean).join(' ').trim()
}

const buildInputFile = (index) => ({
  id: `input-${Date.now()}-${index}`,
  path: '',
  content: '',
})

const formatScoreValue = (value) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return '0'
  const rounded = Math.round(number * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, '')
}

const scoreInputValue = (value, fallback = '') => {
  if (value == null || value === '') return fallback
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return formatScoreValue(number)
}

const formatIdentifierLabel = (value) =>
  String(value || '')
    .split('_')
    .filter(Boolean)
    .map((segment) => segment.charAt(0) + segment.slice(1).toLowerCase())
    .join(' ')

const submissionOutcomeMeta = (statusRaw) => {
  const status = String(statusRaw || '').toUpperCase()
  if (status === 'GRADED') return { label: 'Pass', color: 'success' }
  if (status === 'FAILED') return { label: 'Fail', color: 'error' }
  if (status === 'RUNNING') return { label: 'Running', color: 'warning' }
  if (status === 'QUEUED' || status === 'PENDING' || status === 'SUBMITTED') {
    return { label: 'Pending', color: 'warning' }
  }
  return { label: status ? formatIdentifierLabel(status) : '—', color: 'default' }
}

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

  if (!serializedResults.length && !runTests.length) return []

  const runTestsByName = new Map()
  runTests.forEach((entry) => {
    const name = String(entry?.name || '')
    if (!runTestsByName.has(name)) runTestsByName.set(name, [])
    runTestsByName.get(name).push(entry)
  })

  if (serializedResults.length) {
    return serializedResults.map((row, index) => {
      let runEntry = null
      if (index < runTests.length && String(runTests[index]?.name || '') === String(row?.test_name || '')) {
        runEntry = runTests[index]
      } else {
        const bucket = runTestsByName.get(String(row?.test_name || ''))
        if (bucket?.length) runEntry = bucket.shift()
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

const feedbackSortValue = (result) => {
  if (PROCESS_FAILURE_KINDS.has(result?.failure_kind || '')) return 0
  if (result?.status !== 'PASS') return 1
  return 2
}

const sortFeedbackResults = (results) =>
  [...results].sort((left, right) => feedbackSortValue(left) - feedbackSortValue(right))

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

const feedbackStatusMeta = (result) => {
  if (result?.status === 'PASS') return { label: 'Passed', color: 'success' }
  if (PROCESS_FAILURE_KINDS.has(result?.failure_kind || '')) return { label: 'Did not complete', color: 'warning' }
  return { label: 'Failed', color: 'error' }
}

const hasRenderableDetailValue = (value) => {
  if (value == null) return false
  if (typeof value === 'string') return value !== ''
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

const formatDetailValue = (value) => {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry, null, 2)))
      .join('\n')
  }
  return JSON.stringify(value, null, 2)
}

const VERIFICATION_DETAIL_FIELD_GROUPS = [
  { label: 'Input', keys: ['input_preview', 'stdin_preview'] },
  { label: 'Arguments', keys: ['args'] },
  { label: 'Expected output', keys: ['expected_preview', 'expected_stdout_preview'] },
  { label: 'Expected error output', keys: ['expected_stderr_preview'] },
  { label: 'Actual output', keys: ['actual_preview', 'actual_stdout_preview', 'stdout_preview'] },
  { label: 'Standard error', keys: ['stderr_preview'] },
  { label: 'Input files', keys: ['input_files_preview'] },
  { label: 'Expected files', keys: ['expected_files_preview'] },
  { label: 'Comparison notes', keys: ['comparison_message', 'validator_message'] },
  { label: 'Produced files', keys: ['produced_files'] },
  { label: 'Target', keys: ['target'] },
  { label: 'Error', keys: ['error'] },
]

const STRUCTURED_DETAIL_KEYS = new Set([
  'summary',
  'kind',
  'failure_kind',
  'issues',
  'expected_exit_code',
  'actual_exit_code',
  ...VERIFICATION_DETAIL_FIELD_GROUPS.flatMap((group) => group.keys),
])

const buildVerificationDetailSections = (details) => {
  if (!details || typeof details !== 'object') return []
  const sections = []

  VERIFICATION_DETAIL_FIELD_GROUPS.forEach((group) => {
    for (const key of group.keys) {
      const value = details[key]
      if (!hasRenderableDetailValue(value)) continue
      sections.push({
        key,
        label: group.label,
        value: formatDetailValue(value),
      })
      break
    }
  })

  if (details.expected_exit_code != null || details.actual_exit_code != null) {
    sections.push({
      key: 'exit_codes',
      label: 'Exit codes',
      value: [
        details.expected_exit_code != null ? `Expected: ${details.expected_exit_code}` : null,
        details.actual_exit_code != null ? `Actual: ${details.actual_exit_code}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    })
  }

  return sections
}

const feedbackListSummary = (result) => {
  if (result?.summary || result?.message) return result.summary || result.message
  const hasCaseDetails =
    buildVerificationDetailSections(result?.details).length > 0
    || buildVerificationIssueCards(result?.details).length > 0
  return hasCaseDetails ? 'Configured test available.' : 'No additional details.'
}

const feedbackDetailSummary = (result, detailSections, issueCards) => {
  if (result?.summary || result?.message) return result.summary || result.message
  return detailSections.length || issueCards.length
    ? 'Configured test details are shown below.'
    : 'No detailed summary was recorded.'
}

const buildVerificationIssueCards = (details) => {
  const issues = Array.isArray(details?.issues) ? details.issues : []
  return issues
    .filter((issue) => issue && typeof issue === 'object')
    .map((issue, index) => ({
      id: `issue-${index}`,
      title: issue.summary || formatIdentifierLabel(issue.kind || `issue_${index + 1}`),
      kind: issue.kind || '',
      sections: buildVerificationDetailSections(issue),
      extra: Object.fromEntries(
        Object.entries(issue).filter(([key, value]) => !STRUCTURED_DETAIL_KEYS.has(key) && hasRenderableDetailValue(value)),
      ),
    }))
}

const buildResidualVerificationDetails = (details) => {
  if (!details || typeof details !== 'object') return {}
  return Object.fromEntries(
    Object.entries(details).filter(([key, value]) => !STRUCTURED_DETAIL_KEYS.has(key) && hasRenderableDetailValue(value)),
  )
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
          points_awarded:
            criterion.points_awarded == null || criterion.points_awarded === '' ? '0' : String(criterion.points_awarded),
          comment: criterion.comment || '',
          order_index: Number(criterion.order_index || 0),
          levels: Array.isArray(criterion.levels)
            ? criterion.levels.map((l) => ({
                label: l.label || '',
                min_points: Number(l.min_points ?? 0),
                max_points: Number(l.max_points ?? 0),
                description: l.description || '',
              }))
            : [],
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
  if (!draft?.criteria?.length) return { score: 0, maxScore: 0 }

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
      if (!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(maxPoints) || maxPoints <= 0) return sum
      const boundedAwarded = Math.min(Math.max(Number.isFinite(awarded) ? awarded : 0, 0), maxPoints)
      return sum + (boundedAwarded / maxPoints) * (weight / totalWeight)
    }, 0)
    return {
      score: Math.round(weightedRatio * maxScoreBase * 100) / 100,
      maxScore: maxScoreBase,
    }
  }

  if (totalPoints <= 0) return { score: 0, maxScore: maxScoreBase > 0 ? maxScoreBase : 0 }

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

const getPreviewMode = (mimeType, fileName) => {
  const mime = String(mimeType || '')
  const extension = String(fileName || '').split('.').pop()?.toLowerCase() || ''
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf' || extension === 'pdf') return 'pdf'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('text/') || extension) return 'text'
  return 'binary'
}

const pickPreferredPreviewFile = (files) => {
  const regularFiles = (files || []).filter((file) => !file.is_dir)
  if (!regularFiles.length) return ''
  const preferredExtensions = new Set([
    'py',
    'java',
    'js',
    'jsx',
    'ts',
    'tsx',
    'json',
    'md',
    'txt',
    'html',
    'css',
    'xml',
    'csv',
  ])
  const preferred = regularFiles.find((file) => {
    const extension = String(file.name || '').split('.').pop()?.toLowerCase() || ''
    return preferredExtensions.has(extension)
  })
  return (preferred || regularFiles[0]).name
}

const PROFESSOR_REVIEW_TABS = [
  { key: 'review', label: 'Review' },
  { key: 'tests', label: 'Tests' },
  { key: 'similarity', label: 'Similarity' },
  { key: 'ai-detection', label: 'AI Detection' },
]

const submissionGroupKey = (entry, fallbackAssignmentId = '') => {
  const assignmentUuid = String(entry?.assignment_uuid || entry?.assignment_id || fallbackAssignmentId || '')
  const groupId = String(entry?.group || entry?.group_id || '')
  if (groupId) {
    return `${assignmentUuid}:group:${groupId}`
  }
  const submitterId = String(entry?.submitted_by || '')
  return `${assignmentUuid}:user:${submitterId}`
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

function CourseSubmissionDetailPage({ user }) {
  const theme = useTheme()
  const isProfessorDesktop = useMediaQuery(theme.breakpoints.up('lg'))
  const isDarkMode = theme.palette.mode === 'dark'
  const { courseId, assignmentId, submissionId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const gradingSectionRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detailData, setDetailData] = useState(null)
  const [manifest, setManifest] = useState(null)
  const [manifestLoading, setManifestLoading] = useState(false)
  const [manifestError, setManifestError] = useState('')
  const [selectedFeedbackIndex, setSelectedFeedbackIndex] = useState(0)
  const [submittedPreviewFileName, setSubmittedPreviewFileName] = useState('')
  const [submittedPreviewMode, setSubmittedPreviewMode] = useState('none')
  const [submittedPreviewTextContent, setSubmittedPreviewTextContent] = useState('')
  const [submittedPreviewObjectUrl, setSubmittedPreviewObjectUrl] = useState('')
  const [submittedPreviewTruncated, setSubmittedPreviewTruncated] = useState(false)
  const [submittedPreviewLoading, setSubmittedPreviewLoading] = useState(false)
  const [submittedPreviewError, setSubmittedPreviewError] = useState('')
  const [submittedPreviewMime, setSubmittedPreviewMime] = useState('')
  const [reviewFeedback, setReviewFeedback] = useState('')
  const [gradeRecordScore, setGradeRecordScore] = useState('')
  const [gradeRecordMaxScore, setGradeRecordMaxScore] = useState('')
  const [gradeRecordSaving, setGradeRecordSaving] = useState(false)
  const [reviewFeedbackError, setReviewFeedbackError] = useState('')
  const [rubricDraft, setRubricDraft] = useState(null)
  const [rubricSaving, setRubricSaving] = useState(false)
  const [rubricError, setRubricError] = useState('')
  const [rerunSubmissionId, setRerunSubmissionId] = useState('')
  const [reviewTab, setReviewTab] = useState('review')
  const [aiScan, setAiScan] = useState(null)
  const [aiScanLoading, setAiScanLoading] = useState(false)
  const [aiScanError, setAiScanError] = useState('')
  const [aiFileCache, setAiFileCache] = useState({})
  const [aiExpandedFinding, setAiExpandedFinding] = useState(null)
  const [aiSnippetLoading, setAiSnippetLoading] = useState(false)
  const [submissionQueue, setSubmissionQueue] = useState([])
  const [submissionQueueLoading, setSubmissionQueueLoading] = useState(false)
  const [assignmentSubmissions, setAssignmentSubmissions] = useState([])
  const [showPassedTests, setShowPassedTests] = useState(false)
  const [consoleArgsText, setConsoleArgsText] = useState('')
  const [consoleStdinText, setConsoleStdinText] = useState('')
  const [consoleInputFiles, setConsoleInputFiles] = useState([])
  const [consoleRunLoading, setConsoleRunLoading] = useState(false)
  const [consoleRunError, setConsoleRunError] = useState('')
  const [consoleRunResult, setConsoleRunResult] = useState(null)
  const [consoleSelectedProducedFileName, setConsoleSelectedProducedFileName] = useState('')
  const [consoleStdinUploadError, setConsoleStdinUploadError] = useState('')
  const [consoleStdinSourceLabel, setConsoleStdinSourceLabel] = useState('')
  const [consoleAdvancedOpen, setConsoleAdvancedOpen] = useState(false)
  const [showConsolePanel, setShowConsolePanel] = useState(false)
  const consoleStdinFileInputRef = useRef(null)

  const feedbackResults = useMemo(() => sortFeedbackResults(mergeFeedbackResults(detailData)), [detailData])
  const feedbackSummary = useMemo(() => buildFeedbackSummary(feedbackResults), [feedbackResults])
  const feedbackIndexed = useMemo(
    () => feedbackResults.map((result, index) => ({ result, index })),
    [feedbackResults],
  )
  const failedFeedback = useMemo(
    () =>
      feedbackIndexed.filter(
        ({ result }) => result.status !== 'PASS' || PROCESS_FAILURE_KINDS.has(result.failure_kind || ''),
      ),
    [feedbackIndexed],
  )
  const passedFeedback = useMemo(
    () =>
      feedbackIndexed.filter(
        ({ result }) => result.status === 'PASS' && !PROCESS_FAILURE_KINDS.has(result.failure_kind || ''),
      ),
    [feedbackIndexed],
  )
  const loadedRubricDraft = useMemo(() => buildRubricDraft(detailData?.rubric), [detailData?.rubric])
  const rubricSummary = useMemo(() => computeRubricDraftSummary(rubricDraft), [rubricDraft])
  const defaultGradeMaxScore = useMemo(() => {
    if (detailData?.grade?.max_score != null) return Number(detailData.grade.max_score)
    if (detailData?.submission?.assignment_max_score != null) return Number(detailData.submission.assignment_max_score)
    if (detailData?.rubric?.computed_max_score != null) return Number(detailData.rubric.computed_max_score)
    return 0
  }, [detailData?.grade?.max_score, detailData?.submission?.assignment_max_score, detailData?.rubric?.computed_max_score])
  const loadedGradeScore = useMemo(
    () => scoreInputValue(detailData?.grade?.score, ''),
    [detailData?.grade?.score],
  )
  const loadedGradeMaxScore = useMemo(
    () => scoreInputValue(defaultGradeMaxScore, ''),
    [defaultGradeMaxScore],
  )
  const reviewFeedbackDirty = useMemo(
    () => reviewFeedback !== (detailData?.grade?.feedback || ''),
    [detailData?.grade?.feedback, reviewFeedback],
  )
  const gradeRecordDirty = useMemo(
    () => gradeRecordScore !== loadedGradeScore || gradeRecordMaxScore !== loadedGradeMaxScore || reviewFeedbackDirty,
    [gradeRecordMaxScore, gradeRecordScore, loadedGradeMaxScore, loadedGradeScore, reviewFeedbackDirty],
  )
  const rubricDraftDirty = useMemo(
    () => serializeRubricDraft(rubricDraft) !== serializeRubricDraft(loadedRubricDraft),
    [loadedRubricDraft, rubricDraft],
  )
  const selectedFeedback = feedbackResults[selectedFeedbackIndex] || null
  const selectedFeedbackDetailSections = useMemo(
    () => buildVerificationDetailSections(selectedFeedback?.details),
    [selectedFeedback?.details],
  )
  const selectedFeedbackIssueCards = useMemo(
    () => buildVerificationIssueCards(selectedFeedback?.details),
    [selectedFeedback?.details],
  )
  const selectedFeedbackResidualDetails = useMemo(
    () => buildResidualVerificationDetails(selectedFeedback?.details),
    [selectedFeedback?.details],
  )
  const canEditGrade = Boolean(detailData?.permissions?.can_edit_grade)
  const canRerun = Boolean(detailData?.permissions?.can_rerun)
  const useProfessorWorkspace = canEditGrade && isProfessorDesktop
  const canViewSimilarity = Boolean(user?.is_superuser || user?.is_instructor || user?.is_ta)
  const professorReviewTabs = useMemo(
    () => PROFESSOR_REVIEW_TABS.filter((tab) => canViewSimilarity || tab.key !== 'similarity'),
    [canViewSimilarity],
  )
  const currentGradeLabel = detailData?.grade
    ? `${formatScoreValue(detailData.grade.score)}/${formatScoreValue(detailData.grade.max_score)}`
    : 'Not graded'
  const currentQueueIndex = useMemo(
    () => submissionQueue.findIndex((row) => String(row?.id || '') === String(submissionId || '')),
    [submissionId, submissionQueue],
  )
  const nextSubmissionRow = currentQueueIndex >= 0 ? submissionQueue[currentQueueIndex + 1] || null : null
  const previousSubmissionRow = currentQueueIndex > 0 ? submissionQueue[currentQueueIndex - 1] || null : null
  const currentSubmissionOwnerLabel = detailData?.submission?.group_name || detailData?.submission?.submitted_by_username || 'Student'
  const currentSubmissionActorLabel = detailData?.submission?.submitted_by_username || '—'
  const currentSubmissionMemberNames = detailData?.submission?.group_member_usernames || []
  const nextSubmissionLabel = nextSubmissionRow?.group_name || nextSubmissionRow?.submitted_by_username || ''
  const queueProgressLabel =
    currentQueueIndex >= 0 && submissionQueue.length
      ? `${currentQueueIndex + 1} of ${submissionQueue.length}`
      : ''
  const attemptHistory = useMemo(() => {
    if (!assignmentSubmissions.length) return []
    const currentKey = submissionGroupKey(
      {
        assignment_uuid: detailData?.submission?.assignment_uuid,
        group: detailData?.submission?.group,
        submitted_by: detailData?.submission?.submitted_by,
      },
      assignmentId,
    )
    const attempts = assignmentSubmissions.filter(
      (row) => submissionGroupKey(row, assignmentId) === currentKey,
    )
    return attempts.sort(compareSubmissionsNewestFirst)
  }, [
    assignmentSubmissions,
    assignmentId,
    detailData?.submission?.assignment_uuid,
    detailData?.submission?.group,
    detailData?.submission?.submitted_by,
  ])
  const draftOverallGradeLabel = useMemo(() => {
    const scoreNumber = Number(gradeRecordScore)
    const maxScoreNumber = Number(gradeRecordMaxScore)
    if (Number.isFinite(scoreNumber) && Number.isFinite(maxScoreNumber) && maxScoreNumber > 0) {
      return `${formatScoreValue(scoreNumber)}/${formatScoreValue(maxScoreNumber)}`
    }
    return currentGradeLabel
  }, [currentGradeLabel, gradeRecordMaxScore, gradeRecordScore])
  const terminalTextFieldSx = useMemo(() => buildTerminalTextFieldSx(isDarkMode), [isDarkMode])
  const runCapability = useMemo(() => {
    if (detailData?.file_run?.available) return { ...detailData.file_run, kind: 'file' }
    if (detailData?.console?.available) return { ...detailData.console, kind: 'console' }
    if (detailData?.file_run) return { ...detailData.file_run, kind: 'file' }
    if (detailData?.console) return { ...detailData.console, kind: 'console' }
    return null
  }, [detailData])
  const consoleArgs = useMemo(
    () => consoleArgsText.split('\n').map((value) => value.trim()).filter(Boolean),
    [consoleArgsText],
  )
  const isConsoleFileRun = runCapability?.kind === 'file'
  const consoleCommandLine = useMemo(
    () =>
      isConsoleFileRun
        ? buildCommandLine(runCapability?.command_preview || runCapability?.entry_label || '', consoleArgs)
        : (runCapability?.command_preview || runCapability?.entry_label || '').trim(),
    [consoleArgs, isConsoleFileRun, runCapability?.command_preview, runCapability?.entry_label],
  )
  const consoleProducedFile = useMemo(() => {
    const files = Array.isArray(consoleRunResult?.produced_files) ? consoleRunResult.produced_files : []
    if (!files.length) return null
    return files.find((entry) => entry.name === consoleSelectedProducedFileName) || files[0]
  }, [consoleRunResult, consoleSelectedProducedFileName])
  const consoleProducedFiles = useMemo(
    () => (Array.isArray(consoleRunResult?.produced_files) ? consoleRunResult.produced_files : []),
    [consoleRunResult],
  )
  const consoleResultMeta = useMemo(() => {
    if (!consoleRunResult) return []
    const status = String(consoleRunResult.exit_status || '').toUpperCase()
    const isFailure = PROCESS_FAILURE_KINDS.has(status) || Number(consoleRunResult.returncode) > 0
    return [
      consoleRunResult.exit_status
        ? {
            key: 'status',
            label: formatIdentifierLabel(consoleRunResult.exit_status),
            color: isFailure ? 'error' : 'success',
          }
        : null,
      consoleRunResult.returncode != null
        ? {
            key: 'returncode',
            label: `Exit ${consoleRunResult.returncode}`,
            color: Number(consoleRunResult.returncode) === 0 ? 'success' : 'warning',
          }
        : null,
      consoleRunResult.duration_ms != null
        ? {
            key: 'duration',
            label: `${consoleRunResult.duration_ms} ms`,
            color: 'default',
          }
        : null,
      consoleProducedFiles.length
        ? {
            key: 'files',
            label: `${consoleProducedFiles.length} produced ${consoleProducedFiles.length === 1 ? 'file' : 'files'}`,
            color: 'default',
          }
        : null,
    ].filter(Boolean)
  }, [consoleProducedFiles.length, consoleRunResult])
  const consoleHasAdvancedInputs = consoleArgs.length > 0 || consoleInputFiles.length > 0
  const consoleTerminalOutput = useMemo(() => {
    const lines = []
    if (consoleCommandLine) {
      lines.push(`$ ${consoleCommandLine}`)
    }
    if (consoleRunLoading) {
      lines.push('', 'Running...')
      return lines.join('\n')
    }
    if (consoleRunError) {
      lines.push('', `[error] ${consoleRunError}`)
      return lines.join('\n')
    }
    if (!consoleRunResult) {
      lines.push('', '# Ready to run', '# Run the saved submission with temporary input.')
      return lines.join('\n')
    }

    const metaParts = [
      consoleRunResult.exit_status ? formatIdentifierLabel(consoleRunResult.exit_status) : '',
      consoleRunResult.returncode != null ? `exit ${consoleRunResult.returncode}` : '',
      consoleRunResult.duration_ms != null ? `${consoleRunResult.duration_ms} ms` : '',
    ].filter(Boolean)
    if (metaParts.length) {
      lines.push('', `[${metaParts.join(' • ')}]`)
    }
    lines.push('', 'stdout:', consoleRunResult.stdout || '(no stdout)')
    if (consoleRunResult.stderr) {
      lines.push('', 'stderr:', consoleRunResult.stderr)
    }
    return lines.join('\n')
  }, [consoleCommandLine, consoleRunError, consoleRunLoading, consoleRunResult])

  const loadDetailPage = async () => {
    setLoading(true)
    setError('')
    setManifestLoading(true)
    setManifestError('')
    try {
      const details = await apiRequest(`/api/submissions/${submissionId}/details/`)
      setDetailData(details)
      setReviewFeedback(details?.grade?.feedback || '')
      const nextMaxScore =
        details?.grade?.max_score
        ?? details?.submission?.assignment_max_score
        ?? details?.rubric?.computed_max_score
        ?? ''
      setGradeRecordScore(scoreInputValue(details?.grade?.score, ''))
      setGradeRecordMaxScore(scoreInputValue(nextMaxScore, ''))
      setRubricDraft(buildRubricDraft(details?.rubric))
      const initialFeedback = sortFeedbackResults(mergeFeedbackResults(details))
      const firstFailedIndex = initialFeedback.findIndex((entry) => entry.status !== 'PASS')
      setSelectedFeedbackIndex(firstFailedIndex >= 0 ? firstFailedIndex : 0)
      try {
        const manifestData = await apiRequest(`/api/submissions/${submissionId}/manifest/`)
        setManifest(manifestData)
        setManifestError('')
      } catch (manifestErr) {
        setManifest(null)
        setManifestError(manifestErr.message || 'Unable to load submitted files.')
      }
    } catch (err) {
      setDetailData(null)
      setManifest(null)
      setError(err.message || 'Unable to load submission details.')
    } finally {
      setLoading(false)
      setManifestLoading(false)
    }
  }

  useEffect(() => {
    loadDetailPage()
  }, [submissionId])

  useEffect(() => {
    if (!runCapability) {
      setConsoleArgsText('')
      setConsoleStdinText('')
      setConsoleInputFiles([])
      setConsoleRunResult(null)
      setConsoleRunError('')
      setConsoleSelectedProducedFileName('')
      setConsoleStdinSourceLabel('')
      setConsoleStdinUploadError('')
      setConsoleAdvancedOpen(false)
      return
    }
    const defaultInputFiles = runCapability?.kind === 'file'
      ? (runCapability.default_input_files || []).map((entry, index) => ({
        id: `${entry.path || 'input'}-${index}`,
        path: entry.path || '',
        content: entry.content || '',
      }))
      : []
    setConsoleArgsText(runCapability?.kind === 'file' ? (runCapability.default_args || []).join('\n') : '')
    setConsoleStdinText(runCapability?.default_stdin || '')
    setConsoleInputFiles(defaultInputFiles)
    setConsoleRunResult(null)
    setConsoleRunError('')
    setConsoleSelectedProducedFileName('')
    setConsoleStdinSourceLabel('')
    setConsoleStdinUploadError('')
  }, [detailData?.submission?.id, runCapability])

  useEffect(() => {
    if (!assignmentId || !canEditGrade) {
      setSubmissionQueue([])
      setAssignmentSubmissions([])
      setSubmissionQueueLoading(false)
      return
    }

    let active = true
    const loadSubmissionQueue = async () => {
      setSubmissionQueueLoading(true)
      try {
        const data = await apiRequest(`/api/submissions/?assignment_id=${assignmentId}`)
        if (!active) return
        const sortedRows = Array.isArray(data) ? [...data].sort(compareSubmissionsNewestFirst) : []
        setAssignmentSubmissions(sortedRows)
        const seen = new Set()
        const latestRows = sortedRows.filter((row) => {
          const key = submissionGroupKey(row, assignmentId)
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        setSubmissionQueue(latestRows)
      } catch (_err) {
        if (!active) return
        setAssignmentSubmissions([])
        setSubmissionQueue([])
      } finally {
        if (active) setSubmissionQueueLoading(false)
      }
    }

    loadSubmissionQueue()
    return () => {
      active = false
    }
  }, [assignmentId, canEditGrade])

  useEffect(() => {
    setRubricDraft(loadedRubricDraft)
    setRubricSaving(false)
    setRubricError('')
  }, [loadedRubricDraft, detailData?.submission?.id])

  useEffect(() => {
    setGradeRecordScore(loadedGradeScore)
    setGradeRecordMaxScore(loadedGradeMaxScore)
    setGradeRecordSaving(false)
    setReviewFeedbackError('')
  }, [detailData?.submission?.id, loadedGradeScore, loadedGradeMaxScore])

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

  useEffect(() => {
    setShowPassedTests(false)
  }, [detailData?.submission?.id])

  useEffect(() => {
    if (!canViewSimilarity && reviewTab === 'similarity') {
      setReviewTab('review')
    }
  }, [canViewSimilarity, reviewTab])

  useEffect(() => {
    const focus = new URLSearchParams(location.search).get('focus')
    if (focus === 'grading') {
      setReviewTab('review')
    }
    if (focus === 'grading' && gradingSectionRef.current && !loading && detailData && !useProfessorWorkspace) {
      gradingSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [detailData, loading, location.search, useProfessorWorkspace])

  const handleBack = () => {
    navigate(`/course/${courseId}/assignments/${assignmentId}?tab=Submissions`)
  }

  const handleRerunSubmission = async () => {
    if (!submissionId) return
    setRerunSubmissionId(submissionId)
    setError('')
    try {
      await apiRequest(`/api/submissions/${submissionId}/rerun/`, { method: 'POST' })
      await loadDetailPage()
    } catch (err) {
      setError(err.message || 'Unable to queue rerun.')
    } finally {
      setRerunSubmissionId('')
    }
  }

  const openSubmittedFilePreview = async (fileName) => {
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
      const data = await apiRequest(`/api/submissions/${submissionId}/file/?name=${encodeURIComponent(fileName)}`)
      setSubmittedPreviewFileName(data.name || fileName)
      setSubmittedPreviewTruncated(Boolean(data.truncated))
      const mimeType = data.mime_type || 'application/octet-stream'
      setSubmittedPreviewMime(mimeType)
      const mode = getPreviewMode(mimeType, data.name || fileName)
      if (String(data.encoding || '').toLowerCase() === 'base64') {
        const binary = window.atob(data.content || '')
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index)
        }
        const blob = new Blob([bytes], { type: mimeType })
        const objectUrl = window.URL.createObjectURL(blob)
        setSubmittedPreviewObjectUrl(objectUrl)
        setSubmittedPreviewMode(mode === 'text' ? 'binary' : mode)
      } else {
        setSubmittedPreviewTextContent(data.content || '')
        setSubmittedPreviewMode('text')
      }
    } catch (err) {
      setSubmittedPreviewError(err.message || 'Unable to load submitted file preview.')
      setSubmittedPreviewMode('none')
    } finally {
      setSubmittedPreviewLoading(false)
    }
  }

  useEffect(() => {
    if (!manifest?.files?.length || submittedPreviewFileName || submittedPreviewLoading) return
    const defaultFile = pickPreferredPreviewFile(manifest.files)
    if (defaultFile) {
      openSubmittedFilePreview(defaultFile)
    }
  }, [manifest, submittedPreviewFileName, submittedPreviewLoading])

  const fetchFileForFinding = async (finding) => {
    const key = finding.id
    if (aiExpandedFinding === key) {
      setAiExpandedFinding(null)
      return
    }
    setAiExpandedFinding(key)
    if (aiFileCache[finding.file_path]) return
    setAiSnippetLoading(true)
    try {
      const data = await apiRequest(
        `/api/submissions/${submissionId}/file/?name=${encodeURIComponent(finding.file_path)}`,
      )
      const text = String(data.encoding || '').toLowerCase() === 'base64'
        ? window.atob(data.content || '')
        : (data.content || '')
      setAiFileCache((prev) => ({ ...prev, [finding.file_path]: text.split('\n') }))
    } catch {
      setAiFileCache((prev) => ({ ...prev, [finding.file_path]: null }))
    } finally {
      setAiSnippetLoading(false)
    }
  }

  const saveGradeRecord = async () => {
    if (!submissionId) return
    const scoreNumber = Number(gradeRecordScore)
    const maxScoreNumber = Number(gradeRecordMaxScore)
    if (!Number.isFinite(scoreNumber) || scoreNumber < 0) {
      setReviewFeedbackError('Enter a valid grade score.')
      return false
    }
    if (!Number.isFinite(maxScoreNumber) || maxScoreNumber <= 0) {
      setReviewFeedbackError('Enter a valid assignment max grade.')
      return false
    }
    setGradeRecordSaving(true)
    setReviewFeedbackError('')
    try {
      const data = await apiRequest(`/api/submissions/${submissionId}/grade/`, {
        method: 'POST',
        body: { score: scoreNumber, max_score: maxScoreNumber, feedback: reviewFeedback },
      })
      setDetailData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          submission: { ...prev.submission, status: data.status || prev.submission?.status },
          grade: {
            ...(prev.grade || {}),
            score: data.score,
            max_score: data.max_score,
            feedback: data.feedback ?? '',
          },
        }
      })
      setReviewFeedback(data.feedback ?? '')
      setGradeRecordScore(scoreInputValue(data.score, ''))
      setGradeRecordMaxScore(scoreInputValue(data.max_score, ''))
      return true
    } catch (err) {
      setReviewFeedbackError(err.message || 'Unable to save feedback.')
      return false
    } finally {
      setGradeRecordSaving(false)
    }
  }

  const handleNextSubmission = async () => {
    if (!nextSubmissionRow?.id) return
    if (gradeRecordDirty) {
      const saved = await saveGradeRecord()
      if (!saved) return
    }
    navigate(
      `/course/${courseId}/assignments/${assignmentId}/submissions/${nextSubmissionRow.id}?focus=review`,
    )
  }

  const handlePreviousSubmission = () => {
    if (!previousSubmissionRow?.id) return
    navigate(
      `/course/${courseId}/assignments/${assignmentId}/submissions/${previousSubmissionRow.id}?focus=review`,
    )
  }

  const handleAttemptSwitch = (targetId) => {
    if (!targetId || String(targetId) === String(submissionId || '')) return
    navigate(`/course/${courseId}/assignments/${assignmentId}/submissions/${targetId}?focus=review`)
  }

  const addConsoleInputFile = () => {
    setConsoleInputFiles((prev) => [...prev, buildInputFile(prev.length)])
  }

  const updateConsoleInputFile = (fileId, field, value) => {
    setConsoleInputFiles((prev) =>
      prev.map((entry) => (entry.id === fileId ? { ...entry, [field]: value } : entry)),
    )
  }

  const removeConsoleInputFile = (fileId) => {
    setConsoleInputFiles((prev) => prev.filter((entry) => entry.id !== fileId))
  }

  const openConsoleStdinPicker = () => {
    consoleStdinFileInputRef.current?.click()
  }

  const clearConsoleStdin = () => {
    setConsoleStdinText('')
    setConsoleStdinSourceLabel('')
    setConsoleStdinUploadError('')
  }

  const handleConsoleStdinFileSelected = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 256 * 1024) {
      setConsoleStdinUploadError('Stdin file must be under 256 KB.')
      return
    }
    try {
      const text = await file.text()
      setConsoleStdinText(text)
      setConsoleStdinSourceLabel(file.name)
      setConsoleStdinUploadError('')
    } catch (_err) {
      setConsoleStdinUploadError('Unable to read the stdin file.')
    }
  }

  const handleConsoleRun = async () => {
    if (!submissionId) return
    if (!runCapability) {
      setConsoleRunError('No run capability is available for this submission.')
      return
    }
    setConsoleRunLoading(true)
    setConsoleRunError('')
    try {
      const payload = runCapability.kind === 'file'
        ? {
            args: consoleArgs,
            stdin: consoleStdinText,
            input_files: consoleInputFiles.map((file) => ({
              path: file.path,
              content: file.content,
            })),
          }
        : { stdin: consoleStdinText }
      const data = await apiRequest(
        `/api/submissions/${submissionId}/${runCapability.kind === 'file' ? 'file-run' : 'console-run'}/`,
        {
          method: 'POST',
          body: payload,
        },
      )
      setConsoleRunResult(data)
      setConsoleSelectedProducedFileName('')
    } catch (err) {
      setConsoleRunError(err.message || 'Unable to run the submission.')
    } finally {
      setConsoleRunLoading(false)
    }
  }

  const updateRubricCriterion = (criterionId, field, value) => {
    setRubricDraft((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        criteria: prev.criteria.map((criterion) =>
          criterion.criterion_id === criterionId ? { ...criterion, [field]: value } : criterion,
        ),
      }
    })
  }

  const saveRubricGrade = async () => {
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
    } catch (err) {
      setRubricError(err.message || 'Unable to save rubric grade.')
    } finally {
      setRubricSaving(false)
    }
  }

  if (loading) {
    return (
      <Box sx={{ py: { xs: 2, md: 3 } }}>
        <Typography color="text.secondary">Loading submission…</Typography>
      </Box>
    )
  }

  if (error && !detailData) {
    return (
      <Box sx={{ py: { xs: 2, md: 3 } }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    )
  }

  if (!detailData) return null

  const statusMeta = submissionOutcomeMeta(detailData.submission?.status)
  const submittedFiles = manifest?.files?.filter((file) => !file.is_dir) || []
  const rubricAttachments = Array.isArray(detailData?.rubric?.attachments) ? detailData.rubric.attachments : []
  const submittedAtLabel = detailData.submission?.submitted_at
    ? new Date(detailData.submission.submitted_at).toLocaleString()
    : '—'
  const gradingContextReleaseLabel = detailData?.grade?.released_to_student ? 'Visible to student' : 'Not released'
  const stickyGradingStatusLabel = gradeRecordDirty ? 'Unsaved grade changes' : 'Grade saved'

  const professorCodePanel = (
    <Paper
      elevation={0}
      sx={{
        p: 1.5,
        borderRadius: CARD_RADIUS,
        border: '1px solid',
        borderColor: 'divider',
        position: { lg: 'sticky' },
        top: { lg: 86 },
        height: { lg: 'calc(100vh - 150px)' },
        overflow: 'hidden',
      }}
    >
      <Stack spacing={1.25} sx={{ height: { lg: '100%' }, minHeight: 0 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', md: 'center' }}
        >
          <Stack spacing={0.2}>
            <Typography variant="h6" sx={{ fontWeight: 900 }}>
              Code review
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Start with the submitted code, then review tests and grading in the workspace.
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
            {detailData.submission?.source_bundle_key ? (
              <Button
                variant="outlined"
                size="small"
                startIcon={<DownloadRounded />}
                onClick={() =>
                  window.open(`${API_BASE}/media/${detailData.submission.source_bundle_key}`, '_blank', 'noopener,noreferrer')
                }
              >
                Download bundle
              </Button>
            ) : null}
            <Chip
              size="small"
              variant="outlined"
              label={manifest ? `${manifest.file_count} files • ${formatBytes(manifest.total_size)}` : 'Bundle pending'}
            />
          </Stack>
        </Stack>

        {manifestError ? <Alert severity="error">{manifestError}</Alert> : null}

        {manifestLoading ? (
          <Stack spacing={1}>
            <LinearProgress sx={{ height: 6, borderRadius: 999 }} />
            <Typography variant="body2" color="text.secondary">
              Loading submitted files…
            </Typography>
          </Stack>
        ) : submittedFiles.length ? (
          <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
            {submittedFiles.length > 1 ? (
              <Stack
                direction="row"
                spacing={0.75}
                sx={{
                  overflowX: 'auto',
                  overflowY: 'hidden',
                  pb: 0.35,
                  scrollbarGutter: 'stable',
                }}
              >
                {submittedFiles.map((file) => {
                  const selected = submittedPreviewFileName === file.name
                  return (
                    <Paper
                      key={file.name}
                      variant="outlined"
                      onClick={() => openSubmittedFilePreview(file.name)}
                      sx={{
                        p: 0.9,
                        minWidth: 180,
                        borderRadius: CARD_RADIUS,
                        cursor: 'pointer',
                        flexShrink: 0,
                        borderColor: selected ? 'primary.main' : 'divider',
                        backgroundColor: selected ? 'rgba(79,70,229,0.06)' : 'background.paper',
                      }}
                    >
                      <Stack direction="row" spacing={0.85} alignItems="center">
                        <InsertDriveFileRounded fontSize="small" color="action" />
                        <Stack spacing={0.1} sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                            {file.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatBytes(file.size)}
                          </Typography>
                        </Stack>
                      </Stack>
                    </Paper>
                  )
                })}
              </Stack>
            ) : (
              <Stack direction="row" spacing={0.75} alignItems="center">
                <Chip
                  size="small"
                  variant="outlined"
                  icon={<InsertDriveFileRounded />}
                  label={submittedFiles[0]?.name || 'Submitted file'}
                />
                {submittedFiles[0]?.size != null ? (
                  <Typography variant="caption" color="text.secondary">
                    {formatBytes(submittedFiles[0].size)}
                  </Typography>
                ) : null}
              </Stack>
            )}

            <Paper
              variant="outlined"
              sx={{
                p: 1.2,
                borderRadius: CARD_RADIUS,
                backgroundColor: 'rgba(248,250,252,0.72)',
                flex: 1,
                minHeight: 0,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {submittedPreviewError ? <Alert severity="error">{submittedPreviewError}</Alert> : null}
              {submittedPreviewLoading ? (
                <Typography color="text.secondary">Loading preview…</Typography>
              ) : submittedPreviewFileName ? (
                <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
                  <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
                    <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
                      {submittedPreviewFileName}
                    </Typography>
                    {submittedPreviewObjectUrl ? (
                      <Button
                        size="small"
                        variant="text"
                        component="a"
                        href={submittedPreviewObjectUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open
                      </Button>
                    ) : null}
                  </Stack>
                  {submittedPreviewTruncated ? (
                    <Alert severity="warning" variant="outlined">
                      Showing the first {formatBytes(MAX_SUBMISSION_PREVIEW_BYTES)} only.
                    </Alert>
                  ) : null}
                  {submittedPreviewMode === 'text' ? (
                    <Box
                      component="pre"
                      sx={{
                        m: 0,
                        p: 1.2,
                        borderRadius: CARD_RADIUS,
                        border: '1px solid',
                        borderColor: 'divider',
                        backgroundColor: '#fff',
                        flex: 1,
                        minHeight: 0,
                        maxHeight: '100%',
                        overflow: 'auto',
                        whiteSpace: 'pre',
                        fontSize: 12.5,
                        lineHeight: 1.55,
                        fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
                      }}
                    >
                      {submittedPreviewTextContent || '(empty file)'}
                    </Box>
                  ) : submittedPreviewMode === 'image' && submittedPreviewObjectUrl ? (
                    <Box
                      component="img"
                      src={submittedPreviewObjectUrl}
                      alt={submittedPreviewFileName}
                      sx={{ maxWidth: '100%', maxHeight: 520, objectFit: 'contain', borderRadius: CARD_RADIUS }}
                    />
                  ) : submittedPreviewMode === 'pdf' && submittedPreviewObjectUrl ? (
                    <Box
                      component="iframe"
                      title={submittedPreviewFileName}
                      src={submittedPreviewObjectUrl}
                      sx={{ width: '100%', height: 520, border: 0, borderRadius: CARD_RADIUS }}
                    />
                  ) : submittedPreviewMode === 'video' && submittedPreviewObjectUrl ? (
                    <Box component="video" src={submittedPreviewObjectUrl} controls sx={{ width: '100%', maxHeight: 520, borderRadius: CARD_RADIUS }} />
                  ) : submittedPreviewMode === 'audio' && submittedPreviewObjectUrl ? (
                    <audio src={submittedPreviewObjectUrl} controls style={{ width: '100%' }} />
                  ) : submittedPreviewObjectUrl ? (
                    <Alert severity="info" variant="outlined">
                      Preview is not supported for this file type. Open it in a new tab to inspect the raw file.
                    </Alert>
                  ) : (
                    <Typography color="text.secondary">Select a file to preview it.</Typography>
                  )}
                </Stack>
              ) : (
                <Typography color="text.secondary">Select a file to preview it.</Typography>
              )}
            </Paper>
          </Stack>
        ) : (
          <Typography color="text.secondary">No submission manifest available.</Typography>
        )}
      </Stack>
    </Paper>
  )

  const professorTestsPanel = (
    <Stack spacing={1.2}>
      <Alert severity={feedbackSummary.severity} variant="outlined">
        <Typography sx={{ fontWeight: 800 }}>{feedbackSummary.title}</Typography>
        <Typography variant="body2">{feedbackSummary.description}</Typography>
      </Alert>

      {feedbackResults.length ? (
        <>
          <Stack spacing={0.75}>
            {failedFeedback.length ? (
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                {failedFeedback.map(({ result, index }) => {
                  const meta = feedbackStatusMeta(result)
                  const selected = index === selectedFeedbackIndex
                  return (
                    <Button
                      key={result.id}
                      variant={selected ? 'contained' : 'outlined'}
                      color={meta.color}
                      size="small"
                      onClick={() => setSelectedFeedbackIndex(index)}
                      sx={{
                        borderRadius: 999,
                        textTransform: 'none',
                        px: 1.25,
                        py: 0.65,
                        minWidth: 0,
                      }}
                    >
                      {result.test_name}
                    </Button>
                  )
                })}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No failing checks. Passed cases are available below.
              </Typography>
            )}

            {passedFeedback.length ? (
              <Stack spacing={0.75}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setShowPassedTests((prev) => !prev)}
                  sx={{ alignSelf: 'flex-start', borderRadius: 999, textTransform: 'none' }}
                >
                  {showPassedTests ? `Hide passed (${passedFeedback.length})` : `Show passed (${passedFeedback.length})`}
                </Button>
                {showPassedTests ? (
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                    {passedFeedback.map(({ result, index }) => {
                      const meta = feedbackStatusMeta(result)
                      const selected = index === selectedFeedbackIndex
                      return (
                        <Button
                          key={result.id}
                          variant={selected ? 'contained' : 'outlined'}
                          color={meta.color}
                          size="small"
                          onClick={() => setSelectedFeedbackIndex(index)}
                          sx={{
                            borderRadius: 999,
                            textTransform: 'none',
                            px: 1.1,
                            py: 0.6,
                            minWidth: 0,
                          }}
                        >
                          {result.test_name}
                        </Button>
                      )
                    })}
                  </Stack>
                ) : null}
              </Stack>
            ) : null}
          </Stack>

          {selectedFeedback ? (
            <Paper
              variant="outlined"
              sx={{
                p: 1.25,
                borderRadius: CARD_RADIUS,
                backgroundColor: 'rgba(248,250,252,0.72)',
              }}
            >
              <Stack spacing={1}>
                <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
                    {selectedFeedback.test_name}
                  </Typography>
                  <Chip
                    size="small"
                    label={feedbackStatusMeta(selectedFeedback).label}
                    color={feedbackStatusMeta(selectedFeedback).color}
                    variant="outlined"
                  />
                  {selectedFeedback.time_ms != null ? (
                    <Chip size="small" variant="outlined" label={`${selectedFeedback.time_ms} ms`} />
                  ) : null}
                </Stack>

                <Typography variant="body2" color="text.secondary">
                  {feedbackDetailSummary(selectedFeedback, selectedFeedbackDetailSections, selectedFeedbackIssueCards)}
                </Typography>

                {selectedFeedback.message && selectedFeedback.message !== selectedFeedback.summary ? (
                  <Paper variant="outlined" sx={{ p: 1, borderRadius: CARD_RADIUS, backgroundColor: '#fff' }}>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {selectedFeedback.message}
                    </Typography>
                  </Paper>
                ) : null}

                {selectedFeedbackDetailSections.length ? (
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(0, 1fr))' },
                      gap: 1,
                    }}
                  >
                    {selectedFeedbackDetailSections.map((section) => (
                      <Paper
                        key={section.key}
                        variant="outlined"
                        sx={{
                          p: 1,
                          borderRadius: CARD_RADIUS,
                          backgroundColor: '#fff',
                        }}
                      >
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.35 }}>
                          {section.label}
                        </Typography>
                        <Box
                          component="pre"
                          sx={{
                            m: 0,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            fontSize: 12,
                            lineHeight: 1.5,
                            fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
                          }}
                        >
                          {section.value}
                        </Box>
                      </Paper>
                    ))}
                  </Box>
                ) : null}

                {selectedFeedbackIssueCards.length ? (
                  <Stack spacing={0.9}>
                    <Typography variant="caption" color="text.secondary">
                      Verification issues
                    </Typography>
                    {selectedFeedbackIssueCards.map((issue) => (
                      <Paper key={issue.id} variant="outlined" sx={{ p: 1, borderRadius: CARD_RADIUS, backgroundColor: '#fff' }}>
                        <Stack spacing={0.75}>
                          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                            <Typography variant="body2" sx={{ fontWeight: 800 }}>
                              {issue.title}
                            </Typography>
                            {issue.kind ? (
                              <Chip size="small" variant="outlined" label={formatIdentifierLabel(issue.kind)} />
                            ) : null}
                          </Stack>
                          {issue.sections.map((section) => (
                            <Box key={`${issue.id}-${section.key}`}>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.35 }}>
                                {section.label}
                              </Typography>
                              <Box
                                component="pre"
                                sx={{
                                  m: 0,
                                  p: 0.9,
                                  borderRadius: CARD_RADIUS,
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word',
                                  fontSize: 12,
                                  lineHeight: 1.5,
                                  fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
                                  backgroundColor: 'rgba(248,250,252,0.9)',
                                }}
                              >
                                {section.value}
                              </Box>
                            </Box>
                          ))}
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                ) : null}
              </Stack>
            </Paper>
          ) : null}
        </>
      ) : (
        <Typography color="text.secondary">No check results are available for this submission yet.</Typography>
      )}
    </Stack>
  )

  const professorReviewPanel = (
    <Stack spacing={1.2} ref={gradingSectionRef}>
      {failedFeedback.length ? (
        <Paper
          variant="outlined"
          sx={{
            p: 1,
            borderRadius: CARD_RADIUS,
            backgroundColor: 'rgba(239,68,68,0.06)',
          }}
        >
          <Stack spacing={0.6}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
              Needs attention
            </Typography>
            <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
              {failedFeedback.slice(0, 5).map(({ result, index }) => (
                <Chip
                  key={result.id}
                  size="small"
                  color={feedbackStatusMeta(result).color}
                  variant="outlined"
                  label={result.test_name}
                  onClick={() => {
                    setReviewTab('tests')
                    setSelectedFeedbackIndex(index)
                  }}
                />
              ))}
              {failedFeedback.length > 5 ? (
                <Chip size="small" variant="outlined" label={`+${failedFeedback.length - 5} more`} />
              ) : null}
            </Stack>
          </Stack>
        </Paper>
      ) : null}

      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
        {detailData?.rubric?.available ? (
          <Chip size="small" label={`v${rubricDraft?.version_number || detailData.rubric.version_number || 0}`} />
        ) : null}
        {detailData?.rubric?.available ? (
          <Chip size="small" variant="outlined" label={detailData.rubric.is_weighted ? 'Weighted' : 'Unweighted'} />
        ) : null}
        {detailData?.rubric?.available ? (
          <Chip
            size="small"
            variant="outlined"
            label={`Rubric ${formatScoreValue(rubricSummary.score)}/${formatScoreValue(rubricSummary.maxScore)}`}
          />
        ) : null}
      </Stack>

      {rubricError ? <Alert severity="error">{rubricError}</Alert> : null}
      {reviewFeedbackError ? <Alert severity="error">{reviewFeedbackError}</Alert> : null}

      <Paper
        variant="outlined"
        sx={{
          p: 1.1,
          borderRadius: CARD_RADIUS,
          backgroundColor: 'rgba(248,250,252,0.72)',
        }}
      >
        <Stack spacing={0.9}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', md: 'center' }}
          >
            <Stack spacing={0.15}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                Main review
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Update the final assignment grade and a short student-facing note here.
              </Typography>
            </Stack>
          </Stack>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', xl: '120px 120px minmax(0, 1fr)' },
              gap: 1,
              alignItems: 'start',
            }}
          >
            <TextField
              label="Final grade"
              type="number"
              size="small"
              value={gradeRecordScore}
              onChange={(event) => setGradeRecordScore(event.target.value)}
              inputProps={{ min: 0, step: '0.01' }}
            />
            <TextField
              label="Out of"
              type="number"
              size="small"
              value={gradeRecordMaxScore}
              onChange={(event) => setGradeRecordMaxScore(event.target.value)}
              inputProps={{ min: 0.01, step: '0.01' }}
            />
            <TextField
              label="Instructor note"
              size="small"
              value={reviewFeedback}
              onChange={(event) => setReviewFeedback(event.target.value)}
              placeholder="Add a short note for the student."
              multiline
              minRows={2}
              fullWidth
            />
          </Box>

          <Typography variant="caption" color="text.secondary">
            Use the sticky bar below to save the main review and move to the next student submission.
          </Typography>
        </Stack>
      </Paper>

      {detailData?.rubric?.available ? (
        <>
          <Stack spacing={1}>
            {(rubricDraft?.criteria || []).map((criterion) => {
              const maxPoints = Number(criterion.max_points || 0)
              const awarded = Number(criterion.points_awarded || 0)
              const boundedAwarded = Math.min(
                Math.max(Number.isFinite(awarded) ? awarded : 0, 0),
                maxPoints > 0 ? maxPoints : 0,
              )
              const ratio = maxPoints > 0 ? (boundedAwarded / maxPoints) * 100 : 0
              return (
                <Paper
                  key={criterion.criterion_id}
                  variant="outlined"
                  sx={{
                    p: 1,
                    borderRadius: CARD_RADIUS,
                    backgroundColor: 'rgba(248,250,252,0.72)',
                  }}
                >
                  <Stack spacing={0.65}>
                    <Stack
                      direction={{ xs: 'column', md: 'row' }}
                      spacing={1}
                      justifyContent="space-between"
                      alignItems={{ xs: 'flex-start', md: 'center' }}
                    >
                      <Stack spacing={0.12} sx={{ minWidth: 0, flex: 1 }}>
                        <Typography variant="body1" sx={{ fontWeight: 800 }}>
                          {criterion.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {detailData.rubric.is_weighted && criterion.weight !== ''
                            ? `${formatScoreValue(criterion.max_points)} pts • ${criterion.weight} wt`
                            : `${formatScoreValue(criterion.max_points)} pts`}
                        </Typography>
                      </Stack>
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        <Chip
                          size="small"
                          variant="outlined"
                          label={`${formatScoreValue(boundedAwarded)}/${formatScoreValue(maxPoints)}`}
                        />
                        <TextField
                          label="Score"
                          type="number"
                          size="small"
                          value={criterion.points_awarded}
                          onChange={(event) =>
                            updateRubricCriterion(criterion.criterion_id, 'points_awarded', event.target.value)
                          }
                          inputProps={{ min: 0, max: criterion.max_points, step: '0.01' }}
                          sx={{ width: 96, flexShrink: 0 }}
                        />
                      </Stack>
                    </Stack>
                    <LinearProgress
                      variant="determinate"
                      value={ratio}
                      sx={{
                        height: 8,
                        borderRadius: 999,
                        backgroundColor: 'rgba(148,163,184,0.18)',
                        '& .MuiLinearProgress-bar': {
                          borderRadius: 999,
                          background: 'linear-gradient(90deg, #4f46e5 0%, #7c3aed 100%)',
                        },
                      }}
                    />
                    {(() => {
                      const matchingLevels = (criterion.levels || []).filter((l) => {
                        const pts = Number.isFinite(awarded) ? awarded : 0
                        return pts >= Number(l.min_points) && pts <= Number(l.max_points)
                      })
                      if (!matchingLevels.length) return null
                      return (
                        <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
                          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                            Suggested:
                          </Typography>
                          {matchingLevels.map((l, li) => (
                            <Chip
                              key={li}
                              size="small"
                              label={`${l.label}${l.description ? ` — ${l.description.slice(0, 40)}${l.description.length > 40 ? '…' : ''}` : ''}`}
                              onClick={() => updateRubricCriterion(criterion.criterion_id, 'comment', l.description)}
                              color="primary"
                              variant="outlined"
                              sx={{ fontSize: 11, cursor: 'pointer', height: 'auto', py: 0.25, '& .MuiChip-label': { whiteSpace: 'normal' } }}
                            />
                          ))}
                        </Stack>
                      )
                    })()}
                    <TextField
                      label="Criterion note"
                      size="small"
                      value={criterion.comment}
                      onChange={(event) =>
                        updateRubricCriterion(criterion.criterion_id, 'comment', event.target.value)
                      }
                      multiline
                      minRows={1}
                      maxRows={3}
                      placeholder="Optional criterion note"
                      fullWidth
                    />
                  </Stack>
                </Paper>
              )
            })}
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

      {rubricAttachments.length ? (
        <Paper
          variant="outlined"
          sx={{
            p: 1.1,
            borderRadius: CARD_RADIUS,
            backgroundColor: 'rgba(248,250,252,0.72)',
          }}
        >
          <Stack spacing={0.9}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
              Rubric reference files
            </Typography>
            <Typography variant="caption" color="text.secondary">
              These files are reference only and do not change the saved grade.
            </Typography>
            {rubricAttachments.map((asset) => (
              <Paper
                key={asset.id}
                variant="outlined"
                sx={{
                  p: 1,
                  borderRadius: CARD_RADIUS,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 1,
                  backgroundColor: '#fff',
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
        </Paper>
      ) : null}

    </Stack>
  )

  const professorStickyGradingBar = (
    <Paper
      elevation={4}
      sx={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 18,
        zIndex: 1200,
        width: {
          xs: 'calc(100vw - 24px)',
          md: 'min(760px, calc(100vw - 120px))',
        },
        p: 1,
        borderRadius: CARD_RADIUS,
        border: '1px solid',
        borderColor: 'divider',
        backgroundColor: 'rgba(255,255,255,0.96)',
        backdropFilter: 'blur(14px)',
        boxShadow: '0 16px 40px rgba(15, 23, 42, 0.12)',
      }}
    >
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', md: 'center' }}
        >
          <Stack spacing={0.12}>
            <Typography variant="body2" sx={{ fontWeight: 800 }}>
              {`Overall grade ${draftOverallGradeLabel}`}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {gradeRecordDirty
                ? 'You have unsaved grading changes.'
                : queueProgressLabel
                  ? `Queue ${queueProgressLabel}${nextSubmissionLabel ? ` · Next ${nextSubmissionLabel}` : ''}`
                  : submissionQueueLoading
                    ? 'Loading next submission…'
                    : 'No submission queue available.'}
            </Typography>
          </Stack>

          <Stack direction="row" spacing={0.85} alignItems="center">
            <Button
              size="small"
              variant="outlined"
              startIcon={<ArrowBackRounded />}
              onClick={handlePreviousSubmission}
              disabled={gradeRecordSaving || submissionQueueLoading || !previousSubmissionRow}
            >
              Previous
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={saveGradeRecord}
              disabled={gradeRecordSaving || !gradeRecordDirty}
            >
              {gradeRecordSaving ? 'Saving…' : 'Save grade'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              endIcon={<ArrowForwardRounded />}
              onClick={handleNextSubmission}
              disabled={gradeRecordSaving || submissionQueueLoading || !nextSubmissionRow}
            >
              Next submission
            </Button>
        </Stack>
      </Stack>
    </Paper>
  )

  const professorOverviewPanel = (
    <Stack spacing={1.1}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            md: detailData.submission?.group_name ? 'repeat(2, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))',
            xl: detailData.submission?.group_name ? 'repeat(4, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))',
          },
          gap: 1,
        }}
      >
        <Paper variant="outlined" sx={{ p: 1.1, borderRadius: CARD_RADIUS }}>
          <Typography variant="caption" color="text.secondary">
            {detailData.submission?.group_name ? 'Group' : 'Student'}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 800, mt: 0.25 }}>
            {currentSubmissionOwnerLabel}
          </Typography>
        </Paper>
        {detailData.submission?.group_name ? (
          <Paper variant="outlined" sx={{ p: 1.1, borderRadius: CARD_RADIUS }}>
            <Typography variant="caption" color="text.secondary">Submitted by</Typography>
            <Typography variant="body2" sx={{ fontWeight: 800, mt: 0.25 }}>
              {currentSubmissionActorLabel}
            </Typography>
          </Paper>
        ) : null}
        {detailData.submission?.group_name ? (
          <Paper variant="outlined" sx={{ p: 1.1, borderRadius: CARD_RADIUS }}>
            <Typography variant="caption" color="text.secondary">Members</Typography>
            <Typography variant="body2" sx={{ fontWeight: 800, mt: 0.25 }}>
              {currentSubmissionMemberNames.length || '—'}
            </Typography>
            {currentSubmissionMemberNames.length ? (
              <Typography variant="caption" color="text.secondary">
                {formatMemberPreview(currentSubmissionMemberNames, 2)}
              </Typography>
            ) : null}
          </Paper>
        ) : null}
        <Paper variant="outlined" sx={{ p: 1.1, borderRadius: CARD_RADIUS }}>
          <Typography variant="caption" color="text.secondary">Attempt</Typography>
          <Typography variant="body2" sx={{ fontWeight: 800, mt: 0.25 }}>
            {detailData.submission?.attempt_number || '—'}
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.1, borderRadius: CARD_RADIUS }}>
          <Typography variant="caption" color="text.secondary">Submitted</Typography>
          <Typography variant="body2" sx={{ fontWeight: 800, mt: 0.25 }}>
            {submittedAtLabel}
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.1, borderRadius: CARD_RADIUS }}>
          <Typography variant="caption" color="text.secondary">Verification</Typography>
          <Typography variant="body2" sx={{ fontWeight: 800, mt: 0.25 }}>
            {statusMeta.label}
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.1, borderRadius: CARD_RADIUS }}>
          <Typography variant="caption" color="text.secondary">Run status</Typography>
          <Typography variant="body2" sx={{ fontWeight: 800, mt: 0.25 }}>
            {detailData.grading_run?.exit_status ? formatIdentifierLabel(detailData.grading_run.exit_status) : '—'}
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.1, borderRadius: CARD_RADIUS }}>
          <Typography variant="caption" color="text.secondary">Score</Typography>
          <Typography variant="body2" sx={{ fontWeight: 800, mt: 0.25 }}>
            {currentGradeLabel}
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.1, borderRadius: CARD_RADIUS }}>
          <Typography variant="caption" color="text.secondary">Release</Typography>
          <Typography variant="body2" sx={{ fontWeight: 800, mt: 0.25 }}>
            {gradingContextReleaseLabel}
          </Typography>
        </Paper>
      </Box>

      <Alert severity="info" variant="outlined">
        Use `Review` to save the final score and rubric notes, and use `Tests` to inspect each case. File review stays in the code panel on the left.
      </Alert>
    </Stack>
  )

  const professorConsolePanel = (
    <Paper
      elevation={0}
      sx={{
        p: { xs: 1.2, md: 1.4 },
        borderRadius: CARD_RADIUS,
        border: '1px solid',
        borderColor: 'divider',
        background: isDarkMode
          ? 'linear-gradient(180deg, rgba(15, 23, 42, 0.72) 0%, rgba(15, 23, 42, 0.58) 100%)'
          : 'linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0%, rgba(248, 250, 252, 0.96) 100%)',
        boxShadow: isDarkMode
          ? '0 24px 60px rgba(2, 6, 23, 0.32)'
          : '0 24px 60px rgba(148, 163, 184, 0.12)',
      }}
    >
      <Stack spacing={1.25}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.2}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', md: 'center' }}
        >
          <Stack spacing={0.55}>
            <Stack direction="row" spacing={0.7} alignItems="center" useFlexGap flexWrap="wrap">
              <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
                Console run
              </Typography>
              <Chip
                size="small"
                color={runCapability ? 'primary' : 'default'}
                label={
                  runCapability
                    ? (isConsoleFileRun ? 'stdin, args, and files' : 'stdin preview')
                    : 'Unavailable'
                }
                sx={{ fontWeight: 700 }}
              />
              <Chip size="small" variant="outlined" label="Temporary only" sx={{ fontWeight: 700 }} />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 760 }}>
              Try the saved submission with custom input without changing the recorded grade or files. Use this to
              reproduce edge cases before leaving rubric feedback.
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.8} alignItems="center" useFlexGap>
            {consoleRunResult ? (
              <Typography variant="caption" color="text.secondary">
                Latest output stays below until the next run.
              </Typography>
            ) : null}
            <Button
              size="small"
              variant="contained"
              startIcon={<RefreshRounded />}
              onClick={handleConsoleRun}
              disabled={consoleRunLoading || !runCapability}
            >
              {consoleRunLoading ? 'Running…' : consoleRunResult ? 'Run again' : 'Run'}
            </Button>
          </Stack>
        </Stack>

        {consoleRunError ? <Alert severity="error">{consoleRunError}</Alert> : null}

        {runCapability ? (
          <Stack spacing={1}>
            <Paper
              variant="outlined"
              sx={{
                p: 1.1,
                borderRadius: CARD_RADIUS,
                borderColor: isDarkMode ? 'rgba(129, 140, 248, 0.28)' : 'rgba(99, 102, 241, 0.22)',
                backgroundColor: isDarkMode ? 'rgba(15, 23, 42, 0.34)' : 'rgba(238, 242, 255, 0.54)',
              }}
            >
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={1}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', md: 'center' }}
              >
                <Stack spacing={0.35}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 0.3 }}>
                    COMMAND PREVIEW
                  </Typography>
                  <Typography
                    sx={{
                      fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
                      fontSize: 13,
                      fontWeight: 700,
                      wordBreak: 'break-word',
                    }}
                  >
                    {consoleCommandLine ? `$ ${consoleCommandLine}` : 'Command preview unavailable'}
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap>
                  {consoleResultMeta.length ? (
                    consoleResultMeta.map((meta) => (
                      <Chip key={meta.key} size="small" label={meta.label} color={meta.color} variant="outlined" />
                    ))
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      Run once to inspect stdout, stderr, and any generated files.
                    </Typography>
                  )}
                </Stack>
              </Stack>
            </Paper>

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.15fr) minmax(320px, 0.85fr)' },
                gap: 1,
              }}
            >
              <Paper
                variant="outlined"
                sx={{
                  p: 1.1,
                  borderRadius: CARD_RADIUS,
                  backgroundColor: isDarkMode ? '#0b1020' : '#f8fafc',
                  color: isDarkMode ? '#f8fafc' : '#0f172a',
                  minHeight: 280,
                  borderColor: isDarkMode ? 'rgba(148, 163, 184, 0.25)' : 'rgba(148, 163, 184, 0.35)',
                }}
              >
                <Stack spacing={0.8}>
                  <Stack direction="row" spacing={0.8} alignItems="center" justifyContent="space-between" useFlexGap>
                    <Stack spacing={0.1}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                        Output
                      </Typography>
                      <Typography variant="caption" sx={{ color: isDarkMode ? 'rgba(226, 232, 240, 0.7)' : 'rgba(71, 85, 105, 0.9)' }}>
                        {consoleRunResult ? 'Most recent console output' : 'Ready state preview'}
                      </Typography>
                    </Stack>
                    {consoleRunLoading ? <Chip size="small" color="warning" label="Running" /> : null}
                  </Stack>
                  <Box
                    component="pre"
                    sx={{
                      m: 0,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontSize: 12.5,
                      lineHeight: 1.6,
                      fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
                    }}
                  >
                    {consoleTerminalOutput}
                  </Box>
                </Stack>
              </Paper>

              <Paper
                variant="outlined"
                sx={{
                  p: 1.1,
                  borderRadius: CARD_RADIUS,
                  borderColor: isDarkMode ? 'rgba(148, 163, 184, 0.25)' : 'rgba(148, 163, 184, 0.32)',
                  backgroundColor: isDarkMode ? 'rgba(2, 6, 23, 0.2)' : 'rgba(255, 255, 255, 0.88)',
                }}
              >
                <Stack spacing={0.9}>
                  <Stack direction="row" spacing={0.75} alignItems="center" justifyContent="space-between" useFlexGap>
                    <Stack spacing={0.1}>
                      <Stack direction="row" spacing={0.6} alignItems="center" flexWrap="wrap" useFlexGap>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                          stdin
                        </Typography>
                        {consoleStdinSourceLabel ? (
                          <Chip size="small" variant="outlined" label={consoleStdinSourceLabel} />
                        ) : null}
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        Paste temporary input or upload a `.txt`, `.in`, or `.csv` file.
                      </Typography>
                    </Stack>
                    <Button size="small" variant="outlined" onClick={openConsoleStdinPicker}>
                      Upload stdin
                    </Button>
                  </Stack>
                  {consoleStdinUploadError ? (
                    <Typography variant="caption" color="error">
                      {consoleStdinUploadError}
                    </Typography>
                  ) : null}
                  <TextField
                    label="stdin"
                    value={consoleStdinText}
                    onChange={(event) => setConsoleStdinText(event.target.value)}
                    multiline
                    minRows={3}
                    maxRows={10}
                    sx={{
                      ...terminalTextFieldSx,
                      '& .MuiOutlinedInput-root': {
                        ...terminalTextFieldSx['& .MuiOutlinedInput-root'],
                        minHeight: 280,
                      },
                    }}
                  />
                  <input
                    ref={consoleStdinFileInputRef}
                    type="file"
                    accept=".txt,.in,.csv"
                    hidden
                    onChange={handleConsoleStdinFileSelected}
                  />
                </Stack>
              </Paper>
            </Box>
          </Stack>
        ) : (
          <Alert severity="info" variant="outlined">
            Console runs are not available for this submission yet.
          </Alert>
        )}

        {runCapability?.kind === 'file' ? (
          <Stack spacing={0.75}>
            <Paper
              variant="outlined"
              sx={{
                p: 1.1,
                borderRadius: CARD_RADIUS,
                borderColor: isDarkMode ? 'rgba(148, 163, 184, 0.25)' : 'rgba(148, 163, 184, 0.3)',
                backgroundColor: isDarkMode ? 'rgba(2, 6, 23, 0.16)' : 'rgba(255, 255, 255, 0.78)',
              }}
            >
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={0.9}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', md: 'center' }}
              >
                <Stack spacing={0.2}>
                  <Stack direction="row" spacing={0.7} alignItems="center" useFlexGap flexWrap="wrap">
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                      Run options
                    </Typography>
                    <Chip
                      size="small"
                      variant={consoleHasAdvancedInputs ? 'filled' : 'outlined'}
                      color={consoleHasAdvancedInputs ? 'primary' : 'default'}
                      label={
                        consoleHasAdvancedInputs
                          ? `${consoleArgs.length} args • ${consoleInputFiles.length} input ${consoleInputFiles.length === 1 ? 'file' : 'files'}`
                          : 'No extra options'
                      }
                    />
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    Add command-line arguments or temporary input files for file-based runs.
                  </Typography>
                </Stack>
                <Button
                  size="small"
                  variant={consoleAdvancedOpen ? 'contained' : 'outlined'}
                  onClick={() => setConsoleAdvancedOpen((prev) => !prev)}
                >
                  {consoleAdvancedOpen ? 'Hide options' : 'Edit options'}
                </Button>
              </Stack>
            </Paper>
            <Collapse in={consoleAdvancedOpen}>
              <Stack spacing={1}>
                <TextField
                  label="Program arguments"
                  helperText="One argument per line. They are appended to the command preview in order."
                  value={consoleArgsText}
                  onChange={(event) => setConsoleArgsText(event.target.value)}
                  multiline
                  minRows={2}
                  maxRows={5}
                  sx={terminalTextFieldSx}
                />

                <Stack spacing={1}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={0.75}
                    alignItems={{ xs: 'flex-start', sm: 'center' }}
                    justifyContent="space-between"
                  >
                    <Stack spacing={0.15}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                        Temporary input files
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Provide files that exist only for this run and are not attached to the submission.
                      </Typography>
                    </Stack>
                    <Button size="small" variant="outlined" onClick={addConsoleInputFile} startIcon={<AddRounded />}>
                      Add file
                    </Button>
                  </Stack>
                  {consoleInputFiles.length ? (
                    <Stack spacing={0.8}>
                      {consoleInputFiles.map((file) => (
                        <Paper
                          key={file.id}
                          variant="outlined"
                          sx={{
                            p: 1,
                            borderRadius: CARD_RADIUS,
                            backgroundColor: isDarkMode ? 'rgba(15, 23, 42, 0.28)' : 'rgba(248, 250, 252, 0.72)',
                          }}
                        >
                          <Stack spacing={0.75}>
                            <Stack direction="row" spacing={0.75} alignItems="center" justifyContent="space-between">
                              <TextField
                                label="Path"
                                size="small"
                                value={file.path}
                                onChange={(event) => updateConsoleInputFile(file.id, 'path', event.target.value)}
                                sx={{ flex: 1 }}
                              />
                              <Button
                                size="small"
                                variant="text"
                                color="error"
                                onClick={() => removeConsoleInputFile(file.id)}
                                startIcon={<DeleteRounded />}
                              >
                                Remove
                              </Button>
                            </Stack>
                            <TextField
                              label="Content"
                              size="small"
                              value={file.content}
                              onChange={(event) => updateConsoleInputFile(file.id, 'content', event.target.value)}
                              multiline
                              minRows={3}
                              maxRows={7}
                              sx={terminalTextFieldSx}
                            />
                          </Stack>
                        </Paper>
                      ))}
                    </Stack>
                  ) : (
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 1.2,
                        borderRadius: CARD_RADIUS,
                        borderStyle: 'dashed',
                        backgroundColor: isDarkMode ? 'rgba(15, 23, 42, 0.18)' : 'rgba(248, 250, 252, 0.64)',
                      }}
                    >
                      <Stack direction="row" spacing={1} alignItems="center">
                        <InsertDriveFileRounded color="disabled" />
                        <Stack spacing={0.2}>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            No temporary files yet
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Add fixtures like `input.txt` or config files that your program reads at runtime.
                          </Typography>
                        </Stack>
                      </Stack>
                    </Paper>
                  )}
                </Stack>

                {consoleProducedFiles.length ? (
                  <Stack spacing={0.8}>
                    <Divider />
                    <Stack spacing={0.15}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                        Produced files
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Files generated by the latest temporary run.
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                      {consoleProducedFiles.map((file) => (
                        <Button
                          key={file.name}
                          size="small"
                          variant={consoleSelectedProducedFileName === file.name ? 'contained' : 'outlined'}
                          onClick={() => setConsoleSelectedProducedFileName(file.name)}
                          sx={{ borderRadius: 999, textTransform: 'none' }}
                        >
                          {file.name}
                        </Button>
                      ))}
                    </Stack>
                    {consoleProducedFile ? (
                      <Paper
                        variant="outlined"
                        sx={{
                          p: 1,
                          borderRadius: CARD_RADIUS,
                          backgroundColor: isDarkMode ? 'rgba(15, 23, 42, 0.28)' : '#fff',
                        }}
                      >
                        <Typography variant="caption" color="text.secondary">
                          {consoleProducedFile.name}
                        </Typography>
                        <Box
                          component="pre"
                          sx={{
                            m: 0,
                            mt: 0.5,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            fontSize: 12,
                            lineHeight: 1.5,
                            fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
                          }}
                        >
                          {consoleProducedFile.content || '(empty file)'}
                        </Box>
                      </Paper>
                    ) : null}
                  </Stack>
                ) : null}
              </Stack>
            </Collapse>
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  )

  return (
    <Box
      sx={{
        py: { xs: 2, md: 3 },
        pb: useProfessorWorkspace ? { xs: 12, lg: 14 } : { xs: 2, md: 3 },
      }}
    >
      <Stack spacing={2}>
       

        {error ? <Alert severity="error">{error}</Alert> : null}

        {useProfessorWorkspace ? (
          <Paper
            elevation={0}
            sx={{
              p: { xs: 1.25, md: 1.4 },
              borderRadius: CARD_RADIUS,
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Stack
              direction={{ xs: 'column', lg: 'row' }}
              spacing={1}
              justifyContent="space-between"
              alignItems={{ xs: 'flex-start', lg: 'center' }}
            >
              <Stack spacing={0.15}>
                <Typography sx={{ fontSize: { xs: '1.05rem', md: '1.15rem' }, fontWeight: 900 }}>
                  {detailData.submission?.assignment_title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {detailData.submission?.group_name ? `Group ${currentSubmissionOwnerLabel}` : `Student ${currentSubmissionOwnerLabel}`}
                </Typography>
                {detailData.submission?.group_name ? (
                  <Typography variant="caption" color="text.secondary">
                    Submitted by {currentSubmissionActorLabel}
                  </Typography>
                ) : null}
                {detailData.submission?.group_name && currentSubmissionMemberNames.length ? (
                  <Typography variant="caption" color="text.secondary">
                    Members: {currentSubmissionMemberNames.join(', ')}
                  </Typography>
                ) : null}
                <Typography variant="caption" color="text.secondary">
                  Attempt {detailData.submission?.attempt_number || '—'} •{' '}
                  {detailData.submission?.submitted_at
                    ? new Date(detailData.submission.submitted_at).toLocaleString()
                    : '—'}
                </Typography>
                {attemptHistory.length > 1 ? (
                  <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap sx={{ mt: 0.4 }}>
                    {attemptHistory.map((attempt) => {
                      const selected = String(attempt?.id || '') === String(submissionId || '')
                      return (
                        <Button
                          key={attempt.id}
                          size="small"
                          variant={selected ? 'contained' : 'outlined'}
                          onClick={() => handleAttemptSwitch(attempt.id)}
                          sx={{ borderRadius: 999, textTransform: 'none', px: 1.1, minWidth: 0 }}
                        >
                          Attempt {attempt.attempt_number || '—'}
                        </Button>
                      )
                    })}
                  </Stack>
                ) : null}
              </Stack>
                <Stack spacing={0.75} alignItems={{ xs: 'flex-start', lg: 'flex-end' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ textAlign: { lg: 'right' } }}>
                    Status {statusMeta.label} • Run {detailData.grading_run?.exit_status ? formatIdentifierLabel(detailData.grading_run.exit_status) : '—'} • Grade {currentGradeLabel}
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Tooltip title="Refresh">
                    <IconButton size="small" onClick={loadDetailPage} aria-label="Refresh">
                      <RefreshRounded fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  {canRerun ? (
                    <Button
                      variant="contained"
                      startIcon={<ScheduleRounded />}
                      onClick={handleRerunSubmission}
                      disabled={rerunSubmissionId === submissionId}
                    >
                      {rerunSubmissionId === submissionId ? 'Queueing…' : 'Run again'}
                    </Button>
                  ) : null}
                </Stack>
              </Stack>
            </Stack>
          </Paper>
        ) : (
          <Box
            sx={{
              px: { xs: 1.5, md: 2 },
              py: 1.25,
              borderRadius: CARD_RADIUS,
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.paper',
              borderLeft: '3px solid',
              borderLeftColor: statusMeta.color === 'success'
                ? 'success.main'
                : statusMeta.color === 'error'
                  ? 'error.main'
                  : statusMeta.color === 'warning'
                    ? 'warning.main'
                    : 'primary.main',
            }}
          >
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              justifyContent="space-between"
              alignItems={{ xs: 'flex-start', sm: 'center' }}
              spacing={0.75}
            >
              {/* Left: identity */}
              <Stack spacing={0.1}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                    {detailData.submission?.assignment_title}
                  </Typography>
                  <Chip
                    size="small"
                    label={statusMeta.label}
                    color={statusMeta.color}
                    variant="outlined"
                    sx={{ height: 20, fontSize: 11, fontWeight: 700 }}
                  />
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {detailData.submission?.group_name
                    ? `Group ${detailData.submission.group_name} · ${currentSubmissionActorLabel}`
                    : currentSubmissionOwnerLabel}
                  {detailData.submission?.group_name && currentSubmissionMemberNames.length
                    ? ` · ${formatMemberPreview(currentSubmissionMemberNames)}`
                    : ''}
                  {' · Attempt '}{detailData.submission?.attempt_number || '—'}
                  {' · '}
                  {detailData.submission?.submitted_at
                    ? new Date(detailData.submission.submitted_at).toLocaleString()
                    : '—'}
                </Typography>
              </Stack>

              {/* Right: stats */}
              <Stack direction="row" spacing={2} alignItems="center" flexShrink={0}>
                <Stack spacing={0} alignItems={{ xs: 'flex-start', sm: 'flex-end' }}>
                  <Typography variant="body2" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
                    {currentGradeLabel}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">Grade</Typography>
                </Stack>
                {feedbackSummary.total > 0 && (
                  <>
                    <Box sx={{ width: 1, height: 24, bgcolor: 'divider' }} />
                    <Stack spacing={0} alignItems={{ xs: 'flex-start', sm: 'flex-end' }}>
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: 800, lineHeight: 1.2, color: feedbackSummary.failed ? 'error.main' : 'success.main' }}
                      >
                        {feedbackSummary.passed}/{feedbackSummary.total}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">Tests passed</Typography>
                    </Stack>
                  </>
                )}
              </Stack>
            </Stack>
          </Box>
        )}

        {useProfessorWorkspace ? (
          <Stack spacing={2}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { lg: 'minmax(0, 1.25fr) minmax(360px, 0.95fr)' },
              gap: 2,
              alignItems: 'stretch',
            }}
          >
            {professorCodePanel}

              <Paper
                elevation={0}
              sx={{
                p: 1.25,
                borderRadius: CARD_RADIUS,
                border: '1px solid',
                borderColor: 'divider',
                position: 'sticky',
                top: 86,
                height: 'calc(100vh - 150px)',
                overflow: 'hidden',
              }}
            >
                <Stack spacing={1} sx={{ height: '100%', minHeight: 0 }}>
                  <Stack spacing={0.1}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
                      Review workspace
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Switch between review, tests, similarity, and AI signals.
                    </Typography>
                  </Stack>

                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                    {professorReviewTabs.map((tab) => (
                      <Button
                        key={tab.key}
                        size="small"
                        variant={reviewTab === tab.key ? 'contained' : 'outlined'}
                        onClick={() => setReviewTab(tab.key)}
                        sx={{ borderRadius: 999, textTransform: 'none', px: 1.1 }}
                      >
                        {tab.label}
                      </Button>
                    ))}
                  </Stack>

                  <Divider />

                  <Box
                    sx={{
                      flex: 1,
                      minHeight: 0,
                      overflowY: 'auto',
                      overflowX: 'hidden',
                      pr: 0.5,
                      pb: reviewTab === 'review' || reviewTab === 'similarity' ? 1.5 : 0,
                      scrollbarGutter: 'stable',
                    }}
                  >
                    {reviewTab === 'review'
                      ? professorReviewPanel
                      : reviewTab === 'tests'
                        ? professorTestsPanel
                        : reviewTab === 'similarity'
                          ? (
                            <SubmissionSimilarityPanel
                              assignmentId={assignmentId}
                              submissionId={submissionId}
                              courseId={courseId}
                            />
                          )
                        : reviewTab === 'ai-detection'
                          ? (
                            <Stack spacing={2} sx={{ p: 1 }}>
                              {/* Header row */}
                              <Stack direction="row" alignItems="center" justifyContent="space-between">
                                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                  AI-Generated Code Detection
                                </Typography>
                                <Button
                                  size="small"
                                  variant="contained"
                                  disabled={aiScanLoading}
                                  onClick={async () => {
                                    setAiScanLoading(true)
                                    setAiScanError('')
                                    try {
                                      const data = await apiRequest(
                                        `/api/submissions/${submissionId}/ai-scan/`,
                                        { method: 'POST' },
                                      )
                                      setAiScan(data)
                                    } catch (e) {
                                      setAiScanError(e?.message || 'Scan failed.')
                                    } finally {
                                      setAiScanLoading(false)
                                    }
                                  }}
                                  sx={{ textTransform: 'none', borderRadius: 999 }}
                                >
                                  {aiScanLoading ? 'Scanning…' : aiScan ? 'Re-scan' : 'Scan for AI'}
                                </Button>
                              </Stack>

                              {/* Error */}
                              {aiScanError && (
                                <Typography variant="caption" color="error">
                                  {aiScanError}
                                </Typography>
                              )}

                              {/* No scan yet */}
                              {!aiScan && !aiScanLoading && (
                                <Typography variant="body2" color="text.secondary">
                                  Click &ldquo;Scan for AI&rdquo; to analyse this submission.
                                </Typography>
                              )}

                              {/* Loading skeleton */}
                              {aiScanLoading && (
                                <Stack spacing={1}>
                                  <Skeleton variant="rounded" height={56} />
                                  <Skeleton variant="rounded" height={40} />
                                  <Skeleton variant="rounded" height={40} />
                                </Stack>
                              )}

                              {/* Results */}
                              {aiScan && !aiScanLoading && (
                                <Stack spacing={1.5}>
                                  {/* Overall score card */}
                                  <Box
                                    sx={{
                                      p: 1.5,
                                      borderRadius: 2,
                                      border: '1px solid',
                                      borderColor:
                                        aiScan.verdict === 'CONFIRMED_AI'
                                          ? 'error.light'
                                          : aiScan.verdict === 'LIKELY_AI'
                                            ? 'warning.light'
                                            : 'success.light',
                                      backgroundColor:
                                        aiScan.verdict === 'CONFIRMED_AI'
                                          ? 'rgba(239,68,68,0.06)'
                                          : aiScan.verdict === 'LIKELY_AI'
                                            ? 'rgba(245,158,11,0.06)'
                                            : 'rgba(34,197,94,0.06)',
                                    }}
                                  >
                                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                                      <Stack spacing={0.25}>
                                        <Typography variant="caption" color="text.secondary">
                                          Overall AI confidence
                                        </Typography>
                                        <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1 }}>
                                          {aiScan.overall_score != null
                                            ? `${Math.round(aiScan.overall_score * 100)}%`
                                            : '—'}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                          Model: {aiScan.model_version}
                                          {aiScan.completed_at && ` · ${new Date(aiScan.completed_at).toLocaleString()}`}
                                        </Typography>
                                      </Stack>
                                      <Chip
                                        size="small"
                                        label={
                                          aiScan.verdict === 'CONFIRMED_AI'
                                            ? 'Confirmed AI'
                                            : aiScan.verdict === 'LIKELY_AI'
                                              ? 'Likely AI'
                                              : aiScan.verdict === 'CLEAN'
                                                ? 'Clean'
                                                : aiScan.status === 'FAILED'
                                                  ? 'Failed'
                                                  : 'Pending'
                                        }
                                        color={
                                          aiScan.verdict === 'CONFIRMED_AI'
                                            ? 'error'
                                            : aiScan.verdict === 'LIKELY_AI'
                                              ? 'warning'
                                              : aiScan.verdict === 'CLEAN'
                                                ? 'success'
                                                : 'default'
                                        }
                                        sx={{ fontWeight: 700 }}
                                      />
                                    </Stack>
                                  </Box>

                                  {/* Failed message */}
                                  {aiScan.status === 'FAILED' && (
                                    <Typography variant="caption" color="error">
                                      {aiScan.error_message || 'Scan failed.'}
                                    </Typography>
                                  )}

                                  {/* Findings grouped by file */}
                                  {aiScan.findings?.length > 0 && (() => {
                                    const grouped = aiScan.findings.reduce((acc, f) => {
                                      ;(acc[f.file_path] = acc[f.file_path] || []).push(f)
                                      return acc
                                    }, {})
                                    const fileEntries = Object.entries(grouped)
                                    return (
                                      <Stack spacing={1.25}>
                                        <Stack direction="row" alignItems="center" justifyContent="space-between">
                                          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                            Flagged regions · {fileEntries.length} file{fileEntries.length !== 1 ? 's' : ''}
                                          </Typography>
                                          <Typography variant="caption" color="text.secondary">
                                            Click a region to view code
                                          </Typography>
                                        </Stack>

                                        {fileEntries.map(([filePath, findings]) => {
                                          const maxConf = Math.max(...findings.map((f) => f.confidence))
                                          const fileLines = aiFileCache[filePath]
                                          return (
                                            <Box
                                              key={filePath}
                                              sx={{
                                                borderRadius: 1.5,
                                                border: '1px solid',
                                                borderColor: 'divider',
                                                overflow: 'hidden',
                                              }}
                                            >
                                              {/* File header */}
                                              <Stack
                                                direction="row"
                                                alignItems="center"
                                                justifyContent="space-between"
                                                sx={{
                                                  px: 1.5, py: 1,
                                                  backgroundColor: 'rgba(15,23,42,0.04)',
                                                  borderBottom: '1px solid',
                                                  borderColor: 'divider',
                                                }}
                                              >
                                                <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                                                  <InsertDriveFileRounded sx={{ fontSize: 14, color: 'error.main', flexShrink: 0 }} />
                                                  <Typography variant="caption" sx={{ fontWeight: 700, fontFamily: 'monospace', color: 'text.primary' }} noWrap>
                                                    {filePath}
                                                  </Typography>
                                                </Stack>
                                                <Stack direction="row" spacing={0.75} alignItems="center" flexShrink={0}>
                                                  <Typography variant="caption" color="text.secondary">
                                                    {findings.length} region{findings.length !== 1 ? 's' : ''}
                                                  </Typography>
                                                  <Chip
                                                    size="small"
                                                    label={`up to ${Math.round(maxConf * 100)}% AI`}
                                                    color={maxConf >= 0.75 ? 'error' : 'warning'}
                                                    variant="outlined"
                                                    sx={{ fontWeight: 700, fontSize: 10 }}
                                                  />
                                                </Stack>
                                              </Stack>

                                              {/* Findings within this file */}
                                              <Stack divider={<Divider />}>
                                                {findings.map((f) => {
                                                  const expanded = aiExpandedFinding === f.id
                                                  const CONTEXT = 3
                                                  const startIdx = Math.max(0, f.start_line - CONTEXT)
                                                  const endIdx = Math.min(
                                                    fileLines ? fileLines.length - 1 : f.end_line + CONTEXT,
                                                    f.end_line + CONTEXT,
                                                  )
                                                  const snippetLines = fileLines
                                                    ? fileLines.slice(startIdx, endIdx + 1)
                                                    : []
                                                  return (
                                                    <Box key={f.id}>
                                                      {/* Region row */}
                                                      <Stack
                                                        direction="row"
                                                        alignItems="center"
                                                        justifyContent="space-between"
                                                        spacing={1}
                                                        onClick={() => fetchFileForFinding(f)}
                                                        sx={{
                                                          px: 1.5, py: 0.9,
                                                          cursor: 'pointer',
                                                          backgroundColor: expanded ? 'rgba(239,68,68,0.05)' : 'transparent',
                                                          '&:hover': { backgroundColor: 'rgba(239,68,68,0.035)' },
                                                          transition: 'background 0.12s',
                                                        }}
                                                      >
                                                        <Stack spacing={0} sx={{ minWidth: 0 }}>
                                                          <Typography variant="caption" color="text.secondary">
                                                            Lines {f.start_line + 1}–{f.end_line + 1}
                                                            <Box component="span" sx={{ color: 'text.disabled' }}>
                                                              {' · '}{f.end_line - f.start_line + 1} lines
                                                            </Box>
                                                          </Typography>
                                                        </Stack>
                                                        <Stack direction="row" spacing={0.75} alignItems="center" flexShrink={0}>
                                                          <Chip
                                                            size="small"
                                                            label={`${Math.round(f.confidence * 100)}% AI`}
                                                            color={f.confidence >= 0.75 ? 'error' : 'warning'}
                                                            variant="outlined"
                                                            sx={{ fontWeight: 700, fontSize: 10 }}
                                                          />
                                                          <ExpandMoreRounded sx={{
                                                            fontSize: 15,
                                                            color: 'text.disabled',
                                                            transition: 'transform 0.2s',
                                                            transform: expanded ? 'rotate(180deg)' : 'none',
                                                          }} />
                                                        </Stack>
                                                      </Stack>

                                                      {/* Inline code snippet */}
                                                      <Collapse in={expanded}>
                                                        {aiSnippetLoading && aiExpandedFinding === f.id ? (
                                                          <Box sx={{ px: 2, py: 1.5, backgroundColor: '#0f172a' }}>
                                                            <Skeleton variant="text" width="60%" sx={{ bgcolor: 'rgba(255,255,255,0.08)' }} />
                                                            <Skeleton variant="text" width="80%" sx={{ bgcolor: 'rgba(255,255,255,0.08)' }} />
                                                            <Skeleton variant="text" width="50%" sx={{ bgcolor: 'rgba(255,255,255,0.08)' }} />
                                                          </Box>
                                                        ) : fileLines === null ? (
                                                          <Box sx={{ px: 2, py: 1.25, backgroundColor: '#0f172a' }}>
                                                            <Typography variant="caption" sx={{ color: '#f87171' }}>Could not load file.</Typography>
                                                          </Box>
                                                        ) : snippetLines.length > 0 ? (
                                                          <Box
                                                            component="pre"
                                                            sx={{
                                                              m: 0,
                                                              backgroundColor: '#0f172a',
                                                              overflowX: 'auto',
                                                              fontSize: 12,
                                                              lineHeight: 1.65,
                                                              fontFamily: 'Menlo,Monaco,Consolas,"Courier New",monospace',
                                                            }}
                                                          >
                                                            {snippetLines.map((line, i) => {
                                                              const lineNum = startIdx + i
                                                              const isFlagged = lineNum >= f.start_line && lineNum <= f.end_line
                                                              return (
                                                                <Box
                                                                  key={lineNum}
                                                                  component="div"
                                                                  sx={{
                                                                    display: 'flex',
                                                                    alignItems: 'stretch',
                                                                    backgroundColor: isFlagged ? 'rgba(239,68,68,0.18)' : 'transparent',
                                                                    borderLeft: '3px solid',
                                                                    borderColor: isFlagged ? '#ef4444' : 'transparent',
                                                                  }}
                                                                >
                                                                  <Box
                                                                    component="span"
                                                                    sx={{
                                                                      display: 'inline-block',
                                                                      minWidth: 36,
                                                                      px: 1,
                                                                      textAlign: 'right',
                                                                      color: isFlagged ? 'rgba(239,68,68,0.7)' : 'rgba(148,163,184,0.35)',
                                                                      userSelect: 'none',
                                                                      flexShrink: 0,
                                                                      fontSize: 11,
                                                                    }}
                                                                  >
                                                                    {lineNum + 1}
                                                                  </Box>
                                                                  <Box
                                                                    component="span"
                                                                    sx={{
                                                                      pl: 1.5, pr: 2,
                                                                      color: isFlagged ? '#fca5a5' : 'rgba(203,213,225,0.7)',
                                                                      whiteSpace: 'pre',
                                                                      flex: 1,
                                                                    }}
                                                                  >
                                                                    {line || ' '}
                                                                  </Box>
                                                                </Box>
                                                              )
                                                            })}
                                                          </Box>
                                                        ) : null}
                                                      </Collapse>
                                                    </Box>
                                                  )
                                                })}
                                              </Stack>
                                            </Box>
                                          )
                                        })}
                                      </Stack>
                                    )
                                  })()}

                                  {aiScan.status === 'DONE' && aiScan.findings?.length === 0 && (
                                    <Typography variant="body2" color="text.secondary">
                                      No specific regions flagged.
                                    </Typography>
                                  )}
                                </Stack>
                              )}
                            </Stack>
                          )
                          : professorOverviewPanel}
                  </Box>
                </Stack>
              </Paper>
            </Box>
            <Paper
              elevation={0}
              sx={{
                p: { xs: 1.1, md: 1.15 },
                borderRadius: CARD_RADIUS,
                border: '1px solid',
                borderColor: 'divider',
                backgroundColor: isDarkMode ? 'rgba(15, 23, 42, 0.14)' : 'rgba(79, 70, 229, 0.03)',
              }}
            >
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between">
                <Stack spacing={0.3}>
                  <Stack direction="row" spacing={0.7} alignItems="center" useFlexGap flexWrap="wrap">
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                      Console run
                    </Typography>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={
                        runCapability
                          ? (isConsoleFileRun ? 'Supports stdin, args, and files' : 'Supports stdin preview')
                          : 'Not available'
                      }
                    />
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    Re-run the saved submission with temporary input when you need to confirm a bug or reproduce a
                    student report.
                  </Typography>
                </Stack>
                <Button
                  size="small"
                  variant={showConsolePanel ? 'outlined' : 'contained'}
                  onClick={() => setShowConsolePanel((prev) => !prev)}
                >
                  {showConsolePanel ? 'Hide console' : 'Open console'}
                </Button>
              </Stack>
            </Paper>
            <Collapse in={showConsolePanel} unmountOnExit>
              {professorConsolePanel}
            </Collapse>
          </Stack>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: '360px minmax(0,1fr)' },
              gap: 2,
              alignItems: 'start',
            }}
          >
            {/* ── LEFT COLUMN: Test Results + Submitted Files ───────────────────── */}
            <Stack spacing={2}>

            {/* Test Results */}
            <Paper
              elevation={0}
              sx={{ borderRadius: CARD_RADIUS, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}
            >
              {/* Section header */}
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}
              >
                <Stack spacing={0.1}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>Test Results</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {feedbackSummary.total > 0
                      ? `${feedbackSummary.passed} of ${feedbackSummary.total} checks passed`
                      : 'No automated checks available'}
                  </Typography>
                </Stack>
                {feedbackSummary.total > 0 && (
                  <Stack direction="row" spacing={0.75}>
                    {feedbackSummary.failed > 0 && (
                      <Chip size="small" icon={<CancelRounded sx={{ fontSize: 14 }} />} label={`${feedbackSummary.failed} failed`} color="error" />
                    )}
                    {feedbackSummary.incomplete > 0 && (
                      <Chip size="small" label={`${feedbackSummary.incomplete} incomplete`} color="warning" />
                    )}
                    {feedbackSummary.failed === 0 && feedbackSummary.incomplete === 0 && (
                      <Chip size="small" icon={<CheckCircleRounded sx={{ fontSize: 14 }} />} label="All passed" color="success" />
                    )}
                  </Stack>
                )}
              </Stack>

              {feedbackResults.length ? (
                <Stack divider={<Divider />}>
                  {feedbackResults.map((result, index) => {
                    const meta = feedbackStatusMeta(result)
                    const expanded = index === selectedFeedbackIndex
                    const hasSections = expanded && (selectedFeedbackDetailSections.length > 0 || selectedFeedbackIssueCards.length > 0 || (selectedFeedback?.message && selectedFeedback.message !== selectedFeedback.summary))
                    return (
                      <Box key={result.id}>
                        {/* Row */}
                        <Stack
                          direction="row"
                          alignItems="center"
                          spacing={1.5}
                          onClick={() => setSelectedFeedbackIndex(expanded ? -1 : index)}
                          sx={{
                            px: 2,
                            py: 1.25,
                            cursor: 'pointer',
                            backgroundColor: expanded ? 'rgba(79,70,229,0.03)' : 'transparent',
                            '&:hover': { backgroundColor: 'rgba(0,0,0,0.02)' },
                            transition: 'background 0.15s',
                          }}
                        >
                          {/* Status icon */}
                          {meta.color === 'success'
                            ? <CheckCircleRounded sx={{ color: 'success.main', fontSize: 20, flexShrink: 0 }} />
                            : meta.color === 'error'
                              ? <CancelRounded sx={{ color: 'error.main', fontSize: 20, flexShrink: 0 }} />
                              : <ScheduleRounded sx={{ color: 'warning.main', fontSize: 20, flexShrink: 0 }} />}
                          {/* Name + summary */}
                          <Stack spacing={0.1} sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                              {result.test_name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" noWrap>
                              {feedbackListSummary(result)}
                            </Typography>
                          </Stack>
                          {/* Time chip */}
                          {result.time_ms != null && (
                            <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>
                              {result.time_ms} ms
                            </Typography>
                          )}
                          {/* Expand icon */}
                          <ExpandMoreRounded sx={{
                            fontSize: 18,
                            color: 'text.disabled',
                            flexShrink: 0,
                            transition: 'transform 0.2s',
                            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                          }} />
                        </Stack>

                        {/* Expanded detail */}
                        <Collapse in={expanded}>
                          <Box sx={{ px: 2, pb: 2, pt: 0.5, backgroundColor: 'rgba(248,250,252,0.8)' }}>
                            <Stack spacing={1}>
                              {/* Summary message */}
                              {selectedFeedback?.summary && (
                                <Typography variant="body2" color="text.secondary">
                                  {feedbackDetailSummary(selectedFeedback, selectedFeedbackDetailSections, selectedFeedbackIssueCards)}
                                </Typography>
                              )}
                              {/* Full message */}
                              {selectedFeedback?.message && selectedFeedback.message !== selectedFeedback.summary && (
                                <Box
                                  component="pre"
                                  sx={{
                                    m: 0, p: 1.25, borderRadius: 1.5, border: '1px solid',
                                    borderColor: 'divider', backgroundColor: '#fff',
                                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                    fontSize: 12, lineHeight: 1.6,
                                    fontFamily: 'Menlo,Monaco,Consolas,"Courier New",monospace',
                                  }}
                                >
                                  {selectedFeedback.message}
                                </Box>
                              )}
                              {/* Case details */}
                              {selectedFeedbackDetailSections.length > 0 && (
                                <Stack spacing={0.75}>
                                  <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                    Case details
                                  </Typography>
                                  {selectedFeedbackDetailSections.map((section) => (
                                    <Box key={section.key}>
                                      <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mb: 0.3 }}>
                                        {section.label}
                                      </Typography>
                                      <Box
                                        component="pre"
                                        sx={{
                                          m: 0, p: 1, borderRadius: 1.5, border: '1px solid',
                                          borderColor: 'divider', backgroundColor: '#fff',
                                          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                          fontSize: 12, lineHeight: 1.55,
                                          fontFamily: 'Menlo,Monaco,Consolas,"Courier New",monospace',
                                        }}
                                      >
                                        {section.value}
                                      </Box>
                                    </Box>
                                  ))}
                                </Stack>
                              )}
                              {/* Issues */}
                              {selectedFeedbackIssueCards.length > 0 && (
                                <Stack spacing={0.75}>
                                  <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                    Issues
                                  </Typography>
                                  {selectedFeedbackIssueCards.map((issue) => (
                                    <Paper key={issue.id} variant="outlined" sx={{ p: 1, borderRadius: 1.5, backgroundColor: '#fff' }}>
                                      <Stack spacing={0.5}>
                                        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                            {issue.kind ? formatIdentifierLabel(issue.kind) : 'Issue'}
                                          </Typography>
                                          {issue.kind && <Chip size="small" variant="outlined" label={formatIdentifierLabel(issue.kind)} sx={{ fontSize: 10 }} />}
                                        </Stack>
                                        {issue.message && (
                                          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
                                            {issue.message}
                                          </Typography>
                                        )}
                                      </Stack>
                                    </Paper>
                                  ))}
                                </Stack>
                              )}
                              {!hasSections && (
                                <Typography variant="caption" color="text.secondary">No additional details.</Typography>
                              )}
                            </Stack>
                          </Box>
                        </Collapse>
                      </Box>
                    )
                  })}
                </Stack>
              ) : (
                <Box sx={{ px: 2, py: 3 }}>
                  <Typography color="text.secondary" variant="body2">No check results available for this submission.</Typography>
                </Box>
              )}
            </Paper>

            {/* ── Submitted Files (compact list — preview shown in right column) ── */}
            <Paper
              elevation={0}
              sx={{ borderRadius: CARD_RADIUS, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}
            >
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Stack spacing={0.1}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>Submitted Files</Typography>
                  {manifest && (
                    <Typography variant="caption" color="text.secondary">
                      {manifest.file_count} file{manifest.file_count !== 1 ? 's' : ''} · {formatBytes(manifest.total_size)}
                    </Typography>
                  )}
                </Stack>
                {detailData.submission?.source_bundle_key && (
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<DownloadRounded />}
                    onClick={() => window.open(`${API_BASE}/media/${detailData.submission.source_bundle_key}`, '_blank', 'noopener,noreferrer')}
                    sx={{ textTransform: 'none', borderRadius: 999 }}
                  >
                    Download
                  </Button>
                )}
              </Stack>
              {manifestError && <Box sx={{ p: 2 }}><Alert severity="error">{manifestError}</Alert></Box>}
              {manifestLoading ? (
                <Box sx={{ p: 2 }}><LinearProgress sx={{ height: 4, borderRadius: 999 }} /></Box>
              ) : manifest?.files?.length ? (
                <Stack divider={<Divider />} sx={{ maxHeight: 320, overflowY: 'auto' }}>
                  {manifest.files.filter((f) => !f.is_dir).map((file) => {
                    const sel = submittedPreviewFileName === file.name
                    return (
                      <Stack
                        key={file.name}
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        onClick={() => openSubmittedFilePreview(file.name)}
                        sx={{
                          px: 1.75, py: 1, cursor: 'pointer',
                          backgroundColor: sel ? 'rgba(79,70,229,0.06)' : 'transparent',
                          '&:hover': { backgroundColor: sel ? 'rgba(79,70,229,0.09)' : 'rgba(0,0,0,0.025)' },
                          transition: 'background 0.12s',
                        }}
                      >
                        <InsertDriveFileRounded sx={{ fontSize: 15, color: sel ? 'primary.main' : 'text.disabled', flexShrink: 0 }} />
                        <Stack spacing={0} sx={{ flex: 1, minWidth: 0 }}>
                          <Typography
                            variant="caption"
                            sx={{ fontWeight: sel ? 700 : 500, fontFamily: 'monospace', color: sel ? 'primary.main' : 'text.primary' }}
                            noWrap
                          >
                            {file.name}
                          </Typography>
                          <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10 }}>
                            {formatBytes(file.size)}
                          </Typography>
                        </Stack>
                        <ChevronRightRounded sx={{ fontSize: 16, color: sel ? 'primary.main' : 'text.disabled', flexShrink: 0 }} />
                      </Stack>
                    )
                  })}
                </Stack>
              ) : (
                <Box sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">No files available.</Typography>
                </Box>
              )}
            </Paper>

            </Stack>

            {/* ── RIGHT COLUMN: Feedback + Rubric + File Preview ───────────────── */}
            <Stack spacing={2}>

            {/* Feedback & Rubric */}
            <Paper
              elevation={0}
              sx={{ borderRadius: CARD_RADIUS, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}
            >
              <Stack sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>Feedback & Rubric</Typography>
              </Stack>
              <Stack spacing={2} sx={{ p: 2 }}>
                {detailData?.grade?.feedback ? (
                  <Box sx={{ p: 1.5, borderRadius: 2, borderLeft: '3px solid', borderColor: 'primary.main', backgroundColor: 'rgba(79,70,229,0.04)' }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: 'primary.main', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', mb: 0.5 }}>
                      Instructor note
                    </Typography>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.7 }}>
                      {detailData.grade.feedback}
                    </Typography>
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">No instructor feedback yet.</Typography>
                )}
                {detailData?.rubric?.available ? (
                  <Stack spacing={1}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary' }}>
                        Rubric
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatScoreValue(rubricSummary.score)} / {formatScoreValue(rubricSummary.maxScore)} pts
                      </Typography>
                    </Stack>
                    {(rubricDraft?.criteria || []).map((criterion) => {
                      const maxPoints = Number(criterion.max_points || 0)
                      const awarded = Math.min(Math.max(Number(criterion.points_awarded || 0), 0), maxPoints)
                      const ratio = maxPoints > 0 ? (awarded / maxPoints) * 100 : 0
                      const perfect = ratio >= 100
                      return (
                        <Box
                          key={criterion.criterion_id}
                          sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', backgroundColor: perfect ? 'rgba(34,197,94,0.03)' : 'transparent' }}
                        >
                          <Stack spacing={0.9}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                              <Typography variant="body2" sx={{ fontWeight: 700 }}>{criterion.name}</Typography>
                              <Typography variant="body2" sx={{ fontWeight: 800, color: perfect ? 'success.main' : ratio > 0 ? 'warning.dark' : 'error.main' }}>
                                {formatScoreValue(awarded)} / {formatScoreValue(maxPoints)}
                              </Typography>
                            </Stack>
                            <LinearProgress
                              variant="determinate"
                              value={ratio}
                              sx={{
                                height: 6, borderRadius: 999,
                                backgroundColor: 'rgba(148,163,184,0.18)',
                                '& .MuiLinearProgress-bar': {
                                  borderRadius: 999,
                                  background: perfect
                                    ? 'linear-gradient(90deg,#22c55e,#16a34a)'
                                    : ratio > 0
                                      ? 'linear-gradient(90deg,#f59e0b,#d97706)'
                                      : 'linear-gradient(90deg,#ef4444,#dc2626)',
                                },
                              }}
                            />
                            {criterion.comment && (
                              <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
                                {criterion.comment}
                              </Typography>
                            )}
                          </Stack>
                        </Box>
                      )
                    })}
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.secondary">No rubric available for this assignment.</Typography>
                )}
              </Stack>
            </Paper>

            {/* File Preview — appears when a file is selected from the left column */}
            {submittedPreviewFileName && (
              <Paper
                elevation={0}
                sx={{ borderRadius: CARD_RADIUS, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}
              >
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                    <InsertDriveFileRounded sx={{ fontSize: 15, color: 'text.disabled', flexShrink: 0 }} />
                    <Typography variant="caption" sx={{ fontWeight: 700, fontFamily: 'monospace', color: 'text.secondary' }} noWrap>
                      {submittedPreviewFileName}
                    </Typography>
                  </Stack>
                  <Stack direction="row" spacing={0.5} alignItems="center" flexShrink={0}>
                    {submittedPreviewObjectUrl && (
                      <Button
                        size="small"
                        component="a"
                        href={submittedPreviewObjectUrl}
                        target="_blank"
                        rel="noreferrer"
                        sx={{ textTransform: 'none', fontSize: 11 }}
                      >
                        Open
                      </Button>
                    )}
                  </Stack>
                </Stack>
                <Box sx={{ p: 1.5 }}>
                  {submittedPreviewError && <Alert severity="error" sx={{ mb: 1 }}>{submittedPreviewError}</Alert>}
                  {submittedPreviewLoading ? (
                    <Stack spacing={1}>
                      <Skeleton variant="text" width="40%" />
                      <Skeleton variant="rounded" height={220} />
                    </Stack>
                  ) : (
                    <Stack spacing={1}>
                      {submittedPreviewTruncated && (
                        <Alert severity="warning" variant="outlined" sx={{ py: 0 }}>
                          Showing first {formatBytes(MAX_SUBMISSION_PREVIEW_BYTES)} only.
                        </Alert>
                      )}
                      {submittedPreviewMode === 'text' ? (
                        <Box
                          component="pre"
                          sx={{
                            m: 0, p: 1.25, borderRadius: 1.5, border: '1px solid', borderColor: 'divider',
                            backgroundColor: '#fff', maxHeight: 480, overflow: 'auto',
                            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                            fontSize: 12, lineHeight: 1.6,
                            fontFamily: 'Menlo,Monaco,Consolas,"Courier New",monospace',
                          }}
                        >
                          {submittedPreviewTextContent || '(empty file)'}
                        </Box>
                      ) : submittedPreviewMode === 'image' && submittedPreviewObjectUrl ? (
                        <Box component="img" src={submittedPreviewObjectUrl} alt={submittedPreviewFileName}
                          sx={{ maxWidth: '100%', maxHeight: 480, objectFit: 'contain', borderRadius: CARD_RADIUS }} />
                      ) : submittedPreviewMode === 'pdf' && submittedPreviewObjectUrl ? (
                        <Box component="iframe" title={submittedPreviewFileName} src={submittedPreviewObjectUrl}
                          sx={{ width: '100%', height: 480, border: 0, borderRadius: CARD_RADIUS }} />
                      ) : submittedPreviewMode === 'video' && submittedPreviewObjectUrl ? (
                        <Box component="video" src={submittedPreviewObjectUrl} controls
                          sx={{ width: '100%', maxHeight: 480, borderRadius: CARD_RADIUS }} />
                      ) : submittedPreviewMode === 'audio' && submittedPreviewObjectUrl ? (
                        <audio src={submittedPreviewObjectUrl} controls style={{ width: '100%' }} />
                      ) : submittedPreviewObjectUrl ? (
                        <Alert severity="info" variant="outlined">Preview not supported. Open in a new tab.</Alert>
                      ) : null}
                    </Stack>
                  )}
                </Box>
              </Paper>
            )}

            </Stack>
          </Box>
        )}

        {useProfessorWorkspace ? professorStickyGradingBar : null}
      </Stack>
    </Box>
  )
}

export default CourseSubmissionDetailPage
