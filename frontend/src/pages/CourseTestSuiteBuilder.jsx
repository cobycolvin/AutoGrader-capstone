import { useEffect, useMemo, useState } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Container,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  AddRounded,
  ArrowBackRounded,
  ContentCopyRounded,
  ExpandMoreRounded,
  UploadRounded,
} from '@mui/icons-material'
import { Link as RouterLink, useLocation, useNavigate, useParams } from 'react-router-dom'
import { apiRequest } from '../api/client.js'

const detectLanguageFamily = (name) => {
  const lowered = (name || '').toLowerCase()
  if (lowered.includes('python')) return 'python'
  if (lowered.includes('java')) return 'java'
  return ''
}

const FILE_IO_COMPARISON_MODES = [
  'EXACT',
  'TRIMMED',
  'NORMALIZED_WHITESPACE',
  'UNORDERED_LINES',
  'JSON_EQ',
  'NUMERIC_TOLERANCE',
]
const MAX_INLINE_FILE_BYTES = 256 * 1024

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

const createBuilderGradingFile = (overrides = {}) => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  originalName: '',
  path: '',
  content: '',
  size: 0,
  ...overrides,
})

const JAVA_MAIN_METHOD_RE = /\b(?:public\s+)?static\s+void\s+main\s*\(\s*String(?:\s*\[\s*\]\s*\w+|\s+\w+\s*\[\s*\]|\s*\.\.\.\s*\w+|\s*\[\s*\])?/m
const JAVA_PACKAGE_RE = /^\s*package\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*;/m

const deriveEntrypointFromGradingFile = (path, languageFamily) => {
  const relativePath = String(path || '').trim().replace(/^\.\/+/, '').replace(/\\/g, '/')
  if (!relativePath) return ''
  if (languageFamily === 'python') return relativePath
  if (languageFamily === 'java') {
    return relativePath.replace(/\.java$/i, '').split('/').filter(Boolean).join('.')
  }
  return ''
}

const deriveJavaMainClassFromSource = (path, content) => {
  const relativePath = String(path || '').trim().replace(/^\.\/+/, '').replace(/\\/g, '/')
  if (!relativePath || !/\.java$/i.test(relativePath)) return ''
  const source = String(content || '')
  if (!JAVA_MAIN_METHOD_RE.test(source)) return ''
  const baseName = relativePath.split('/').pop()?.replace(/\.java$/i, '') || ''
  if (!baseName) return ''
  const packageMatch = source.match(JAVA_PACKAGE_RE)
  return packageMatch?.[1] ? `${packageMatch[1]}.${baseName}` : baseName
}

const FILE_IO_VALIDATOR_TEMPLATE = `def validate_case(case, context):
    case_dir = context["case_dir"]
    stdout = context["stdout"]
    stderr = context["stderr"]
    exit_code = context["exit_code"]

    # Return {"passed": bool, "message": str}
    return {"passed": True, "message": ""}
`

const makeDefaultFileFixture = () => ({
  path: '',
  content: '',
})

const makeDefaultInlineExpectation = () => ({
  content: '',
  comparison_mode: 'EXACT',
  numeric_tolerance: '',
})

const makeDefaultFileExpectation = () => ({
  path: '',
  content: '',
  comparison_mode: 'EXACT',
  numeric_tolerance: '',
})

const makeDefaultIOCase = (index) => ({
  name: `case-${index}`,
  input: '',
  expected: '',
})

const makeDefaultOOPClassTest = () => ({
  name: '',
  class_name: '',
  constructor_args: '[]',
  steps: [{ method: '', args: '[]' }],
  assert_method: '',
  assert_args: '[]',
  expected: '',
})

const makeDefaultOOPMainTest = () => ({
  name: '',
  input: '',
  expected: '',
  main_class: '',
})

const makeDefaultFileIOCase = (index) => {
  const useSample = index === 1
  return {
    name: `case-${index}`,
    args: [],
    stdin: useSample ? '1 2' : '',
    input_files: [makeDefaultFileFixture()],
    expected_files: [makeDefaultFileExpectation()],
    use_expected_stdout: useSample,
    expected_stdout: {
      ...makeDefaultInlineExpectation(),
      content: useSample ? '3' : '',
    },
    use_expected_stderr: false,
    expected_stderr: makeDefaultInlineExpectation(),
    expected_exit_code: '0',
    validation_mode: 'BUILT_IN',
    timeout_ms: '',
    active_input_index: 0,
    active_expected_index: 0,
    ui_show_args: false,
    ui_show_input_files: false,
    ui_show_expected_files: false,
    ui_show_stderr: false,
  }
}

const cloneBuilderFileIOCase = (testCase, index) => ({
  ...makeDefaultFileIOCase(index),
  ...testCase,
  name: `${(testCase?.name || `case-${index}`).trim() || `case-${index}`}-copy`,
  args: Array.isArray(testCase?.args) ? [...testCase.args] : [],
  input_files: Array.isArray(testCase?.input_files)
    ? testCase.input_files.map((file) => ({ ...makeDefaultFileFixture(), ...file }))
    : [makeDefaultFileFixture()],
  expected_files: Array.isArray(testCase?.expected_files)
    ? testCase.expected_files.map((file) => ({ ...makeDefaultFileExpectation(), ...file }))
    : [makeDefaultFileExpectation()],
  expected_stdout: { ...makeDefaultInlineExpectation(), ...(testCase?.expected_stdout || {}) },
  expected_stderr: { ...makeDefaultInlineExpectation(), ...(testCase?.expected_stderr || {}) },
})

const migrateIOCasesToAdvancedCases = (cases) =>
  (Array.isArray(cases) ? cases : []).map((testCase, index) => ({
    ...makeDefaultFileIOCase(index + 1),
    name: testCase?.name || `case-${index + 1}`,
    stdin: testCase?.input ?? '',
    use_expected_stdout: (testCase?.expected ?? '') !== '',
    expected_stdout: {
      ...makeDefaultInlineExpectation(),
      content: testCase?.expected ?? '',
    },
  }))

const toPrettyJson = (value, fallback) => {
  try {
    return JSON.stringify(value === undefined ? fallback : value, null, 2)
  } catch (_error) {
    return JSON.stringify(fallback, null, 2)
  }
}

const normalizeLoadedExpectation = (expectation) => ({
  content: expectation?.content ?? '',
  comparison_mode: expectation?.comparison_mode || 'EXACT',
  numeric_tolerance:
    expectation?.numeric_tolerance === null || expectation?.numeric_tolerance === undefined
      ? ''
      : String(expectation.numeric_tolerance),
})

function BuilderSection({ eyebrow, title, subtitle, action, children, compact = false }) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: compact ? { xs: 1.75, md: 2 } : { xs: 2, md: 2.5 },
        borderRadius: 3,
        border: '1px solid',
        borderColor: 'divider',
        backgroundColor: 'rgba(255,255,255,0.94)',
      }}
    >
      <Stack spacing={compact ? 1.5 : 2}>
        {(eyebrow || title || subtitle || action) ? (
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.25}
            alignItems={{ xs: 'flex-start', md: 'center' }}
            justifyContent="space-between"
          >
            <Box>
              {eyebrow ? (
                <Typography
                  variant="caption"
                  sx={{ display: 'block', fontWeight: 800, letterSpacing: 0.5, color: 'text.secondary', textTransform: 'uppercase', mb: 0.5 }}
                >
                  {eyebrow}
                </Typography>
              ) : null}
              {title ? (
                <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: -0.2 }}>
                  {title}
                </Typography>
              ) : null}
              {subtitle ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: title ? 0.5 : 0 }}>
                  {subtitle}
                </Typography>
              ) : null}
            </Box>
            {action ? <Box sx={{ flexShrink: 0 }}>{action}</Box> : null}
          </Stack>
        ) : null}
        {children}
      </Stack>
    </Paper>
  )
}

function SummaryRow({ label, value, tone = 'default' }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2} alignItems="baseline">
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          fontWeight: 700,
          color:
            tone === 'primary'
              ? 'primary.main'
              : tone === 'warning'
                ? 'warning.main'
                : 'text.primary',
        }}
      >
        {value}
      </Typography>
    </Stack>
  )
}

const BUILDER_STEPS = [
  {
    key: 'setup',
    label: 'Setup',
    title: 'Setup',
    subtitle: 'Upload grading files and define how this suite should run.',
  },
  {
    key: 'cases',
    label: 'Cases',
    title: 'Test cases',
    subtitle: 'Define what each case provides and what each case should produce.',
  },
  {
    key: 'review',
    label: 'Review',
    title: 'Review and publish',
    subtitle: 'Confirm the setup, case coverage, and version details before publishing.',
  },
]

