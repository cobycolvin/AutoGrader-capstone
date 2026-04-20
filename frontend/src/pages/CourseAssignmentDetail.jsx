import { useEffect, useMemo, useState } from 'react'
import {
  Autocomplete,
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Container,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
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
  ExpandMoreRounded,
  GradeRounded,
  GroupWorkRounded,
  AccessTimeRounded,
  DeleteRounded,
  EditRounded,
  UploadRounded,
  VisibilityRounded,
  DownloadRounded,
  InsertDriveFileRounded,
} from '@mui/icons-material'
import { Link as RouterLink, useLocation, useNavigate, useParams } from 'react-router-dom'
import { apiRequest, downloadFile, API_BASE } from '../api/client.js'
import AssignmentInstructionsEditor from '../components/AssignmentInstructionsEditor.jsx'
import CourseAssignmentIntegrity from './CourseAssignmentIntegrity.jsx'
import CourseSubmissions from './CourseSubmissions.jsx'
import CourseTestSuiteBuilder from './CourseTestSuiteBuilder.jsx'
import RowActionsMenu from '../components/RowActionsMenu.jsx'
import {
  ASSIGNMENT_SUBMISSION_MODE,
  allowsWorkspaceSubmission,
  getAssignmentSubmissionModeLabel,
} from '../utils/assignmentSubmissionMode.js'

const emptyForm = {
  title: '',
  description: '',
  instructions: '',
  due_at: '',
  max_score: '',
  language_id: '',
  allow_groups: false,
  group_mode: 'REUSABLE_SET',
  group_source: 'SET',
  group_set_id: '',
  assignment_group_ids: [],
  submission_mode: ASSIGNMENT_SUBMISSION_MODE.UPLOAD,
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

const formatBytes = (bytes) => {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = Number(bytes)
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
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
      if (typeof current !== 'object' || current === null) continue
      for (const value of Object.values(current)) {
        if (typeof value === 'string' && value.trim()) return value
        if (Array.isArray(value) || (value && typeof value === 'object')) queue.push(value)
      }
    }
  }
  return err?.message || fallback
}

const buildRubricEditorState = (rubricSource) => ({
  is_weighted: Boolean(rubricSource?.is_weighted),
  criteria: Array.isArray(rubricSource?.criteria)
    ? rubricSource.criteria.map((criterion) => ({
        name: criterion.name || '',
        max_points: criterion.max_points ?? '',
        weight: criterion.weight ?? '',
        levels: Array.isArray(criterion.levels)
          ? criterion.levels.map((l) => ({
              label: l.label || '',
              min_points: l.min_points ?? '',
              max_points: l.max_points ?? '',
              description: l.description || '',
            }))
          : [],
      }))
    : [],
})

const buildRubricPayloadFromEditor = (rubricDraft) => ({
  is_weighted: Boolean(rubricDraft?.is_weighted),
  criteria: (rubricDraft?.criteria || []).map((criterion, index) => ({
    name: criterion.name || '',
    max_points: Number(criterion.max_points) || 0,
    weight: rubricDraft?.is_weighted
      ? criterion.weight === '' || criterion.weight === null
        ? null
        : Number(criterion.weight)
      : null,
    order_index: index,
    levels: (criterion.levels || [])
      .filter((l) => l.label && l.label.trim())
      .map((l, li) => ({
        label: l.label.trim(),
        min_points: Number(l.min_points) || 0,
        max_points: Number(l.max_points) || 0,
        description: l.description || '',
        order_index: li,
      })),
  })),
})

const serializeRubricEditorState = (rubricDraft) =>
  JSON.stringify({
    is_weighted: Boolean(rubricDraft?.is_weighted),
    criteria: (rubricDraft?.criteria || []).map((criterion) => ({
      name: criterion.name || '',
      max_points: criterion.max_points ?? '',
      weight: criterion.weight ?? '',
      levels: criterion.levels || [],
    })),
  })

const formatRubricNumber = (value) => {
  const parsed = Number(value)
  if (Number.isNaN(parsed)) return String(value ?? '')
  if (Number.isInteger(parsed)) return String(parsed)
  return parsed.toFixed(2).replace(/\.?0+$/, '')
}

const formatRubricPointRange = (minPoints, maxPoints) => {
  const min = Number(minPoints)
  const max = Number(maxPoints)
  if (Number.isNaN(min) || Number.isNaN(max)) return ''
  if (min === max) return `${formatRubricNumber(max)} pts`
  return `${formatRubricNumber(min)}-${formatRubricNumber(max)} pts`
}

const rubricTemplateHasScoringGuide = (template) =>
  (template?.active_version?.criteria || []).some((criterion) => (criterion.levels || []).length > 0)

const extensionOf = (name) => {
  const dotIndex = String(name || '').lastIndexOf('.')
  if (dotIndex < 0) return ''
  return String(name || '').slice(dotIndex).toLowerCase()
}

const buildGroupScopeOptions = (groupSets) => {
  const setOptions = groupSets.map((groupSet) => ({
    id: `set:${groupSet.id}`,
    type: 'SET',
    value: groupSet.id,
    label: groupSet.name,
    helper: 'All groups in this set',
  }))
  const groupOptions = groupSets.flatMap((groupSet) =>
    (groupSet.groups || []).map((group) => ({
      id: `group:${group.id}`,
      type: 'GROUP',
      value: group.id,
      label: group.name,
      helper: groupSet.name,
    })),
  )
  return [...setOptions, ...groupOptions]
}

const detectInstructionBinaryPreviewMode = (name, mimeType) => {
  const type = String(mimeType || '').toLowerCase()
  const ext = extensionOf(name)
  if (type.startsWith('image/')) return 'image'
  if (type === 'application/pdf' || ext === '.pdf') return 'pdf'
  if (type.startsWith('audio/')) return 'audio'
  if (type.startsWith('video/')) return 'video'
  return 'binary'
}

const detectLanguageFamily = (name) => {
  const lowered = (name || '').toLowerCase()
  if (lowered.includes('python')) return 'python'
  if (lowered.includes('java')) return 'java'
  return ''
}

