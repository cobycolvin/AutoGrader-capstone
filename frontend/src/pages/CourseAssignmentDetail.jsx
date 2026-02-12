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
  Container,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Tab,
  Tabs,
  TextField,
  Typography,
  Tooltip,
} from '@mui/material'
import {
  AddRounded,
  ArrowBackRounded,
  CodeRounded,
  GradeRounded,
  GroupWorkRounded,
  AccessTimeRounded,
  DeleteRounded,
  EditRounded,
  LockRounded,
  UploadRounded,
  VisibilityRounded,
  FormatBoldRounded,
  FormatItalicRounded,
  FormatUnderlinedRounded,
  FormatListBulletedRounded,
  FormatListNumberedRounded,
  LinkRounded,
  FormatClearRounded,
  FormatQuoteRounded,
  HorizontalRuleRounded,
  UndoRounded,
  RedoRounded,
  StrikethroughSRounded,
  DownloadRounded,
} from '@mui/icons-material'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import { Link as RouterLink, useParams } from 'react-router-dom'
import { apiRequest, API_BASE, downloadFile } from '../api/client.js'

const emptyForm = {
  title: '',
  description: '',
  due_at: '',
  max_score: '',
  language_id: '',
  allow_groups: false,
  group_mode: 'PER_ASSIGNMENT',
  submission_file_types: '',
  submission_max_size_mb: 25,
  submission_max_attempts: 3,
}

const toLocalInputValue = (iso) => {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const tzOffset = date.getTimezoneOffset() * 60000
  const local = new Date(date.getTime() - tzOffset)
  return local.toISOString().slice(0, 16)
}

const formatDate = (value) => {
  if (!value) return 'No due date'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No due date'
  return date.toLocaleString()
}

function SectionCard({ title, subtitle, action, children }) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: { xs: 2.5, md: 3 },
        borderRadius: 3,
        border: '1px solid',
        borderColor: 'divider',
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(248,250,252,0.95) 100%)',
      }}
    >
      <Stack spacing={2}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={2}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 900 }}>
              {title}
            </Typography>
            {subtitle ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {subtitle}
              </Typography>
            ) : null}
          </Box>
          {action ? <Box sx={{ pt: 0.5 }}>{action}</Box> : null}
        </Stack>
        {children}
      </Stack>
    </Paper>
  )
}

