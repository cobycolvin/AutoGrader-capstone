import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { githubLight } from '@uiw/codemirror-theme-github'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { java } from '@codemirror/lang-java'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import { indentWithTab } from '@codemirror/commands'
import { keymap, EditorView } from '@codemirror/view'
import { xml } from '@codemirror/lang-xml'
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  AddRounded,
  ArrowBackRounded,
  ChevronRightRounded,
  CodeRounded,
  DeleteRounded,
  EditRounded,
  ExpandMoreRounded,
  PlayArrowRounded,
  SaveRounded,
  SendRounded,
  UploadRounded,
} from '@mui/icons-material'
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { apiRequest } from '../api/client.js'

const editorSx = {
  '& .MuiInputBase-root': {
    alignItems: 'flex-start',
    fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
    fontSize: 13,
    lineHeight: 1.7,
    borderRadius: 0,
    border: 'none',
    backgroundColor: 'transparent',
  },
  '& .MuiOutlinedInput-notchedOutline': { border: 'none' },
  '& textarea': {
    fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
    lineHeight: 1.7,
    resize: 'none',
  },
}

const terminalSx = {
  m: 0,
  p: 1.5,
  overflow: 'auto',
  borderRadius: 0,
  backgroundColor: '#0f172a',
  color: '#e2e8f0',
  fontSize: 12,
  lineHeight: 1.6,
  fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
}

const editorThemeExtension = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    backgroundColor: '#ffffff',
  },
  '.cm-scroller': {
    fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
    lineHeight: 1.7,
  },
  '.cm-content': {
    minHeight: '100%',
    padding: '16px 0',
  },
  '.cm-line': {
    padding: '0 16px',
  },
  '.cm-gutters': {
    borderRight: '1px solid #e2e8f0',
    backgroundColor: '#f8fafc',
    color: '#64748b',
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#eef2ff',
  },
  '.cm-activeLine': {
    backgroundColor: '#f8fafc',
  },
  '.cm-search': {
    borderRadius: '10px',
    border: '1px solid #cbd5e1',
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
  },
})

const formatDateTime = (value) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const buildWorkspaceQuery = (groupId) => (!groupId ? '' : `?group_id=${encodeURIComponent(groupId)}`)

const extensionOf = (path) => {
  const normalized = String(path || '')
  const dotIndex = normalized.lastIndexOf('.')
  return dotIndex >= 0 ? normalized.slice(dotIndex).toLowerCase() : ''
}

const editorExtensionForPath = (path) => {
  const extension = extensionOf(path)
  if (extension === '.py') return python()
  if (extension === '.java') return java()
  if (extension === '.json') return json()
  if (extension === '.md') return markdown()
  if (extension === '.html') return html()
  if (extension === '.css') return css()
  if (extension === '.xml') return xml()
  if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(extension)) {
    return javascript({
      jsx: extension === '.jsx' || extension === '.tsx',
      typescript: extension === '.ts' || extension === '.tsx',
    })
  }
  return []
}