function CourseTestSuiteBuilder({
  user,
  embedded = false,
  editVersionId: editVersionIdProp = '',
  onCancel,
  onPublished,
}) {
  const { courseId, assignmentId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const routeEditVersionId = new URLSearchParams(location.search).get('edit') || ''
  const editVersionId = editVersionIdProp || routeEditVersionId
  const testsPageHref = `/course/${courseId}/assignments/${assignmentId}?tab=tests`
  const canManage = Boolean(user?.is_superuser || user?.is_instructor || user?.is_ta)

  const [assignment, setAssignment] = useState(null)
  const [languages, setLanguages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [testSuites, setTestSuites] = useState([])
  const [testSuitesLoading, setTestSuitesLoading] = useState(false)
  const [testSuitesError, setTestSuitesError] = useState('')
  const [builderMode, setBuilderMode] = useState('IO')
  const [builderName, setBuilderName] = useState('')
  const [builderLanguageId, setBuilderLanguageId] = useState('')
  const [builderVisibility, setBuilderVisibility] = useState('PRIVATE')
  const [builderCases, setBuilderCases] = useState([makeDefaultIOCase(1)])
  const [builderModulePath, setBuilderModulePath] = useState('main.py')
  const [builderClassTests, setBuilderClassTests] = useState([makeDefaultOOPClassTest()])
  const [builderMainTests, setBuilderMainTests] = useState([makeDefaultOOPMainTest()])
  const [builderEntryPath, setBuilderEntryPath] = useState('main.py')
  const [builderMainClass, setBuilderMainClass] = useState('')
  const [builderFileIOCases, setBuilderFileIOCases] = useState([makeDefaultFileIOCase(1)])
  const [builderGradingFiles, setBuilderGradingFiles] = useState([])
  const [builderPrimaryGradingFileId, setBuilderPrimaryGradingFileId] = useState('')
  const [builderValidatorCode, setBuilderValidatorCode] = useState('')
  const [builderMainClassMode, setBuilderMainClassMode] = useState('auto')
  const [builderLoadingVersionId, setBuilderLoadingVersionId] = useState('')
  const [builderEditingVersion, setBuilderEditingVersion] = useState(null)
  const [builderTimeout, setBuilderTimeout] = useState('')
  const [builderError, setBuilderError] = useState('')
  const [builderSubmitting, setBuilderSubmitting] = useState(false)
  const [pagePrimed, setPagePrimed] = useState(false)
  const [activeBuilderStep, setActiveBuilderStep] = useState(0)
  const [expandedBuilderCaseIndex, setExpandedBuilderCaseIndex] = useState(0)

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      setError('')
      try {
        const [assignmentData, languageData] = await Promise.all([
          apiRequest(`/api/assignments/${assignmentId}/`),
          canManage ? apiRequest('/api/programming-languages/') : Promise.resolve([]),
        ])
        setAssignment(assignmentData)
        setLanguages(Array.isArray(languageData) ? languageData : [])
      } catch (err) {
        setError(err.message || 'Unable to load the test builder.')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [assignmentId, canManage])

  const loadTestSuites = async () => {
    if (!canManage) return []
    setTestSuitesLoading(true)
    setTestSuitesError('')
    try {
      const data = await apiRequest(`/api/assignments/${assignmentId}/test-suites/`)
      const list = Array.isArray(data) ? data : []
      setTestSuites(list)
      return list
    } catch (err) {
      setTestSuites([])
      setTestSuitesError(err.message || 'Unable to load test suites')
      return []
    } finally {
      setTestSuitesLoading(false)
    }
  }

  useEffect(() => {
    loadTestSuites()
  }, [assignmentId, canManage])

  useEffect(() => {
    setPagePrimed(false)
    setBuilderEditingVersion(null)
    setBuilderError('')
    setBuilderMainClassMode('auto')
    setActiveBuilderStep(0)
    setExpandedBuilderCaseIndex(0)
  }, [assignmentId, editVersionId])

  useEffect(() => {
    if (!assignment) return
    if (!builderLanguageId && assignment.language) {
      setBuilderLanguageId(assignment.language)
    }
    if (!builderName && assignment.title) {
      setBuilderName(`${assignment.title} tests`)
    }
  }, [assignment, builderLanguageId, builderName])

  const selectedBuilderLanguage = useMemo(() => {
    if (builderLanguageId) {
      return languages.find((language) => String(language.id) === String(builderLanguageId)) || null
    }
    return null
  }, [builderLanguageId, languages])

  const builderLanguageName = selectedBuilderLanguage?.name || assignment?.language_name || ''
  const builderLanguageFamily = useMemo(
    () => detectLanguageFamily(builderLanguageName),
    [builderLanguageName],
  )
  const builderSupportsFileIO = builderLanguageFamily === 'python' || builderLanguageFamily === 'java'
  const anyCustomFileIOCase = useMemo(
    () => builderFileIOCases.some((testCase) => testCase.validation_mode === 'CUSTOM'),
    [builderFileIOCases],
  )
  const builderPrimaryGradingFile = useMemo(
    () => builderGradingFiles.find((file) => file.id === builderPrimaryGradingFileId) || null,
    [builderGradingFiles, builderPrimaryGradingFileId],
  )
  const builderJavaMainCandidates = useMemo(() => {
    if (builderLanguageFamily !== 'java') return []
    return builderGradingFiles
      .map((file) => ({
        ...file,
        derivedMainClass: deriveJavaMainClassFromSource(file.path, file.content),
      }))
      .filter((file) => file.derivedMainClass)
  }, [builderGradingFiles, builderLanguageFamily])
  const builderPrimaryJavaMainCandidate = useMemo(
    () => builderJavaMainCandidates.find((file) => file.id === builderPrimaryGradingFileId) || null,
    [builderJavaMainCandidates, builderPrimaryGradingFileId],
  )
  const builderJavaMainSelectionMessage = useMemo(() => {
    if (builderLanguageFamily !== 'java' || !builderGradingFiles.length) return ''
    if (builderJavaMainCandidates.length > 1 && !builderPrimaryJavaMainCandidate) {
      return 'Multiple uploaded Java files contain main(). Choose the primary grading file before publishing.'
    }
    if (!builderJavaMainCandidates.length && !String(builderMainClass || '').trim()) {
      return 'No uploaded grading file contains main(). Enter the Java main class manually or upload the driver file.'
    }
    return ''
  }, [
    builderGradingFiles.length,
    builderJavaMainCandidates.length,
    builderLanguageFamily,
    builderMainClass,
    builderPrimaryJavaMainCandidate,
  ])

  useEffect(() => {
    if (builderMode === 'OOP') {
      setBuilderMode('FILE_IO')
      return
    }
    if (builderSupportsFileIO && builderMode !== 'FILE_IO') {
      setBuilderMode('FILE_IO')
    }
  }, [builderMode, builderSupportsFileIO])

  const primeFreshBuilder = () => {
    const preferredMode = 'FILE_IO'
    setBuilderEditingVersion(null)
    setBuilderError('')
    setBuilderMode(preferredMode)
    setBuilderVisibility('PRIVATE')
    setBuilderCases([makeDefaultIOCase(1)])
    setBuilderModulePath('main.py')
    setBuilderClassTests([makeDefaultOOPClassTest()])
    setBuilderMainTests([makeDefaultOOPMainTest()])
    setBuilderEntryPath('main.py')
    setBuilderMainClass('')
    setBuilderFileIOCases([makeDefaultFileIOCase(1)])
    setBuilderGradingFiles([])
    setBuilderPrimaryGradingFileId('')
    setBuilderValidatorCode('')
    setExpandedBuilderCaseIndex(0)
    setBuilderTimeout('')
    if (assignment?.title) {
      setBuilderName(`${assignment.title} tests`)
    }
  }

  useEffect(() => {
    if (!assignment || !canManage || editVersionId || pagePrimed) return
    primeFreshBuilder()
    setPagePrimed(true)
  }, [assignment, canManage, editVersionId, pagePrimed])

  const fetchSuiteFilePayload = async (versionId, fileName) => {
    return apiRequest(
      `/api/assignments/${assignmentId}/test-suites/${versionId}/file/?name=${encodeURIComponent(fileName)}`,
    )
  }

  const fetchSuiteTextFile = async (versionId, fileName, { required = true } = {}) => {
    try {
      const data = await fetchSuiteFilePayload(versionId, fileName)
      if (data.encoding === 'base64') {
        throw new Error(`${fileName} is not a text file.`)
      }
      return data.content || ''
    } catch (err) {
      if (!required) {
        return ''
      }
      throw err
    }
  }

  const loadBuilderSuiteVersion = async (version) => {
    setBuilderLoadingVersionId(version.id)
    setBuilderError('')
    try {
      const testsText = await fetchSuiteTextFile(version.id, 'tests.json')
      const testsPayload = JSON.parse(testsText)
      const suiteType = String(testsPayload?.type || '').toUpperCase()
      if (!['IO', 'OOP', 'FILE_IO'].includes(suiteType)) {
        throw new Error('This test suite was not generated by the direct builder.')
      }

      const assignmentLanguageId = assignment?.language_id || builderLanguageId || ''
      setBuilderEditingVersion(version)
      setBuilderLanguageId(assignmentLanguageId)
      setBuilderName(version.name || (assignment?.title ? `${assignment.title} tests` : builderName))
      setBuilderVisibility(version.visibility || 'PRIVATE')
      setBuilderTimeout(testsPayload?.timeout_ms ? String(testsPayload.timeout_ms) : '')

      if (suiteType === 'IO') {
        const tests = Array.isArray(testsPayload.tests) ? testsPayload.tests : []
        setBuilderMode('FILE_IO')
        setBuilderGradingFiles([])
        setBuilderPrimaryGradingFileId('')
        setBuilderFileIOCases(
          tests.length
            ? migrateIOCasesToAdvancedCases(
                tests.map((test, index) => ({
                  name: test.name || `case-${index + 1}`,
                  input: test.input ?? '',
                  expected: test.expected ?? '',
                })),
              )
            : [makeDefaultFileIOCase(1)],
        )
        setBuilderClassTests([makeDefaultOOPClassTest()])
        setBuilderMainTests([makeDefaultOOPMainTest()])
        setBuilderModulePath('main.py')
        setBuilderEntryPath('main.py')
        setBuilderMainClass(testsPayload.main_class || '')
        setBuilderMainClassMode('manual')
        setBuilderValidatorCode('')
      } else if (suiteType === 'OOP') {
        setBuilderError('OOP test suites are temporarily hidden in the frontend and cannot be edited here.')
        setPagePrimed(true)
        return
      } else {
        const gradingFiles = await Promise.all(
          (testsPayload.grading_files || []).map(async (file) =>
            createBuilderGradingFile({
              originalName: file.path || '',
              path: file.path || '',
              content: file.source ? await fetchSuiteTextFile(version.id, file.source) : '',
              size: 0,
            }),
          ),
        )
        const primaryGradingFilePath = String(testsPayload.primary_grading_file || '').trim()
        const selectedPrimaryGradingFile = gradingFiles.find(
          (file) => String(file.path || '').trim() === primaryGradingFilePath,
        )
        const cases = Array.isArray(testsPayload.cases) ? testsPayload.cases : []
        const loadedCases = await Promise.all(
          cases.map(async (testCase, index) => {
            const inputFiles = await Promise.all(
              (testCase.input_files || []).map(async (file) => ({
                path: file.path || '',
                content: file.source ? await fetchSuiteTextFile(version.id, file.source) : '',
              })),
            )
            const expectedFiles = await Promise.all(
              (testCase.expected_files || []).map(async (file) => ({
                path: file.path || '',
                content: file.source ? await fetchSuiteTextFile(version.id, file.source) : '',
                comparison_mode: file.comparison_mode || 'EXACT',
                numeric_tolerance:
                  file.numeric_tolerance === null || file.numeric_tolerance === undefined
                    ? ''
                    : String(file.numeric_tolerance),
              })),
            )
            return {
              name: testCase.name || `case-${index + 1}`,
              args: Array.isArray(testCase.args) ? testCase.args.map((item) => String(item)) : [],
              stdin: testCase.stdin ?? '',
              input_files: inputFiles.length ? inputFiles : [makeDefaultFileFixture()],
              expected_files: expectedFiles.length ? expectedFiles : [makeDefaultFileExpectation()],
              use_expected_stdout: Boolean(testCase.expected_stdout),
              expected_stdout: testCase.expected_stdout
                ? normalizeLoadedExpectation(testCase.expected_stdout)
                : makeDefaultInlineExpectation(),
              use_expected_stderr: Boolean(testCase.expected_stderr),
              expected_stderr: testCase.expected_stderr
                ? normalizeLoadedExpectation(testCase.expected_stderr)
                : makeDefaultInlineExpectation(),
              expected_exit_code: String(testCase.expected_exit_code ?? 0),
              validation_mode: testCase.validation_mode || 'BUILT_IN',
              timeout_ms:
                testCase.timeout_ms === null || testCase.timeout_ms === undefined
                  ? ''
                  : String(testCase.timeout_ms),
              active_input_index: 0,
              active_expected_index: 0,
            }
          }),
        )
        const validatorCode =
          loadedCases.some((testCase) => testCase.validation_mode === 'CUSTOM')
            ? await fetchSuiteTextFile(version.id, 'validator.py', { required: false })
            : ''

        setBuilderMode('FILE_IO')
        setBuilderEntryPath(testsPayload.entry_path || 'main.py')
        setBuilderMainClass(testsPayload.main_class || '')
        setBuilderMainClassMode('manual')
        setBuilderFileIOCases(loadedCases.length ? loadedCases : [makeDefaultFileIOCase(1)])
        setExpandedBuilderCaseIndex(0)
        setBuilderGradingFiles(
          gradingFiles.map((file) => ({
            ...file,
            size: new Blob([file.content || '']).size,
          })),
        )
        setBuilderPrimaryGradingFileId(selectedPrimaryGradingFile?.id || '')
        setBuilderValidatorCode(validatorCode)
        setBuilderCases([makeDefaultIOCase(1)])
        setBuilderClassTests([makeDefaultOOPClassTest()])
        setBuilderMainTests([makeDefaultOOPMainTest()])
        setBuilderModulePath('main.py')
      }
      setPagePrimed(true)
    } catch (err) {
      setBuilderError(err.message || 'Unable to load this suite into the builder.')
    } finally {
      setBuilderLoadingVersionId('')
    }
  }

  useEffect(() => {
    if (!assignment || !canManage || !editVersionId || testSuitesLoading) return
    if (builderEditingVersion && String(builderEditingVersion.id) === String(editVersionId)) return
    if (String(builderLoadingVersionId) === String(editVersionId)) return
    const version = testSuites.find((item) => String(item.id) === String(editVersionId))
    if (version) {
      loadBuilderSuiteVersion(version)
      return
    }
    if (testSuites.length || !testSuitesError) {
      setBuilderError('Unable to find that test suite version.')
    }
  }, [
    assignment,
    canManage,
    editVersionId,
    testSuites,
    testSuitesLoading,
    testSuitesError,
    builderEditingVersion,
    builderLoadingVersionId,
  ])

  useEffect(() => {
    if (anyCustomFileIOCase && !builderValidatorCode.trim()) {
      setBuilderValidatorCode(FILE_IO_VALIDATOR_TEMPLATE)
    }
  }, [anyCustomFileIOCase, builderValidatorCode])

  useEffect(() => {
    if (builderLanguageFamily !== 'java') return

    if (!builderGradingFiles.length) {
      if (builderMainClassMode === 'auto' && builderMainClass) {
        setBuilderMainClass('')
      }
      if (builderPrimaryGradingFileId) {
        setBuilderPrimaryGradingFileId('')
      }
      return
    }

    const currentPrimary = builderGradingFiles.find((file) => file.id === builderPrimaryGradingFileId) || null

    if (builderPrimaryJavaMainCandidate) {
      if (
        builderMainClassMode === 'auto' &&
        builderMainClass !== builderPrimaryJavaMainCandidate.derivedMainClass
      ) {
        setBuilderMainClass(builderPrimaryJavaMainCandidate.derivedMainClass)
      }
      return
    }

    if (builderJavaMainCandidates.length === 1) {
      const [candidate] = builderJavaMainCandidates
      if (builderPrimaryGradingFileId !== candidate.id) {
        setBuilderPrimaryGradingFileId(candidate.id)
      }
      if (builderMainClassMode === 'auto' && builderMainClass !== candidate.derivedMainClass) {
        setBuilderMainClass(candidate.derivedMainClass)
      }
      return
    }

    if (currentPrimary) {
      setBuilderPrimaryGradingFileId('')
    }
    if (builderMainClassMode === 'auto' && builderMainClass) {
      setBuilderMainClass('')
    }
  }, [
    builderGradingFiles,
    builderJavaMainCandidates,
    builderLanguageFamily,
    builderMainClass,
    builderMainClassMode,
    builderPrimaryGradingFileId,
    builderPrimaryJavaMainCandidate,
  ])

  const handleBuilderClassTestChange = (index, field, value) => {
    setBuilderClassTests((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }

  const addBuilderClassTest = () => {
    setBuilderClassTests((prev) => [...prev, makeDefaultOOPClassTest()])
  }

  const removeBuilderClassTest = (index) => {
    setBuilderClassTests((prev) => prev.filter((_, idx) => idx !== index))
  }

  const handleBuilderStepChange = (classIndex, stepIndex, field, value) => {
    setBuilderClassTests((prev) => {
      const next = [...prev]
      const current = next[classIndex] || makeDefaultOOPClassTest()
      const steps = Array.isArray(current.steps) ? [...current.steps] : []
      steps[stepIndex] = { ...(steps[stepIndex] || { method: '', args: '[]' }), [field]: value }
      next[classIndex] = { ...current, steps }
      return next
    })
  }

  const addBuilderStep = (classIndex) => {
    setBuilderClassTests((prev) => {
      const next = [...prev]
      const current = next[classIndex] || makeDefaultOOPClassTest()
      const steps = Array.isArray(current.steps) ? [...current.steps] : []
      steps.push({ method: '', args: '[]' })
      next[classIndex] = { ...current, steps }
      return next
    })
  }

  const removeBuilderStep = (classIndex, stepIndex) => {
    setBuilderClassTests((prev) => {
      const next = [...prev]
      const current = next[classIndex]
      if (!current) return prev
      const steps = (current.steps || []).filter((_, idx) => idx !== stepIndex)
      next[classIndex] = { ...current, steps: steps.length ? steps : [{ method: '', args: '[]' }] }
      return next
    })
  }

  const handleBuilderMainTestChange = (index, field, value) => {
    setBuilderMainTests((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }

  const addBuilderMainTest = () => {
    setBuilderMainTests((prev) => [...prev, makeDefaultOOPMainTest()])
  }

  const removeBuilderMainTest = (index) => {
    setBuilderMainTests((prev) => prev.filter((_, idx) => idx !== index))
  }

  const handleBuilderFileIOCaseChange = (index, field, value) => {
    setBuilderFileIOCases((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }

  const addBuilderFileIOCase = () => {
    setBuilderFileIOCases((prev) => {
      const next = [...prev, makeDefaultFileIOCase(prev.length + 1)]
      setExpandedBuilderCaseIndex(next.length - 1)
      return next
    })
  }

  const removeBuilderFileIOCase = (index) => {
    setBuilderFileIOCases((prev) => {
      const next = prev.filter((_, idx) => idx !== index)
      const nextIndex = next.length ? Math.min(index, next.length - 1) : 0
      setExpandedBuilderCaseIndex(nextIndex)
      return next
    })
  }

  const duplicateBuilderFileIOCase = (index) => {
    setBuilderFileIOCases((prev) => {
      const source = prev[index] || makeDefaultFileIOCase(index + 1)
      const duplicate = cloneBuilderFileIOCase(source, prev.length + 1)
      const next = [...prev]
      next.splice(index + 1, 0, duplicate)
      setExpandedBuilderCaseIndex(index + 1)
      return next
    })
  }

  const handleBuilderFileIOArgsChange = (index, value) => {
    handleBuilderFileIOCaseChange(
      index,
      'args',
      (value || []).map((item) => String(item ?? '')).filter((item) => item.trim() !== ''),
    )
  }

  const handleBuilderFileIOFileChange = (caseIndex, collection, fileIndex, field, value) => {
    setBuilderFileIOCases((prev) => {
      const next = [...prev]
      const current = next[caseIndex] || makeDefaultFileIOCase(caseIndex + 1)
      const files = Array.isArray(current[collection]) ? [...current[collection]] : []
      const defaults = collection === 'input_files' ? makeDefaultFileFixture() : makeDefaultFileExpectation()
      files[fileIndex] = { ...(files[fileIndex] || defaults), [field]: value }
      next[caseIndex] = { ...current, [collection]: files }
      return next
    })
  }

  const addBuilderFileIOFile = (caseIndex, collection) => {
    setBuilderFileIOCases((prev) => {
      const next = [...prev]
      const current = next[caseIndex] || makeDefaultFileIOCase(caseIndex + 1)
      const files = Array.isArray(current[collection]) ? [...current[collection]] : []
      const isInput = collection === 'input_files'
      files.push(isInput ? makeDefaultFileFixture() : makeDefaultFileExpectation())
      next[caseIndex] = {
        ...current,
        [collection]: files,
        [isInput ? 'active_input_index' : 'active_expected_index']: files.length - 1,
      }
      return next
    })
  }

  const removeBuilderFileIOFile = (caseIndex, collection, fileIndex) => {
    setBuilderFileIOCases((prev) => {
      const next = [...prev]
      const current = next[caseIndex]
      if (!current) return prev
      const files = (current[collection] || []).filter((_, idx) => idx !== fileIndex)
      const isInput = collection === 'input_files'
      const activeKey = isInput ? 'active_input_index' : 'active_expected_index'
      const nextActiveIndex = files.length ? Math.min(current[activeKey] || 0, files.length - 1) : 0
      next[caseIndex] = {
        ...current,
        [collection]: files,
        [activeKey]: nextActiveIndex,
      }
      return next
    })
  }

  const selectBuilderFileIOFile = (caseIndex, collection, fileIndex) => {
    handleBuilderFileIOCaseChange(
      caseIndex,
      collection === 'input_files' ? 'active_input_index' : 'active_expected_index',
      fileIndex,
    )
  }

  const handleBuilderFileIOExpectationChange = (caseIndex, field, value, key = 'expected_stdout') => {
    setBuilderFileIOCases((prev) => {
      const next = [...prev]
      const current = next[caseIndex] || makeDefaultFileIOCase(caseIndex + 1)
      next[caseIndex] = {
        ...current,
        [key]: { ...(current[key] || makeDefaultInlineExpectation()), [field]: value },
      }
      return next
    })
  }

  const handleBuilderFileIOFixtureUpload = async (caseIndex, collection, fileIndex, file) => {
    if (!file) return
    if (file.size > MAX_INLINE_FILE_BYTES) {
      setBuilderError(`"${file.name}" is too large. Fixture files must be 256 KB or smaller.`)
      return
    }
    try {
      const content = await file.text()
      setBuilderError('')
      setBuilderFileIOCases((prev) => {
        const next = [...prev]
        const current = next[caseIndex] || makeDefaultFileIOCase(caseIndex + 1)
        const files = Array.isArray(current[collection]) ? [...current[collection]] : []
        const defaults = collection === 'input_files' ? makeDefaultFileFixture() : makeDefaultFileExpectation()
        const currentFile = { ...(files[fileIndex] || defaults) }
        files[fileIndex] = {
          ...currentFile,
          path: (currentFile.path || '').trim() ? currentFile.path : file.name,
          content,
        }
        next[caseIndex] = { ...current, [collection]: files }
        return next
      })
    } catch (_error) {
      setBuilderError(`Unable to read "${file.name}". Upload a text file or paste the content manually.`)
    }
  }

  const syncBuilderRunSetupFromPrimaryFile = (path, content = '') => {
    if (builderLanguageFamily === 'python') {
      const derivedEntrypoint = deriveEntrypointFromGradingFile(path, builderLanguageFamily)
      if (derivedEntrypoint) {
        setBuilderEntryPath(derivedEntrypoint)
      }
      return
    }
    if (builderLanguageFamily === 'java') {
      const derivedMainClass = deriveJavaMainClassFromSource(path, content)
      if (derivedMainClass) {
        setBuilderMainClass(derivedMainClass)
        setBuilderMainClassMode('auto')
      }
    }
  }

  const handleBuilderGradingFilesUpload = async (fileList) => {
    const uploads = Array.from(fileList || [])
    if (!uploads.length) return

    try {
      const loadedFiles = []
      for (const file of uploads) {
        if (file.size > MAX_INLINE_FILE_BYTES) {
          throw new Error(`"${file.name}" is too large. Grading files must be 256 KB or smaller.`)
        }
        const content = await file.text()
        loadedFiles.push(
          createBuilderGradingFile({
            originalName: file.name,
            path: file.webkitRelativePath || file.name,
            content,
            size: file.size,
          }),
        )
      }

      setBuilderGradingFiles((prev) => [...prev, ...loadedFiles])
      setBuilderError('')

      if (!builderPrimaryGradingFileId && builderLanguageFamily !== 'java' && loadedFiles[0]) {
        setBuilderPrimaryGradingFileId(loadedFiles[0].id)
        syncBuilderRunSetupFromPrimaryFile(loadedFiles[0].path, loadedFiles[0].content)
      }
    } catch (err) {
      setBuilderError(err.message || 'Unable to read the grading files you selected.')
    }
  }

  const handleBuilderGradingFilePathChange = (fileId, value) => {
    setBuilderGradingFiles((prev) =>
      prev.map((file) => (file.id === fileId ? { ...file, path: value } : file)),
    )
    if (fileId === builderPrimaryGradingFileId) {
      const selected = builderGradingFiles.find((file) => file.id === fileId)
      syncBuilderRunSetupFromPrimaryFile(value, selected?.content || '')
    }
  }

  const handleSelectBuilderPrimaryGradingFile = (fileId) => {
    setBuilderPrimaryGradingFileId(fileId)
    const selected = builderGradingFiles.find((file) => file.id === fileId)
    if (selected) {
      syncBuilderRunSetupFromPrimaryFile(selected.path, selected.content)
    }
  }

  const handleRemoveBuilderGradingFile = (fileId) => {
    const nextFiles = builderGradingFiles.filter((file) => file.id !== fileId)
    setBuilderGradingFiles(nextFiles)
    if (fileId === builderPrimaryGradingFileId) {
      setBuilderPrimaryGradingFileId(nextFiles[0]?.id || '')
      if (nextFiles[0]) {
        syncBuilderRunSetupFromPrimaryFile(nextFiles[0].path, nextFiles[0].content)
      }
    }
  }

  const handleBuildTemplate = async () => {
    setBuilderSubmitting(true)
    setBuilderError('')
    try {
      const timeoutMs = builderTimeout === '' ? null : Number(builderTimeout)
      if (timeoutMs !== null && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
        throw new Error('Timeout must be a positive number.')
      }

      const payload = {
        name: builderName || 'tests',
        language_id: builderLanguageId || null,
        type: 'FILE_IO',
        visibility: builderVisibility,
        set_active: true,
        timeout_ms: timeoutMs,
      }

      const gradingFiles = builderGradingFiles
        .filter((file) => (file.path || '').trim() || (file.content || '') !== '')
        .map((file, index) => {
          const path = String(file.path || '').trim()
          if (!path) {
            throw new Error(`Grading file ${index + 1} needs a path.`)
          }
          return {
            path,
            content: file.content ?? '',
          }
        })

      if (gradingFiles.length) {
        payload.grading_files = gradingFiles
      }

      const primaryGradingFile = builderGradingFiles.find((file) => file.id === builderPrimaryGradingFileId)
      if (primaryGradingFile?.path?.trim()) {
        payload.primary_grading_file = primaryGradingFile.path.trim()
      }

      const normalizeTolerance = (rawValue, label) => {
        if (rawValue === '' || rawValue === null || rawValue === undefined) {
          return null
        }
        const value = Number(rawValue)
        if (!Number.isFinite(value)) {
          throw new Error(`${label} must be a number.`)
        }
        return value
      }

      const buildExpectationPayload = (expectation, label) => {
        const comparisonMode = (expectation?.comparison_mode || 'EXACT').trim() || 'EXACT'
        const normalized = {
          content: expectation?.content ?? '',
          comparison_mode: comparisonMode,
        }
        if (comparisonMode === 'NUMERIC_TOLERANCE') {
          const tolerance = normalizeTolerance(expectation?.numeric_tolerance, `${label} tolerance`)
          if (tolerance === null) {
            throw new Error(`${label} requires numeric tolerance.`)
          }
          normalized.numeric_tolerance = tolerance
        }
        return normalized
      }

      if (builderMode === 'OOP') {
        throw new Error('OOP builder is temporarily hidden in the frontend.')
      } else {
        if (!builderSupportsFileIO) {
          throw new Error('This guided builder currently supports Python and Java assignments only.')
        }

        if (builderLanguageFamily === 'python') {
          const entryPath = (builderEntryPath || '').trim()
          if (!entryPath) {
            throw new Error('Entry script path is required for Python tests.')
          }
          payload.entry_path = entryPath
        } else if (builderLanguageFamily === 'java') {
          const mainClass = (builderMainClass || '').trim()
          if (!mainClass && builderJavaMainCandidates.length > 1) {
            throw new Error('Multiple uploaded Java files contain main(). Choose the primary grading file or enter the main class.')
          }
          if (!mainClass) {
            throw new Error(
              builderJavaMainCandidates.length
                ? 'Choose the Java grading file that contains main() or enter the main class.'
                : 'Main class is required for Java tests.',
            )
          }
          if (builderPrimaryGradingFile && !builderPrimaryJavaMainCandidate && builderJavaMainCandidates.length > 1) {
            throw new Error('The selected primary grading file does not contain main(). Choose the Java driver file before publishing.')
          }
          payload.main_class = mainClass
        }

        const cases = builderFileIOCases
          .map((testCase, index) => {
            const inputFiles = (testCase.input_files || []).filter(
              (file) => (file.path || '').trim() || (file.content || '') !== '',
            )
            const expectedFiles = (testCase.expected_files || []).filter(
              (file) =>
                (file.path || '').trim() ||
                (file.content || '') !== '' ||
                (file.comparison_mode || 'EXACT') !== 'EXACT' ||
                (file.numeric_tolerance || '') !== '',
            )
            const hasAnyField =
              (testCase.name || '').trim() ||
              (testCase.args || []).length > 0 ||
              (testCase.stdin || '') !== '' ||
              inputFiles.length > 0 ||
              expectedFiles.length > 0 ||
              Boolean(testCase.use_expected_stdout) ||
              Boolean(testCase.use_expected_stderr) ||
              (testCase.validation_mode || 'BUILT_IN') === 'CUSTOM' ||
              String(testCase.expected_exit_code ?? '0').trim() !== '0'

            if (!hasAnyField) return null

            const caseTimeout =
              testCase.timeout_ms === '' || testCase.timeout_ms === null || testCase.timeout_ms === undefined
                ? null
                : Number(testCase.timeout_ms)
            if (caseTimeout !== null && (!Number.isFinite(caseTimeout) || caseTimeout <= 0)) {
            throw new Error(`Timeout must be a positive number in case ${index + 1}.`)
            }

            const expectedExitCodeRaw = String(testCase.expected_exit_code ?? '0').trim()
            const expectedExitCode = expectedExitCodeRaw === '' ? 0 : Number(expectedExitCodeRaw)
            if (!Number.isInteger(expectedExitCode)) {
              throw new Error(`Expected exit code must be an integer in case ${index + 1}.`)
            }

            const normalizedInputFiles = inputFiles.map((file, fileIndex) => {
              const path = (file.path || '').trim()
              if (!path) {
                throw new Error(`Input file path is required in case ${index + 1}, file ${fileIndex + 1}.`)
              }
              return {
                path,
                content: file.content ?? '',
              }
            })

            const normalizedExpectedFiles = expectedFiles.map((file, fileIndex) => {
              const path = (file.path || '').trim()
              if (!path) {
                throw new Error(`Expected file path is required in file I/O case ${index + 1}, file ${fileIndex + 1}.`)
              }
              return {
                path,
                ...buildExpectationPayload(
                  file,
                  `Expected file ${fileIndex + 1} in file I/O case ${index + 1}`,
                ),
              }
            })

            const normalized = {
              name: (testCase.name || '').trim() || `case-${index + 1}`,
              args: (testCase.args || []).map((arg) => String(arg).trim()).filter(Boolean),
              stdin: testCase.stdin ?? '',
              input_files: normalizedInputFiles,
              expected_files: normalizedExpectedFiles,
              expected_exit_code: expectedExitCode,
              validation_mode: testCase.validation_mode || 'BUILT_IN',
            }

            if (caseTimeout !== null) {
              normalized.timeout_ms = caseTimeout
            }
            if (testCase.use_expected_stdout) {
              normalized.expected_stdout = buildExpectationPayload(
                testCase.expected_stdout,
                `Expected stdout in file I/O case ${index + 1}`,
              )
            }
            if (testCase.use_expected_stderr) {
              normalized.expected_stderr = buildExpectationPayload(
                testCase.expected_stderr,
                `Expected stderr in file I/O case ${index + 1}`,
              )
            }
            if (
              normalized.validation_mode === 'BUILT_IN' &&
              !normalized.expected_files.length &&
              !normalized.expected_stdout &&
              !normalized.expected_stderr
            ) {
              throw new Error(`Built-in validation needs expected output in file I/O case ${index + 1}.`)
            }

            return normalized
          })
          .filter(Boolean)

        if (!cases.length) {
          throw new Error('Add at least one file I/O test case.')
        }

        if (cases.some((testCase) => testCase.validation_mode === 'CUSTOM')) {
          const validatorCode = (builderValidatorCode || '').trim()
          if (!validatorCode) {
            throw new Error('validator_code is required when any file I/O case uses custom validation.')
          }
          payload.validator_code = builderValidatorCode
        }

        payload.cases = cases
      }

      await apiRequest(`/api/assignments/${assignmentId}/test-suites/build/`, {
        method: 'POST',
        body: payload,
      })
      if (embedded) {
        onPublished?.()
      } else {
        navigate(testsPageHref, { replace: true })
      }
    } catch (err) {
      setBuilderError(err.message || 'Unable to build test suite')
    } finally {
      setBuilderSubmitting(false)
    }
  }

  const modeSupportNote = useMemo(() => {
    if (builderLanguageFamily === 'java') {
      return 'Java requires the exact main class, including package name when packages are used.'
    }
    if (builderLanguageFamily === 'python') {
      return 'Python uses main.py by default. Change the entry script path only when this suite runs a different file.'
    }
    return 'Use one case flow for stdin, files, args, stderr, and exit-code checks.'
  }, [builderLanguageFamily])

  const builderCaseCount = useMemo(() => builderFileIOCases.length, [builderFileIOCases.length])

  const builderCaseStats = useMemo(() => {
    return builderFileIOCases.reduce(
      (acc, testCase) => {
        const inputFiles = Array.isArray(testCase.input_files) ? testCase.input_files : []
        const expectedFiles = Array.isArray(testCase.expected_files) ? testCase.expected_files : []
        const hasInputFiles = inputFiles.some((file) => (file.path || '').trim() || (file.content || '') !== '')
        const hasExpectedFiles = expectedFiles.some(
          (file) =>
            (file.path || '').trim() ||
            (file.content || '') !== '' ||
            (file.comparison_mode || 'EXACT') !== 'EXACT' ||
            (file.numeric_tolerance || '') !== '',
        )
        if ((testCase.args || []).length) acc.args += 1
        if ((testCase.stdin || '').trim()) acc.stdin += 1
        if (hasInputFiles) acc.inputFiles += 1
        if (hasExpectedFiles) acc.expectedFiles += 1
        if (testCase.use_expected_stdout) acc.stdout += 1
        if (testCase.use_expected_stderr) acc.stderr += 1
        if ((testCase.validation_mode || 'BUILT_IN') === 'CUSTOM') acc.custom += 1
        return acc
      },
      { args: 0, stdin: 0, inputFiles: 0, expectedFiles: 0, stdout: 0, stderr: 0, custom: 0 },
    )
  }, [builderFileIOCases])

  const builderPrimaryEntrypoint = useMemo(() => {
    if (builderLanguageFamily === 'python') {
      return builderEntryPath || 'Not set'
    }
    if (builderLanguageFamily === 'java') {
      return builderMainClass || 'Not set'
    }
    return builderLanguageName || 'Not set'
  }, [builderLanguageFamily, builderEntryPath, builderMainClass, builderLanguageName])
  const builderGradingFilesSummary = useMemo(() => {
    if (!builderGradingFiles.length) return 'No grading files'
    return `${builderGradingFiles.length} grading file${builderGradingFiles.length === 1 ? '' : 's'}`
  }, [builderGradingFiles])

  const builderSidebarLabel = builderEditingVersion
    ? `Editing v${builderEditingVersion.version_number}`
    : 'New version'

  const ShellComponent = embedded ? Box : Container
  const handleCancel = () => {
    if (embedded) {
      onCancel?.()
      return
    }
    navigate(testsPageHref)
  }

  if (loading) {
    return (
      <Box sx={{ py: embedded ? 0 : { xs: 2, md: 3 } }}>
        <Typography color="text.secondary">Loading test builder…</Typography>
      </Box>
    )
  }

  if (error) {
    return (
      <Box sx={{ py: embedded ? 0 : { xs: 2, md: 3 } }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    )
  }

  if (!assignment) {
    return null
  }

  if (!canManage) {
    return (
      <Box sx={{ py: embedded ? 0 : { xs: 2, md: 3 } }}>
        <Alert severity="warning">Instructor, TA, or superuser access is required to build test suites.</Alert>
      </Box>
    )
  }

  return (
    <Box
      sx={{
        minHeight: embedded ? 'auto' : '100vh',
        py: embedded ? 0 : { xs: 2.5, md: 4 },
        background: embedded
          ? 'transparent'
          : 'linear-gradient(180deg, rgba(248,250,252,1) 0%, rgba(255,255,255,1) 55%, rgba(248,250,252,1) 100%)',
      }}
    >
      <ShellComponent {...(embedded ? {} : { maxWidth: 'xl' })}>
        <Stack spacing={2.5}>
          {!embedded ? (
            <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
              <Button
                component={RouterLink}
                to={testsPageHref}
                startIcon={<ArrowBackRounded />}
                variant="text"
              >
                Back to tests
              </Button>
              <Chip size="small" variant="outlined" label={assignment.title} />
            </Stack>
          ) : null}

          <Paper
            elevation={0}
            sx={{
              px: { xs: 1.5, md: 2 },
              py: { xs: 1.25, md: 1.5 },
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'divider',
              backgroundColor: 'rgba(255,255,255,0.94)',
            }}
          >
            <Stack
              direction={{ xs: 'column', lg: 'row' }}
              spacing={1}
              alignItems={{ xs: 'flex-start', lg: 'center' }}
              sx={{ flexWrap: 'wrap' }}
            >
              {BUILDER_STEPS.map((step, index) => {
                const isActive = index === activeBuilderStep
                const isCompleted = index < activeBuilderStep
                return (
                  <Stack
                    key={step.key}
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    sx={{ minWidth: { lg: 0 }, flex: { lg: 1 } }}
                  >
                    <Box
                      sx={{
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 11,
                        fontWeight: 800,
                        border: '1px solid',
                        borderColor: isActive || isCompleted ? 'primary.main' : 'divider',
                        backgroundColor: isActive ? 'primary.main' : isCompleted ? 'rgba(79,70,229,0.12)' : 'background.paper',
                        color: isActive ? 'primary.contrastText' : isCompleted ? 'primary.main' : 'text.secondary',
                        flexShrink: 0,
                      }}
                    >
                      {index + 1}
                    </Box>
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: isActive ? 800 : 600,
                        color: isActive ? 'text.primary' : 'text.secondary',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {step.label}
                    </Typography>
                    {index < BUILDER_STEPS.length - 1 ? (
                      <Box
                        sx={{
                          display: { xs: 'none', lg: 'block' },
                          flex: 1,
                          height: 1,
                          backgroundColor: 'divider',
                          minWidth: 24,
                        }}
                      />
                    ) : null}
                  </Stack>
                )
              })}
            </Stack>
          </Paper>

          {builderEditingVersion ? (
            <Alert severity="info">
              Publishing this edit creates a new version. The existing suite stays unchanged.
            </Alert>
          ) : null}
          {testSuitesError ? <Alert severity="error">{testSuitesError}</Alert> : null}
          {builderError ? <Alert severity="error">{builderError}</Alert> : null}

          {activeBuilderStep === 0 ? (
            <BuilderSection
              eyebrow="Step 1"
              title="Setup"
              subtitle="Upload grading files and define how this suite should run."
              compact
            >
              <Stack spacing={2}>
                <Paper
                  variant="outlined"
                  sx={{
                    p: { xs: 2, md: 2.25 },
                    borderRadius: 2,
                    borderStyle: 'dashed',
                    backgroundColor: 'rgba(15, 23, 42, 0.02)',
                  }}
                >
                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={1.5}
                    justifyContent="space-between"
                    alignItems={{ xs: 'flex-start', md: 'center' }}
                  >
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                        Upload grading files
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        Add a driver file and any support files. Mark one as primary after upload.
                      </Typography>
                    </Box>
                    <Button
                      variant="contained"
                      component="label"
                      startIcon={<UploadRounded />}
                    >
                      Upload
                      <input
                        type="file"
                        multiple
                        hidden
                        onChange={(event) => {
                          handleBuilderGradingFilesUpload(event.target.files)
                          event.target.value = ''
                        }}
                      />
                    </Button>
                  </Stack>
                </Paper>

                {builderGradingFiles.length ? (
                  <Stack spacing={1.25}>
                    {builderJavaMainSelectionMessage ? (
                      <Alert severity="warning" sx={{ borderRadius: 2 }}>
                        {builderJavaMainSelectionMessage}
                      </Alert>
                    ) : null}
                    {builderGradingFiles.map((file) => {
                      const isPrimary = builderPrimaryGradingFileId === file.id
                      const detectedJavaMainClass =
                        builderLanguageFamily === 'java'
                          ? deriveJavaMainClassFromSource(file.path, file.content)
                          : ''
                      const canBePrimary =
                        builderLanguageFamily !== 'java' || Boolean(detectedJavaMainClass)
                      return (
                        <Paper key={file.id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                          <Stack spacing={1.5}>
                            <Stack
                              direction={{ xs: 'column', md: 'row' }}
                              spacing={1.25}
                              justifyContent="space-between"
                              alignItems={{ xs: 'flex-start', md: 'center' }}
                            >
                              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                                  {file.originalName || file.path || 'Untitled file'}
                                </Typography>
                                <Chip size="small" variant="outlined" label={formatBytes(file.size)} />
                                {isPrimary ? <Chip size="small" color="primary" label="Primary file" /> : null}
                                {detectedJavaMainClass ? (
                                  <Chip size="small" variant="outlined" label={`main(): ${detectedJavaMainClass}`} />
                                ) : null}
                              </Stack>
                              <Stack direction="row" spacing={1}>
                                <Button
                                  size="small"
                                  variant={isPrimary ? 'contained' : 'outlined'}
                                  onClick={() => handleSelectBuilderPrimaryGradingFile(file.id)}
                                  disabled={!canBePrimary}
                                >
                                  {isPrimary ? 'Primary' : 'Set primary'}
                                </Button>
                                <Button
                                  size="small"
                                  color="error"
                                  onClick={() => handleRemoveBuilderGradingFile(file.id)}
                                >
                                  Remove
                                </Button>
                              </Stack>
                            </Stack>

                            <TextField
                              size="small"
                              label="Path in suite"
                              value={file.path}
                              onChange={(event) => handleBuilderGradingFilePathChange(file.id, event.target.value)}
                              fullWidth
                              helperText={
                                builderLanguageFamily === 'java'
                                  ? isPrimary && detectedJavaMainClass
                                    ? `Run setup will use ${detectedJavaMainClass} as the Java main class.`
                                    : detectedJavaMainClass
                                      ? `This file contains main() and can be selected as the primary grading file.`
                                      : 'Use a safe relative path such as Driver.java or helpers/Support.java.'
                                  : isPrimary && builderLanguageFamily
                                    ? `Run setup will use ${deriveEntrypointFromGradingFile(file.path, builderLanguageFamily) || 'this path'} as the primary entry script.`
                                    : 'Use a safe relative path such as Driver.java or helpers/Driver.py.'
                              }
                            />
                          </Stack>
                        </Paper>
                      )
                    })}
                  </Stack>
                ) : (
                  <Alert severity="info" sx={{ borderRadius: 2 }}>
                    No grading files uploaded. Skip this step for plain console assignments.
                  </Alert>
                )}

                <Divider />

                <Stack spacing={1}>
                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={1.25}
                    justifyContent="space-between"
                    alignItems={{ xs: 'flex-start', md: 'center' }}
                  >
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                        Run setup
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        Set the language, visibility, timeout, and entrypoint for this suite.
                      </Typography>
                    </Box>
                    {!builderSupportsFileIO ? (
                      <Chip
                        size="small"
                        color="warning"
                        variant="outlined"
                        label="Python and Java only"
                      />
                    ) : null}
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {modeSupportNote}
                  </Typography>
                </Stack>

                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <TextField
                    size="small"
                    label="Suite name"
                    value={builderName}
                    onChange={(event) => setBuilderName(event.target.value)}
                    fullWidth
                  />
                  <FormControl size="small" fullWidth>
                    <InputLabel id="builder-page-language-label">Language</InputLabel>
                    <Select
                      labelId="builder-page-language-label"
                      label="Language"
                      value={builderLanguageId}
                      onChange={(event) => setBuilderLanguageId(event.target.value)}
                    >
                      {languages.map((language) => (
                        <MenuItem key={language.id} value={language.id}>
                          {language.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl size="small" fullWidth>
                    <InputLabel id="builder-page-visibility-label">Visibility</InputLabel>
                    <Select
                      labelId="builder-page-visibility-label"
                      label="Visibility"
                      value={builderVisibility}
                      onChange={(event) => setBuilderVisibility(event.target.value)}
                    >
                      <MenuItem value="PUBLIC">Public</MenuItem>
                      <MenuItem value="PRIVATE">Private</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField
                    size="small"
                    label="Timeout (ms)"
                    value={builderTimeout}
                    onChange={(event) => setBuilderTimeout(event.target.value)}
                    type="number"
                    fullWidth
                  />
                  {builderLanguageFamily === 'python' ? (
                    <TextField
                      size="small"
                      label="Entry script path"
                      value={builderEntryPath}
                      onChange={(event) => setBuilderEntryPath(event.target.value)}
                      placeholder="main.py"
                      fullWidth
                    />
                  ) : null}
                  {builderLanguageFamily === 'java' ? (
                    <TextField
                      size="small"
                      label="Main class"
                      value={builderMainClass}
                      onChange={(event) => {
                        setBuilderMainClass(event.target.value)
                        setBuilderMainClassMode('manual')
                      }}
                      placeholder="shipping.LoadShipping"
                      fullWidth
                    />
                  ) : null}
                </Stack>
              </Stack>
            </BuilderSection>
          ) : null}

          {activeBuilderStep === 1 ? (
            <>
              {builderMode === 'OOP' ? (
                <BuilderSection
                  eyebrow="Step 2"
                  title="OOP tests"
                  subtitle="Keep contract tests and optional main-flow checks together in one suite."
                >
                  <Stack spacing={2}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      Class-method tests
                    </Typography>
                    {builderClassTests.map((testCase, classIndex) => (
                    <Paper
                      key={`class-case-${classIndex}`}
                      variant="outlined"
                      sx={{ p: 1.75, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.9)' }}
                    >
                      <Stack spacing={1.5}>
                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                          <TextField
                            label="Name"
                            value={testCase.name}
                            onChange={(event) => handleBuilderClassTestChange(classIndex, 'name', event.target.value)}
                            fullWidth
                          />
                          <TextField
                            label="Class name"
                            value={testCase.class_name}
                            onChange={(event) => handleBuilderClassTestChange(classIndex, 'class_name', event.target.value)}
                            fullWidth
                          />
                          <Button
                            variant="text"
                            color="error"
                            onClick={() => removeBuilderClassTest(classIndex)}
                            disabled={builderClassTests.length <= 1}
                          >
                            Remove
                          </Button>
                        </Stack>

                        <TextField
                          label="Constructor args (JSON array)"
                          value={testCase.constructor_args}
                          onChange={(event) => handleBuilderClassTestChange(classIndex, 'constructor_args', event.target.value)}
                          placeholder='["Messi", 10]'
                          fullWidth
                        />

                        <Stack spacing={1}>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            Steps
                          </Typography>
                          {(testCase.steps || []).map((step, stepIndex) => (
                            <Stack
                              key={`step-${classIndex}-${stepIndex}`}
                              direction={{ xs: 'column', md: 'row' }}
                              spacing={1.5}
                            >
                              <TextField
                                label="Method"
                                value={step.method}
                                onChange={(event) => handleBuilderStepChange(classIndex, stepIndex, 'method', event.target.value)}
                                fullWidth
                              />
                              <TextField
                                label="Args (JSON array)"
                                value={step.args}
                                onChange={(event) => handleBuilderStepChange(classIndex, stepIndex, 'args', event.target.value)}
                                placeholder="[]"
                                fullWidth
                              />
                              <Button variant="text" color="error" onClick={() => removeBuilderStep(classIndex, stepIndex)}>
                                Remove
                              </Button>
                            </Stack>
                          ))}
                          <Button variant="outlined" size="small" startIcon={<AddRounded />} onClick={() => addBuilderStep(classIndex)}>
                            Add step
                          </Button>
                        </Stack>

                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                          <TextField
                            label="Assert method"
                            value={testCase.assert_method}
                            onChange={(event) => handleBuilderClassTestChange(classIndex, 'assert_method', event.target.value)}
                            fullWidth
                          />
                          <TextField
                            label="Assert args (JSON array)"
                            value={testCase.assert_args}
                            onChange={(event) => handleBuilderClassTestChange(classIndex, 'assert_args', event.target.value)}
                            placeholder="[]"
                            fullWidth
                          />
                          <TextField
                            label="Expected (JSON)"
                            value={testCase.expected}
                            onChange={(event) => handleBuilderClassTestChange(classIndex, 'expected', event.target.value)}
                            placeholder="2"
                            fullWidth
                          />
                        </Stack>
                      </Stack>
                    </Paper>
                  ))}
                  <Button variant="outlined" startIcon={<AddRounded />} onClick={addBuilderClassTest}>
                    Add class test
                  </Button>

                  <Divider />

                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    Main-flow tests (optional)
                  </Typography>
                  <Stack spacing={1.5}>
                    {builderMainTests.map((testCase, index) => (
                      <Paper key={`main-case-${index}`} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                        <Stack spacing={1.5}>
                          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                            <TextField
                              label="Name"
                              value={testCase.name}
                              onChange={(event) => handleBuilderMainTestChange(index, 'name', event.target.value)}
                              fullWidth
                            />
                            {builderLanguageFamily === 'java' ? (
                              <TextField
                                label="Main class (optional)"
                                value={testCase.main_class}
                                onChange={(event) => handleBuilderMainTestChange(index, 'main_class', event.target.value)}
                                placeholder="Main"
                                fullWidth
                              />
                            ) : null}
                            <Button
                              variant="text"
                              color="error"
                              onClick={() => removeBuilderMainTest(index)}
                              disabled={builderMainTests.length <= 1}
                            >
                              Remove
                            </Button>
                          </Stack>
                          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                            <TextField
                              label="Input (stdin)"
                              value={testCase.input}
                              onChange={(event) => handleBuilderMainTestChange(index, 'input', event.target.value)}
                              multiline
                              minRows={3}
                              fullWidth
                            />
                            <TextField
                              label="Expected output"
                              value={testCase.expected}
                              onChange={(event) => handleBuilderMainTestChange(index, 'expected', event.target.value)}
                              multiline
                              minRows={3}
                              fullWidth
                            />
                          </Stack>
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                  <Button variant="outlined" startIcon={<AddRounded />} onClick={addBuilderMainTest}>
                    Add main-flow test
                  </Button>
                  </Stack>
                </BuilderSection>
              ) : (
                <BuilderSection
                  eyebrow="Step 2"
                  title="Test cases"
                  subtitle="Use one case flow for stdin, expected output, files, args, stderr, and exit codes."
                >
                  <Stack spacing={2}>
                  <Stack spacing={1.5}>
                    {builderFileIOCases.map((testCase, index) => {
                      const inputFiles = Array.isArray(testCase.input_files) ? testCase.input_files : []
                      const expectedFiles = Array.isArray(testCase.expected_files) ? testCase.expected_files : []
                      const activeInputIndex = inputFiles.length
                        ? Math.min(testCase.active_input_index || 0, inputFiles.length - 1)
                        : 0
                      const activeExpectedIndex = expectedFiles.length
                        ? Math.min(testCase.active_expected_index || 0, expectedFiles.length - 1)
                        : 0
                      const activeInputFile = inputFiles[activeInputIndex] || null
                      const activeExpectedFile = expectedFiles[activeExpectedIndex] || null
                      const visibleInputCount = inputFiles.filter(
                        (file) => (file.path || '').trim() || (file.content || '') !== '',
                      ).length
                      const visibleExpectedCount = expectedFiles.filter(
                        (file) => (file.path || '').trim() || (file.content || '') !== '',
                      ).length
                      const showArgsSection =
                        Boolean(testCase.ui_show_args) ||
                        (Array.isArray(testCase.args) && testCase.args.length > 0) ||
                        String(testCase.expected_exit_code ?? '0').trim() !== '0'
                      const showInputFilesSection =
                        Boolean(testCase.ui_show_input_files) || visibleInputCount > 0
                      const showExpectedFilesSection =
                        Boolean(testCase.ui_show_expected_files) || visibleExpectedCount > 0
                      const showStderrSection =
                        Boolean(testCase.ui_show_stderr) ||
                        Boolean(testCase.use_expected_stderr) ||
                        Boolean((testCase.expected_stderr?.content || '').trim())
                      const hasStdin = Boolean(String(testCase.stdin || '').trim())
                      const hasStdout = Boolean(String(testCase.expected_stdout?.content || '').trim())
                      const caseSummaryItems = [
                        { label: 'stdin', active: hasStdin },
                        { label: 'stdout', active: hasStdout },
                        { label: 'args', active: showArgsSection },
                        { label: 'input files', active: showInputFilesSection },
                        { label: 'expected files', active: showExpectedFilesSection },
                        { label: 'stderr', active: showStderrSection },
                      ]
                      const completedSummaryItems = caseSummaryItems.filter((item) => item.active).length
                      const coreReady = hasStdout || visibleExpectedCount > 0 || showStderrSection

                      return (
                        <Accordion
                          key={`file-io-case-${index}`}
                          expanded={expandedBuilderCaseIndex === index}
                          onChange={(_event, isExpanded) => setExpandedBuilderCaseIndex(isExpanded ? index : -1)}
                          disableGutters
                          sx={{
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 2.5,
                            overflow: 'hidden',
                            backgroundColor: 'rgba(255,255,255,0.9)',
                            '&:before': { display: 'none' },
                          }}
                        >
                          <AccordionSummary expandIcon={<ExpandMoreRounded />}>
                            <Stack
                              direction={{ xs: 'column', md: 'row' }}
                              spacing={1.5}
                              justifyContent="space-between"
                              alignItems={{ xs: 'flex-start', md: 'center' }}
                              sx={{ width: '100%' }}
                            >
                              <Box>
                                <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                                  {(testCase.name || '').trim() || `case-${index + 1}`}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                  {completedSummaryItems}/{caseSummaryItems.length} sections configured • {visibleInputCount} input files • {visibleExpectedCount} expected files
                                </Typography>
                              </Box>
                              <Stack direction="row" spacing={1} alignItems="center">
                                <Chip
                                  size="small"
                                  variant="outlined"
                                  label={testCase.validation_mode === 'CUSTOM' ? 'Custom validator' : 'Built-in checks'}
                                />
                                <Chip
                                  size="small"
                                  color={coreReady ? 'success' : 'default'}
                                  variant="outlined"
                                  label={coreReady ? 'Ready' : 'Needs expected result'}
                                />
                                {testCase.timeout_ms ? (
                                  <Chip size="small" color="primary" variant="outlined" label={`${testCase.timeout_ms} ms`} />
                                ) : null}
                                <Button
                                  variant="text"
                                  startIcon={<ContentCopyRounded />}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    duplicateBuilderFileIOCase(index)
                                  }}
                                >
                                  Duplicate
                                </Button>
                                <Button
                                  variant="text"
                                  color="error"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    removeBuilderFileIOCase(index)
                                  }}
                                  disabled={builderFileIOCases.length <= 1}
                                >
                                  Remove
                                </Button>
                              </Stack>
                            </Stack>
                          </AccordionSummary>
                          <AccordionDetails>
                            <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} alignItems="flex-start">
                              <Paper
                                variant="outlined"
                                sx={{
                                  p: 1.5,
                                  borderRadius: 2,
                                  width: { xs: '100%', lg: 200 },
                                  flexShrink: 0,
                                  backgroundColor: 'rgba(15, 23, 42, 0.02)',
                                }}
                              >
                                <Stack spacing={1.25}>
                                  <Typography variant="body2" color="text.secondary">
                                    {caseSummaryItems.filter((item) => item.active).map((item) => item.label).join(' • ') || 'No optional checks'}
                                  </Typography>
                                  <Typography variant="body2" sx={{ fontWeight: 700, color: coreReady ? 'text.primary' : 'warning.main' }}>
                                    {coreReady ? 'Ready' : 'Needs expected result'}
                                  </Typography>
                                  <Stack spacing={0.75}>
                                    <SummaryRow label="Validation" value={testCase.validation_mode === 'CUSTOM' ? 'Custom' : 'Built-in'} />
                                    <SummaryRow label="Timeout" value={testCase.timeout_ms ? `${testCase.timeout_ms} ms` : 'Default'} />
                                    <SummaryRow label="Args" value={String((testCase.args || []).length)} />
                                    <SummaryRow label="Input files" value={String(visibleInputCount)} />
                                    <SummaryRow label="Expected files" value={String(visibleExpectedCount)} />
                                  </Stack>
                                </Stack>
                              </Paper>

                              <Stack spacing={2} sx={{ flex: 1, minWidth: 0 }}>
                              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                                <TextField
                                  size="small"
                                  label="Case name"
                                  value={testCase.name}
                                  onChange={(event) => handleBuilderFileIOCaseChange(index, 'name', event.target.value)}
                                  fullWidth
                                />
                                <TextField
                                  size="small"
                                  label="Timeout (ms)"
                                  type="number"
                                  value={testCase.timeout_ms}
                                  onChange={(event) => handleBuilderFileIOCaseChange(index, 'timeout_ms', event.target.value)}
                                  sx={{ width: { xs: '100%', md: 160 } }}
                                />
                                <FormControl size="small" sx={{ minWidth: { xs: '100%', md: 180 } }}>
                                  <InputLabel id={`validation-mode-${index}`}>Validation</InputLabel>
                                  <Select
                                    labelId={`validation-mode-${index}`}
                                    label="Validation"
                                    value={testCase.validation_mode}
                                    onChange={(event) => handleBuilderFileIOCaseChange(index, 'validation_mode', event.target.value)}
                                  >
                                    <MenuItem value="BUILT_IN">Built-in</MenuItem>
                                    <MenuItem value="CUSTOM">Custom</MenuItem>
                                  </Select>
                                </FormControl>
                              </Stack>

                              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                                <Stack spacing={1.75}>
                                  <Stack
                                    direction={{ xs: 'column', md: 'row' }}
                                    spacing={1}
                                    justifyContent="space-between"
                                    alignItems={{ xs: 'flex-start', md: 'center' }}
                                  >
                                  <Box>
                                      <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                                        Console check
                                      </Typography>
                                      <Typography variant="body2" color="text.secondary">
                                        Stdin and expected output.
                                      </Typography>
                                    </Box>
                                    <Button
                                      size="small"
                                      variant="text"
                                      onClick={() => {
                                        if (!showArgsSection) {
                                          handleBuilderFileIOCaseChange(index, 'ui_show_args', true)
                                          return
                                        }
                                        if (!showInputFilesSection) {
                                          if (!inputFiles.length) addBuilderFileIOFile(index, 'input_files')
                                          handleBuilderFileIOCaseChange(index, 'ui_show_input_files', true)
                                          return
                                        }
                                        if (!showExpectedFilesSection) {
                                          if (!expectedFiles.length) addBuilderFileIOFile(index, 'expected_files')
                                          handleBuilderFileIOCaseChange(index, 'ui_show_expected_files', true)
                                          return
                                        }
                                        if (!showStderrSection) {
                                          handleBuilderFileIOCaseChange(index, 'ui_show_stderr', true)
                                          handleBuilderFileIOCaseChange(index, 'use_expected_stderr', true)
                                        }
                                      }}
                                    >
                                      Add option
                                    </Button>
                                  </Stack>

                                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                                    <TextField
                                      size="small"
                                      label="Input (stdin)"
                                      value={testCase.stdin}
                                      onChange={(event) => handleBuilderFileIOCaseChange(index, 'stdin', event.target.value)}
                                      multiline
                                      minRows={3}
                                      fullWidth
                                    />
                                    <TextField
                                      size="small"
                                      label="Expected output"
                                      value={testCase.expected_stdout?.content || ''}
                                      onChange={(event) => {
                                        handleBuilderFileIOCaseChange(index, 'use_expected_stdout', true)
                                        handleBuilderFileIOExpectationChange(index, 'content', event.target.value, 'expected_stdout')
                                      }}
                                      multiline
                                      minRows={3}
                                      fullWidth
                                    />
                                  </Stack>

                                  <Stack
                                    direction={{ xs: 'column', md: 'row' }}
                                    spacing={1.5}
                                    alignItems={{ xs: 'stretch', md: 'center' }}
                                  >
                                    <FormControl size="small" sx={{ minWidth: { xs: '100%', md: 220 } }}>
                                      <InputLabel id={`stdout-mode-${index}`}>Output comparison</InputLabel>
                                      <Select
                                        labelId={`stdout-mode-${index}`}
                                        label="Output comparison"
                                        value={testCase.expected_stdout?.comparison_mode || 'EXACT'}
                                        onChange={(event) => {
                                          handleBuilderFileIOCaseChange(index, 'use_expected_stdout', true)
                                          handleBuilderFileIOExpectationChange(index, 'comparison_mode', event.target.value, 'expected_stdout')
                                        }}
                                      >
                                        {FILE_IO_COMPARISON_MODES.map((mode) => (
                                          <MenuItem key={mode} value={mode}>
                                            {mode}
                                          </MenuItem>
                                        ))}
                                      </Select>
                                    </FormControl>
                                    {(testCase.expected_stdout?.comparison_mode || 'EXACT') === 'NUMERIC_TOLERANCE' ? (
                                      <TextField
                                        size="small"
                                        label="Tolerance"
                                        value={testCase.expected_stdout?.numeric_tolerance || ''}
                                        onChange={(event) => handleBuilderFileIOExpectationChange(index, 'numeric_tolerance', event.target.value, 'expected_stdout')}
                                        sx={{ width: { xs: '100%', md: 180 } }}
                                      />
                                    ) : null}
                                  </Stack>
                                </Stack>
                              </Paper>

                              {showArgsSection ? (
                                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                                  <Stack spacing={1.5}>
                                    <Stack
                                      direction={{ xs: 'column', md: 'row' }}
                                      spacing={1}
                                      justifyContent="space-between"
                                      alignItems={{ xs: 'flex-start', md: 'center' }}
                                    >
                                      <Box>
                                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                                          Run details
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary">
                                          Add command-line args or a non-zero exit code only when this case needs them.
                                        </Typography>
                                      </Box>
                                      <Button
                                        size="small"
                                        variant="text"
                                        color="inherit"
                                        onClick={() => {
                                          handleBuilderFileIOCaseChange(index, 'args', [])
                                          handleBuilderFileIOCaseChange(index, 'expected_exit_code', '0')
                                          handleBuilderFileIOCaseChange(index, 'ui_show_args', false)
                                        }}
                                      >
                                        Remove section
                                      </Button>
                                    </Stack>
                                    <Autocomplete
                                      multiple
                                      freeSolo
                                      options={[]}
                                      value={testCase.args || []}
                                      onChange={(_event, value) => handleBuilderFileIOArgsChange(index, value)}
                                      renderInput={(params) => (
                                        <TextField
                                          {...params}
                                          size="small"
                                          label="Command args"
                                          placeholder="day1items.txt"
                                          helperText="Press Enter after each argument. Order is preserved."
                                        />
                                      )}
                                    />
                                    <TextField
                                      size="small"
                                      label="Expected exit code"
                                      value={testCase.expected_exit_code}
                                      onChange={(event) => handleBuilderFileIOCaseChange(index, 'expected_exit_code', event.target.value)}
                                      sx={{ width: { xs: '100%', md: 180 } }}
                                    />
                                  </Stack>
                                </Paper>
                              ) : null}

                              {showInputFilesSection ? (
                                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, flex: 1, minWidth: 0 }}>
                                  <Stack spacing={1.5}>
                                    <Stack
                                      direction={{ xs: 'column', md: 'row' }}
                                      spacing={1}
                                      justifyContent="space-between"
                                      alignItems={{ xs: 'flex-start', md: 'center' }}
                                    >
                                      <Box>
                                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                                          Input files
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary">
                                          Add files that should exist before the program runs.
                                        </Typography>
                                      </Box>
                                      <Stack direction="row" spacing={1}>
                                        <Button variant="outlined" size="small" startIcon={<AddRounded />} onClick={() => addBuilderFileIOFile(index, 'input_files')}>
                                          Add file
                                        </Button>
                                        <Button
                                          size="small"
                                          variant="text"
                                          color="inherit"
                                          onClick={() => {
                                            handleBuilderFileIOCaseChange(index, 'input_files', [makeDefaultFileFixture()])
                                            handleBuilderFileIOCaseChange(index, 'active_input_index', 0)
                                            handleBuilderFileIOCaseChange(index, 'ui_show_input_files', false)
                                          }}
                                        >
                                          Remove section
                                        </Button>
                                      </Stack>
                                    </Stack>
                                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                                      {inputFiles.map((file, fileIndex) => (
                                        <Chip
                                          key={`input-${index}-${fileIndex}`}
                                          clickable
                                          color={activeInputIndex === fileIndex ? 'primary' : 'default'}
                                          variant={activeInputIndex === fileIndex ? 'filled' : 'outlined'}
                                          label={(file.path || '').trim() || `input-${fileIndex + 1}`}
                                          onClick={() => selectBuilderFileIOFile(index, 'input_files', fileIndex)}
                                        />
                                      ))}
                                    </Stack>
                                    {activeInputFile ? (
                                      <Stack spacing={1.5}>
                                        <TextField
                                          size="small"
                                          label="File path"
                                          value={activeInputFile.path}
                                          onChange={(event) => handleBuilderFileIOFileChange(index, 'input_files', activeInputIndex, 'path', event.target.value)}
                                          fullWidth
                                        />
                                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                          <Button
                                            size="small"
                                            variant="outlined"
                                            component="label"
                                            startIcon={<UploadRounded />}
                                          >
                                            Upload file
                                            <input
                                              type="file"
                                              hidden
                                              onChange={(event) => {
                                                const file = event.target.files?.[0]
                                                if (file) {
                                                  handleBuilderFileIOFixtureUpload(index, 'input_files', activeInputIndex, file)
                                                }
                                                event.target.value = ''
                                              }}
                                            />
                                          </Button>
                                          <Button
                                            size="small"
                                            variant="text"
                                            color="error"
                                            onClick={() => removeBuilderFileIOFile(index, 'input_files', activeInputIndex)}
                                          >
                                            Remove current file
                                          </Button>
                                        </Stack>
                                        <TextField
                                          label="File content"
                                          value={activeInputFile.content}
                                          onChange={(event) => handleBuilderFileIOFileChange(index, 'input_files', activeInputIndex, 'content', event.target.value)}
                                          multiline
                                          minRows={6}
                                          fullWidth
                                          helperText="Paste text content or upload a local text file."
                                          sx={{ '& .MuiInputBase-input': { fontFamily: 'Menlo, Monaco, Consolas, \"Courier New\", monospace' } }}
                                        />
                                      </Stack>
                                    ) : null}
                                  </Stack>
                                </Paper>
                              ) : null}

                              {showExpectedFilesSection ? (
                                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, flex: 1, minWidth: 0 }}>
                                  <Stack spacing={1.5}>
                                    <Stack
                                      direction={{ xs: 'column', md: 'row' }}
                                      spacing={1}
                                      justifyContent="space-between"
                                      alignItems={{ xs: 'flex-start', md: 'center' }}
                                    >
                                      <Box>
                                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                                          Expected files
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary">
                                          Add output files when the program should create or change files.
                                        </Typography>
                                      </Box>
                                      <Stack direction="row" spacing={1}>
                                        <Button variant="outlined" size="small" startIcon={<AddRounded />} onClick={() => addBuilderFileIOFile(index, 'expected_files')}>
                                          Add file
                                        </Button>
                                        <Button
                                          size="small"
                                          variant="text"
                                          color="inherit"
                                          onClick={() => {
                                            handleBuilderFileIOCaseChange(index, 'expected_files', [makeDefaultFileExpectation()])
                                            handleBuilderFileIOCaseChange(index, 'active_expected_index', 0)
                                            handleBuilderFileIOCaseChange(index, 'ui_show_expected_files', false)
                                          }}
                                        >
                                          Remove section
                                        </Button>
                                      </Stack>
                                    </Stack>
                                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                                      {expectedFiles.map((file, fileIndex) => (
                                        <Chip
                                          key={`expected-${index}-${fileIndex}`}
                                          clickable
                                          color={activeExpectedIndex === fileIndex ? 'primary' : 'default'}
                                          variant={activeExpectedIndex === fileIndex ? 'filled' : 'outlined'}
                                          label={(file.path || '').trim() || `output-${fileIndex + 1}`}
                                          onClick={() => selectBuilderFileIOFile(index, 'expected_files', fileIndex)}
                                        />
                                      ))}
                                    </Stack>
                                    {activeExpectedFile ? (
                                      <Stack spacing={1.5}>
                                        <TextField
                                          size="small"
                                          label="File path"
                                          value={activeExpectedFile.path}
                                          onChange={(event) => handleBuilderFileIOFileChange(index, 'expected_files', activeExpectedIndex, 'path', event.target.value)}
                                          fullWidth
                                        />
                                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                          <Button
                                            size="small"
                                            variant="outlined"
                                            component="label"
                                            startIcon={<UploadRounded />}
                                          >
                                            Upload file
                                            <input
                                              type="file"
                                              hidden
                                              onChange={(event) => {
                                                const file = event.target.files?.[0]
                                                if (file) {
                                                  handleBuilderFileIOFixtureUpload(index, 'expected_files', activeExpectedIndex, file)
                                                }
                                                event.target.value = ''
                                              }}
                                            />
                                          </Button>
                                          <Button
                                            size="small"
                                            variant="text"
                                            color="error"
                                            onClick={() => removeBuilderFileIOFile(index, 'expected_files', activeExpectedIndex)}
                                          >
                                            Remove current file
                                          </Button>
                                        </Stack>
                                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                                          <FormControl size="small" fullWidth>
                                            <InputLabel id={`expected-file-mode-${index}`}>Comparison</InputLabel>
                                            <Select
                                              labelId={`expected-file-mode-${index}`}
                                              label="Comparison"
                                              value={activeExpectedFile.comparison_mode || 'EXACT'}
                                              onChange={(event) => handleBuilderFileIOFileChange(index, 'expected_files', activeExpectedIndex, 'comparison_mode', event.target.value)}
                                            >
                                              {FILE_IO_COMPARISON_MODES.map((mode) => (
                                                <MenuItem key={mode} value={mode}>
                                                  {mode}
                                                </MenuItem>
                                              ))}
                                            </Select>
                                          </FormControl>
                                          {activeExpectedFile.comparison_mode === 'NUMERIC_TOLERANCE' ? (
                                            <TextField
                                              label="Tolerance"
                                              value={activeExpectedFile.numeric_tolerance}
                                              onChange={(event) => handleBuilderFileIOFileChange(index, 'expected_files', activeExpectedIndex, 'numeric_tolerance', event.target.value)}
                                              sx={{ width: { xs: '100%', md: 180 } }}
                                            />
                                          ) : null}
                                        </Stack>
                                        <TextField
                                          label="Expected content"
                                          value={activeExpectedFile.content}
                                          onChange={(event) => handleBuilderFileIOFileChange(index, 'expected_files', activeExpectedIndex, 'content', event.target.value)}
                                          multiline
                                          minRows={6}
                                          fullWidth
                                          helperText="Paste text content or upload a local text file."
                                          sx={{ '& .MuiInputBase-input': { fontFamily: 'Menlo, Monaco, Consolas, \"Courier New\", monospace' } }}
                                        />
                                      </Stack>
                                    ) : null}
                                  </Stack>
                                </Paper>
                              ) : null}

                              {showStderrSection ? (
                                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                                  <Stack spacing={1.5}>
                                    <Stack
                                      direction={{ xs: 'column', md: 'row' }}
                                      spacing={1}
                                      justifyContent="space-between"
                                      alignItems={{ xs: 'flex-start', md: 'center' }}
                                    >
                                      <Box>
                                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                                          Expected stderr
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary">
                                          Add stderr checks only when the assignment expects error output.
                                        </Typography>
                                      </Box>
                                      <Button
                                        size="small"
                                        variant="text"
                                        color="inherit"
                                        onClick={() => {
                                          handleBuilderFileIOCaseChange(index, 'use_expected_stderr', false)
                                          handleBuilderFileIOCaseChange(index, 'ui_show_stderr', false)
                                          handleBuilderFileIOCaseChange(index, 'expected_stderr', makeDefaultInlineExpectation())
                                        }}
                                      >
                                        Remove section
                                      </Button>
                                    </Stack>
                                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                                      <FormControl size="small" fullWidth>
                                        <InputLabel id={`stderr-mode-${index}`}>Comparison</InputLabel>
                                        <Select
                                          labelId={`stderr-mode-${index}`}
                                          label="Comparison"
                                          value={testCase.expected_stderr?.comparison_mode || 'EXACT'}
                                          onChange={(event) => {
                                            handleBuilderFileIOCaseChange(index, 'use_expected_stderr', true)
                                            handleBuilderFileIOExpectationChange(index, 'comparison_mode', event.target.value, 'expected_stderr')
                                          }}
                                        >
                                          {FILE_IO_COMPARISON_MODES.map((mode) => (
                                            <MenuItem key={mode} value={mode}>
                                              {mode}
                                            </MenuItem>
                                          ))}
                                        </Select>
                                      </FormControl>
                                      {(testCase.expected_stderr?.comparison_mode || 'EXACT') === 'NUMERIC_TOLERANCE' ? (
                                        <TextField
                                          label="Tolerance"
                                          value={testCase.expected_stderr?.numeric_tolerance || ''}
                                          onChange={(event) => handleBuilderFileIOExpectationChange(index, 'numeric_tolerance', event.target.value, 'expected_stderr')}
                                          sx={{ width: { xs: '100%', md: 180 } }}
                                        />
                                      ) : null}
                                    </Stack>
                                    <TextField
                                      label="Expected stderr content"
                                      value={testCase.expected_stderr?.content || ''}
                                      onChange={(event) => {
                                        handleBuilderFileIOCaseChange(index, 'use_expected_stderr', true)
                                        handleBuilderFileIOExpectationChange(index, 'content', event.target.value, 'expected_stderr')
                                      }}
                                      multiline
                                      minRows={5}
                                      fullWidth
                                    />
                                  </Stack>
                                </Paper>
                              ) : null}
                              </Stack>
                            </Stack>
                          </AccordionDetails>
                        </Accordion>
                      )
                    })}
                  </Stack>
                  <Button variant="outlined" startIcon={<AddRounded />} onClick={addBuilderFileIOCase}>
                    Add case
                  </Button>

                  {anyCustomFileIOCase ? (
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                      <Stack spacing={1.5}>
                        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1.5}>
                          <Box>
                            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                              Validation script
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              Define <code>validate_case(case, context)</code> for custom cases.
                            </Typography>
                          </Box>
                          <Button variant="outlined" size="small" onClick={() => setBuilderValidatorCode(FILE_IO_VALIDATOR_TEMPLATE)}>
                            Load starter template
                          </Button>
                        </Stack>
                        <TextField
                          label="validator.py"
                          value={builderValidatorCode}
                          onChange={(event) => setBuilderValidatorCode(event.target.value)}
                          multiline
                          minRows={14}
                          fullWidth
                          sx={{ '& .MuiInputBase-input': { fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace', fontSize: 13 } }}
                        />
                      </Stack>
                    </Paper>
                  ) : null}
                  </Stack>
                </BuilderSection>
              )}
            </>
          ) : null}

          {activeBuilderStep === 2 ? (
            <BuilderSection
              eyebrow="Step 3"
              title="Review and publish"
              subtitle="Confirm the suite setup before publishing this version."
            >
              <Stack spacing={2}>
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Stack spacing={1.25}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                      Suite summary
                    </Typography>
                    <SummaryRow label="Assignment" value={assignment.title} />
                    <SummaryRow label="Version" value={builderSidebarLabel} tone={builderEditingVersion ? 'primary' : 'default'} />
                    <SummaryRow label="Checks" value="Unified case flow" tone="primary" />
                    <SummaryRow label="Language" value={builderLanguageName || 'Not set'} />
                    <SummaryRow label="Visibility" value={builderVisibility === 'PUBLIC' ? 'Visible to students' : 'Private to staff'} />
                    <SummaryRow label="Grading files" value={builderGradingFilesSummary} />
                    <SummaryRow
                      label="Primary grading file"
                      value={builderPrimaryGradingFile?.path || 'None selected'}
                      tone={builderPrimaryGradingFile ? 'primary' : 'default'}
                    />
                    <SummaryRow label="Cases" value={String(builderCaseCount)} />
                    <SummaryRow label="Entrypoint" value={builderPrimaryEntrypoint} />
                    <SummaryRow label="Timeout" value={builderTimeout ? `${builderTimeout} ms` : 'Assignment default'} />
                  </Stack>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Stack spacing={1.25}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                      Case coverage
                    </Typography>
                    <SummaryRow label="Cases with stdin" value={String(builderCaseStats.stdin)} />
                    <SummaryRow label="Cases with args" value={String(builderCaseStats.args)} />
                    <SummaryRow label="Cases with input files" value={String(builderCaseStats.inputFiles)} />
                    <SummaryRow label="Cases with expected files" value={String(builderCaseStats.expectedFiles)} />
                    <SummaryRow label="Cases validating stdout" value={String(builderCaseStats.stdout)} />
                    <SummaryRow label="Cases validating stderr" value={String(builderCaseStats.stderr)} />
                    <SummaryRow label="Custom validator cases" value={String(builderCaseStats.custom)} tone={builderCaseStats.custom ? 'warning' : 'default'} />
                  </Stack>
                </Paper>
              </Stack>
            </BuilderSection>
          ) : null}

          <Paper
            variant="outlined"
            sx={{
              p: 1.5,
              borderRadius: 2,
              backgroundColor: 'rgba(255,255,255,0.94)',
            }}
          >
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={1.25}
              alignItems={{ xs: 'stretch', md: 'center' }}
              justifyContent="space-between"
            >
              <Button variant="text" onClick={handleCancel}>
                Cancel
              </Button>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                <Button
                  variant="outlined"
                  onClick={() => setActiveBuilderStep((prev) => Math.max(prev - 1, 0))}
                  disabled={activeBuilderStep === 0}
                >
                  Back
                </Button>
                {activeBuilderStep < BUILDER_STEPS.length - 1 ? (
                  <Button
                    variant="contained"
                    onClick={() => setActiveBuilderStep((prev) => Math.min(prev + 1, BUILDER_STEPS.length - 1))}
                    disabled={!builderSupportsFileIO}
                  >
                    {activeBuilderStep === 0
                      ? 'Continue to cases'
                      : 'Continue to review'}
                  </Button>
                ) : (
                  <Button
                    variant="contained"
                    onClick={handleBuildTemplate}
                    disabled={builderSubmitting || !builderSupportsFileIO}
                  >
                    {builderSubmitting ? 'Building…' : 'Build & publish'}
                  </Button>
                )}
              </Stack>
            </Stack>
          </Paper>
        </Stack>
      </ShellComponent>
    </Box>
  )
}

export default CourseTestSuiteBuilder