const isLikelyZipFile = (file) => {
  if (!file) return false
  const name = String(file.name || '').toLowerCase()
  const type = String(file.type || '').toLowerCase()
  return (
    name.endsWith('.zip') ||
    type === 'application/zip' ||
    type === 'application/x-zip-compressed'
  )
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
  const location = useLocation()
  const navigate = useNavigate()
  const [assignment, setAssignment] = useState(null)
  const [languages, setLanguages] = useState([])
  const [groupSets, setGroupSets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [rubric, setRubric] = useState({ version_number: 0, is_weighted: false, criteria: [], attachments: [], total_points: 0, total_weight: 0 })
  const [rubricForm, setRubricForm] = useState({ is_weighted: false, criteria: [] })
  const [rubricSaving, setRubricSaving] = useState(false)
  const [rubricError, setRubricError] = useState('')
  const [rubricLevelsOpen, setRubricLevelsOpen] = useState({})
  const [rubricVersions, setRubricVersions] = useState([])
  const [rubricVersionsError, setRubricVersionsError] = useState('')
  const [rubricSelectedVersion, setRubricSelectedVersion] = useState('')
  const [rubricActivating, setRubricActivating] = useState(false)
  const [rubricTemplates, setRubricTemplates] = useState([])
  const [rubricTemplatesLoading, setRubricTemplatesLoading] = useState(false)
  const [rubricTemplatesError, setRubricTemplatesError] = useState('')
  const [selectedRubricTemplateId, setSelectedRubricTemplateId] = useState('')
  const [rubricTemplateDialogOpen, setRubricTemplateDialogOpen] = useState(false)
  const [rubricTemplateDialogMode, setRubricTemplateDialogMode] = useState('create')
  const [rubricTemplateDraft, setRubricTemplateDraft] = useState({ name: '', description: '' })
  const [rubricTemplateSaving, setRubricTemplateSaving] = useState(false)
  const [rubricTemplateDeleting, setRubricTemplateDeleting] = useState(false)
  const [testSuites, setTestSuites] = useState([])
  const [testSuiteFiles, setTestSuiteFiles] = useState([])
  const [testSuiteExecutionMode, setTestSuiteExecutionMode] = useState('AUTO')
  const [testSuiteBundleName, setTestSuiteBundleName] = useState('')
  const [showImportSuite, setShowImportSuite] = useState(false)
  const [showUploadAdvanced, setShowUploadAdvanced] = useState(false)
  const [showTemplateTools, setShowTemplateTools] = useState(false)
  const [inlineBuilderOpen, setInlineBuilderOpen] = useState(false)
  const [inlineBuilderEditVersionId, setInlineBuilderEditVersionId] = useState('')
  const [testSuiteVisibility, setTestSuiteVisibility] = useState('PRIVATE')
  const [testSuiteUploading, setTestSuiteUploading] = useState(false)
  const [testSuiteError, setTestSuiteError] = useState('')
  const [previewSuite, setPreviewSuite] = useState(null)
  const [testSuiteFilter, setTestSuiteFilter] = useState('ALL')
  const [manifest, setManifest] = useState(null)
  const [manifestLoading, setManifestLoading] = useState(false)
  const [manifestError, setManifestError] = useState('')
  const [previewFileName, setPreviewFileName] = useState('')
  const [previewFileContent, setPreviewFileContent] = useState('')
  const [previewFileLoading, setPreviewFileLoading] = useState(false)
  const [previewFileError, setPreviewFileError] = useState('')
  const [previewFileTruncated, setPreviewFileTruncated] = useState(false)
  const [previewFileMode, setPreviewFileMode] = useState('none')
  const [previewFileMime, setPreviewFileMime] = useState('')
  const [previewFileObjectUrl, setPreviewFileObjectUrl] = useState('')
  const [templateList, setTemplateList] = useState([])
  const [templateLoading, setTemplateLoading] = useState(false)
  const [templateError, setTemplateError] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [templateLanguage, setTemplateLanguage] = useState('')
  const [templateType, setTemplateType] = useState('ALL')
  const [activeTab, setActiveTab] = useState(0)
  const [instructionAssets, setInstructionAssets] = useState([])
  const [instructionAssetsLoading, setInstructionAssetsLoading] = useState(false)
  const [instructionAssetsError, setInstructionAssetsError] = useState('')
  const [instructionAssetsUploading, setInstructionAssetsUploading] = useState(false)
  const [instructionAssetDeletingId, setInstructionAssetDeletingId] = useState('')
  const [instructionPreviewAssetId, setInstructionPreviewAssetId] = useState('')
  const [instructionPreviewName, setInstructionPreviewName] = useState('')
  const [instructionPreviewMode, setInstructionPreviewMode] = useState('none')
  const [instructionPreviewContent, setInstructionPreviewContent] = useState('')
  const [instructionPreviewObjectUrl, setInstructionPreviewObjectUrl] = useState('')
  const [instructionPreviewMime, setInstructionPreviewMime] = useState('')
  const [instructionPreviewLoading, setInstructionPreviewLoading] = useState(false)
  const [instructionPreviewError, setInstructionPreviewError] = useState('')
  const [instructionPreviewTruncated, setInstructionPreviewTruncated] = useState(false)

  const canManage = Boolean(user?.is_superuser || user?.is_instructor || user?.is_ta)

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

  const resetInstructionPreview = () => {
    if (instructionPreviewObjectUrl) {
      window.URL.revokeObjectURL(instructionPreviewObjectUrl)
    }
    setInstructionPreviewAssetId('')
    setInstructionPreviewName('')
    setInstructionPreviewMode('none')
    setInstructionPreviewContent('')
    setInstructionPreviewObjectUrl('')
    setInstructionPreviewMime('')
    setInstructionPreviewLoading(false)
    setInstructionPreviewError('')
    setInstructionPreviewTruncated(false)
  }

  const loadInstructionFiles = async () => {
    setInstructionAssetsLoading(true)
    setInstructionAssetsError('')
    try {
      const data = await apiRequest(`/api/assignments/${assignmentId}/instruction-files/`)
      setInstructionAssets(Array.isArray(data) ? data : [])
      return Array.isArray(data) ? data : []
    } catch (err) {
      setInstructionAssets([])
      setInstructionAssetsError(err.message || 'Unable to load assignment files')
      return []
    } finally {
      setInstructionAssetsLoading(false)
    }
  }

  const loadInstructionPreview = async (asset) => {
    if (!asset?.id) return
    if (instructionPreviewObjectUrl) {
      window.URL.revokeObjectURL(instructionPreviewObjectUrl)
      setInstructionPreviewObjectUrl('')
    }
    setInstructionPreviewAssetId(asset.id)
    setInstructionPreviewName(asset.original_name || '')
    setInstructionPreviewMode('none')
    setInstructionPreviewContent('')
    setInstructionPreviewMime(asset.mime_type || '')
    setInstructionPreviewLoading(true)
    setInstructionPreviewError('')
    setInstructionPreviewTruncated(false)
    try {
      const data = await apiRequest(
        `/api/assignments/${assignmentId}/instruction-files/${asset.id}/preview/`,
      )
      setInstructionPreviewName(data.name || asset.original_name || '')
      setInstructionPreviewTruncated(Boolean(data.truncated))
      const encoding = String(data.encoding || '').toLowerCase()
      const mimeType = data.mime_type || 'application/octet-stream'
      setInstructionPreviewMime(mimeType)
      if (encoding === 'base64') {
        const binary = window.atob(data.content || '')
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index)
        }
        const blob = new Blob([bytes], { type: mimeType })
        const objectUrl = window.URL.createObjectURL(blob)
        setInstructionPreviewObjectUrl(objectUrl)
        setInstructionPreviewMode(detectInstructionBinaryPreviewMode(data.name || asset.original_name, mimeType))
      } else {
        setInstructionPreviewContent(data.content || '')
        setInstructionPreviewMode('text')
      }
    } catch (err) {
      setInstructionPreviewError(err.message || 'Unable to preview assignment file')
      setInstructionPreviewMode('none')
    } finally {
      setInstructionPreviewLoading(false)
    }
  }

  useEffect(() => {
    loadInstructionFiles()
  }, [assignmentId])

  useEffect(() => {
    if (!instructionAssets.length) {
      resetInstructionPreview()
      return
    }
    const selectedAsset = instructionAssets.find((asset) => asset.id === instructionPreviewAssetId)
    if (!selectedAsset) {
      loadInstructionPreview(instructionAssets[0])
    }
  }, [instructionAssets, instructionPreviewAssetId])

  useEffect(
    () => () => {
      if (instructionPreviewObjectUrl) {
        window.URL.revokeObjectURL(instructionPreviewObjectUrl)
      }
    },
    [instructionPreviewObjectUrl],
  )

  const loadRubric = async () => {
    setRubricError('')
    try {
      const data = await apiRequest(`/api/assignments/${assignmentId}/rubric/`)
      setRubric(data || { version_number: 0, is_weighted: false, criteria: [], attachments: [], total_points: 0, total_weight: 0 })
      setRubricForm(buildRubricEditorState(data))
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

  const loadRubricTemplates = async () => {
    if (!canManage) return
    setRubricTemplatesLoading(true)
    setRubricTemplatesError('')
    try {
      const data = await apiRequest(`/api/rubric-templates/?course_id=${encodeURIComponent(courseId)}`)
      setRubricTemplates(Array.isArray(data) ? data : [])
    } catch (err) {
      setRubricTemplates([])
      setRubricTemplatesError(err.message || 'Unable to load rubric templates')
    } finally {
      setRubricTemplatesLoading(false)
    }
  }

  useEffect(() => {
    if (!canManage) return
    loadRubricTemplates()
  }, [courseId, canManage])

  useEffect(() => {
    if (!selectedRubricTemplateId) return
    if (!rubricTemplates.some((template) => template.id === selectedRubricTemplateId)) {
      setSelectedRubricTemplateId('')
    }
  }, [rubricTemplates, selectedRubricTemplateId])

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

  const assignmentBuilderLanguageName = useMemo(() => {
    if (assignment?.language_name) return assignment.language_name
    if (!assignment?.language) return ''
    return languages.find((language) => String(language.id) === String(assignment.language))?.name || ''
  }, [assignment, languages])

  const inlineBuilderSupported = useMemo(() => {
    const family = detectLanguageFamily(assignmentBuilderLanguageName)
    return family === 'python' || family === 'java'
  }, [assignmentBuilderLanguageName])

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

  useEffect(() => {
    const loadGroupSets = async () => {
      try {
        const data = await apiRequest(`/api/courses/${courseId}/groups/`)
        setGroupSets(Array.isArray(data?.group_sets) ? data.group_sets : [])
      } catch (_err) {
        setGroupSets([])
      }
    }
    if (canManage) {
      loadGroupSets()
    }
  }, [canManage, courseId])

  const openEdit = () => {
    if (!assignment) return
    setForm({
      title: assignment.title || '',
      description: assignment.description || '',
      instructions: assignment.instructions || '',
      due_at: toLocalInputValue(assignment.due_at),
      max_score: assignment.max_score ?? '',
      language_id: assignment.language || '',
      allow_groups: Boolean(assignment.allow_groups),
      group_mode: assignment.group_mode || (assignment.allow_groups ? 'REUSABLE_SET' : 'PER_ASSIGNMENT'),
      group_source:
        assignment.allow_groups && !assignment.group_set && (assignment.assignment_groups || []).length
          ? 'GROUPS'
          : 'SET',
      group_set_id: assignment.group_set || '',
      assignment_group_ids: (assignment.assignment_groups || []).map((group) => group.id),
      submission_mode: assignment.submission_mode || ASSIGNMENT_SUBMISSION_MODE.UPLOAD,
      submission_file_types: (assignment.submission_file_types || []).join(', '),
      submission_max_size_mb: assignment.submission_max_size_mb ?? 25,
      submission_max_attempts: assignment.submission_max_attempts ?? 3,
    })
    setDialogOpen(true)
  }

  const handleInstructionFilesSelected = async (event) => {
    const selectedFiles = Array.from(event.target.files || [])
    event.target.value = ''
    if (!selectedFiles.length) return

    setInstructionAssetsUploading(true)
    setInstructionAssetsError('')
    try {
      const formData = new FormData()
      selectedFiles.forEach((file) => formData.append('files[]', file))
      const created = await apiRequest(`/api/assignments/${assignmentId}/instruction-files/`, {
        method: 'POST',
        body: formData,
      })
      await loadInstructionFiles()
      if (Array.isArray(created) && created.length) {
        await loadInstructionPreview(created[0])
      }
    } catch (err) {
      setInstructionAssetsError(err.message || 'Unable to upload assignment files')
    } finally {
      setInstructionAssetsUploading(false)
    }
  }

  const handleDownloadInstructionFile = async (asset) => {
    try {
      await downloadFile(
        `/api/assignments/${assignmentId}/instruction-files/${asset.id}/download/`,
        { filename: asset.original_name || 'assignment-file' },
      )
    } catch (err) {
      setInstructionAssetsError(err.message || 'Unable to download assignment file')
    }
  }

  const handleDeleteInstructionFile = async (asset) => {
    if (!asset?.id) return
    const confirmed = window.confirm(`Delete ${asset.original_name}?`)
    if (!confirmed) return

    setInstructionAssetDeletingId(asset.id)
    setInstructionAssetsError('')
    try {
      await apiRequest(`/api/assignments/${assignmentId}/instruction-files/${asset.id}/`, {
        method: 'DELETE',
      })
      const nextAssets = await loadInstructionFiles()
      if (instructionPreviewAssetId === asset.id) {
        if (nextAssets.length) {
          await loadInstructionPreview(nextAssets[0])
        } else {
          resetInstructionPreview()
        }
      }
    } catch (err) {
      setInstructionAssetsError(err.message || 'Unable to delete assignment file')
    } finally {
      setInstructionAssetDeletingId('')
    }
  }

  const handleSave = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const derivedGroupMode = !form.allow_groups
        ? 'PER_ASSIGNMENT'
        : form.group_source === 'GROUPS'
          ? 'PER_ASSIGNMENT'
          : 'REUSABLE_SET'
      const payload = {
        title: form.title,
        description: form.description,
        instructions: form.instructions || '',
        due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
        max_score: form.max_score === '' ? 0 : Number(form.max_score),
        language_id: form.language_id || null,
        allow_groups: form.allow_groups,
        group_mode: derivedGroupMode,
        group_set_id: form.allow_groups && form.group_source === 'SET' ? form.group_set_id || null : null,
        assignment_group_ids:
          form.allow_groups && form.group_source === 'GROUPS' ? form.assignment_group_ids || [] : [],
        submission_mode: form.submission_mode || ASSIGNMENT_SUBMISSION_MODE.UPLOAD,
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

  const handleAddLevel = (criterionIndex) => {
    setRubricForm((prev) => {
      const next = [...prev.criteria]
      const levels = [...(next[criterionIndex].levels || []), { label: '', min_points: '', max_points: '', description: '' }]
      next[criterionIndex] = { ...next[criterionIndex], levels }
      return { ...prev, criteria: next }
    })
  }

  const handleRemoveLevel = (criterionIndex, levelIndex) => {
    setRubricForm((prev) => {
      const next = [...prev.criteria]
      const levels = (next[criterionIndex].levels || []).filter((_, i) => i !== levelIndex)
      next[criterionIndex] = { ...next[criterionIndex], levels }
      return { ...prev, criteria: next }
    })
  }

  const handleLevelChange = (criterionIndex, levelIndex, field, value) => {
    setRubricForm((prev) => {
      const next = [...prev.criteria]
      const levels = [...(next[criterionIndex].levels || [])]
      levels[levelIndex] = { ...levels[levelIndex], [field]: value }
      next[criterionIndex] = { ...next[criterionIndex], levels }
      return { ...prev, criteria: next }
    })
  }

  const handleSaveRubric = async () => {
    setRubricSaving(true)
    setRubricError('')
    try {
      const payload = buildRubricPayloadFromEditor(rubricForm)
      await apiRequest(`/api/assignments/${assignmentId}/rubric/`, {
        method: 'POST',
        body: payload,
      })
      await loadRubric()
      await loadRubricVersions()
    } catch (err) {
      setRubricError(extractApiErrorMessage(err, 'Unable to save rubric'))
    } finally {
      setRubricSaving(false)
    }
  }

  const selectedRubricTemplate = useMemo(
    () => rubricTemplates.find((template) => template.id === selectedRubricTemplateId) || null,
    [rubricTemplates, selectedRubricTemplateId],
  )

  const handleApplyRubricTemplateToEditor = () => {
    if (!selectedRubricTemplate?.active_version) return
    const nextDraft = buildRubricEditorState(selectedRubricTemplate.active_version)
    const draftChanged =
      serializeRubricEditorState(rubricForm) !== serializeRubricEditorState(nextDraft)
    if (draftChanged && rubricForm.criteria.length) {
      const confirmed = window.confirm('Replace the current rubric draft with this template?')
      if (!confirmed) return
    }
    setRubricForm(nextDraft)
  }

  const applyTemplateDirectly = (template) => {
    if (!template?.active_version) return
    setRubricForm(buildRubricEditorState(template.active_version))
    setSelectedRubricTemplateId(template.id)
  }

  const openCreateRubricTemplateDialog = () => {
    setRubricTemplateDialogMode('create')
    setRubricTemplateDraft({
      name: assignment?.title ? `${assignment.title} rubric` : '',
      description: '',
    })
    setRubricTemplateDialogOpen(true)
  }

  const openUpdateRubricTemplateDialog = () => {
    if (!selectedRubricTemplate?.is_editable) return
    setRubricTemplateDialogMode('update')
    setRubricTemplateDraft({
      name: selectedRubricTemplate.name || '',
      description: selectedRubricTemplate.description || '',
    })
    setRubricTemplateDialogOpen(true)
  }

  const handleSaveRubricTemplate = async () => {
    setRubricTemplateSaving(true)
    setRubricTemplatesError('')
    try {
      const rubricPayload = buildRubricPayloadFromEditor(rubricForm)
      const isUpdate = rubricTemplateDialogMode === 'update' && selectedRubricTemplate?.id

      let data
      if (isUpdate) {
        const existingCriteria = selectedRubricTemplate.active_version?.criteria || []
        const draftCriteria = rubricPayload.criteria || []
        const criteriaUnchanged =
          existingCriteria.length === draftCriteria.length &&
          existingCriteria.every((c, i) => {
            const d = draftCriteria[i]
            return (
              d &&
              c.name === d.name &&
              String(c.max_points) === String(d.max_points) &&
              String(c.weight ?? '') === String(d.weight ?? '')
            )
          })
        const weightUnchanged =
          Boolean(selectedRubricTemplate.active_version?.is_weighted) === Boolean(rubricPayload.is_weighted)

        if (criteriaUnchanged && weightUnchanged) {
          data = await apiRequest(`/api/rubric-templates/${selectedRubricTemplate.id}/`, {
            method: 'PATCH',
            body: {
              name: rubricTemplateDraft.name,
              description: rubricTemplateDraft.description || '',
            },
          })
        } else {
          data = await apiRequest(`/api/rubric-templates/${selectedRubricTemplate.id}/versions/`, {
            method: 'POST',
            body: {
              ...rubricPayload,
              name: rubricTemplateDraft.name,
              description: rubricTemplateDraft.description || '',
            },
          })
        }
      } else {
        data = await apiRequest('/api/rubric-templates/', {
          method: 'POST',
          body: {
            ...rubricPayload,
            name: rubricTemplateDraft.name,
            description: rubricTemplateDraft.description || '',
            course_id: courseId,
          },
        })
      }
      await loadRubricTemplates()
      setSelectedRubricTemplateId(data?.id || '')
      setRubricTemplateDialogOpen(false)
    } catch (err) {
      setRubricTemplatesError(extractApiErrorMessage(err, 'Unable to save rubric template'))
    } finally {
      setRubricTemplateSaving(false)
    }
  }

  const handleDeleteRubricTemplate = async () => {
    if (!selectedRubricTemplate?.id || !selectedRubricTemplate.is_editable) return
    const confirmed = window.confirm(
      `Delete the course template "${selectedRubricTemplate.name}"? This cannot be undone.`,
    )
    if (!confirmed) return
    setRubricTemplateDeleting(true)
    setRubricTemplatesError('')
    try {
      await apiRequest(`/api/rubric-templates/${selectedRubricTemplate.id}/`, { method: 'DELETE' })
      setSelectedRubricTemplateId('')
      await loadRubricTemplates()
    } catch (err) {
      setRubricTemplatesError(extractApiErrorMessage(err, 'Unable to delete rubric template'))
    } finally {
      setRubricTemplateDeleting(false)
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

  const totalRubricWeight = useMemo(
    () =>
      rubricForm.criteria.reduce((total, criterion) => {
        const weight = Number(criterion.weight)
        return total + (Number.isFinite(weight) ? weight : 0)
      }, 0),
    [rubricForm.criteria],
  )

  const handleUploadTestSuite = async () => {
    if (!testSuiteFiles.length) return
    if (hasMixedUploadSelection) {
      setTestSuiteError('Upload either one .zip file or raw files, not a mix.')
      return
    }
    if (selectedZipCount > 1) {
      setTestSuiteError('Upload a single .zip file, or upload raw files.')
      return
    }

    setTestSuiteUploading(true)
    setTestSuiteError('')
    try {
      const formData = new FormData()
      formData.append('visibility', testSuiteVisibility)
      formData.append('set_active', 'true')
      if (testSuiteExecutionMode !== 'AUTO') {
        formData.append('execution_mode', testSuiteExecutionMode)
      }
      if (selectedZipFile) {
        formData.append('file', selectedZipFile)
      } else {
        if (testSuiteBundleName.trim()) {
          formData.append('name', testSuiteBundleName.trim())
        }
        testSuiteFiles.forEach((file) => {
          formData.append('files', file)
        })
      }
      await apiRequest(`/api/assignments/${assignmentId}/test-suites/`, {
        method: 'POST',
        body: formData,
      })
      setTestSuiteFiles([])
      setTestSuiteBundleName('')
      setTestSuiteExecutionMode('AUTO')
      await loadTestSuites()
    } catch (err) {
      setTestSuiteError(err.message || 'Unable to upload test suite')
    } finally {
      setTestSuiteUploading(false)
    }
  }

  const handleClearSelectedTestSuiteFiles = () => {
    setTestSuiteFiles([])
    setTestSuiteError('')
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

  const selectedZipCount = useMemo(
    () => testSuiteFiles.filter((file) => isLikelyZipFile(file)).length,
    [testSuiteFiles],
  )
  const selectedRawCount = testSuiteFiles.length - selectedZipCount
  const selectedZipFile = useMemo(() => {
    if (selectedZipCount !== 1 || selectedRawCount !== 0) return null
    return testSuiteFiles.find((file) => isLikelyZipFile(file)) || null
  }, [selectedZipCount, selectedRawCount, testSuiteFiles])
  const hasMixedUploadSelection = selectedZipCount > 0 && selectedRawCount > 0
  const showBundleNameField = selectedRawCount > 0 && selectedZipCount === 0
  const canUploadSelection =
    testSuiteFiles.length > 0 &&
    !hasMixedUploadSelection &&
    (selectedRawCount > 0 || selectedZipCount === 1)

  const closePreview = () => {
    if (previewFileObjectUrl) {
      window.URL.revokeObjectURL(previewFileObjectUrl)
    }
    setPreviewSuite(null)
    setManifest(null)
    setManifestError('')
    setPreviewFileLoading(false)
    setPreviewFileName('')
    setPreviewFileContent('')
    setPreviewFileError('')
    setPreviewFileTruncated(false)
    setPreviewFileMode('none')
    setPreviewFileMime('')
    setPreviewFileObjectUrl('')
  }

  const loadPreviewFile = async (fileName) => {
    if (!previewSuite || !fileName) return
    if (previewFileObjectUrl) {
      window.URL.revokeObjectURL(previewFileObjectUrl)
      setPreviewFileObjectUrl('')
    }
    setPreviewFileName(fileName)
    setPreviewFileLoading(true)
    setPreviewFileError('')
    setPreviewFileContent('')
    setPreviewFileTruncated(false)
    setPreviewFileMode('none')
    setPreviewFileMime('')
    try {
      const data = await apiRequest(
        `/api/assignments/${assignmentId}/test-suites/${previewSuite.id}/file/?name=${encodeURIComponent(fileName)}`,
      )
      setPreviewFileName(data.name || fileName)
      setPreviewFileTruncated(Boolean(data.truncated))
      const encoding = String(data.encoding || '').toLowerCase()
      const mimeType = data.mime_type || 'application/octet-stream'
      setPreviewFileMime(mimeType)
      if (encoding === 'base64') {
        const binary = window.atob(data.content || '')
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index)
        }
        const blob = new Blob([bytes], { type: mimeType })
        const objectUrl = window.URL.createObjectURL(blob)
        setPreviewFileObjectUrl(objectUrl)
        setPreviewFileMode('binary')
      } else {
        setPreviewFileContent(data.content || '')
        setPreviewFileMode('text')
      }
    } catch (err) {
      setPreviewFileError(err.message || 'Unable to load file preview')
      setPreviewFileMode('none')
    } finally {
      setPreviewFileLoading(false)
    }
  }

  useEffect(() => {
    const loadManifest = async () => {
      if (!previewSuite) {
        if (previewFileObjectUrl) {
          window.URL.revokeObjectURL(previewFileObjectUrl)
        }
        setManifest(null)
        setManifestError('')
        setPreviewFileLoading(false)
        setPreviewFileName('')
        setPreviewFileContent('')
        setPreviewFileError('')
        setPreviewFileTruncated(false)
        setPreviewFileMode('none')
        setPreviewFileMime('')
        setPreviewFileObjectUrl('')
        return
      }
      setManifestLoading(true)
      setManifestError('')
      if (previewFileObjectUrl) {
        window.URL.revokeObjectURL(previewFileObjectUrl)
      }
      setPreviewFileLoading(false)
      setPreviewFileName('')
      setPreviewFileContent('')
      setPreviewFileError('')
      setPreviewFileTruncated(false)
      setPreviewFileMode('none')
      setPreviewFileMime('')
      setPreviewFileObjectUrl('')
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

  useEffect(
    () => () => {
      if (previewFileObjectUrl) {
        window.URL.revokeObjectURL(previewFileObjectUrl)
      }
    },
    [previewFileObjectUrl],
  )

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
        label: assignment.allow_groups ? 'Group submissions' : 'Individual only',
        icon: <GroupWorkRounded fontSize="small" />,
      },
      {
        label: getAssignmentSubmissionModeLabel(assignment),
        icon: <UploadRounded fontSize="small" />,
      },
      ...(assignment.allow_groups && assignment.group_set_name
        ? [{ label: assignment.group_set_name, icon: <GroupWorkRounded fontSize="small" /> }]
        : assignment.allow_groups && (assignment.assignment_groups || []).length
          ? [{ label: `${assignment.assignment_groups.length} selected groups`, icon: <GroupWorkRounded fontSize="small" /> }]
        : []),
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

  const groupScopeOptions = useMemo(() => buildGroupScopeOptions(groupSets), [groupSets])
  const selectedGroupScopeOptions = useMemo(() => {
    if (!form.allow_groups) return []
    if (form.group_source === 'SET' && form.group_set_id) {
      return groupScopeOptions.filter((option) => option.type === 'SET' && option.value === form.group_set_id)
    }
    if (form.group_source === 'GROUPS' && Array.isArray(form.assignment_group_ids)) {
      return groupScopeOptions.filter(
        (option) => option.type === 'GROUP' && form.assignment_group_ids.includes(option.value),
      )
    }
    return []
  }, [form.allow_groups, form.group_source, form.group_set_id, form.assignment_group_ids, groupScopeOptions])

  const openInlineBuilder = (versionId = '') => {
    setInlineBuilderEditVersionId(versionId)
    setInlineBuilderOpen(true)
    setShowImportSuite(false)
  }

  const closeInlineBuilder = () => {
    setInlineBuilderOpen(false)
    setInlineBuilderEditVersionId('')
  }

  const handleInlineBuilderPublished = async () => {
    closeInlineBuilder()
    await loadTestSuites()
  }

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

  const toPrettyJson = (value, fallback) => {
    try {
      return JSON.stringify(value === undefined ? fallback : value, null, 2)
    } catch (_error) {
      return JSON.stringify(fallback, null, 2)
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
    () =>
      canManage
        ? ['Overview', 'Rubric', 'Tests', 'Integrity', 'Submissions', 'Settings']
        : ['Overview', 'Rubric', 'Tests', 'Submissions'],
    [canManage],
  )

  const integrityTabIndex = useMemo(
    () => detailTabs.findIndex((label) => label === 'Integrity'),
    [detailTabs],
  )

  const submissionsTabIndex = useMemo(
    () => detailTabs.findIndex((label) => label === 'Submissions'),
    [detailTabs],
  )

  const settingsTabIndex = useMemo(
    () => detailTabs.findIndex((label) => label === 'Settings'),
    [detailTabs],
  )

  useEffect(() => {
    if (activeTab >= detailTabs.length) {
      setActiveTab(0)
    }
  }, [activeTab, detailTabs.length])

  useEffect(() => {
    const tabParam = new URLSearchParams(location.search).get('tab')
    if (!tabParam) return
    const nextIndex = detailTabs.findIndex(
      (label) => label.toLowerCase() === tabParam.toLowerCase(),
    )
    if (nextIndex >= 0 && nextIndex !== activeTab) {
      setActiveTab(nextIndex)
    }
  }, [detailTabs, location.search])

  const handleTabChange = (_event, value) => {
    setActiveTab(value)
    const nextLabel = detailTabs[value]
    if (!nextLabel) return
    const params = new URLSearchParams(location.search)
    params.set('tab', nextLabel)
    navigate(
      {
        pathname: location.pathname,
        search: `?${params.toString()}`,
      },
      { replace: true },
    )
  }

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
      <Container maxWidth="xl">
        <Stack spacing={2.5}>
          <Paper
            elevation={0}
            sx={{
              p: { xs: 1.5, md: 2 },
              borderRadius: 2.5,
              border: '1px solid',
              borderColor: 'divider',
              backgroundColor: 'background.paper',
            }}
          >
            <Stack spacing={1.25}>
              {/* Breadcrumb */}
              <Button
                component={RouterLink}
                to={`/course/${courseId}/assignments`}
                startIcon={<ArrowBackRounded sx={{ fontSize: 14 }} />}
                size="small"
                sx={{
                  alignSelf: 'flex-start',
                  textTransform: 'none',
                  color: 'text.secondary',
                  px: 0,
                  py: 0,
                  minWidth: 0,
                  fontWeight: 500,
                  fontSize: 12,
                  '&:hover': { backgroundColor: 'transparent', color: 'text.primary' },
                }}
              >
                Assignments
              </Button>

              {/* Title row + action */}
              <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} gap={1.5}>
                <Stack spacing={0.35} sx={{ minWidth: 0 }}>
                  <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: -0.15 }}>
                    {assignment.title}
                  </Typography>
                  {assignment.description && (
                    <Typography color="text.secondary" variant="body2">
                      {assignment.description}
                    </Typography>
                  )}
                </Stack>
                {!canManage && allowsWorkspaceSubmission(assignment) ? (
                  <Button
                    component={RouterLink}
                    to={`/course/${courseId}/assignments/${assignmentId}/workspace`}
                    variant="contained"
                    startIcon={<CodeRounded />}
                    sx={{ textTransform: 'none', borderRadius: 999, flexShrink: 0 }}
                  >
                    Open workspace
                  </Button>
                ) : null}
                {canManage ? (
                  <Button
                    variant="outlined"
                    startIcon={<EditRounded />}
                    onClick={openEdit}
                    sx={{ textTransform: 'none', borderRadius: 999, flexShrink: 0 }}
                  >
                    Edit
                  </Button>
                ) : null}
              </Stack>

              {/* Meta chips */}
              <Stack direction="row" flexWrap="wrap" rowGap={0.5} columnGap={1.5}>
                {summaryChips.map((chip) => (
                  <Stack key={chip.label} direction="row" spacing={0.5} alignItems="center">
                    <Box sx={{ color: 'text.disabled', display: 'flex', fontSize: 14 }}>{chip.icon}</Box>
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
              onChange={handleTabChange}
              variant="fullWidth"
              sx={{ minHeight: 42, '& .MuiTabs-indicator': { height: 3, borderRadius: 2 } }}
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
                <Stack spacing={1.5}>
                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={1.5}
                    alignItems={{ xs: 'stretch', md: 'center' }}
                    justifyContent="space-between"
                  >
                    <Box>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                          Assignment files
                        </Typography>
                        <Chip
                          size="small"
                          label={
                            instructionAssetsLoading
                              ? 'Loading…'
                              : `${instructionAssets.length} file${instructionAssets.length === 1 ? '' : 's'}`
                          }
                          variant="outlined"
                        />
                      </Stack>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {canManage
                          ? 'Upload PDFs, starter notes, or handouts students should read before submitting.'
                          : 'Files shared with this assignment.'}
                      </Typography>
                    </Box>
                    {canManage ? (
                      <Button
                        size="small"
                        variant="outlined"
                        component="label"
                        startIcon={<UploadRounded />}
                        disabled={instructionAssetsUploading}
                        sx={{ alignSelf: { xs: 'flex-start', md: 'center' } }}
                      >
                        {instructionAssetsUploading ? 'Uploading…' : 'Upload files'}
                        <input type="file" multiple hidden onChange={handleInstructionFilesSelected} />
                      </Button>
                    ) : null}
                  </Stack>
                  {instructionAssetsError ? <Alert severity="error">{instructionAssetsError}</Alert> : null}
                  {instructionAssetsLoading ? (
                    <Typography color="text.secondary">Loading assignment files…</Typography>
                  ) : instructionAssets.length ? (
                    <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2}>
                      <Paper
                        elevation={0}
                        sx={{
                          width: { xs: '100%', lg: 320 },
                          flexShrink: 0,
                          p: 1,
                          borderRadius: 2.5,
                          border: '1px solid',
                          borderColor: 'divider',
                          background: 'linear-gradient(180deg, rgba(248, 250, 252, 0.86) 0%, rgba(255, 255, 255, 0.98) 100%)',
                        }}
                      >
                        <Stack spacing={0.75}>
                          <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
                            Shared files
                          </Typography>
                          <Stack spacing={0.75}>
                        {instructionAssets.map((asset) => {
                          const selected = instructionPreviewAssetId === asset.id
                          const deleting = instructionAssetDeletingId === asset.id
                          return (
                            <Box
                              key={asset.id}
                              sx={{
                                p: 1,
                                borderRadius: 2,
                                border: '1px solid',
                                borderColor: selected ? 'primary.main' : 'divider',
                                background: selected
                                  ? 'linear-gradient(135deg, rgba(79, 70, 229, 0.08) 0%, rgba(255, 255, 255, 0.98) 72%)'
                                  : 'rgba(255, 255, 255, 0.88)',
                              }}
                            >
                              <Stack direction="row" spacing={1} alignItems="flex-start">
                                <Button
                                  onClick={() => loadInstructionPreview(asset)}
                                  sx={{
                                    minWidth: 0,
                                    p: 0,
                                    flex: 1,
                                    justifyContent: 'flex-start',
                                    textTransform: 'none',
                                    color: 'inherit',
                                  }}
                                >
                                  <Box
                                    sx={{
                                      width: 36,
                                      height: 36,
                                      borderRadius: 1.75,
                                      display: 'grid',
                                      placeItems: 'center',
                                      backgroundColor: selected ? 'rgba(79, 70, 229, 0.14)' : 'rgba(15, 23, 42, 0.05)',
                                      color: selected ? 'primary.main' : 'text.secondary',
                                      flexShrink: 0,
                                    }}
                                  >
                                    <InsertDriveFileRounded fontSize="small" />
                                  </Box>
                                  <Box sx={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                                    <Typography
                                      variant="body2"
                                      sx={{
                                        fontWeight: 700,
                                        color: 'text.primary',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      {asset.original_name}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                      {formatBytes(asset.file_size || 0)}
                                      {asset.created_at ? ` • ${formatDate(asset.created_at)}` : ''}
                                    </Typography>
                                  </Box>
                                </Button>
                                <RowActionsMenu
                                  disabled={deleting}
                                  items={[
                                    {
                                      key: 'preview',
                                      label: 'Preview',
                                      onClick: () => loadInstructionPreview(asset),
                                      icon: <VisibilityRounded fontSize="small" />,
                                    },
                                    {
                                      key: 'download',
                                      label: 'Download',
                                      onClick: () => handleDownloadInstructionFile(asset),
                                      icon: <DownloadRounded fontSize="small" />,
                                    },
                                    ...(canManage
                                      ? [
                                          {
                                            key: 'delete',
                                            label: 'Delete',
                                            onClick: () => handleDeleteInstructionFile(asset),
                                            icon: <DeleteRounded fontSize="small" color="error" />,
                                            disabled: deleting,
                                          },
                                        ]
                                      : []),
                                  ]}
                                />
                              </Stack>
                            </Box>
                          )
                        })}
                          </Stack>
                        </Stack>
                      </Paper>

                      <Paper
                        elevation={0}
                        sx={{
                          flex: 1,
                          p: 2,
                          borderRadius: 2.5,
                          border: '1px solid',
                          borderColor: 'divider',
                          background: 'linear-gradient(180deg, rgba(248, 250, 252, 0.86) 0%, rgba(255, 255, 255, 0.98) 100%)',
                          minHeight: 220,
                        }}
                      >
                        <Stack spacing={1.25} sx={{ height: '100%' }}>
                          <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                              {instructionPreviewName ? `Preview: ${instructionPreviewName}` : 'Select a file to preview'}
                            </Typography>
                            {instructionPreviewTruncated ? (
                              <Chip size="small" color="warning" label="Truncated" />
                            ) : null}
                          </Stack>
                          {instructionPreviewError ? <Alert severity="error">{instructionPreviewError}</Alert> : null}
                          {instructionPreviewLoading ? (
                            <Typography color="text.secondary">Loading file preview…</Typography>
                          ) : instructionPreviewError ? null : instructionPreviewMode === 'text' ? (
                            <Box
                              component="pre"
                              sx={{
                                m: 0,
                                flex: 1,
                                minHeight: 180,
                                maxHeight: 380,
                                overflow: 'auto',
                                border: '1px solid',
                                borderColor: 'divider',
                                borderRadius: 2,
                                p: 1.25,
                                fontSize: 12,
                                lineHeight: 1.55,
                                fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
                                backgroundColor: 'rgba(15, 23, 42, 0.04)',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                              }}
                            >
                              {instructionPreviewContent || '(empty file)'}
                            </Box>
                          ) : instructionPreviewMode === 'image' && instructionPreviewObjectUrl ? (
                            <Box
                              component="img"
                              src={instructionPreviewObjectUrl}
                              alt={instructionPreviewName}
                              sx={{
                                width: '100%',
                                maxHeight: 380,
                                objectFit: 'contain',
                                borderRadius: 2,
                                border: '1px solid',
                                borderColor: 'divider',
                                backgroundColor: '#fff',
                              }}
                            />
                          ) : ['pdf', 'binary'].includes(instructionPreviewMode) && instructionPreviewObjectUrl ? (
                            <Box
                              component="iframe"
                              title={instructionPreviewName}
                              src={instructionPreviewObjectUrl}
                              sx={{
                                width: '100%',
                                height: 380,
                                border: '1px solid',
                                borderColor: 'divider',
                                borderRadius: 2,
                                backgroundColor: '#fff',
                              }}
                            />
                          ) : instructionPreviewMode === 'audio' && instructionPreviewObjectUrl ? (
                            <audio src={instructionPreviewObjectUrl} controls style={{ width: '100%' }} />
                          ) : instructionPreviewMode === 'video' && instructionPreviewObjectUrl ? (
                            <Box
                              component="video"
                              src={instructionPreviewObjectUrl}
                              controls
                              sx={{
                                width: '100%',
                                maxHeight: 380,
                                borderRadius: 2,
                                border: '1px solid',
                                borderColor: 'divider',
                                backgroundColor: '#000',
                              }}
                            />
                          ) : (
                            <Stack
                              spacing={1}
                              alignItems="flex-start"
                              justifyContent="center"
                              sx={{ flex: 1, minHeight: 180 }}
                            >
                              <Typography color="text.secondary">
                                {instructionAssets.length
                                  ? 'Select a file from the list to preview it.'
                                  : 'No assignment files uploaded yet.'}
                              </Typography>
                            </Stack>
                          )}
                        </Stack>
                      </Paper>
                    </Stack>
                  ) : (
                    <Paper
                      elevation={0}
                      sx={{
                        p: { xs: 2, md: 2.5 },
                        borderRadius: 2.5,
                        border: '1px dashed',
                        borderColor: 'primary.light',
                        background:
                          'linear-gradient(135deg, rgba(59, 130, 246, 0.06) 0%, rgba(255, 255, 255, 0.96) 70%)',
                      }}
                    >
                      <Stack
                        direction={{ xs: 'column', md: 'row' }}
                        spacing={1.5}
                        alignItems={{ xs: 'flex-start', md: 'center' }}
                        justifyContent="space-between"
                      >
                        <Stack direction="row" spacing={1.25} alignItems="center">
                          <Box
                            sx={{
                              width: 40,
                              height: 40,
                              borderRadius: 2,
                              display: 'grid',
                              placeItems: 'center',
                              backgroundColor: 'rgba(79, 70, 229, 0.12)',
                              color: 'primary.main',
                              flexShrink: 0,
                            }}
                          >
                            <InsertDriveFileRounded fontSize="small" />
                          </Box>
                          <Box>
                            <Typography variant="body1" sx={{ fontWeight: 800 }}>
                              No assignment files yet
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {canManage
                                ? 'Add the PDF prompt, starter notes, or any handout students should read before they begin.'
                                : 'The instructor has not attached any files to this assignment yet.'}
                            </Typography>
                          </Box>
                        </Stack>
                      </Stack>
                    </Paper>
                  )}
                </Stack>
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
              </Stack>
            ) : null}

            {activeTab === 1 ? (
              <Stack spacing={2}>
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>
                    Rubric
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <Chip label={`v${rubric.version_number || 0}`} size="small" />
                    <Chip label={rubric.is_weighted ? 'Weighted' : 'Unweighted'} size="small" variant="outlined" />
                    <Chip
                      label={`${canManage ? totalRubricPoints : (Number(rubric.total_points) || 0)} total points`}
                      size="small"
                      variant="outlined"
                    />
                    {(canManage ? rubricForm.is_weighted : rubric.is_weighted) ? (
                      <Chip
                        label={`Weight ${canManage ? totalRubricWeight : (Number(rubric.total_weight) || 0)}`}
                        size="small"
                        variant="outlined"
                      />
                    ) : null}
                  </Stack>
                </Stack>
                {canManage ? (
                  <>
                    {rubricVersionsError ? <Alert severity="error">{rubricVersionsError}</Alert> : null}
                    {rubricError ? <Alert severity="error">{rubricError}</Alert> : null}
                    {rubricTemplatesError ? <Alert severity="error">{rubricTemplatesError}</Alert> : null}
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 320px' },
                        gap: 2,
                        alignItems: 'start',
                      }}
                    >
                      <Paper
                        elevation={0}
                        sx={{
                          p: 2,
                          borderRadius: 2,
                          border: '1px solid',
                          borderColor: 'divider',
                          backgroundColor: 'background.paper',
                        }}
                      >
                        <Stack spacing={2}>
                          <Stack
                            direction={{ xs: 'column', md: 'row' }}
                            spacing={1.5}
                            alignItems={{ xs: 'stretch', md: 'center' }}
                            justifyContent="space-between"
                          >
                            <Box>
                              <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                                Rubric editor
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                Define the criteria and point model used when staff grade submissions.
                              </Typography>
                            </Box>
                            <ToggleButtonGroup
                              size="small"
                              exclusive
                              value={rubricForm.is_weighted ? 'WEIGHTED' : 'UNWEIGHTED'}
                              onChange={(_event, value) => {
                                if (!value) return
                                setRubricForm((prev) => ({
                                  ...prev,
                                  is_weighted: value === 'WEIGHTED',
                                  criteria: prev.criteria.map((criterion) => ({
                                    ...criterion,
                                    weight: value === 'WEIGHTED' ? criterion.weight : '',
                                  })),
                                }))
                              }}
                            >
                              <ToggleButton value="UNWEIGHTED">Unweighted</ToggleButton>
                              <ToggleButton value="WEIGHTED">Weighted</ToggleButton>
                            </ToggleButtonGroup>
                          </Stack>
                          <Typography variant="body2" color="text.secondary">
                            {rubricForm.is_weighted
                              ? 'Every criterion needs points and a positive weight.'
                              : 'Use points only. Weights are ignored.'}
                          </Typography>
                          <Stack spacing={1.1}>
                            {rubricForm.criteria.length === 0 ? (
                              <Box
                                sx={{
                                  p: 2,
                                  borderRadius: 2,
                                  border: '1px dashed',
                                  borderColor: 'divider',
                                  backgroundColor: 'rgba(248,250,252,0.7)',
                                }}
                              >
                                <Stack spacing={2}>
                                  <Stack spacing={0.35}>
                                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                                      Set up this rubric
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                      Start from a template or define criteria manually.
                                    </Typography>
                                  </Stack>

                                  {rubricTemplatesLoading ? (
                                    <Typography variant="caption" color="text.secondary">Loading templates…</Typography>
                                  ) : (
                                    <Stack spacing={1.5}>
                                      {/* Standard templates */}
                                      {rubricTemplates.filter((t) => t.scope === 'SYSTEM').length > 0 && (
                                        <Stack spacing={0.75}>
                                          <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary' }}>
                                            Standard templates
                                          </Typography>
                                          <Box
                                            sx={{
                                              display: 'grid',
                                              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                                              gap: 1,
                                            }}
                                          >
                                            {rubricTemplates.filter((t) => t.scope === 'SYSTEM').map((template) => (
                                              <Paper
                                                key={template.id}
                                                variant="outlined"
                                                onClick={() => applyTemplateDirectly(template)}
                                                sx={{
                                                  p: 1.25,
                                                  borderRadius: 2,
                                                  cursor: 'pointer',
                                                  transition: 'border-color 0.15s, box-shadow 0.15s',
                                                  '&:hover': {
                                                    borderColor: 'primary.main',
                                                    boxShadow: '0 0 0 1px',
                                                    boxShadowColor: 'primary.main',
                                                  },
                                                }}
                                              >
                                                <Stack spacing={0.5}>
                                                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                                                    <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
                                                      {template.name}
                                                    </Typography>
                                                    <Stack direction="row" spacing={0.5} sx={{ ml: 0.5, flexShrink: 0 }}>
                                                      <Chip size="small" label="Standard" color="primary" sx={{ fontSize: 9, height: 18 }} />
                                                      {rubricTemplateHasScoringGuide(template) ? (
                                                        <Chip size="small" label="Guide" variant="outlined" sx={{ fontSize: 9, height: 18 }} />
                                                      ) : null}
                                                    </Stack>
                                                  </Stack>
                                                  <Typography variant="caption" color="text.secondary">
                                                    {template.active_version?.criteria_count || 0} criteria · {template.active_version?.total_points || 0} pts
                                                  </Typography>
                                                  <Stack spacing={0.2}>
                                                    {(template.active_version?.criteria || []).slice(0, 3).map((c) => (
                                                      <Typography key={c.id} variant="caption" color="text.disabled" noWrap>
                                                        · {c.name}
                                                      </Typography>
                                                    ))}
                                                  </Stack>
                                                </Stack>
                                              </Paper>
                                            ))}
                                          </Box>
                                        </Stack>
                                      )}

                                      {/* Course templates */}
                                      {rubricTemplates.filter((t) => t.scope === 'COURSE').length > 0 && (
                                        <Stack spacing={0.75}>
                                          <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary' }}>
                                            Course templates
                                          </Typography>
                                          <Box
                                            sx={{
                                              display: 'grid',
                                              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                                              gap: 1,
                                            }}
                                          >
                                            {rubricTemplates.filter((t) => t.scope === 'COURSE').map((template) => (
                                              <Paper
                                                key={template.id}
                                                variant="outlined"
                                                onClick={() => applyTemplateDirectly(template)}
                                                sx={{
                                                  p: 1.25,
                                                  borderRadius: 2,
                                                  cursor: 'pointer',
                                                  transition: 'border-color 0.15s, box-shadow 0.15s',
                                                  '&:hover': { borderColor: 'primary.main' },
                                                }}
                                              >
                                                <Stack spacing={0.5}>
                                                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                                                    <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
                                                      {template.name}
                                                    </Typography>
                                                    <Stack direction="row" spacing={0.5} sx={{ ml: 0.5, flexShrink: 0 }}>
                                                      <Chip size="small" label={`v${template.active_version?.version_number || 1}`} variant="outlined" sx={{ fontSize: 9, height: 18 }} />
                                                      {rubricTemplateHasScoringGuide(template) ? (
                                                        <Chip size="small" label="Guide" variant="outlined" sx={{ fontSize: 9, height: 18 }} />
                                                      ) : null}
                                                    </Stack>
                                                  </Stack>
                                                  <Typography variant="caption" color="text.secondary">
                                                    {template.active_version?.criteria_count || 0} criteria · {template.active_version?.total_points || 0} pts
                                                  </Typography>
                                                </Stack>
                                              </Paper>
                                            ))}
                                          </Box>
                                        </Stack>
                                      )}
                                    </Stack>
                                  )}

                                  <Typography variant="caption" color="text.secondary">
                                    Or skip templates and use <strong>+ Add criterion</strong> below to build from scratch.
                                  </Typography>
                                </Stack>
                              </Box>
                            ) : null}
                            {rubricForm.criteria.map((criterion, index) => (
                              <Paper
                                key={`criterion-${index}`}
                                elevation={0}
                                sx={{
                                  borderRadius: 2,
                                  border: '1px solid',
                                  borderColor: 'divider',
                                  backgroundColor: 'background.paper',
                                  overflow: 'hidden',
                                }}
                              >
                                <Stack spacing={1.25} sx={{ p: 1.5 }}>
                                  <Stack direction="row" spacing={1} alignItems="center">
                                    <Chip size="small" label={`#${index + 1}`} variant="outlined" />
                                    <TextField
                                      label="Criterion"
                                      value={criterion.name}
                                      onChange={(event) => handleCriterionChange(index, 'name', event.target.value)}
                                      fullWidth
                                    />
                                    <Tooltip title="Remove criterion">
                                      <IconButton color="error" onClick={() => handleRemoveCriterion(index)}>
                                        <DeleteRounded />
                                      </IconButton>
                                    </Tooltip>
                                  </Stack>
                                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems="center">
                                    <TextField
                                      label="Points"
                                      type="number"
                                      value={criterion.max_points}
                                      onChange={(event) => handleCriterionChange(index, 'max_points', event.target.value)}
                                      sx={{ width: { xs: '100%', sm: 150 } }}
                                    />
                                    {rubricForm.is_weighted ? (
                                      <TextField
                                        label="Weight"
                                        type="number"
                                        value={criterion.weight}
                                        onChange={(event) => handleCriterionChange(index, 'weight', event.target.value)}
                                        sx={{ width: { xs: '100%', sm: 150 } }}
                                      />
                                    ) : null}
                                    <Button
                                      size="small"
                                      onClick={() => setRubricLevelsOpen((prev) => ({ ...prev, [index]: !prev[index] }))}
                                      endIcon={
                                        <ExpandMoreRounded
                                          fontSize="small"
                                          sx={{
                                            transform: rubricLevelsOpen[index] ? 'rotate(180deg)' : 'rotate(0deg)',
                                            transition: 'transform 0.2s',
                                          }}
                                        />
                                      }
                                      sx={{ textTransform: 'none', ml: 'auto', flexShrink: 0 }}
                                    >
                                      Scoring guide {criterion.levels?.length ? `(${criterion.levels.length})` : ''}
                                    </Button>
                                  </Stack>
                                </Stack>
                                <Collapse in={Boolean(rubricLevelsOpen[index])}>
                                  <Box sx={{ borderTop: '1px solid', borderColor: 'divider', px: 1.5, py: 1.25, backgroundColor: 'grey.50' }}>
                                    <Stack spacing={1}>
                                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                                        Scoring levels — when an instructor enters a score in this range, the level description is suggested as a comment.
                                      </Typography>
                                      {(criterion.levels || []).map((level, li) => (
                                        <Stack key={li} direction="row" spacing={1} alignItems="flex-start">
                                          <TextField
                                            label="Label"
                                            value={level.label}
                                            onChange={(e) => handleLevelChange(index, li, 'label', e.target.value)}
                                            size="small"
                                            sx={{ width: 120 }}
                                            placeholder="e.g. Excellent"
                                          />
                                          <TextField
                                            label="Min pts"
                                            type="number"
                                            value={level.min_points}
                                            onChange={(e) => handleLevelChange(index, li, 'min_points', e.target.value)}
                                            size="small"
                                            sx={{ width: 80 }}
                                          />
                                          <TextField
                                            label="Max pts"
                                            type="number"
                                            value={level.max_points}
                                            onChange={(e) => handleLevelChange(index, li, 'max_points', e.target.value)}
                                            size="small"
                                            sx={{ width: 80 }}
                                          />
                                          <TextField
                                            label="Comment to suggest"
                                            value={level.description}
                                            onChange={(e) => handleLevelChange(index, li, 'description', e.target.value)}
                                            size="small"
                                            sx={{ flex: 1 }}
                                            placeholder="e.g. Excellent work, meets all requirements."
                                          />
                                          <IconButton size="small" color="error" onClick={() => handleRemoveLevel(index, li)}>
                                            <DeleteRounded fontSize="small" />
                                          </IconButton>
                                        </Stack>
                                      ))}
                                      <Button
                                        size="small"
                                        onClick={() => handleAddLevel(index)}
                                        sx={{ alignSelf: 'flex-start', textTransform: 'none' }}
                                      >
                                        + Add level
                                      </Button>
                                    </Stack>
                                  </Box>
                                </Collapse>
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
                        </Stack>
                      </Paper>
                      <Stack spacing={2}>
                        <Paper
                          elevation={0}
                          sx={{
                            p: 2,
                            borderRadius: 2,
                            border: '1px solid',
                            borderColor: 'divider',
                            backgroundColor: 'background.paper',
                          }}
                        >
                          <Stack spacing={1.25}>
                            <Stack spacing={0.35}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                                Template library
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                Start from a standard rubric or save this draft as a reusable course template.
                              </Typography>
                            </Stack>
                            <FormControl size="small" fullWidth disabled={rubricTemplatesLoading}>
                              <InputLabel id="rubric-template-select-label">Template</InputLabel>
                              <Select
                                labelId="rubric-template-select-label"
                                label="Template"
                                value={selectedRubricTemplateId || ''}
                                onChange={(event) => setSelectedRubricTemplateId(event.target.value)}
                              >
                                <MenuItem value="">Choose template</MenuItem>
                                {rubricTemplates.map((template) => (
                                  <MenuItem key={template.id} value={template.id}>
                                    {`${template.scope === 'SYSTEM' ? 'Standard' : 'Course'} • ${template.name}`}
                                  </MenuItem>
                                ))}
                              </Select>
                            </FormControl>
                            {selectedRubricTemplate ? (
                              <Stack spacing={1}>
                                <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                                  <Chip
                                    size="small"
                                    color={selectedRubricTemplate.scope === 'SYSTEM' ? 'primary' : 'default'}
                                    label={selectedRubricTemplate.scope === 'SYSTEM' ? 'Standard' : 'Course template'}
                                  />
                                  <Chip
                                    size="small"
                                    variant="outlined"
                                    label={`v${selectedRubricTemplate.active_version?.version_number || 0}`}
                                  />
                                  <Chip
                                    size="small"
                                    variant="outlined"
                                    label={selectedRubricTemplate.active_version?.is_weighted ? 'Weighted' : 'Unweighted'}
                                  />
                                </Stack>
                                {selectedRubricTemplate.description ? (
                                  <Typography variant="body2" color="text.secondary">
                                    {selectedRubricTemplate.description}
                                  </Typography>
                                ) : null}
                                {selectedRubricTemplate.active_version ? (
                                  <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                                    <Typography variant="caption" color="text.secondary">
                                      {`${selectedRubricTemplate.active_version.criteria_count || 0} criteria • ${selectedRubricTemplate.active_version.total_points || 0} pts${selectedRubricTemplate.active_version.is_weighted ? ` • ${selectedRubricTemplate.active_version.total_weight || 0} wt` : ''}`}
                                    </Typography>
                                    {rubricTemplateHasScoringGuide(selectedRubricTemplate) ? (
                                      <Chip size="small" label="Includes scoring guide" variant="outlined" />
                                    ) : null}
                                  </Stack>
                                ) : null}
                                {selectedRubricTemplate.active_version?.criteria?.length ? (
                                  <Stack
                                    spacing={0.9}
                                    sx={{
                                      maxHeight: 320,
                                      overflowY: 'auto',
                                      pr: 0.5,
                                    }}
                                  >
                                    {selectedRubricTemplate.active_version.criteria.map((criterion) => (
                                      <Paper
                                        key={`${selectedRubricTemplate.id}-${criterion.order_index}`}
                                        variant="outlined"
                                        sx={{
                                          p: 1,
                                          borderRadius: 2,
                                          bgcolor: 'grey.50',
                                        }}
                                      >
                                        <Stack spacing={0.8}>
                                          <Stack direction="row" justifyContent="space-between" spacing={1}>
                                            <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                              {criterion.name}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                                              {criterion.max_points} pts
                                            </Typography>
                                          </Stack>
                                          {(criterion.levels || []).length > 0 ? (
                                            <Stack spacing={0.6}>
                                              {(criterion.levels || []).map((level) => (
                                                <Box
                                                  key={level.id || `${criterion.id}-${level.order_index}`}
                                                  sx={{
                                                    borderRadius: 1.5,
                                                    border: '1px solid',
                                                    borderColor: 'divider',
                                                    bgcolor: 'background.paper',
                                                    px: 1,
                                                    py: 0.8,
                                                  }}
                                                >
                                                  <Stack spacing={0.35}>
                                                    <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                                                      <Chip
                                                        size="small"
                                                        label={level.label}
                                                        sx={{ height: 20, fontSize: 10, fontWeight: 700, bgcolor: 'primary.50', color: 'primary.main' }}
                                                      />
                                                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                                                        {formatRubricPointRange(level.min_points, level.max_points)}
                                                      </Typography>
                                                    </Stack>
                                                    {level.description ? (
                                                      <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.45 }}>
                                                        {level.description}
                                                      </Typography>
                                                    ) : null}
                                                  </Stack>
                                                </Box>
                                              ))}
                                            </Stack>
                                          ) : (
                                            <Typography variant="caption" color="text.secondary">
                                              No scoring guide defined for this criterion.
                                            </Typography>
                                          )}
                                        </Stack>
                                      </Paper>
                                    ))}
                                  </Stack>
                                ) : null}
                                <Button
                                  variant="contained"
                                  onClick={handleApplyRubricTemplateToEditor}
                                  disabled={!selectedRubricTemplate.active_version}
                                  fullWidth
                                >
                                  Load into editor
                                </Button>
                                {selectedRubricTemplate.is_editable ? (
                                  <Stack direction="row" spacing={1} alignItems="center">
                                    <Button
                                      variant="text"
                                      onClick={openUpdateRubricTemplateDialog}
                                      sx={{ px: 0, textTransform: 'none' }}
                                    >
                                      Update template
                                    </Button>
                                    <Box sx={{ flex: 1 }} />
                                    <Button
                                      variant="text"
                                      color="error"
                                      onClick={handleDeleteRubricTemplate}
                                      disabled={rubricTemplateDeleting}
                                      sx={{ px: 0, textTransform: 'none' }}
                                    >
                                      {rubricTemplateDeleting ? 'Deleting…' : 'Delete'}
                                    </Button>
                                  </Stack>
                                ) : (
                                  <Typography variant="caption" color="text.secondary">
                                    Standard templates are read-only. Load one, adapt it, then save as a course template below.
                                  </Typography>
                                )}
                              </Stack>
                            ) : (
                              <Typography variant="body2" color="text.secondary">
                                {rubricTemplatesLoading
                                  ? 'Loading rubric templates…'
                                  : 'Choose a template above to prefill the editor.'}
                              </Typography>
                            )}
                            <Divider />
                            <Button
                              variant="outlined"
                              onClick={openCreateRubricTemplateDialog}
                              fullWidth
                              sx={{ textTransform: 'none' }}
                            >
                              Save current as template
                            </Button>
                          </Stack>
                        </Paper>
                        <Paper
                          elevation={0}
                          sx={{
                            p: 2,
                            borderRadius: 2,
                            border: '1px solid',
                            borderColor: 'divider',
                            backgroundColor: 'background.paper',
                          }}
                        >
                          <Stack spacing={1.25}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                              Active version
                            </Typography>
                            <FormControl size="small" fullWidth>
                              <InputLabel id="rubric-version-label">Version</InputLabel>
                              <Select
                                labelId="rubric-version-label"
                                label="Version"
                                value={rubricSelectedVersion || ''}
                                onChange={(event) => setRubricSelectedVersion(event.target.value)}
                              >
                                {rubricVersions.length === 0 ? (
                                  <MenuItem value="">No versions</MenuItem>
                                ) : (
                                  rubricVersions.map((version) => (
                                    <MenuItem key={version.id} value={version.id}>
                                      {`v${version.version_number} • ${version.is_weighted ? 'Weighted' : 'Unweighted'} • ${version.total_points} pts${version.is_weighted ? ` • ${version.total_weight} wt` : ''}`}
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
                              {rubricActivating ? 'Updating…' : 'Use this rubric'}
                            </Button>
                          </Stack>
                        </Paper>
                        <Paper
                          elevation={0}
                          sx={{
                            p: 2,
                            borderRadius: 2,
                            border: '1px solid',
                            borderColor: 'divider',
                            backgroundColor: 'background.paper',
                          }}
                        >
                          <Stack spacing={1.1}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
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
                                    p: 1.25,
                                    borderRadius: 2,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 1,
                                  }}
                                >
                                  <Stack spacing={0.35} sx={{ minWidth: 0 }}>
                                    <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                                      <Chip
                                        label={`v${version.version_number}`}
                                        size="small"
                                        color={version.is_active ? 'primary' : 'default'}
                                        variant={version.is_active ? 'filled' : 'outlined'}
                                      />
                                      <Chip
                                        label={version.is_weighted ? 'Weighted' : 'Unweighted'}
                                        size="small"
                                        variant="outlined"
                                      />
                                    </Stack>
                                    <Typography variant="caption" color="text.secondary">
                                      {`${version.criteria_count} criteria • ${version.total_points} pts${version.is_weighted ? ` • ${version.total_weight} wt` : ''}`}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                      {new Date(version.created_at).toLocaleString()}
                                    </Typography>
                                  </Stack>
                                  <Button
                                    size="small"
                                    variant="text"
                                    onClick={() => setRubricSelectedVersion(version.id)}
                                  >
                                    Choose
                                  </Button>
                                </Paper>
                              ))
                            )}
                          </Stack>
                        </Paper>
                      </Stack>
                    </Box>
                  </>
                ) : (
                  <Stack spacing={1.5}>
                    {rubricError ? <Alert severity="error">{rubricError}</Alert> : null}
                    <Paper
                      elevation={0}
                      sx={{
                        p: 1.75,
                        borderRadius: 2,
                        border: '1px solid',
                        borderColor: 'divider',
                        backgroundColor: 'background.paper',
                      }}
                    >
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <Chip label={`v${rubric.version_number || 0}`} size="small" />
                        <Chip label={rubric.is_weighted ? 'Weighted' : 'Unweighted'} size="small" variant="outlined" />
                        <Chip label={`${Number(rubric.total_points) || 0} total points`} size="small" variant="outlined" />
                        {rubric.is_weighted ? (
                          <Chip label={`${Number(rubric.total_weight) || 0} wt`} size="small" variant="outlined" />
                        ) : null}
                      </Stack>
                    </Paper>
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
                          <Stack spacing={0.25}>
                            <Typography sx={{ fontWeight: 600 }}>{criterion.name}</Typography>
                            {rubric.is_weighted && criterion.weight != null ? (
                              <Typography variant="caption" color="text.secondary">
                                {criterion.weight} wt
                              </Typography>
                            ) : null}
                          </Stack>
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
                        ? 'Set up and manage the test versions used for grading.'
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
                    {inlineBuilderOpen && inlineBuilderSupported ? (
                      <CourseTestSuiteBuilder
                        key={inlineBuilderEditVersionId || 'new-inline-suite'}
                        user={user}
                        embedded
                        editVersionId={inlineBuilderEditVersionId}
                        onCancel={closeInlineBuilder}
                        onPublished={handleInlineBuilderPublished}
                      />
                    ) : (
                      <Paper
                        variant="outlined"
                        sx={{
                          p: 1.75,
                          borderRadius: 2,
                          backgroundColor: 'rgba(248, 250, 252, 0.9)',
                        }}
                      >
                        <Stack spacing={1.5}>
                          <Stack
                            direction={{ xs: 'column', md: 'row' }}
                            spacing={1.5}
                            alignItems={{ xs: 'stretch', md: 'center' }}
                          >
                            <Box sx={{ flex: 1 }}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                                Set up tests
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                {inlineBuilderSupported
                                  ? 'Use the guided editor here to define grading files, cases, and expected results.'
                                  : 'Guided setup currently supports Python and Java assignments. Use prepared-suite import for this assignment language.'}
                              </Typography>
                            </Box>
                            {inlineBuilderSupported ? (
                              <Button variant="contained" onClick={() => openInlineBuilder()}>
                                Set up tests
                              </Button>
                            ) : (
                              <Button variant="contained" onClick={() => setShowImportSuite((prev) => !prev)}>
                                {showImportSuite ? 'Hide import' : 'Import prepared suite'}
                              </Button>
                            )}
                          </Stack>
                          {!inlineBuilderSupported ? (
                            <Alert severity="warning">
                              Guided setup currently supports Python and Java assignment languages.
                            </Alert>
                          ) : null}
                        </Stack>
                      </Paper>
                    )}

                    <Stack
                      direction={{ xs: 'column', md: 'row' }}
                      spacing={1}
                      alignItems={{ xs: 'flex-start', md: 'center' }}
                    >
                      <Chip label={`${testSuiteStats.private} private`} size="small" variant="outlined" />
                      <Chip label={`${testSuiteStats.public} public`} size="small" variant="outlined" />
                      {testSuites.length ? (
                        <Typography variant="caption" color="text.secondary">
                          Latest upload {new Date(testSuites[0].created_at).toLocaleString()}
                        </Typography>
                      ) : null}
                      <Box sx={{ flex: 1 }} />
                      <Button size="small" variant="text" onClick={() => setShowTemplateTools((prev) => !prev)}>
                        {showTemplateTools ? 'Hide template downloads' : 'Template downloads'}
                      </Button>
                    </Stack>

                    <Collapse in={!inlineBuilderSupported && showImportSuite}>
                      <Paper
                        variant="outlined"
                        sx={{
                          p: 1.75,
                          borderRadius: 2,
                          backgroundColor: 'rgba(248, 250, 252, 0.9)',
                        }}
                      >
                        <Stack spacing={1.25}>
                          <Box>
                            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                              Import prepared suite
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              Use this only when you already have a prepared suite bundle or source set built elsewhere.
                            </Typography>
                          </Box>

                          <Stack
                            direction={{ xs: 'column', md: 'row' }}
                            spacing={1.25}
                            alignItems={{ xs: 'stretch', md: 'center' }}
                            sx={{
                              p: 1.25,
                              borderRadius: 2.5,
                              border: '1px dashed',
                              borderColor: 'primary.light',
                              background:
                                'linear-gradient(135deg, rgba(59, 130, 246, 0.06) 0%, rgba(255, 255, 255, 0.94) 65%)',
                            }}
                          >
                            <Stack
                              direction={{ xs: 'column', md: 'row' }}
                              spacing={1.25}
                              alignItems={{ xs: 'stretch', md: 'center' }}
                              sx={{ width: '100%' }}
                            >
                              <Stack direction="row" spacing={1.25} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
                                <Box
                                  sx={{
                                    width: 34,
                                    height: 34,
                                    borderRadius: 1.5,
                                    display: 'grid',
                                    placeItems: 'center',
                                    backgroundColor: 'rgba(79, 70, 229, 0.14)',
                                    color: 'primary.main',
                                    flexShrink: 0,
                                  }}
                                >
                                  <UploadRounded fontSize="small" />
                                </Box>
                                <Box sx={{ minWidth: 0 }}>
                                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                    {selectedZipFile ? 'Prepared suite selected' : 'Choose suite files'}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                    {selectedZipFile
                                      ? selectedZipFile.name
                                      : testSuiteFiles.length
                                        ? `${testSuiteFiles.length} file(s) selected`
                                        : 'Pick one .zip or multiple prepared source files (auto-zipped).'}
                                  </Typography>
                                </Box>
                              </Stack>
                              <Button variant="outlined" component="label">
                                Browse files
                                <input
                                  type="file"
                                  multiple
                                  hidden
                                  onChange={(event) => {
                                    setTestSuiteFiles(Array.from(event.target.files || []))
                                    setTestSuiteError('')
                                    setShowImportSuite(true)
                                    event.target.value = ''
                                  }}
                                />
                              </Button>
                              {testSuiteFiles.length > 0 ? (
                                <Button
                                  size="small"
                                  variant="text"
                                  color="inherit"
                                  onClick={handleClearSelectedTestSuiteFiles}
                                  sx={{ flexShrink: 0 }}
                                >
                                  Clear
                                </Button>
                              ) : null}
                            </Stack>
                          </Stack>

                          <Stack
                            direction={{ xs: 'column', md: 'row' }}
                            spacing={1.25}
                            alignItems={{ xs: 'stretch', md: 'center' }}
                          >
                            {showBundleNameField ? (
                              <TextField
                                size="small"
                                label="Bundle name (optional)"
                                value={testSuiteBundleName}
                                onChange={(event) => setTestSuiteBundleName(event.target.value)}
                                placeholder="uploaded-files"
                                sx={{ minWidth: 260 }}
                              />
                            ) : null}
                            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
                              {selectedZipFile ? (
                                <Chip label="Zip upload" size="small" color="primary" variant="outlined" />
                              ) : testSuiteFiles.length ? (
                                <Chip label="Raw files (auto-zip)" size="small" color="primary" variant="outlined" />
                              ) : null}
                              {testSuiteFiles.length > 0 ? (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  sx={{
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    minWidth: 0,
                                  }}
                                >
                                  {testSuiteFiles.map((file) => file.name).join(', ')}
                                </Typography>
                              ) : null}
                            </Stack>
                            <Button
                              variant="contained"
                              startIcon={<UploadRounded />}
                              onClick={handleUploadTestSuite}
                              disabled={testSuiteUploading || !canUploadSelection}
                              sx={{ minWidth: 148 }}
                            >
                              {testSuiteUploading ? 'Importing…' : 'Import suite'}
                            </Button>
                          </Stack>

                          <Stack direction="row" spacing={1} alignItems="center">
                            <Button
                              size="small"
                              variant="text"
                              onClick={() => setShowUploadAdvanced((prev) => !prev)}
                            >
                              {showUploadAdvanced ? 'Hide import settings' : 'Import settings'}
                            </Button>
                          </Stack>

                          {hasMixedUploadSelection ? (
                            <Alert severity="warning">
                              Upload either one `.zip` file or multiple raw files, not both.
                            </Alert>
                          ) : null}
                          {selectedZipCount > 1 ? (
                            <Alert severity="warning">
                              Upload one `.zip` file at a time.
                            </Alert>
                          ) : null}

                          <Collapse in={showUploadAdvanced}>
                            <Stack
                              direction={{ xs: 'column', md: 'row' }}
                              spacing={1.25}
                              alignItems={{ xs: 'stretch', md: 'center' }}
                              sx={{ pt: 0.5 }}
                            >
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
                              <FormControl size="small" sx={{ minWidth: 220 }}>
                                <InputLabel id="test-execution-mode-label">Execution mode</InputLabel>
                                <Select
                                  labelId="test-execution-mode-label"
                                  label="Execution mode"
                                  value={testSuiteExecutionMode}
                                  onChange={(event) => setTestSuiteExecutionMode(event.target.value)}
                                >
                                  <MenuItem value="AUTO">Auto-detect</MenuItem>
                                  <MenuItem value="LANGUAGE_TEMPLATE">Language template</MenuItem>
                                  <MenuItem value="PYTHON_RUNNER">Python runner</MenuItem>
                                </Select>
                              </FormControl>
                            </Stack>
                          </Collapse>
                        </Stack>
                      </Paper>
                    </Collapse>

                    <Collapse in={showTemplateTools}>
                      <Paper
                        variant="outlined"
                        sx={{
                          p: 1.5,
                          borderRadius: 2,
                          backgroundColor: 'rgba(248, 250, 252, 0.9)',
                        }}
                      >
                        <Stack spacing={1.25}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                            Template downloads
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Optional starter zip templates for manual test authoring.
                          </Typography>
                          <Stack
                            direction={{ xs: 'column', md: 'row' }}
                            spacing={1.25}
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
                            <Alert severity="error">{templateError}</Alert>
                          ) : null}
                        </Stack>
                      </Paper>
                    </Collapse>
                  </>
                ) : null}
                <Divider />
                <Stack spacing={1.25}>
                  {canManage ? (
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} alignItems={{ xs: 'stretch', md: 'center' }} justifyContent="space-between">
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        Uploaded versions
                      </Typography>
                      <ToggleButtonGroup
                        size="small"
                        exclusive
                        value={testSuiteFilter}
                        onChange={(_event, value) => {
                          if (value) setTestSuiteFilter(value)
                        }}
                      >
                        <ToggleButton value="ALL">All</ToggleButton>
                        <ToggleButton value="ACTIVE">Active</ToggleButton>
                        <ToggleButton value="PUBLIC">Public</ToggleButton>
                        <ToggleButton value="PRIVATE">Private</ToggleButton>
                      </ToggleButtonGroup>
                    </Stack>
                  ) : null}
                  {filteredTestSuites.length === 0 ? (
                    <Typography color="text.secondary">No test suites uploaded yet.</Typography>
                  ) : (
                    <Stack spacing={1}>
                      {filteredTestSuites.map((version) => (
                        <Paper
                          key={version.id}
                          variant="outlined"
                          sx={{
                            px: 1.5,
                            py: 1.35,
                            borderRadius: 3,
                            backgroundColor: version.is_active ? 'rgba(37, 99, 235, 0.04)' : 'rgba(255, 255, 255, 0.9)',
                            borderColor: version.is_active ? 'rgba(99, 102, 241, 0.22)' : 'divider',
                          }}
                        >
                          <Stack
                            direction="row"
                            spacing={1.5}
                            alignItems="flex-start"
                            justifyContent="space-between"
                          >
                            <Stack spacing={0.6} sx={{ minWidth: 0, flex: 1 }}>
                              <Stack
                                direction={{ xs: 'column', sm: 'row' }}
                                spacing={1}
                                alignItems={{ xs: 'flex-start', sm: 'center' }}
                                sx={{ minWidth: 0 }}
                              >
                                <Typography variant="body1" sx={{ fontWeight: 800 }}>
                                  v{version.version_number}
                                </Typography>
                                <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                                  {version.is_active ? (
                                    <Chip
                                      label="Active"
                                      size="small"
                                      color="primary"
                                      sx={{ height: 24, fontWeight: 700 }}
                                    />
                                  ) : null}
                                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                                    {version.visibility === 'PRIVATE' ? 'Private' : 'Public'}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    •
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {new Date(version.created_at).toLocaleString()}
                                  </Typography>
                                </Stack>
                              </Stack>
                              <Typography
                                variant="body2"
                                sx={{
                                  fontWeight: 700,
                                  color: 'text.primary',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: { xs: 'normal', md: 'nowrap' },
                                  wordBreak: 'break-word',
                                }}
                              >
                                {(version.bundle_key || '').split('/').pop()}
                              </Typography>
                            </Stack>

                            <RowActionsMenu
                              items={[
                                canManage
                                  ? {
                                      key: 'activate',
                                      label: version.is_active ? 'Already active' : 'Set active',
                                      onClick: version.is_active ? undefined : () => handleActivateTestSuite(version.id),
                                      disabled: version.is_active,
                                    }
                                  : null,
                                canManage
                                  ? {
                                      key: 'edit',
                                      label: 'Edit',
                                      onClick: () => openInlineBuilder(version.id),
                                      icon: <EditRounded fontSize="small" />,
                                      disabled: false,
                                    }
                                  : null,
                                {
                                  key: 'preview',
                                  label: 'Preview',
                                  onClick: () => setPreviewSuite(version),
                                  icon: <VisibilityRounded fontSize="small" />,
                                },
                                {
                                  key: 'download',
                                  label: 'Download',
                                  onClick: () =>
                                    window.open(`${API_BASE}/media/${version.bundle_key}`, '_blank', 'noopener,noreferrer'),
                                  icon: <DownloadRounded fontSize="small" />,
                                },
                              ].filter(Boolean)}
                            />
                          </Stack>
                        </Paper>
                      ))}
                    </Stack>
                  )}
                </Stack>
              </Stack>
            ) : null}

            {canManage && activeTab === integrityTabIndex ? (
              <CourseAssignmentIntegrity assignmentId={assignmentId} courseId={courseId} />
            ) : null}

            {activeTab === submissionsTabIndex ? (
              <CourseSubmissions
                user={user}
                fixedAssignmentId={assignmentId}
                assignmentTitle={assignment.title}
                assignment={assignment}
                embedded
              />
            ) : null}

            {canManage && activeTab === settingsTabIndex ? (
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
                      <Typography color="text.secondary">Submission mode</Typography>
                      <Typography>{getAssignmentSubmissionModeLabel(assignment)}</Typography>
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
                      <Typography color="text.secondary">Submission mode</Typography>
                      <Typography>{getAssignmentSubmissionModeLabel(assignment)}</Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Language</Typography>
                      <Typography>{assignment.language_name || '—'}</Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Submission type</Typography>
                      <Typography>{assignment.allow_groups ? 'Group' : 'Individual'}</Typography>
                    </Stack>
                    {assignment.allow_groups ? (
                      <>
                        <Stack direction="row" justifyContent="space-between">
                          <Typography color="text.secondary">Allowed groups</Typography>
                          <Typography sx={{ textAlign: 'right' }}>
                            {assignment.group_set_name
                              ? assignment.group_set_name
                              : (assignment.assignment_groups || []).length
                                ? assignment.assignment_groups.map((group) => group.name).join(', ')
                                : '—'}
                          </Typography>
                        </Stack>
                      </>
                    ) : null}
                  </Stack>
                </SectionCard>
              </Stack>
            ) : null}
          </Paper>
        </Stack>
      </Container>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
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
            <AssignmentInstructionsEditor
              value={form.instructions}
              onChange={(value) => setForm((current) => ({ ...current, instructions: value }))}
              helperText="Update the assignment brief, submission format, examples, or starter guidance here."
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
            <FormControl size="small" fullWidth>
              <InputLabel id="detail-submission-type-label">Submission type</InputLabel>
              <Select
                labelId="detail-submission-type-label"
                label="Submission type"
                value={form.allow_groups ? 'GROUP' : 'INDIVIDUAL'}
                onChange={(event) =>
                  setForm({
                    ...form,
                    allow_groups: event.target.value === 'GROUP',
                    group_mode: event.target.value === 'GROUP' ? 'REUSABLE_SET' : 'PER_ASSIGNMENT',
                    group_set_id: event.target.value === 'GROUP' ? form.group_set_id : '',
                    assignment_group_ids: event.target.value === 'GROUP' ? form.assignment_group_ids : [],
                  })
                }
              >
                <MenuItem value="INDIVIDUAL">Individual submissions</MenuItem>
                <MenuItem value="GROUP">Group submissions</MenuItem>
              </Select>
            </FormControl>
            {form.allow_groups ? (
              <Stack spacing={2}>
                <Autocomplete
                  multiple
                  size="small"
                  options={groupScopeOptions}
                  value={selectedGroupScopeOptions}
                  onChange={(_event, value) => {
                    const selected = Array.isArray(value) ? value : []
                    const latestSet = [...selected].reverse().find((option) => option.type === 'SET')
                    if (latestSet) {
                      setForm({
                        ...form,
                        group_source: 'SET',
                        group_set_id: latestSet.value,
                        assignment_group_ids: [],
                      })
                      return
                    }
                    setForm({
                      ...form,
                      group_source: 'GROUPS',
                      group_set_id: '',
                      assignment_group_ids: selected
                        .filter((option) => option.type === 'GROUP')
                        .map((option) => option.value),
                    })
                  }}
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  getOptionLabel={(option) => option.label}
                  noOptionsText="Create course groups first"
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Allowed groups"
                      placeholder="Choose one set or specific groups"
                    />
                  )}
                  renderOption={(props, option) => (
                    <Box component="li" {...props}>
                      <Stack spacing={0.15}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {option.label}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {option.type === 'SET' ? option.helper : `Specific group • ${option.helper}`}
                        </Typography>
                      </Stack>
                    </Box>
                  )}
                />
                <Typography variant="caption" color="text.secondary">
                  {groupSets.length
                    ? 'Choose one reusable set, or choose the specific groups allowed to submit.'
                    : 'Create course groups first in the Groups tab.'}
                </Typography>
              </Stack>
            ) : null}
            <Stack spacing={2}>
              <Stack spacing={1}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Submission mode
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  fullWidth
                  size="small"
                  value={form.submission_mode}
                  onChange={(_event, value) => {
                    if (!value) return
                    setForm({ ...form, submission_mode: value })
                  }}
                >
                  <ToggleButton value={ASSIGNMENT_SUBMISSION_MODE.UPLOAD}>Upload only</ToggleButton>
                  <ToggleButton value={ASSIGNMENT_SUBMISSION_MODE.WORKSPACE}>Workspace only</ToggleButton>
                  <ToggleButton value={ASSIGNMENT_SUBMISSION_MODE.BOTH}>Both</ToggleButton>
                </ToggleButtonGroup>
                <Typography variant="caption" color="text.secondary">
                  Workspace mode requires a programming language and lets students code and submit in-browser.
                </Typography>
              </Stack>
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

      <Dialog
        open={rubricTemplateDialogOpen}
        onClose={() => setRubricTemplateDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {rubricTemplateDialogMode === 'update' ? 'Update rubric template' : 'Save rubric as template'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Template name"
              value={rubricTemplateDraft.name}
              onChange={(event) =>
                setRubricTemplateDraft((current) => ({ ...current, name: event.target.value }))
              }
              fullWidth
              required
            />
            <TextField
              label="Description"
              value={rubricTemplateDraft.description}
              onChange={(event) =>
                setRubricTemplateDraft((current) => ({ ...current, description: event.target.value }))
              }
              fullWidth
              multiline
              minRows={3}
              helperText={
                rubricTemplateDialogMode === 'update'
                  ? 'If criteria are unchanged, only the name and description are updated (no new version). If criteria differ, a new version is created.'
                  : 'Create a reusable course template from the rubric currently loaded in the editor.'
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRubricTemplateDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSaveRubricTemplate}
            disabled={rubricTemplateSaving}
          >
            {rubricTemplateSaving
              ? 'Saving…'
              : rubricTemplateDialogMode === 'update'
                ? 'Save template version'
                : 'Create template'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(previewSuite)} onClose={closePreview} maxWidth="md" fullWidth>
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
                      maxHeight: 260,
                      overflow: 'auto',
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1.5,
                      p: 1,
                      backgroundColor: 'rgba(248, 250, 252, 0.8)',
                    }}
                  >
                    {manifest.files.map((file) => (
                      <Button
                        key={file.name}
                        size="small"
                        onClick={() => loadPreviewFile(file.name)}
                        disabled={file.is_dir}
                        variant={previewFileName === file.name ? 'contained' : 'text'}
                        sx={{
                          justifyContent: 'space-between',
                          textTransform: 'none',
                          fontFamily: 'Menlo, Monaco, Consolas, monospace',
                          px: 1,
                          py: 0.5,
                        }}
                      >
                        <span>{file.name}</span>
                        <span>{file.is_dir ? '—' : `${(file.size / 1024).toFixed(1)} KB`}</span>
                      </Button>
                    ))}
                  </Stack>
                  <Divider />
                  <Stack spacing={1}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        {previewFileName ? `Preview: ${previewFileName}` : 'Select a file to preview'}
                      </Typography>
                      {previewFileTruncated ? <Chip size="small" color="warning" label="Truncated" /> : null}
                    </Stack>
                    {previewFileError ? <Alert severity="error">{previewFileError}</Alert> : null}
                    {previewFileLoading ? (
                      <Typography color="text.secondary">Loading file preview…</Typography>
                    ) : previewFileError ? null : previewFileName && previewFileMode === 'text' ? (
                      <Box
                        component="pre"
                        sx={{
                          m: 0,
                          maxHeight: 260,
                          overflow: 'auto',
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 1.5,
                          p: 1.25,
                          fontSize: 12,
                          lineHeight: 1.5,
                          fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
                          backgroundColor: 'rgba(15, 23, 42, 0.04)',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {previewFileContent || '(empty file)'}
                      </Box>
                    ) : previewFileName && previewFileMode === 'binary' ? (
                      <Box
                        sx={{
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 1.5,
                          overflow: 'hidden',
                          backgroundColor: 'rgba(248, 250, 252, 0.8)',
                        }}
                      >
                        {previewFileMime.startsWith('image/') ? (
                          <Box
                            component="img"
                            src={previewFileObjectUrl}
                            alt={previewFileName}
                            sx={{
                              display: 'block',
                              width: '100%',
                              maxHeight: 360,
                              objectFit: 'contain',
                              backgroundColor: '#f8fafc',
                            }}
                          />
                        ) : (
                          <Box
                            component="iframe"
                            title={previewFileName}
                            src={previewFileObjectUrl}
                            sx={{
                              width: '100%',
                              height: 360,
                              border: 0,
                              display: 'block',
                            }}
                          />
                        )}
                      </Box>
                    ) : null}
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
      </Dialog>    </Box>
  )
}

export default CourseAssignmentDetail