export default function CourseAssignmentWorkspace() {
  const { courseId, assignmentId } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const groupId = searchParams.get('group') || ''
  const importInputRef = useRef(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [assignment, setAssignment] = useState(null)
  const [groups, setGroups] = useState([])
  const [requiresGroupSelection, setRequiresGroupSelection] = useState(false)
  const [owner, setOwner] = useState(null)
  const [draft, setDraft] = useState(null)
  const [files, setFiles] = useState([])
  const [selectedPath, setSelectedPath] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [consoleCapability, setConsoleCapability] = useState(null)
  const [fileRunCapability, setFileRunCapability] = useState(null)
  const [attempts, setAttempts] = useState(null)
  const [stdinText, setStdinText] = useState('')
  const [argsText, setArgsText] = useState('')
  const [inputFiles, setInputFiles] = useState([])
  const [runLoading, setRunLoading] = useState(false)
  const [runError, setRunError] = useState('')
  const [runResult, setRunResult] = useState(null)
  const [selectedProducedFileName, setSelectedProducedFileName] = useState('')
  const [submitLoading, setSubmitLoading] = useState(false)
  const [showRunConfig, setShowRunConfig] = useState(false)

  const applyWorkspacePayload = useCallback((payload, options = {}) => {
    const resetRunInputs = options.resetRunInputs !== false
    setAssignment(payload.assignment || null)
    setGroups(Array.isArray(payload.groups) ? payload.groups : [])
    setRequiresGroupSelection(Boolean(payload.requires_group_selection))
    setOwner(payload.owner || null)
    setDraft(payload.draft || null)
    const nextFiles = Array.isArray(payload.draft?.files) ? payload.draft.files : []
    setFiles(nextFiles)
    setSelectedPath((current) => {
      if (current && nextFiles.some((e) => e.path === current)) return current
      return nextFiles[0]?.path || ''
    })
    setConsoleCapability(payload.console || null)
    setFileRunCapability(payload.file_run || null)
    setAttempts(payload.attempts || null)
    setDirty(false)
    setSaveError('')
    setError(payload.reason || '')
    if (!resetRunInputs) return
    if (payload.file_run?.available) {
      setArgsText((payload.file_run.default_args || []).join('\n'))
      setStdinText(payload.file_run.default_stdin || '')
      setInputFiles(
        (payload.file_run.default_input_files || []).map((e, i) => ({
          id: `${e.path || 'input'}-${i}`, path: e.path || '', content: e.content || '',
        })),
      )
      return
    }
    setArgsText('')
    setStdinText(payload.console?.default_stdin || '')
    setInputFiles([])
  }, [])

  const loadWorkspace = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const payload = await apiRequest(`/api/assignments/${assignmentId}/workspace/${buildWorkspaceQuery(groupId)}`)
      applyWorkspacePayload(payload, { resetRunInputs: true })
    } catch (err) {
      setError(err.message || 'Unable to load workspace')
    } finally {
      setLoading(false)
    }
  }, [applyWorkspacePayload, assignmentId, groupId])

  useEffect(() => { loadWorkspace() }, [loadWorkspace])

  const selectedFile = useMemo(() => files.find((e) => e.path === selectedPath) || null, [files, selectedPath])
  const codeEditorExtensions = useMemo(
    () => [
      editorExtensionForPath(selectedPath),
      search({ top: true }),
      highlightSelectionMatches(),
      keymap.of([indentWithTab, ...searchKeymap]),
      EditorState.tabSize.of(2),
      EditorView.lineWrapping,
      editorThemeExtension,
    ],
    [selectedPath],
  )

  const runCapability = useMemo(() => {
    if (fileRunCapability?.available) return { ...fileRunCapability, kind: 'file' }
    if (consoleCapability?.available) return { ...consoleCapability, kind: 'console' }
    if (fileRunCapability) return { ...fileRunCapability, kind: 'file' }
    if (consoleCapability) return { ...consoleCapability, kind: 'console' }
    return null
  }, [consoleCapability, fileRunCapability])

  const producedFile = useMemo(() => {
    const entries = Array.isArray(runResult?.produced_files) ? runResult.produced_files : []
    if (!entries.length) return null
    return entries.find((e) => e.name === selectedProducedFileName) || entries[0]
  }, [runResult, selectedProducedFileName])

  const persistDraft = useCallback(async ({ force = false } = {}) => {
    if (!draft || (!dirty && !force) || requiresGroupSelection) return null
    setSaving(true)
    setSaveError('')
    try {
      const payload = await apiRequest(`/api/assignments/${assignmentId}/workspace/${buildWorkspaceQuery(groupId)}`, {
        method: 'PUT',
        body: {
          expected_revision: draft.revision,
          files: files.map((e) => ({ path: e.path, content: e.content || '' })),
        },
      })
      applyWorkspacePayload(payload, { resetRunInputs: false })
      return payload
    } catch (err) {
      setSaveError(err.message || 'Unable to save draft')
      throw err
    } finally {
      setSaving(false)
    }
  }, [applyWorkspacePayload, assignmentId, dirty, draft, files, groupId, requiresGroupSelection])

  useEffect(() => {
    if (!dirty || requiresGroupSelection) return undefined
    const timer = window.setTimeout(() => { persistDraft().catch(() => {}) }, 900)
    return () => window.clearTimeout(timer)
  }, [dirty, files, persistDraft, requiresGroupSelection])

  const updateSelectedFileContent = (nextContent) => {
    setFiles((cur) => cur.map((e) => (e.path === selectedPath ? { ...e, content: nextContent } : e)))
    setDirty(true)
  }

  const handleAddFile = () => {
    const nextPath = window.prompt('File name', 'main.py')
    if (!nextPath?.trim()) return
    const trimmed = nextPath.trim().replace(/\\/g, '/')
    if (files.some((e) => e.path === trimmed)) { setSaveError('A file with that name already exists.'); return }
    setFiles((cur) => [...cur, { path: trimmed, content: '' }])
    setSelectedPath(trimmed)
    setDirty(true)
  }

  const handleRenameSelectedFile = () => {
    if (!selectedFile) return
    const nextPath = window.prompt('Rename file', selectedFile.path)
    if (!nextPath || nextPath.trim() === selectedFile.path) return
    const trimmed = nextPath.trim().replace(/\\/g, '/')
    if (files.some((e) => e.path === trimmed && e.path !== selectedFile.path)) { setSaveError('A file with that name already exists.'); return }
    setFiles((cur) => cur.map((e) => (e.path === selectedFile.path ? { ...e, path: trimmed } : e)))
    setSelectedPath(trimmed)
    setDirty(true)
  }

  const handleDeleteSelectedFile = () => {
    if (!selectedFile || files.length <= 1) return
    if (!window.confirm(`Delete ${selectedFile.path}?`)) return
    const nextFiles = files.filter((e) => e.path !== selectedFile.path)
    setFiles(nextFiles)
    setSelectedPath(nextFiles[0]?.path || '')
    setDirty(true)
  }

  const handleImportFiles = async (event) => {
    const selected = Array.from(event.target.files || [])
    event.target.value = ''
    if (!selected.length) return
    const imported = await Promise.all(selected.map(async (f) => ({ path: f.name, content: await f.text() })))
    const dup = imported.find((e) => files.some((f) => f.path === e.path))
    if (dup) { setSaveError(`Duplicate file: ${dup.path}`); return }
    setFiles((cur) => [...cur, ...imported])
    setSelectedPath(imported[0]?.path || selectedPath)
    setDirty(true)
  }

  const handleGroupChange = (event) => {
    setSearchParams(event.target.value ? { group: event.target.value } : {})
    setRunResult(null)
    setRunError('')
  }

  const handleRun = async () => {
    if (!runCapability) return
    setRunLoading(true)
    setRunError('')
    try {
      await persistDraft({ force: true })
      const payload = runCapability.kind === 'file'
        ? {
            args: argsText.split('\n').map((v) => v.trim()).filter(Boolean),
            stdin: stdinText,
            input_files: inputFiles.map((e) => ({ path: e.path, content: e.content || '' })),
          }
        : { stdin: stdinText }
      const result = await apiRequest(`/api/assignments/${assignmentId}/workspace-run/${buildWorkspaceQuery(groupId)}`, {
        method: 'POST', body: payload,
      })
      setRunResult(result)
      setSelectedProducedFileName(result.produced_files?.[0]?.name || '')
    } catch (err) {
      setRunError(err.message || 'Unable to run draft')
    } finally {
      setRunLoading(false)
    }
  }

  const handleSubmit = async () => {
    setSubmitLoading(true)
    setRunError('')
    try {
      await persistDraft({ force: true })
      const submission = await apiRequest(`/api/assignments/${assignmentId}/workspace-submit/${buildWorkspaceQuery(groupId)}`, {
        method: 'POST', body: {},
      })
      navigate(`/course/${courseId}/assignments/${assignmentId}/submissions/${submission.id}`)
    } catch (err) {
      setRunError(err.message || 'Unable to submit draft')
    } finally {
      setSubmitLoading(false)
    }
  }

  // ── save status label ────────────────────────────────────────────────────
  const saveStatusLabel = saving
    ? 'Saving…'
    : dirty
      ? 'Unsaved changes'
      : draft?.updated_at
        ? `Saved ${formatDateTime(draft.updated_at)}`
        : null

  const saveStatusColor = saving ? 'text.disabled' : dirty ? 'warning.main' : 'success.main'

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Typography color="text.secondary">Loading workspace…</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', backgroundColor: '#f8fafc' }}>

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <Box
        sx={{
          flexShrink: 0,
          px: 2,
          py: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
          backgroundColor: '#fff',
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          flexWrap: 'wrap',
        }}
      >
        {/* Back */}
        <Button
          component={RouterLink}
          to={`/course/${courseId}/assignments/${assignmentId}`}
          startIcon={<ArrowBackRounded />}
          size="small"
          sx={{ textTransform: 'none', color: 'text.secondary', minWidth: 0 }}
        >
          Back
        </Button>

        <Divider orientation="vertical" flexItem />

        {/* Title + meta */}
        <Stack direction="row" alignItems="center" spacing={1} sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap sx={{ fontWeight: 800 }}>
            {assignment?.title || 'Workspace'}
          </Typography>
          {assignment?.language_name && (
            <Chip icon={<CodeRounded />} label={assignment.language_name} size="small" variant="outlined" sx={{ height: 22 }} />
          )}
          {attempts && (
            <Chip
              label={attempts.max ? `${attempts.remaining} attempt${attempts.remaining === 1 ? '' : 's'} left` : 'Unlimited'}
              size="small"
              variant="outlined"
              sx={{ height: 22 }}
            />
          )}
          {owner && (
            <Chip label={`${owner.kind === 'group' ? 'Group' : 'Draft'}: ${owner.name}`} size="small" variant="outlined" sx={{ height: 22 }} />
          )}
        </Stack>

        {/* Save status */}
        {saveStatusLabel && (
          <Typography variant="caption" sx={{ color: saveStatusColor, whiteSpace: 'nowrap' }}>
            {saveStatusLabel}
          </Typography>
        )}

        {/* Actions */}
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Tooltip title={!runCapability?.available ? (runCapability?.reason || 'Run not configured for this assignment') : ''}>
            <span>
              <Button
                size="small"
                variant="outlined"
                startIcon={<PlayArrowRounded />}
                onClick={handleRun}
                disabled={!runCapability?.available || runLoading || submitLoading}
                sx={{ textTransform: 'none', borderRadius: 999 }}
              >
                {runLoading ? 'Running…' : 'Run'}
              </Button>
            </span>
          </Tooltip>
          <Button
            size="small"
            variant="outlined"
            startIcon={<SaveRounded />}
            onClick={() => persistDraft({ force: true })}
            disabled={saving || submitLoading}
            sx={{ textTransform: 'none', borderRadius: 999 }}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<SendRounded />}
            onClick={handleSubmit}
            disabled={submitLoading || saving || requiresGroupSelection}
            sx={{ textTransform: 'none', borderRadius: 999 }}
          >
            {submitLoading ? 'Submitting…' : 'Submit'}
          </Button>
        </Stack>
      </Box>

      {/* ── Alerts ───────────────────────────────────────────────────────── */}
      {(error || saveError || runError) && (
        <Box sx={{ px: 2, pt: 1, flexShrink: 0 }}>
          {error && <Alert severity="error" sx={{ mb: 0.5 }}>{error}</Alert>}
          {saveError && <Alert severity="error" sx={{ mb: 0.5 }}>{saveError}</Alert>}
          {runError && <Alert severity="error" sx={{ mb: 0.5 }}>{runError}</Alert>}
        </Box>
      )}

      {/* ── Group selector ───────────────────────────────────────────────── */}
      {groups.length > 0 && (
        <Box sx={{ px: 2, pt: 1, flexShrink: 0 }}>
          <FormControl size="small" sx={{ minWidth: 240 }}>
            <InputLabel id="ws-group-label">Workspace group</InputLabel>
            <Select
              labelId="ws-group-label"
              label="Workspace group"
              value={groupId || owner?.id || ''}
              onChange={handleGroupChange}
            >
              {requiresGroupSelection && <MenuItem value=""><em>Choose a group</em></MenuItem>}
              {groups.map((g) => <MenuItem key={g.id} value={g.id}>{g.name}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>
      )}

      {requiresGroupSelection ? (
        <Box sx={{ px: 2, pt: 2 }}>
          <Alert severity="info">Choose a group above to open the shared workspace.</Alert>
        </Box>
      ) : (
        /* ── Main workspace area ─────────────────────────────────────── */
        <Box sx={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

          {/* Files sidebar */}
          <Box
            sx={{
              width: 200,
              flexShrink: 0,
              borderRight: '1px solid',
              borderColor: 'divider',
              backgroundColor: '#fff',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary' }}>
                Files
              </Typography>
              <Stack direction="row" spacing={0.25}>
                <Tooltip title="Import files">
                  <IconButton size="small" onClick={() => importInputRef.current?.click()} sx={{ p: 0.4 }}>
                    <UploadRounded sx={{ fontSize: 15 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="New file">
                  <IconButton size="small" onClick={handleAddFile} sx={{ p: 0.4 }}>
                    <AddRounded sx={{ fontSize: 15 }} />
                  </IconButton>
                </Tooltip>
              </Stack>
              <input ref={importInputRef} type="file" multiple hidden onChange={handleImportFiles} />
            </Stack>

            <Box sx={{ flex: 1, overflowY: 'auto', p: 0.75 }}>
              <Stack spacing={0.25}>
                {files.map((entry) => {
                  const active = entry.path === selectedPath
                  return (
                    <Button
                      key={entry.path}
                      onClick={() => setSelectedPath(entry.path)}
                      sx={{
                        justifyContent: 'flex-start',
                        textTransform: 'none',
                        borderRadius: 1.5,
                        px: 1,
                        py: 0.5,
                        minHeight: 0,
                        backgroundColor: active ? 'rgba(79,70,229,0.08)' : 'transparent',
                        color: active ? 'primary.main' : 'text.primary',
                        '&:hover': { backgroundColor: active ? 'rgba(79,70,229,0.12)' : 'rgba(0,0,0,0.04)' },
                      }}
                    >
                      <ChevronRightRounded sx={{ fontSize: 14, mr: 0.5, opacity: active ? 1 : 0.3 }} />
                      <Typography variant="caption" noWrap sx={{ fontWeight: active ? 700 : 500, flex: 1, textAlign: 'left', fontFamily: 'monospace' }}>
                        {entry.path}
                      </Typography>
                    </Button>
                  )
                })}
              </Stack>
            </Box>
          </Box>

          {/* Editor + output column */}
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

            {/* File tab bar */}
            {selectedFile && (
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ px: 1.5, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', backgroundColor: '#fff', flexShrink: 0 }}
              >
                <Stack spacing={0.15}>
                  <Typography variant="caption" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'text.primary' }}>
                    {selectedFile.path}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Search with Cmd/Ctrl+F. Tab indents code.
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={0.25} alignItems="center">
                  <Tooltip title="Rename">
                    <IconButton size="small" onClick={handleRenameSelectedFile} sx={{ p: 0.4 }}>
                      <EditRounded sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={files.length <= 1 ? 'Need at least one file' : 'Delete'}>
                    <span>
                      <IconButton size="small" disabled={files.length <= 1} onClick={handleDeleteSelectedFile} sx={{ p: 0.4 }}>
                        <DeleteRounded sx={{ fontSize: 14 }} />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>
              </Stack>
            )}

            {/* Editor */}
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', backgroundColor: '#fff' }}>
              {selectedFile ? (
                <CodeMirror
                  key={selectedFile.path}
                  value={selectedFile.content || ''}
                  onChange={(value) => updateSelectedFileContent(value)}
                  theme={githubLight}
                  extensions={codeEditorExtensions}
                  basicSetup={{
                    lineNumbers: true,
                    foldGutter: false,
                    highlightActiveLineGutter: true,
                    highlightSpecialChars: false,
                    history: true,
                    drawSelection: true,
                    dropCursor: true,
                    allowMultipleSelections: true,
                    indentOnInput: true,
                    bracketMatching: true,
                    closeBrackets: true,
                    autocompletion: true,
                    rectangularSelection: true,
                    crosshairCursor: false,
                    highlightActiveLine: true,
                  }}
                  style={{ height: '100%' }}
                />
              ) : (
                <Stack sx={{ height: '100%' }} alignItems="center" justifyContent="center" spacing={1}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    Select a file to edit
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Add a file or choose one from the sidebar to start coding.
                  </Typography>
                </Stack>
              )}
            </Box>

            {/* Run config (collapsible, only when run is available) */}
            {runCapability?.available && (
              <Box sx={{ borderTop: '1px solid', borderColor: 'divider', flexShrink: 0, backgroundColor: '#fff' }}>
                <Button
                  size="small"
                  onClick={() => setShowRunConfig((v) => !v)}
                  endIcon={showRunConfig ? <ExpandMoreRounded sx={{ fontSize: 14 }} /> : <ChevronRightRounded sx={{ fontSize: 14 }} />}
                  sx={{ textTransform: 'none', color: 'text.secondary', px: 1.5, py: 0.75, width: '100%', justifyContent: 'flex-start', borderRadius: 0 }}
                >
                  <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Run inputs
                  </Typography>
                </Button>
                <Collapse in={showRunConfig}>
                  <Stack spacing={1.25} sx={{ px: 1.5, pb: 1.5 }}>
                    {runCapability.kind === 'file' && (
                      <>
                        <TextField
                          label="Arguments"
                          value={argsText}
                          onChange={(e) => setArgsText(e.target.value)}
                          helperText="One argument per line"
                          multiline
                          minRows={2}
                          fullWidth
                          size="small"
                          sx={editorSx}
                        />
                        {inputFiles.length > 0 && (
                          <Stack spacing={0.75}>
                            {inputFiles.map((entry) => (
                              <Paper key={entry.id} variant="outlined" sx={{ p: 1, borderRadius: 1.5 }}>
                                <Stack spacing={0.75}>
                                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                                    <Typography variant="caption" color="text.secondary">Input file</Typography>
                                    <IconButton size="small" onClick={() => setInputFiles((cur) => cur.filter((e) => e.id !== entry.id))}>
                                      <DeleteRounded sx={{ fontSize: 14 }} />
                                    </IconButton>
                                  </Stack>
                                  <TextField size="small" label="Path" value={entry.path} onChange={(e) => setInputFiles((cur) => cur.map((f) => (f.id === entry.id ? { ...f, path: e.target.value } : f)))} fullWidth />
                                  <TextField label="Content" value={entry.content} onChange={(e) => setInputFiles((cur) => cur.map((f) => (f.id === entry.id ? { ...f, content: e.target.value } : f)))} multiline minRows={3} fullWidth size="small" sx={editorSx} />
                                </Stack>
                              </Paper>
                            ))}
                          </Stack>
                        )}
                        <Button size="small" startIcon={<AddRounded />} onClick={() => setInputFiles((cur) => [...cur, { id: `input-${Date.now()}`, path: '', content: '' }])} sx={{ alignSelf: 'flex-start', textTransform: 'none' }}>
                          Add input file
                        </Button>
                      </>
                    )}
                    <TextField
                      label="Standard input"
                      value={stdinText}
                      onChange={(e) => setStdinText(e.target.value)}
                      multiline
                      minRows={3}
                      fullWidth
                      size="small"
                      sx={editorSx}
                    />
                  </Stack>
                </Collapse>
              </Box>
            )}

            {/* Output panel — only shown when there's output */}
            {runResult && (
              <Box
                sx={{
                  flexShrink: 0,
                  borderTop: '1px solid',
                  borderColor: 'divider',
                  maxHeight: 240,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  sx={{ px: 1.5, py: 0.75, backgroundColor: '#0f172a', borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}
                >
                  <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'rgba(255,255,255,0.5)' }}>
                    Output
                  </Typography>
                  <Chip
                    size="small"
                    label={runResult.returncode === 0 ? 'OK' : `exit ${runResult.returncode}`}
                    color={runResult.returncode === 0 ? 'success' : 'warning'}
                    sx={{ height: 18, fontSize: 10, fontWeight: 700 }}
                  />
                  {runResult.duration_ms != null && (
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.35)' }}>
                      {runResult.duration_ms} ms
                    </Typography>
                  )}
                  <Box sx={{ flex: 1 }} />
                  <Button
                    size="small"
                    onClick={() => setRunResult(null)}
                    sx={{ color: 'rgba(255,255,255,0.35)', textTransform: 'none', minWidth: 0, p: 0, fontSize: 11, '&:hover': { color: 'rgba(255,255,255,0.6)', backgroundColor: 'transparent' } }}
                  >
                    Clear
                  </Button>
                </Stack>
                <Box component="pre" sx={{ ...terminalSx, flex: 1, minHeight: 0, overflow: 'auto' }}>
                  {`${runResult.stdout || ''}${runResult.stderr ? `\n[stderr]\n${runResult.stderr}` : ''}` || '(no output)'}
                </Box>
                {runResult.produced_files?.length > 0 && (
                  <>
                    <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />
                    <Stack direction="row" spacing={0.75} sx={{ px: 1.5, py: 0.75, backgroundColor: '#0f172a', flexShrink: 0, flexWrap: 'wrap' }} useFlexGap>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)', alignSelf: 'center' }}>Files:</Typography>
                      {runResult.produced_files.map((f) => (
                        <Button
                          key={f.name}
                          size="small"
                          variant={producedFile?.name === f.name ? 'contained' : 'outlined'}
                          onClick={() => setSelectedProducedFileName(f.name)}
                          sx={{ textTransform: 'none', fontSize: 11, py: 0.25, minHeight: 0 }}
                        >
                          {f.name}
                        </Button>
                      ))}
                    </Stack>
                    {producedFile && (
                      <Box component="pre" sx={{ ...terminalSx, maxHeight: 120, overflow: 'auto', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                        {producedFile.encoding === 'base64' ? `${producedFile.name}\n\n(binary file)` : producedFile.content || '(empty)'}
                      </Box>
                    )}
                  </>
                )}
              </Box>
            )}
          </Box>
        </Box>
      )}
    </Box>
  )
}