function CourseAssignmentDetail({ user }) {
  const { courseId, assignmentId } = useParams()
  const [assignment, setAssignment] = useState(null)
  const [languages, setLanguages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [rubric, setRubric] = useState({ version_number: 0, is_weighted: false, criteria: [] })
  const [rubricForm, setRubricForm] = useState({ is_weighted: false, criteria: [] })
  const [rubricSaving, setRubricSaving] = useState(false)
  const [rubricError, setRubricError] = useState('')
  const [rubricVersions, setRubricVersions] = useState([])
  const [rubricVersionsError, setRubricVersionsError] = useState('')
  const [rubricSelectedVersion, setRubricSelectedVersion] = useState('')
  const [rubricActivating, setRubricActivating] = useState(false)
  const [testSuites, setTestSuites] = useState([])
  const [testSuiteFile, setTestSuiteFile] = useState(null)
  const [testSuiteVisibility, setTestSuiteVisibility] = useState('PRIVATE')
  const [testSuiteUploading, setTestSuiteUploading] = useState(false)
  const [testSuiteError, setTestSuiteError] = useState('')
  const [previewSuite, setPreviewSuite] = useState(null)
  const [testSuiteFilter, setTestSuiteFilter] = useState('ALL')
  const [manifest, setManifest] = useState(null)
  const [manifestLoading, setManifestLoading] = useState(false)
  const [manifestError, setManifestError] = useState('')
  const [templateList, setTemplateList] = useState([])
  const [templateLoading, setTemplateLoading] = useState(false)
  const [templateError, setTemplateError] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [templateLanguage, setTemplateLanguage] = useState('')
  const [templateType, setTemplateType] = useState('ALL')
  const [builderOpen, setBuilderOpen] = useState(false)
  const [builderName, setBuilderName] = useState('')
  const [builderLanguageId, setBuilderLanguageId] = useState('')
  const [builderCases, setBuilderCases] = useState([
    { name: 'case-1', input: '', expected: '', points: 5 },
  ])
  const [builderTimeout, setBuilderTimeout] = useState('')
  const [builderError, setBuilderError] = useState('')
  const [builderSubmitting, setBuilderSubmitting] = useState(false)
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const [instructionsDraft, setInstructionsDraft] = useState('')
  const [instructionsSaving, setInstructionsSaving] = useState(false)
  const [instructionsError, setInstructionsError] = useState('')
  const [editorTick, setEditorTick] = useState(0)
  const [activeTab, setActiveTab] = useState(0)

  const instructionsEditor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
      Placeholder.configure({
        placeholder: 'Start writing instructions...',
      }),
      CharacterCount,
    ],
    content: '',
    onUpdate: ({ editor }) => {
      setInstructionsDraft(editor.getHTML())
    },
  })

  const canManage = Boolean(user?.is_superuser || user?.is_instructor)

  const loadAssignment = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiRequest(`/api/assignments/${assignmentId}/`)
      setAssignment(data)
    } catch (err) {
      setError(err.message || 'Unable to load assignment')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAssignment()
  }, [assignmentId])

  const loadRubric = async () => {
    setRubricError('')
    try {
      const data = await apiRequest(`/api/assignments/${assignmentId}/rubric/`)
      setRubric(data || { version_number: 0, is_weighted: false, criteria: [] })
      setRubricForm({
        is_weighted: Boolean(data?.is_weighted),
        criteria: (data?.criteria || []).map((criterion) => ({
          name: criterion.name || '',
          max_points: criterion.max_points ?? '',
          weight: criterion.weight ?? '',
        })),
      })
    } catch (err) {
      setRubricError(err.message || 'Unable to load rubric')
    }
  }

  useEffect(() => {
    loadRubric()
  }, [assignmentId])

  const loadRubricVersions = async () => {
    setRubricVersionsError('')
    try {
      const data = await apiRequest(`/api/assignments/${assignmentId}/rubric/versions/`)
      setRubricVersions(Array.isArray(data) ? data : [])
      const active = (data || []).find((version) => version.is_active)
      if (active) {
        setRubricSelectedVersion(active.id)
      }
    } catch (err) {
      setRubricVersionsError(err.message || 'Unable to load rubric versions')
    }
  }

  useEffect(() => {
    if (!canManage) return
    loadRubricVersions()
  }, [assignmentId, canManage])

  const loadTestSuites = async () => {
    setTestSuiteError('')
    try {
      const visibilityQuery = canManage ? '' : '?visibility=PUBLIC'
      const data = await apiRequest(`/api/assignments/${assignmentId}/test-suites/${visibilityQuery}`)
      setTestSuites(data || [])
    } catch (err) {
      setTestSuiteError(err.message || 'Unable to load test suites')
    }
  }

  useEffect(() => {
    loadTestSuites()
  }, [assignmentId, canManage])

  useEffect(() => {
    const loadTemplates = async () => {
      if (!canManage) return
      setTemplateLoading(true)
      setTemplateError('')
      try {
        const data = await apiRequest('/api/test-templates/')
        setTemplateList(Array.isArray(data) ? data : [])
      } catch (err) {
        setTemplateError(err.message || 'Unable to load templates')
      } finally {
        setTemplateLoading(false)
      }
    }
    loadTemplates()
  }, [canManage])

  useEffect(() => {
    if (!assignment || templateLanguage) return
    if (assignment.language_name) {
      setTemplateLanguage(assignment.language_name)
    }
  }, [assignment, templateLanguage])

  useEffect(() => {
    if (!assignment) return
    if (!builderLanguageId && assignment.language) {
      setBuilderLanguageId(assignment.language)
    }
    if (!builderName && assignment.title) {
      setBuilderName(`${assignment.title} I/O tests`)
    }
  }, [assignment, builderLanguageId, builderName])

  useEffect(() => {
    const loadLanguages = async () => {
      try {
        const data = await apiRequest('/api/programming-languages/')
        setLanguages(data)
      } catch (err) {
        // optional
      }
    }
    if (canManage) {
      loadLanguages()
    }
  }, [canManage])

  const openEdit = () => {
    if (!assignment) return
    setForm({
      title: assignment.title || '',
      description: assignment.description || '',
      due_at: toLocalInputValue(assignment.due_at),
      max_score: assignment.max_score ?? '',
      language_id: assignment.language || '',
      allow_groups: Boolean(assignment.allow_groups),
      group_mode: assignment.group_mode || 'PER_ASSIGNMENT',
      submission_file_types: (assignment.submission_file_types || []).join(', '),
      submission_max_size_mb: assignment.submission_max_size_mb ?? 25,
      submission_max_attempts: assignment.submission_max_attempts ?? 3,
    })
    setDialogOpen(true)
  }

  const openInstructions = () => {
    if (!assignment) return
    setInstructionsDraft(assignment.instructions || '')
    setInstructionsError('')
    setInstructionsOpen(true)
  }

  const handleSaveInstructions = async () => {
    setInstructionsSaving(true)
    setInstructionsError('')
    try {
      await apiRequest(`/api/assignments/${assignmentId}/`, {
        method: 'PATCH',
        body: { instructions: instructionsDraft },
      })
      setInstructionsOpen(false)
      await loadAssignment()
    } catch (err) {
      setInstructionsError(err.message || 'Unable to save instructions')
    } finally {
      setInstructionsSaving(false)
    }
  }

  useEffect(() => {
    if (instructionsOpen && instructionsEditor) {
      instructionsEditor.commands.setContent(assignment?.instructions || '', false)
      instructionsEditor.commands.focus('end')
    }
  }, [instructionsOpen, instructionsEditor, assignment?.instructions])

  useEffect(() => {
    if (!instructionsEditor) return
    const trigger = () => setEditorTick((tick) => tick + 1)
    instructionsEditor.on('selectionUpdate', trigger)
    instructionsEditor.on('transaction', trigger)
    return () => {
      instructionsEditor.off('selectionUpdate', trigger)
      instructionsEditor.off('transaction', trigger)
    }
  }, [instructionsEditor])

  const handleSave = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = {
        title: form.title,
        description: form.description,
        due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
        max_score: form.max_score === '' ? 0 : Number(form.max_score),
        language_id: form.language_id || null,
        allow_groups: form.allow_groups,
        group_mode: form.group_mode,
        submission_file_types: form.submission_file_types
          ? form.submission_file_types
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : [],
        submission_max_size_mb: Number(form.submission_max_size_mb) || 0,
        submission_max_attempts: Number(form.submission_max_attempts) || 0,
      }
      await apiRequest(`/api/assignments/${assignmentId}/`, {
        method: 'PATCH',
        body: payload,
      })
      setDialogOpen(false)
      await loadAssignment()
    } catch (err) {
      setError(err.message || 'Unable to update assignment')
    } finally {
      setSaving(false)
    }
  }

  const handleAddCriterion = () => {
    setRubricForm((prev) => ({
      ...prev,
      criteria: [...prev.criteria, { name: '', max_points: '', weight: '' }],
    }))
  }

  const handleRemoveCriterion = (index) => {
    setRubricForm((prev) => ({
      ...prev,
      criteria: prev.criteria.filter((_, idx) => idx !== index),
    }))
  }

  const handleCriterionChange = (index, field, value) => {
    setRubricForm((prev) => {
      const next = [...prev.criteria]
      next[index] = { ...next[index], [field]: value }
      return { ...prev, criteria: next }
    })
  }

  const handleSaveRubric = async () => {
    setRubricSaving(true)
    setRubricError('')
    try {
      const payload = {
        is_weighted: rubricForm.is_weighted,
        criteria: rubricForm.criteria.map((criterion, index) => ({
          name: criterion.name || '',
          max_points: Number(criterion.max_points) || 0,
          weight: rubricForm.is_weighted
            ? criterion.weight === '' || criterion.weight === null
              ? null
              : Number(criterion.weight)
            : null,
          order_index: index,
        })),
      }
      await apiRequest(`/api/assignments/${assignmentId}/rubric/`, {
        method: 'POST',
        body: payload,
      })
      await loadRubric()
      await loadRubricVersions()
    } catch (err) {
      setRubricError(err.message || 'Unable to save rubric')
    } finally {
      setRubricSaving(false)
    }
  }

  const handleActivateRubric = async () => {
    if (!rubricSelectedVersion) return
    setRubricActivating(true)
    setRubricVersionsError('')
    try {
      await apiRequest(`/api/assignments/${assignmentId}/rubric/activate/`, {
        method: 'POST',
        body: { version_id: rubricSelectedVersion },
      })
      await loadRubric()
      await loadRubricVersions()
    } catch (err) {
      setRubricVersionsError(err.message || 'Unable to activate rubric')
    } finally {
      setRubricActivating(false)
    }
  }

  const totalRubricPoints = useMemo(
    () =>
      rubricForm.criteria.reduce((total, criterion) => {
        const points = Number(criterion.max_points)
        return total + (Number.isFinite(points) ? points : 0)
      }, 0),
    [rubricForm.criteria],
  )

  const handleUploadTestSuite = async () => {
    if (!testSuiteFile) return
    setTestSuiteUploading(true)
    setTestSuiteError('')
    try {
      const formData = new FormData()
      formData.append('file', testSuiteFile)
      formData.append('visibility', testSuiteVisibility)
      await apiRequest(`/api/assignments/${assignmentId}/test-suites/`, {
        method: 'POST',
        body: formData,
      })
      setTestSuiteFile(null)
      await loadTestSuites()
    } catch (err) {
      setTestSuiteError(err.message || 'Unable to upload test suite')
    } finally {
      setTestSuiteUploading(false)
    }
  }

  const handleActivateTestSuite = async (versionId) => {
    setTestSuiteError('')
    try {
      await apiRequest(`/api/assignments/${assignmentId}/test-suites/activate/`, {
        method: 'POST',
        body: { version_id: versionId },
      })
      await loadTestSuites()
    } catch (err) {
      setTestSuiteError(err.message || 'Unable to set active test suite')
    }
  }

  const testSuiteStats = useMemo(() => {
    const stats = { public: 0, private: 0 }
    testSuites.forEach((suite) => {
      if (suite.visibility === 'PUBLIC') stats.public += 1
      if (suite.visibility === 'PRIVATE') stats.private += 1
    })
    return stats
  }, [testSuites])

  const activeTestSuite = useMemo(
    () => testSuites.find((suite) => suite.is_active) || null,
    [testSuites],
  )

  const filteredTestSuites = useMemo(() => {
    if (testSuiteFilter === 'ALL') return testSuites
    if (testSuiteFilter === 'ACTIVE') return testSuites.filter((suite) => suite.is_active)
    return testSuites.filter((suite) => suite.visibility === testSuiteFilter)
  }, [testSuites, testSuiteFilter])

  const closePreview = () => {
    setPreviewSuite(null)
    setManifest(null)
    setManifestError('')
  }

  useEffect(() => {
    const loadManifest = async () => {
      if (!previewSuite) {
        setManifest(null)
        setManifestError('')
        return
      }
      setManifestLoading(true)
      setManifestError('')
      try {
        const data = await apiRequest(
          `/api/assignments/${assignmentId}/test-suites/${previewSuite.id}/manifest/`,
        )
        setManifest(data)
      } catch (err) {
        setManifestError(err.message || 'Unable to load manifest')
        setManifest(null)
      } finally {
        setManifestLoading(false)
      }
    }
    loadManifest()
  }, [previewSuite, assignmentId])

  const summaryChips = useMemo(() => {
    if (!assignment) return []
    return [
      { label: formatDate(assignment.due_at), icon: <AccessTimeRounded fontSize="small" /> },
      { label: `Max score ${assignment.max_score}`, icon: <GradeRounded fontSize="small" /> },
      {
        label: assignment.language_name ? assignment.language_name : 'Language —',
        icon: <CodeRounded fontSize="small" />,
      },
      {
        label: assignment.allow_groups ? 'Groups enabled' : 'Individual only',
        icon: <GroupWorkRounded fontSize="small" />,
      },
    ]
  }, [assignment])

  const filteredTemplates = useMemo(() => {
    let next = templateList
    if (templateLanguage) {
      const needle = templateLanguage.toLowerCase()
      next = next.filter((template) => template.language?.toLowerCase() === needle)
    }
    if (templateType !== 'ALL') {
      next = next.filter((template) => template.type === templateType)
    }
    return next
  }, [templateList, templateLanguage, templateType])

  const handleBuilderCaseChange = (index, field, value) => {
    setBuilderCases((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }

  const addBuilderCase = () => {
    setBuilderCases((prev) => [
      ...prev,
      { name: `case-${prev.length + 1}`, input: '', expected: '', points: 5 },
    ])
  }

  const removeBuilderCase = (index) => {
    setBuilderCases((prev) => prev.filter((_, idx) => idx !== index))
  }

  const handleBuildTemplate = async () => {
    setBuilderSubmitting(true)
    setBuilderError('')
    try {
      const tests = builderCases
        .map((test, index) => ({
          name: test.name || `case-${index + 1}`,
          input: test.input ?? '',
          expected: test.expected ?? '',
          points: Number(test.points) || 0,
        }))
        .filter((test) => test.input !== '' || test.expected !== '')
      const payload = {
        name: builderName || 'io-tests',
        language_id: builderLanguageId || null,
        type: 'IO',
        tests,
        timeout_ms: builderTimeout ? Number(builderTimeout) : null,
      }
      await downloadFile('/api/test-templates/build/', {
        method: 'POST',
        body: payload,
        filename: `${payload.name}.zip`,
      })
      setBuilderOpen(false)
    } catch (err) {
      setBuilderError(err.message || 'Unable to generate test suite')
    } finally {
      setBuilderSubmitting(false)
    }
  }

  const selectedTemplate = useMemo(
    () => filteredTemplates.find((template) => template.id === templateId) || null,
    [filteredTemplates, templateId],
  )

  useEffect(() => {
    if (!templateId) return
    if (!filteredTemplates.some((template) => template.id === templateId)) {
      setTemplateId('')
    }
  }, [filteredTemplates, templateId])

  useEffect(() => {
    if (templateId || filteredTemplates.length !== 1) return
    setTemplateId(filteredTemplates[0].id)
  }, [filteredTemplates, templateId])

  const detailTabs = useMemo(
    () => (canManage ? ['Overview', 'Rubric', 'Tests', 'Settings'] : ['Overview', 'Rubric', 'Tests']),
    [canManage],
  )

  useEffect(() => {
    if (activeTab >= detailTabs.length) {
      setActiveTab(0)
    }
  }, [activeTab, detailTabs.length])

  if (loading) {
    return (
      <Box sx={{ py: { xs: 2, md: 3 } }}>
        <Typography color="text.secondary">Loading assignment…</Typography>
      </Box>
    )
  }

  if (error) {
    return (
      <Box sx={{ py: { xs: 2, md: 3 } }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    )
  }

  if (!assignment) {
    return null
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        py: { xs: 2.5, md: 4 },
        background:
          'linear-gradient(180deg, rgba(248,250,252,1) 0%, rgba(255,255,255,1) 55%, rgba(248,250,252,1) 100%)',
      }}
    >
      <Container maxWidth="lg">
        <Stack spacing={2.5}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
            <Button
              component={RouterLink}
              to={`/course/${courseId}/assignments`}
              startIcon={<ArrowBackRounded />}
              variant="text"
            >
              Assignments
            </Button>
            <Stack direction="row" spacing={1} alignItems="center">
              {!canManage ? (
                <Tooltip title="Instructor access required">
                  <Chip icon={<LockRounded />} label="Read-only" size="small" variant="outlined" />
                </Tooltip>
              ) : (
                <Button
                  variant="contained"
                  startIcon={<EditRounded />}
                  onClick={openEdit}
                >
                  Edit assignment
                </Button>
              )}
            </Stack>
          </Stack>

          <Paper
            elevation={0}
            sx={{
              p: { xs: 2, md: 2.5 },
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Stack spacing={1}>
              <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: -0.2 }}>
                {assignment.title}
              </Typography>
              <Typography color="text.secondary" variant="body2">
                {assignment.description || 'Add a short description so students know what to build.'}
              </Typography>
              <Stack
                direction="row"
                flexWrap="wrap"
                rowGap={0.75}
                columnGap={2}
                sx={{ pt: 0.25 }}
              >
                {summaryChips.map((chip) => (
                  <Stack key={chip.label} direction="row" spacing={1} alignItems="center">
                    {chip.icon}
                    <Typography variant="caption" color="text.secondary">
                      {chip.label}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </Stack>
          </Paper>

          <Paper
            elevation={0}
            sx={{
              p: { xs: 2, md: 2.5 },
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Tabs
              value={activeTab}
              onChange={(_e, value) => setActiveTab(value)}
              variant="scrollable"
              allowScrollButtonsMobile
              sx={{ minHeight: 42 }}
            >
              {detailTabs.map((label) => (
                <Tab key={label} label={label} />
              ))}
            </Tabs>
            <Divider sx={{ my: 2 }} />

            {activeTab === 0 ? (
              <Stack spacing={2}>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  Student instructions
                </Typography>
                {assignment.instructions ? (
                  <Box
                    sx={{
                      color: 'text.primary',
                      '& p': { mt: 0, mb: 1.25 },
                      '& ul, & ol': { pl: 2.5, mb: 1.25 },
                      '& li': { mb: 0.5 },
                      '& a': { color: 'primary.main' },
                      '& code': {
                        fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
                        backgroundColor: 'rgba(15, 23, 42, 0.06)',
                        px: 0.5,
                        borderRadius: 0.75,
                      },
                    }}
                    dangerouslySetInnerHTML={{ __html: assignment.instructions }}
                  />
                ) : (
                  <Typography color="text.secondary">
                    Add instructions, submission format, and examples to guide students.
                  </Typography>
                )}
                <Divider />
                <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                  Submission rules (summary)
                </Typography>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <Stack spacing={1}>
                    <Typography color="text.secondary">Accepted types</Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      {(assignment.submission_file_types || []).length ? (
                        assignment.submission_file_types.map((type) => (
                          <Chip key={type} label={type} size="small" variant="outlined" />
                        ))
                      ) : (
                        <Chip label="Any" size="small" variant="outlined" />
                      )}
                    </Stack>
                  </Stack>
                  <Stack spacing={1}>
                    <Typography color="text.secondary">Max size</Typography>
                    <Typography>
                      {assignment.submission_max_size_mb ? `${assignment.submission_max_size_mb} MB` : '—'}
                    </Typography>
                  </Stack>
                  <Stack spacing={1}>
                    <Typography color="text.secondary">Max attempts</Typography>
                    <Typography>
                      {assignment.submission_max_attempts ? assignment.submission_max_attempts : 'Unlimited'}
                    </Typography>
                  </Stack>
                </Stack>
                {canManage ? (
                  <Button size="small" variant="outlined" onClick={openInstructions}>
                    Edit instructions
                  </Button>
                ) : null}
              </Stack>
            ) : null}

            {activeTab === 1 ? (
              <Stack spacing={2}>
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>
                    {canManage ? 'Rubric' : 'Rubric (read-only)'}
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <Chip label={`v${rubric.version_number || 0}`} size="small" />
                    <Chip label={`Total ${totalRubricPoints}`} size="small" variant="outlined" />
                  </Stack>
                </Stack>
                {canManage ? (
                  <>
                    {rubricVersionsError ? <Alert severity="error">{rubricVersionsError}</Alert> : null}
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', md: 'center' }}>
                      <FormControl size="small" sx={{ minWidth: 200 }}>
                        <InputLabel id="rubric-version-label">Active rubric</InputLabel>
                        <Select
                          labelId="rubric-version-label"
                          label="Active rubric"
                          value={rubricSelectedVersion || ''}
                          onChange={(event) => setRubricSelectedVersion(event.target.value)}
                        >
                          {rubricVersions.length === 0 ? (
                            <MenuItem value="">No versions</MenuItem>
                          ) : (
                            rubricVersions.map((version) => (
                              <MenuItem key={version.id} value={version.id}>
                                v{version.version_number} • {version.total_points} pts
                              </MenuItem>
                            ))
                          )}
                        </Select>
                      </FormControl>
                      <Button
                        variant="outlined"
                        onClick={handleActivateRubric}
                        disabled={!rubricSelectedVersion || rubricActivating}
                      >
                        {rubricActivating ? 'Updating…' : 'Set active'}
                      </Button>
                    </Stack>
                    {rubricError ? <Alert severity="error">{rubricError}</Alert> : null}
                    <FormControlLabel
                      control={
                        <Switch
                          checked={rubricForm.is_weighted}
                          onChange={(event) =>
                            setRubricForm((prev) => ({ ...prev, is_weighted: event.target.checked }))
                          }
                        />
                      }
                      label="Weighted rubric"
                    />
                    <Stack spacing={1.25}>
                      {rubricForm.criteria.length === 0 ? (
                        <Typography color="text.secondary">
                          No criteria yet. Add your first criterion.
                        </Typography>
                      ) : null}
                      {rubricForm.criteria.map((criterion, index) => (
                        <Paper
                          key={`criterion-${index}`}
                          elevation={0}
                          sx={{
                            p: 2,
                            borderRadius: 3,
                            border: '1px solid',
                            borderColor: 'divider',
                            backgroundColor: 'rgba(2, 6, 23, 0.02)',
                          }}
                        >
                          <Stack
                            direction={{ xs: 'column', md: 'row' }}
                            spacing={1.5}
                            alignItems={{ xs: 'stretch', md: 'center' }}
                          >
                            <TextField
                              label="Criterion"
                              value={criterion.name}
                              onChange={(event) => handleCriterionChange(index, 'name', event.target.value)}
                              fullWidth
                            />
                            <TextField
                              label="Points"
                              type="number"
                              value={criterion.max_points}
                              onChange={(event) => handleCriterionChange(index, 'max_points', event.target.value)}
                              sx={{ width: { xs: '100%', md: 140 } }}
                            />
                            {rubricForm.is_weighted ? (
                              <TextField
                                label="Weight"
                                type="number"
                                value={criterion.weight}
                                onChange={(event) => handleCriterionChange(index, 'weight', event.target.value)}
                                sx={{ width: { xs: '100%', md: 140 } }}
                              />
                            ) : null}
                            <Button
                              color="error"
                              variant="outlined"
                              startIcon={<DeleteRounded />}
                              onClick={() => handleRemoveCriterion(index)}
                            >
                              Remove
                            </Button>
                          </Stack>
                        </Paper>
                      ))}
                    </Stack>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                      <Button
                        variant="outlined"
                        startIcon={<AddRounded />}
                        onClick={handleAddCriterion}
                      >
                        Add criterion
                      </Button>
                      <Button
                        variant="contained"
                        onClick={handleSaveRubric}
                        disabled={rubricSaving}
                      >
                        {rubricSaving ? 'Saving…' : 'Save rubric'}
                      </Button>
                    </Stack>
                    <Divider />
                    <Stack spacing={1}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        Version history
                      </Typography>
                      {rubricVersions.length === 0 ? (
                        <Typography color="text.secondary">No rubric versions yet.</Typography>
                      ) : (
                        rubricVersions.map((version) => (
                          <Paper
                            key={version.id}
                            variant="outlined"
                            sx={{
                              p: 1.5,
                              borderRadius: 2,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 1,
                            }}
                          >
                            <Stack spacing={0.5}>
                              <Stack direction="row" spacing={1} alignItems="center">
                                <Chip
                                  label={`v${version.version_number}`}
                                  size="small"
                                  color={version.is_active ? 'primary' : 'default'}
                                  variant={version.is_active ? 'filled' : 'outlined'}
                                />
                                {version.is_active ? <Chip label="Active" size="small" /> : null}
                                <Typography variant="caption" color="text.secondary">
                                  {new Date(version.created_at).toLocaleString()}
                                </Typography>
                              </Stack>
                              <Typography variant="caption" color="text.secondary">
                                {version.criteria_count} criteria • {version.total_points} pts
                              </Typography>
                            </Stack>
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => setRubricSelectedVersion(version.id)}
                            >
                              Select
                            </Button>
                          </Paper>
                        ))
                      )}
                    </Stack>
                  </>
                ) : (
                  <Stack spacing={1.5}>
                    {rubricError ? <Alert severity="error">{rubricError}</Alert> : null}
                    {rubric.criteria?.length ? (
                      rubric.criteria.map((criterion) => (
                        <Paper
                          key={criterion.id}
                          variant="outlined"
                          sx={{
                            p: 1.5,
                            borderRadius: 2,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}
                        >
                          <Typography sx={{ fontWeight: 600 }}>{criterion.name}</Typography>
                          <Typography color="text.secondary">{criterion.max_points} pts</Typography>
                        </Paper>
                      ))
                    ) : (
                      <Typography color="text.secondary">Rubric not available.</Typography>
                    )}
                  </Stack>
                )}
              </Stack>
            ) : null}

            {activeTab === 2 ? (
              <Stack spacing={2}>
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>
                      {canManage ? 'Test suites' : 'Public test suites'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {canManage
                        ? 'Upload versioned test bundles and set the active suite used for grading.'
                        : 'Preview or download public test bundles for this assignment.'}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip label={`${testSuites.length} versions`} size="small" variant="outlined" />
                    {activeTestSuite ? (
                      <Chip
                        label={`Active v${activeTestSuite.version_number}`}
                        size="small"
                        color="primary"
                        variant="outlined"
                      />
                    ) : null}
                  </Stack>
                </Stack>
                {testSuiteError ? <Alert severity="error">{testSuiteError}</Alert> : null}
                {canManage ? (
                  <>
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 1.5,
                        borderRadius: 2,
                        backgroundColor: 'rgba(248, 250, 252, 0.9)',
                      }}
                    >
                      <Stack spacing={1.5}>
                        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                          <Box>
                            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                              Test suite builder (Phase 1)
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              Pick a language, download a ready zip, edit locally, then upload.
                            </Typography>
                          </Box>
                          <Chip label="Phase 1" size="small" variant="outlined" />
                        </Stack>
                        <Stack
                          direction={{ xs: 'column', md: 'row' }}
                          spacing={1.5}
                          alignItems={{ xs: 'stretch', md: 'center' }}
                        >
                          <FormControl size="small" sx={{ minWidth: 180 }}>
                            <InputLabel id="template-language-label">Language</InputLabel>
                            <Select
                              labelId="template-language-label"
                              label="Language"
                              value={templateLanguage}
                              onChange={(event) => setTemplateLanguage(event.target.value)}
                            >
                              <MenuItem value="">All languages</MenuItem>
                              {languages.map((language) => (
                                <MenuItem key={language.id} value={language.name}>
                                  {language.name}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                          <ToggleButtonGroup
                            size="small"
                            value={templateType}
                            exclusive
                            onChange={(_event, nextValue) => {
                              if (!nextValue) return
                              setTemplateType(nextValue)
                            }}
                          >
                            <ToggleButton value="ALL">All</ToggleButton>
                            <ToggleButton value="UNIT">Unit</ToggleButton>
                            <ToggleButton value="IO">I/O</ToggleButton>
                          </ToggleButtonGroup>
                          <FormControl size="small" sx={{ minWidth: 240 }}>
                            <InputLabel id="template-select-label">Template</InputLabel>
                            <Select
                              labelId="template-select-label"
                              label="Template"
                              value={templateId}
                              onChange={(event) => setTemplateId(event.target.value)}
                            >
                              {filteredTemplates.length === 0 ? (
                                <MenuItem value="">
                                  {templateLoading ? 'Loading…' : 'No templates'}
                                </MenuItem>
                              ) : (
                                filteredTemplates.map((template) => (
                                  <MenuItem key={template.id} value={template.id}>
                                    {template.name}
                                  </MenuItem>
                                ))
                              )}
                            </Select>
                          </FormControl>
                          <Button
                            variant="outlined"
                            startIcon={<DownloadRounded />}
                            disabled={!templateId}
                            onClick={() => {
                              if (!templateId) return
                              window.open(`${API_BASE}/api/test-templates/${templateId}/bundle/`, '_blank')
                            }}
                          >
                            Download zip
                          </Button>
                        </Stack>
                        {selectedTemplate ? (
                          <Typography variant="body2" color="text.secondary">
                            {selectedTemplate.description}
                          </Typography>
                        ) : null}
                        {templateError ? (
                          <Alert severity="error" sx={{ mt: 1 }}>
                            {templateError}
                          </Alert>
                        ) : null}
                      </Stack>
                    </Paper>
                    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', md: 'center' }}>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                            I/O builder (MVP)
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Define inputs + expected outputs. We generate a ready zip.
                          </Typography>
                        </Box>
                        <Button variant="contained" onClick={() => setBuilderOpen(true)}>
                          Build tests
                        </Button>
                      </Stack>
                    </Paper>
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                      <Paper
                        variant="outlined"
                        sx={{ p: 1.5, borderRadius: 2, flex: 1, minWidth: 220 }}
                      >
                        <Typography variant="caption" color="text.secondary">
                          Active suite
                        </Typography>
                        <Typography sx={{ fontWeight: 700, mt: 0.5 }}>
                          {activeTestSuite ? `v${activeTestSuite.version_number}` : 'Not set'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {activeTestSuite ? activeTestSuite.visibility : '—'}
                        </Typography>
                      </Paper>
                      <Paper
                        variant="outlined"
                        sx={{ p: 1.5, borderRadius: 2, flex: 1, minWidth: 220 }}
                      >
                        <Typography variant="caption" color="text.secondary">
                          Visibility breakdown
                        </Typography>
                        <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                          <Chip label={`${testSuiteStats.private} private`} size="small" />
                          <Chip label={`${testSuiteStats.public} public`} size="small" variant="outlined" />
                        </Stack>
                      </Paper>
                      <Paper
                        variant="outlined"
                        sx={{ p: 1.5, borderRadius: 2, flex: 1, minWidth: 220 }}
                      >
                        <Typography variant="caption" color="text.secondary">
                          Latest upload
                        </Typography>
                        <Typography sx={{ fontWeight: 700, mt: 0.5 }}>
                          {testSuites.length
                            ? new Date(testSuites[0].created_at).toLocaleString()
                            : '—'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {testSuites.length ? `v${testSuites[0].version_number}` : 'No versions yet'}
                        </Typography>
                      </Paper>
                    </Stack>
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 1.5,
                        borderRadius: 2,
                        backgroundColor: 'rgba(248, 250, 252, 0.9)',
                      }}
                    >
                      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} alignItems={{ xs: 'stretch', md: 'center' }}>
                        <FormControl size="small" sx={{ minWidth: 170 }}>
                          <InputLabel id="test-visibility-label">Visibility</InputLabel>
                          <Select
                            labelId="test-visibility-label"
                            label="Visibility"
                            value={testSuiteVisibility}
                            onChange={(event) => setTestSuiteVisibility(event.target.value)}
                          >
                            <MenuItem value="PUBLIC">Public</MenuItem>
                            <MenuItem value="PRIVATE">Private</MenuItem>
                          </Select>
                        </FormControl>
                        <Button variant="outlined" component="label" fullWidth>
                          {testSuiteFile ? testSuiteFile.name : 'Choose .zip bundle'}
                          <input
                            type="file"
                            accept=".zip,application/zip"
                            hidden
                            onChange={(event) => setTestSuiteFile(event.target.files?.[0] || null)}
                          />
                        </Button>
                        <Button
                          variant="contained"
                          startIcon={<UploadRounded />}
                          onClick={handleUploadTestSuite}
                          disabled={!testSuiteFile || testSuiteUploading}
                        >
                          {testSuiteUploading ? 'Uploading…' : 'Upload'}
                        </Button>
                        <ToggleButtonGroup
                          size="small"
                          exclusive
                          value={testSuiteFilter}
                          onChange={(_event, value) => {
                            if (value) setTestSuiteFilter(value)
                          }}
                          sx={{ ml: { md: 1 }, justifyContent: { xs: 'flex-start', md: 'flex-end' } }}
                        >
                          <ToggleButton value="ALL">All</ToggleButton>
                          <ToggleButton value="ACTIVE">Active</ToggleButton>
                          <ToggleButton value="PUBLIC">Public</ToggleButton>
                          <ToggleButton value="PRIVATE">Private</ToggleButton>
                        </ToggleButtonGroup>
                      </Stack>
                    </Paper>
                  </>
                ) : null}
                <Divider />
                <Stack spacing={1.25}>
                  {filteredTestSuites.length === 0 ? (
                    <Typography color="text.secondary">No test suites uploaded yet.</Typography>
                  ) : (
                    <Stack spacing={1}>
                      <Box
                        sx={{
                          display: { xs: 'none', md: 'grid' },
                          gridTemplateColumns: '140px 120px 200px 1fr 260px',
                          gap: 1,
                          px: 1,
                          color: 'text.secondary',
                        }}
                      >
                        <Typography variant="caption">Version</Typography>
                        <Typography variant="caption">Visibility</Typography>
                        <Typography variant="caption">Uploaded</Typography>
                        <Typography variant="caption">Bundle</Typography>
                        <Typography variant="caption">Actions</Typography>
                      </Box>
                      {filteredTestSuites.map((version) => (
                        <Paper
                          key={version.id}
                          variant="outlined"
                          sx={{
                            p: 1.5,
                            borderRadius: 2,
                            backgroundColor: version.is_active ? 'rgba(37, 99, 235, 0.06)' : 'transparent',
                          }}
                        >
                          <Box
                            sx={{
                              display: { xs: 'flex', md: 'grid' },
                              flexDirection: { xs: 'column', md: 'unset' },
                              gridTemplateColumns: { md: '140px 120px 200px 1fr 260px' },
                              gap: 1,
                              alignItems: { md: 'center' },
                            }}
                          >
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                v{version.version_number}
                              </Typography>
                              {version.is_active ? <Chip label="Active" size="small" color="primary" /> : null}
                            </Stack>
                            <Chip
                              label={version.visibility}
                              size="small"
                              variant="outlined"
                              sx={{ width: 'fit-content' }}
                            />
                            <Typography variant="body2" color="text.secondary">
                              {new Date(version.created_at).toLocaleString()}
                            </Typography>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {(version.bundle_key || '').split('/').pop()}
                            </Typography>
                            <Stack direction="row" spacing={1} alignItems="center">
                              {canManage ? (
                                <Button
                                  size="small"
                                  variant="outlined"
                                  onClick={() => handleActivateTestSuite(version.id)}
                                  disabled={version.is_active}
                                >
                                  Set active
                                </Button>
                              ) : null}
                              <Button
                                size="small"
                                variant="outlined"
                                startIcon={<VisibilityRounded />}
                                onClick={() => setPreviewSuite(version)}
                              >
                                Preview
                              </Button>
                              <Button
                                size="small"
                                variant="text"
                                startIcon={<DownloadRounded />}
                                component="a"
                                href={`${API_BASE}/media/${version.bundle_key}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Download
                              </Button>
                            </Stack>
                          </Box>
                        </Paper>
                      ))}
                    </Stack>
                  )}
                </Stack>
              </Stack>
            ) : null}

            {canManage && activeTab === 3 ? (
              <Stack spacing={2}>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  Settings
                </Typography>
                <SectionCard title="Submission rules" subtitle="File types, max size, and resubmission limits.">
                  <Stack spacing={1.5}>
                    <Stack spacing={1}>
                      <Typography color="text.secondary">Accepted types</Typography>
                      <Stack direction="row" spacing={1} flexWrap="wrap">
                        {(assignment.submission_file_types || []).length ? (
                          assignment.submission_file_types.map((type) => (
                            <Chip key={type} label={type} size="small" variant="outlined" />
                          ))
                        ) : (
                          <Chip label="Any" size="small" variant="outlined" />
                        )}
                      </Stack>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Max file size</Typography>
                      <Typography>
                        {assignment.submission_max_size_mb ? `${assignment.submission_max_size_mb} MB` : '—'}
                      </Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Max attempts</Typography>
                      <Typography>
                        {assignment.submission_max_attempts ? assignment.submission_max_attempts : 'Unlimited'}
                      </Typography>
                    </Stack>
                    <Button variant="outlined" size="small" onClick={openEdit} disabled={!canManage}>
                      Edit submission rules
                    </Button>
                  </Stack>
                </SectionCard>

                <SectionCard title="Assignment details">
                  <Stack spacing={1.5}>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Due date</Typography>
                      <Typography>{formatDate(assignment.due_at)}</Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Max score</Typography>
                      <Typography>{assignment.max_score}</Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Language</Typography>
                      <Typography>{assignment.language_name || '—'}</Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Group mode</Typography>
                      <Typography>
                        {assignment.group_mode === 'REUSABLE_SET' ? 'Reusable set' : 'Per assignment'}
                      </Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Groups</Typography>
                      <Typography>{assignment.allow_groups ? 'Allowed' : 'Individual only'}</Typography>
                    </Stack>
                  </Stack>
                </SectionCard>
              </Stack>
            ) : null}
          </Paper>
        </Stack>
      </Container>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit assignment</DialogTitle>
        <DialogContent>
          <Stack component="form" spacing={2} sx={{ mt: 1 }} onSubmit={handleSave}>
            <TextField
              label="Title"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              fullWidth
              required
            />
            <TextField
              label="Description"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              fullWidth
              multiline
              minRows={3}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Due date"
                type="datetime-local"
                value={form.due_at}
                onChange={(event) => setForm({ ...form, due_at: event.target.value })}
                fullWidth
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="Max score"
                type="number"
                value={form.max_score}
                onChange={(event) => setForm({ ...form, max_score: event.target.value })}
                fullWidth
              />
            </Stack>
            <FormControl size="small" fullWidth>
              <InputLabel id="detail-language-label">Programming language</InputLabel>
              <Select
                labelId="detail-language-label"
                label="Programming language"
                value={form.language_id || ''}
                onChange={(event) => setForm({ ...form, language_id: event.target.value })}
              >
                <MenuItem value="">None</MenuItem>
                {languages.map((language) => (
                  <MenuItem key={language.id} value={language.id}>
                    {language.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
              <FormControl size="small" fullWidth>
                <InputLabel id="detail-group-mode-label">Group mode</InputLabel>
                <Select
                  labelId="detail-group-mode-label"
                  label="Group mode"
                  value={form.group_mode}
                  onChange={(event) => setForm({ ...form, group_mode: event.target.value })}
                >
                  <MenuItem value="PER_ASSIGNMENT">Per assignment</MenuItem>
                  <MenuItem value="REUSABLE_SET">Reusable set</MenuItem>
                </Select>
              </FormControl>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.allow_groups}
                    onChange={(event) =>
                      setForm({ ...form, allow_groups: event.target.checked })
                    }
                  />
                }
                label="Allow groups"
              />
            </Stack>
            <Stack spacing={2}>
              <TextField
                label="Accepted file types"
                value={form.submission_file_types}
                onChange={(event) =>
                  setForm({ ...form, submission_file_types: event.target.value })
                }
                placeholder="e.g. .py, .java, .zip"
                fullWidth
                helperText="Comma-separated list. Leave empty to allow any."
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Max file size (MB)"
                  type="number"
                  value={form.submission_max_size_mb}
                  onChange={(event) =>
                    setForm({ ...form, submission_max_size_mb: event.target.value })
                  }
                  fullWidth
                />
                <TextField
                  label="Max attempts"
                  type="number"
                  value={form.submission_max_attempts}
                  onChange={(event) =>
                    setForm({ ...form, submission_max_attempts: event.target.value })
                  }
                  fullWidth
                  helperText="Use 0 for unlimited"
                />
              </Stack>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={instructionsOpen} onClose={() => setInstructionsOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Edit instructions</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {instructionsError ? <Alert severity="error">{instructionsError}</Alert> : null}
            <Paper
              variant="outlined"
              data-editor-tick={editorTick}
              sx={{
                px: 1,
                py: 0.5,
                borderRadius: 2,
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                flexWrap: 'wrap',
                backgroundColor: 'rgba(248, 250, 252, 0.9)',
                position: 'sticky',
                top: 0,
                zIndex: 1,
              }}
            >
              <ToggleButtonGroup
                size="small"
                exclusive
                value={
                  instructionsEditor?.isActive('heading', { level: 1 })
                    ? 'h1'
                    : instructionsEditor?.isActive('heading', { level: 2 })
                      ? 'h2'
                      : instructionsEditor?.isActive('heading', { level: 3 })
                        ? 'h3'
                        : 'paragraph'
                }
                onChange={(_event, value) => {
                  if (!value) return
                  if (value === 'paragraph') {
                    instructionsEditor?.chain().focus().setParagraph().run()
                  } else {
                    const level = Number(value.replace('h', ''))
                    instructionsEditor?.chain().focus().toggleHeading({ level }).run()
                  }
                }}
                sx={{ mr: 0.5 }}
              >
                <ToggleButton value="paragraph">P</ToggleButton>
                <ToggleButton value="h1">H1</ToggleButton>
                <ToggleButton value="h2">H2</ToggleButton>
                <ToggleButton value="h3">H3</ToggleButton>
              </ToggleButtonGroup>
              <Divider flexItem orientation="vertical" sx={{ mx: 0.5 }} />
              <Tooltip title="Bold">
                <IconButton
                  size="small"
                  color={instructionsEditor?.isActive('bold') ? 'primary' : 'default'}
                  onClick={() => instructionsEditor?.chain().focus().toggleBold().run()}
                >
                  <FormatBoldRounded fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Italic">
                <IconButton
                  size="small"
                  color={instructionsEditor?.isActive('italic') ? 'primary' : 'default'}
                  onClick={() => instructionsEditor?.chain().focus().toggleItalic().run()}
                >
                  <FormatItalicRounded fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Strikethrough">
                <IconButton
                  size="small"
                  color={instructionsEditor?.isActive('strike') ? 'primary' : 'default'}
                  onClick={() => instructionsEditor?.chain().focus().toggleStrike().run()}
                >
                  <StrikethroughSRounded fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Underline">
                <IconButton
                  size="small"
                  color={instructionsEditor?.isActive('underline') ? 'primary' : 'default'}
                  onClick={() => instructionsEditor?.chain().focus().toggleUnderline().run()}
                >
                  <FormatUnderlinedRounded fontSize="small" />
                </IconButton>
              </Tooltip>
              <Divider flexItem orientation="vertical" sx={{ mx: 0.5 }} />
              <Tooltip title="Bulleted list">
                <IconButton
                  size="small"
                  color={instructionsEditor?.isActive('bulletList') ? 'primary' : 'default'}
                  onClick={() => instructionsEditor?.chain().focus().toggleBulletList().run()}
                >
                  <FormatListBulletedRounded fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Numbered list">
                <IconButton
                  size="small"
                  color={instructionsEditor?.isActive('orderedList') ? 'primary' : 'default'}
                  onClick={() => instructionsEditor?.chain().focus().toggleOrderedList().run()}
                >
                  <FormatListNumberedRounded fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Quote">
                <IconButton
                  size="small"
                  color={instructionsEditor?.isActive('blockquote') ? 'primary' : 'default'}
                  onClick={() => instructionsEditor?.chain().focus().toggleBlockquote().run()}
                >
                  <FormatQuoteRounded fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Code block">
                <IconButton
                  size="small"
                  color={instructionsEditor?.isActive('codeBlock') ? 'primary' : 'default'}
                  onClick={() => instructionsEditor?.chain().focus().toggleCodeBlock().run()}
                >
                  <CodeRounded fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Divider">
                <IconButton
                  size="small"
                  onClick={() => instructionsEditor?.chain().focus().setHorizontalRule().run()}
                >
                  <HorizontalRuleRounded fontSize="small" />
                </IconButton>
              </Tooltip>
              <Divider flexItem orientation="vertical" sx={{ mx: 0.5 }} />
              <Tooltip title="Insert link">
                <IconButton
                  size="small"
                  onClick={() => {
                    const url = window.prompt('Enter link URL')
                    if (url) {
                      instructionsEditor?.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
                    }
                  }}
                >
                  <LinkRounded fontSize="small" />
                </IconButton>
              </Tooltip>
              <Box sx={{ flex: 1 }} />
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Tooltip title="Undo">
                  <IconButton size="small" onClick={() => instructionsEditor?.chain().focus().undo().run()}>
                    <UndoRounded fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Redo">
                  <IconButton size="small" onClick={() => instructionsEditor?.chain().focus().redo().run()}>
                    <RedoRounded fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
              <Tooltip title="Clear formatting">
                <IconButton
                  size="small"
                  onClick={() => instructionsEditor?.chain().focus().clearNodes().unsetAllMarks().run()}
                >
                  <FormatClearRounded fontSize="small" />
                </IconButton>
              </Tooltip>
              <Divider flexItem orientation="vertical" sx={{ mx: 0.5 }} />
              <Typography variant="caption" color="text.secondary" sx={{ pr: 0.5 }}>
                {instructionsEditor?.storage.characterCount?.words() || 0} words
              </Typography>
            </Paper>
            <Paper
              variant="outlined"
              sx={{
                minHeight: 240,
                p: 2,
                borderRadius: 2,
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
              }}
            >
              <Box
                sx={{
                  '& .ProseMirror': {
                    minHeight: 190,
                    outline: 'none',
                  },
                  '& .ProseMirror p': { mt: 0, mb: 1.25 },
                  '& .ProseMirror ul, & .ProseMirror ol': { pl: 2.5, mb: 1.25 },
                  '& .ProseMirror li': { mb: 0.5 },
                  '& .ProseMirror a': { color: 'primary.main' },
                  '& .ProseMirror code': {
                    fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
                    backgroundColor: 'rgba(15, 23, 42, 0.06)',
                    px: 0.5,
                    borderRadius: 0.75,
                  },
                }}
              >
                <EditorContent editor={instructionsEditor} />
              </Box>
            </Paper>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInstructionsOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveInstructions} disabled={instructionsSaving}>
            {instructionsSaving ? 'Saving…' : 'Save instructions'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(previewSuite)} onClose={closePreview} maxWidth="sm" fullWidth>
        <DialogTitle>Test suite preview</DialogTitle>
        <DialogContent>
          {previewSuite ? (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Stack spacing={0.5}>
                <Typography variant="subtitle2" color="text.secondary">
                  File
                </Typography>
                <Typography>{(previewSuite.bundle_key || '').split('/').pop()}</Typography>
              </Stack>
              <Stack direction="row" spacing={2}>
                <Stack spacing={0.5}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Version
                  </Typography>
                  <Typography>v{previewSuite.version_number}</Typography>
                </Stack>
                <Stack spacing={0.5}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Visibility
                  </Typography>
                  <Typography>{previewSuite.visibility}</Typography>
                </Stack>
              </Stack>
              <Stack spacing={0.5}>
                <Typography variant="subtitle2" color="text.secondary">
                  Uploaded
                </Typography>
                <Typography>{new Date(previewSuite.created_at).toLocaleString()}</Typography>
              </Stack>
              <Stack spacing={0.5}>
                <Typography variant="subtitle2" color="text.secondary">
                  Checksum
                </Typography>
                <Typography sx={{ wordBreak: 'break-all' }}>{previewSuite.checksum}</Typography>
              </Stack>
              <Divider />
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Manifest
              </Typography>
              {manifestError ? <Alert severity="error">{manifestError}</Alert> : null}
              {manifestLoading ? (
                <Typography color="text.secondary">Loading manifest…</Typography>
              ) : manifest?.files?.length ? (
                <Stack spacing={1}>
                  <Typography variant="caption" color="text.secondary">
                    {manifest.file_count} entries • {(manifest.total_size / (1024 * 1024)).toFixed(2)} MB total
                  </Typography>
                  <Stack
                    spacing={0.5}
                    sx={{
                      maxHeight: 220,
                      overflow: 'auto',
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1.5,
                      p: 1,
                      backgroundColor: 'rgba(248, 250, 252, 0.8)',
                    }}
                  >
                    {manifest.files.map((file) => (
                      <Stack key={file.name} direction="row" spacing={1} justifyContent="space-between">
                        <Typography variant="caption" sx={{ fontFamily: 'Menlo, Monaco, Consolas, monospace' }}>
                          {file.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {file.is_dir ? '—' : `${(file.size / 1024).toFixed(1)} KB`}
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>
                </Stack>
              ) : (
                <Typography color="text.secondary">No manifest available.</Typography>
              )}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={closePreview}>Close</Button>
          {previewSuite ? (
            <Button
              variant="contained"
              component="a"
              href={`${API_BASE}/media/${previewSuite.bundle_key}`}
              target="_blank"
              rel="noreferrer"
            >
              Open file
            </Button>
          ) : null}
        </DialogActions>
      </Dialog>

      <Dialog open={builderOpen} onClose={() => setBuilderOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Build I/O test suite</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="info">
              Builder currently supports Python I/O tests. Student submissions should include
              <strong> main.py</strong> that reads from stdin.
            </Alert>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField
                label="Suite name"
                value={builderName}
                onChange={(event) => setBuilderName(event.target.value)}
                fullWidth
              />
              <FormControl size="small" fullWidth>
                <InputLabel id="builder-language-label">Language</InputLabel>
                <Select
                  labelId="builder-language-label"
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
              <TextField
                label="Timeout (ms)"
                value={builderTimeout}
                onChange={(event) => setBuilderTimeout(event.target.value)}
                type="number"
                fullWidth
              />
            </Stack>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Test cases
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Provide stdin input (include newlines) and the exact expected stdout output.
            </Typography>
            <Stack spacing={1.5}>
              {builderCases.map((testCase, index) => (
                <Paper key={`case-${index}`} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                  <Stack spacing={1.5}>
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                      <TextField
                        label="Name"
                        value={testCase.name}
                        onChange={(event) =>
                          handleBuilderCaseChange(index, 'name', event.target.value)
                        }
                        sx={{ minWidth: 160 }}
                      />
                      <TextField
                        label="Points"
                        type="number"
                        value={testCase.points}
                        onChange={(event) =>
                          handleBuilderCaseChange(index, 'points', event.target.value)
                        }
                        sx={{ width: 140 }}
                      />
                      <Box sx={{ flex: 1 }} />
                      <Button
                        variant="text"
                        color="error"
                        onClick={() => removeBuilderCase(index)}
                        disabled={builderCases.length <= 1}
                      >
                        Remove
                      </Button>
                    </Stack>
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                      <TextField
                        label="Input (stdin)"
                        value={testCase.input}
                        onChange={(event) =>
                          handleBuilderCaseChange(index, 'input', event.target.value)
                        }
                        multiline
                        minRows={3}
                        fullWidth
                      />
                      <TextField
                        label="Expected output"
                        value={testCase.expected}
                        onChange={(event) =>
                          handleBuilderCaseChange(index, 'expected', event.target.value)
                        }
                        multiline
                        minRows={3}
                        fullWidth
                      />
                    </Stack>
                  </Stack>
                </Paper>
              ))}
            </Stack>
            <Button variant="outlined" startIcon={<AddRounded />} onClick={addBuilderCase}>
              Add case
            </Button>
            {builderError ? <Alert severity="error">{builderError}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBuilderOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleBuildTemplate}
            disabled={builderSubmitting}
          >
            {builderSubmitting ? 'Generating…' : 'Generate zip'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default CourseAssignmentDetail
