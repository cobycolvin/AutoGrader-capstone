import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
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
  DeleteRounded,
  PlayArrowRounded,
  RefreshRounded,
  UploadRounded,
} from '@mui/icons-material'
import { apiRequest } from '../api/client.js'

const MAX_STDIN_UPLOAD_BYTES = 256 * 1024

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

const formatDate = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

const formatIdentifierLabel = (value) =>
  String(value || '')
    .split('_')
    .filter(Boolean)
    .map((segment) => segment.charAt(0) + segment.slice(1).toLowerCase())
    .join(' ')

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

const terminalTextFieldSx = {
  '& .MuiInputLabel-root': {
    color: 'rgba(165, 180, 252, 0.96)',
    fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
  },
  '& .MuiOutlinedInput-root': {
    alignItems: 'flex-start',
    backgroundColor: '#020617',
    color: '#e2e8f0',
    fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
    fontSize: 13,
    lineHeight: 1.6,
    '& fieldset': {
      borderColor: 'rgba(148, 163, 184, 0.18)',
    },
    '&:hover fieldset': {
      borderColor: 'rgba(129, 140, 248, 0.55)',
    },
    '&.Mui-focused fieldset': {
      borderColor: 'rgba(165, 180, 252, 0.88)',
    },
    '& textarea': {
      whiteSpace: 'pre',
      overflowWrap: 'normal',
      caretColor: '#a5b4fc',
    },
    '& input': {
      caretColor: '#a5b4fc',
    },
  },
}

function AssignmentRunWorkspace({ assignmentId, assignmentTitle, user, onOpenSubmissions }) {
  const [submissionRows, setSubmissionRows] = useState([])
  const [submissionsLoading, setSubmissionsLoading] = useState(true)
  const [submissionsError, setSubmissionsError] = useState('')
  const [selectedSubmissionId, setSelectedSubmissionId] = useState('')
  const [detailData, setDetailData] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [detailRefreshKey, setDetailRefreshKey] = useState(0)
  const [setupOpen, setSetupOpen] = useState(false)
  const [selectedSetupPanel, setSelectedSetupPanel] = useState('files')
  const [argsText, setArgsText] = useState('')
  const [stdinText, setStdinText] = useState('')
  const [stdinUploadError, setStdinUploadError] = useState('')
  const [stdinSourceLabel, setStdinSourceLabel] = useState('')
  const [inputFiles, setInputFiles] = useState([])
  const [runLoading, setRunLoading] = useState(false)
  const [runError, setRunError] = useState('')
  const [runResult, setRunResult] = useState(null)
  const [selectedProducedFileName, setSelectedProducedFileName] = useState('')
  const stdinFileInputRef = useRef(null)

  const capability = useMemo(() => {
    if (detailData?.file_run?.available) {
      return { ...detailData.file_run, kind: 'file' }
    }
    if (detailData?.console?.available) {
      return { ...detailData.console, kind: 'console' }
    }
    if (detailData?.file_run) {
      return { ...detailData.file_run, kind: 'file' }
    }
    if (detailData?.console) {
      return { ...detailData.console, kind: 'console' }
    }
    return null
  }, [detailData])

  const loadSubmissions = useCallback(async () => {
    if (!assignmentId) return
    setSubmissionsLoading(true)
    setSubmissionsError('')
    try {
      const data = await apiRequest(`/api/submissions/?assignment_id=${assignmentId}`)
      setSubmissionRows(Array.isArray(data) ? data : [])
    } catch (err) {
      setSubmissionsError(err.message || 'Unable to load submissions')
      setSubmissionRows([])
    } finally {
      setSubmissionsLoading(false)
    }
  }, [assignmentId])

  useEffect(() => {
    loadSubmissions()
  }, [loadSubmissions])

  const ownSubmissions = useMemo(() => {
    const userId = user?.id == null ? '' : String(user.id)
    return [...submissionRows]
      .filter((row) => {
        if (!row) return false
        if (!Object.prototype.hasOwnProperty.call(row, 'submitted_by')) return true
        return String(row.submitted_by) === userId
      })
      .sort((left, right) => {
        const leftTime = new Date(left?.submitted_at || 0).getTime()
        const rightTime = new Date(right?.submitted_at || 0).getTime()
        return rightTime - leftTime
      })
  }, [submissionRows, user?.id])

  useEffect(() => {
    if (!ownSubmissions.length) {
      if (selectedSubmissionId) setSelectedSubmissionId('')
      return
    }
    if (!ownSubmissions.some((row) => row.id === selectedSubmissionId)) {
      setSelectedSubmissionId(ownSubmissions[0].id)
    }
  }, [ownSubmissions, selectedSubmissionId])

  useEffect(() => {
    if (!selectedSubmissionId) {
      setDetailData(null)
      setDetailError('')
      return undefined
    }

    let cancelled = false

    const loadDetails = async () => {
      setDetailLoading(true)
      setDetailError('')
      setRunError('')
      setStdinUploadError('')
      setStdinSourceLabel('')
      setRunResult(null)
      setSelectedProducedFileName('')
      try {
        const data = await apiRequest(`/api/submissions/${selectedSubmissionId}/details/`)
        if (cancelled) return
        setDetailData(data)
        const nextCapability = data?.file_run?.available
          ? { ...data.file_run, kind: 'file' }
          : data?.console?.available
            ? { ...data.console, kind: 'console' }
            : data?.file_run
              ? { ...data.file_run, kind: 'file' }
              : data?.console
                ? { ...data.console, kind: 'console' }
                : null
        const defaultInputFiles = nextCapability?.kind === 'file'
          ? (nextCapability.default_input_files || []).map((entry, index) => ({
            id: `${entry.path || 'input'}-${index}`,
            path: entry.path || '',
            content: entry.content || '',
          }))
          : []
        setArgsText(nextCapability?.kind === 'file' ? (nextCapability.default_args || []).join('\n') : '')
        setStdinText(nextCapability?.default_stdin || '')
        setInputFiles(defaultInputFiles)
        setSetupOpen(false)
        setSelectedSetupPanel(defaultInputFiles.length ? 'files' : 'command')
      } catch (err) {
        if (cancelled) return
        setDetailData(null)
        setDetailError(err.message || 'Unable to load submission workspace')
      } finally {
        if (!cancelled) {
          setDetailLoading(false)
        }
      }
    }

    loadDetails()
    return () => {
      cancelled = true
    }
  }, [selectedSubmissionId, detailRefreshKey])

  const selectedSubmission = useMemo(
    () => ownSubmissions.find((row) => row.id === selectedSubmissionId) || null,
    [ownSubmissions, selectedSubmissionId],
  )

  const fileRunArgs = useMemo(
    () => argsText.split('\n').map((value) => value.trim()).filter(Boolean),
    [argsText],
  )

  const selectedProducedFile = useMemo(() => {
    const files = Array.isArray(runResult?.produced_files) ? runResult.produced_files : []
    if (!files.length) return null
    return files.find((entry) => entry.name === selectedProducedFileName) || files[0]
  }, [runResult, selectedProducedFileName])
  const isFileCapability = capability?.kind === 'file'
  const isConsoleCapability = capability?.kind === 'console'
  const commandLine = useMemo(
    () => (
      isFileCapability
        ? buildCommandLine(capability?.command_preview || capability?.entry_label || '', fileRunArgs)
        : (capability?.command_preview || capability?.entry_label || '').trim()
    ),
    [capability?.command_preview, capability?.entry_label, fileRunArgs, isFileCapability],
  )
  const terminalOutput = useMemo(() => {
    const lines = []
    if (commandLine) {
      lines.push(`$ ${commandLine}`)
    }
    if (runLoading) {
      lines.push('', 'Running...')
      return lines.join('\n')
    }
    if (runError) {
      lines.push('', `[error] ${runError}`)
      return lines.join('\n')
    }
    if (!runResult) {
      lines.push('', '# Ready to run', '# Use custom args, stdin, or input files, then execute the saved submission.')
      return lines.join('\n')
    }

    const metaParts = [
      runResult.exit_status ? formatIdentifierLabel(runResult.exit_status) : '',
      runResult.returncode != null ? `exit ${runResult.returncode}` : '',
      runResult.duration_ms != null ? `${runResult.duration_ms} ms` : '',
    ].filter(Boolean)
    if (metaParts.length) {
      lines.push('', `[${metaParts.join(' • ')}]`)
    }
    lines.push('', 'stdout:', runResult.stdout || '(no stdout)')
    if (runResult.stderr) {
      lines.push('', 'stderr:', runResult.stderr)
    }
    return lines.join('\n')
  }, [commandLine, runError, runLoading, runResult])

  const addInputFile = () => {
    setInputFiles((prev) => [...prev, buildInputFile(prev.length)])
  }

  const openStdinFilePicker = () => {
    stdinFileInputRef.current?.click()
  }

  const clearStdin = () => {
    setStdinText('')
    setStdinSourceLabel('')
    setStdinUploadError('')
  }

  const handleStdinFileSelected = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if ((file.size || 0) > MAX_STDIN_UPLOAD_BYTES) {
      setStdinUploadError(`stdin file is too large. Limit is ${formatBytes(MAX_STDIN_UPLOAD_BYTES)}.`)
      return
    }

    try {
      const text = await file.text()
      setStdinText(text)
      setStdinSourceLabel(file.name || 'stdin.txt')
      setStdinUploadError('')
      setSetupOpen(true)
      setSelectedSetupPanel('command')
    } catch (_err) {
      setStdinUploadError('Unable to read that file as text.')
    }
  }

  const updateInputFile = (id, field, value) => {
    setInputFiles((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, [field]: value } : entry)),
    )
  }

  const removeInputFile = (id) => {
    setInputFiles((prev) => prev.filter((entry) => entry.id !== id))
  }

  const handleRefreshWorkspace = async () => {
    await loadSubmissions()
    setDetailRefreshKey((prev) => prev + 1)
  }

  const handleRun = async () => {
    if (!selectedSubmissionId || !capability?.available) return
    setRunLoading(true)
    setRunError('')
    try {
      const data = await apiRequest(
        `/api/submissions/${selectedSubmissionId}/${isFileCapability ? 'file-run' : 'console-run'}/`,
        {
          method: 'POST',
          body: isFileCapability
            ? {
                args: fileRunArgs,
                stdin: stdinText,
                input_files: inputFiles.map((entry) => ({
                  path: entry.path,
                  content: entry.content,
                })),
              }
            : {
                stdin: stdinText,
              },
        },
      )
      setRunResult(data)
      setSelectedProducedFileName(data?.produced_files?.[0]?.name || '')
    } catch (err) {
      setRunError(err.message || 'Unable to run the submitted program')
      setRunResult(null)
      setSelectedProducedFileName('')
    } finally {
      setRunLoading(false)
    }
  }

  if (submissionsLoading) {
    return <Typography color="text.secondary">Loading run workspace…</Typography>
  }

  return (
    <Stack spacing={2.25}>
      <Paper
        elevation={0}
        sx={{
          p: { xs: 2, md: 2.5 },
          borderRadius: 3,
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Stack spacing={1.5}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.25}
            alignItems={{ xs: 'flex-start', md: 'center' }}
            justifyContent="space-between"
          >
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                Run workspace
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>
                Run one of your saved submissions with temporary input without changing its grade.
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <Button
                size="small"
                variant="text"
                startIcon={<RefreshRounded />}
                onClick={handleRefreshWorkspace}
              >
                Refresh
              </Button>
              {ownSubmissions.length > 1 ? (
                <FormControl size="small" sx={{ minWidth: 220 }}>
                  <InputLabel id="workspace-submission-label">Submission</InputLabel>
                  <Select
                    labelId="workspace-submission-label"
                    label="Submission"
                    value={selectedSubmissionId}
                    onChange={(event) => setSelectedSubmissionId(event.target.value)}
                  >
                    {ownSubmissions.map((row) => (
                      <MenuItem key={row.id} value={row.id}>
                        {`Attempt ${row.attempt_number || '—'} • ${formatDate(row.submitted_at)}`}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              ) : null}
            </Stack>
          </Stack>

          {submissionsError ? <Alert severity="error">{submissionsError}</Alert> : null}

          {!ownSubmissions.length ? (
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                borderRadius: 2.5,
                borderStyle: 'dashed',
                backgroundColor: 'rgba(248, 250, 252, 0.9)',
              }}
            >
              <Stack spacing={1.25}>
                <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                  No submission available yet
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Submit your code for {assignmentTitle || 'this assignment'} first. The run workspace always uses one of your saved submissions.
                </Typography>
                {onOpenSubmissions ? (
                  <Button size="small" variant="contained" onClick={onOpenSubmissions} sx={{ alignSelf: 'flex-start' }}>
                    Open submissions
                  </Button>
                ) : null}
              </Stack>
            </Paper>
          ) : null}
        </Stack>
      </Paper>

      {selectedSubmission ? (
        <Paper
          elevation={0}
          sx={{
            p: { xs: 2, md: 2.5 },
            borderRadius: 3,
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Stack spacing={1.5}>
            <Stack
              direction={{ xs: 'column', lg: 'row' }}
              spacing={1}
              justifyContent="space-between"
              alignItems={{ xs: 'flex-start', lg: 'center' }}
            >
              <Stack spacing={0.35}>
                <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                  Submission attempt {selectedSubmission.attempt_number || '—'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Submitted {formatDate(selectedSubmission.submitted_at)}
                </Typography>
              </Stack>
              <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                {selectedSubmission.status ? (
                  <Chip
                    size="small"
                    label={String(selectedSubmission.status).replaceAll('_', ' ')}
                    variant="outlined"
                  />
                ) : null}
                <Button
                  size="small"
                  variant="text"
                  onClick={() => setSetupOpen((prev) => !prev)}
                  disabled={detailLoading || !capability?.available}
                >
                  {setupOpen ? 'Hide setup' : 'Adjust setup'}
                </Button>
              </Stack>
            </Stack>

            {detailLoading ? (
              <Typography color="text.secondary">Loading run settings…</Typography>
            ) : null}
            {detailError ? <Alert severity="error">{detailError}</Alert> : null}
            {!detailLoading && !detailError && capability && !capability.available ? (
              <Alert severity="info">{capability.reason || 'Run workspace is not available for this submission.'}</Alert>
            ) : null}

            {!detailLoading && capability?.available ? (
              <>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 0,
                    overflow: 'hidden',
                    borderRadius: 2.5,
                    borderColor: 'rgba(15, 23, 42, 0.08)',
                    backgroundColor: '#0f172a',
                  }}
                >
                  <Stack spacing={0}>
                    <Stack
                      direction={{ xs: 'column', md: 'row' }}
                      spacing={1}
                      justifyContent="space-between"
                      alignItems={{ xs: 'flex-start', md: 'center' }}
                      sx={{
                        px: 1.35,
                        py: 1,
                        borderBottom: '1px solid rgba(255,255,255,0.08)',
                        backgroundColor: 'rgba(15, 23, 42, 0.92)',
                      }}
                    >
                      <Stack spacing={0.15}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#f8fafc' }}>
                          Execution console
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'rgba(226, 232, 240, 0.72)' }}>
                          {[
                            isFileCapability && capability.default_case_name ? `Base case ${capability.default_case_name}` : '',
                            isFileCapability ? `${fileRunArgs.length} arg${fileRunArgs.length === 1 ? '' : 's'}` : '',
                            isFileCapability ? `${inputFiles.length} input file${inputFiles.length === 1 ? '' : 's'}` : '',
                            isConsoleCapability && capability.supports_stdin ? (stdinText ? 'stdin configured' : 'stdin empty') : '',
                          ]
                            .filter(Boolean)
                            .join(' • ')}
                        </Typography>
                      </Stack>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                        {runResult?.exit_status ? (
                          <Chip
                            size="small"
                            label={formatIdentifierLabel(runResult.exit_status)}
                            sx={{
                              color: '#e2e8f0',
                              borderColor: 'rgba(255,255,255,0.16)',
                              backgroundColor: 'rgba(255,255,255,0.04)',
                            }}
                            variant="outlined"
                          />
                        ) : null}
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<PlayArrowRounded />}
                          onClick={handleRun}
                          disabled={runLoading || detailLoading}
                        >
                          {runLoading ? 'Running…' : 'Run'}
                        </Button>
                      </Stack>
                    </Stack>

                    <Box
                      sx={{
                        px: 1.35,
                        py: 1.15,
                        borderBottom: '1px solid rgba(255,255,255,0.08)',
                        backgroundColor: 'rgba(15, 23, 42, 0.98)',
                        fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
                        fontSize: 12.5,
                        color: '#cbd5e1',
                        overflowX: 'auto',
                        whiteSpace: 'pre',
                      }}
                    >
                      {commandLine ? `$ ${commandLine}` : capability.command_preview || capability.entry_label}
                    </Box>

                    <Collapse in={setupOpen}>
                      <Box
                        sx={{
                          borderBottom: '1px solid rgba(255,255,255,0.08)',
                          backgroundColor: 'rgba(2, 6, 23, 0.74)',
                        }}
                      >
                        <Stack spacing={1.15} sx={{ px: 1.35, py: 1.2 }}>
                          <Stack
                            direction={{ xs: 'column', md: 'row' }}
                            spacing={1}
                            alignItems={{ xs: 'flex-start', md: 'center' }}
                            justifyContent="space-between"
                          >
                            <Stack spacing={0.15}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#f8fafc' }}>
                                Workspace setup
                              </Typography>
                              <Typography variant="caption" sx={{ color: 'rgba(226, 232, 240, 0.72)' }}>
                                {isFileCapability
                                  ? 'Adjust args, stdin, or temporary files without leaving the console.'
                                  : 'Adjust stdin without leaving the console.'}
                              </Typography>
                            </Stack>
                            {isFileCapability ? (
                              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                                <Button
                                  size="small"
                                  variant={selectedSetupPanel === 'command' ? 'contained' : 'text'}
                                  onClick={() => setSelectedSetupPanel('command')}
                                  sx={selectedSetupPanel !== 'command'
                                    ? {
                                        color: 'rgba(191, 219, 254, 0.9)',
                                        '&:hover': {
                                          backgroundColor: 'rgba(79, 70, 229, 0.12)',
                                        },
                                      }
                                    : undefined}
                                >
                                  Command
                                </Button>
                                <Button
                                  size="small"
                                  variant={selectedSetupPanel === 'files' ? 'contained' : 'text'}
                                  onClick={() => setSelectedSetupPanel('files')}
                                  sx={selectedSetupPanel !== 'files'
                                    ? {
                                        color: 'rgba(191, 219, 254, 0.9)',
                                        '&:hover': {
                                          backgroundColor: 'rgba(79, 70, 229, 0.12)',
                                        },
                                      }
                                    : undefined}
                                >
                                  Files
                                </Button>
                              </Stack>
                            ) : null}
                          </Stack>

                          <Collapse in={selectedSetupPanel === 'command' || isConsoleCapability}>
                            <Stack spacing={1.1}>
                              {isFileCapability ? (
                                <TextField
                                  label="Command args"
                                  size="small"
                                  value={argsText}
                                  onChange={(event) => setArgsText(event.target.value)}
                                  multiline
                                  minRows={3}
                                  fullWidth
                                  helperText="One argument per line."
                                  FormHelperTextProps={{
                                    sx: {
                                      color: 'rgba(148, 163, 184, 0.9)',
                                      ml: 0.2,
                                    },
                                  }}
                                  sx={terminalTextFieldSx}
                                />
                              ) : null}
                              {capability?.supports_stdin ? (
                                <Stack spacing={0.85}>
                                  <input
                                    ref={stdinFileInputRef}
                                    type="file"
                                    hidden
                                    accept=".txt,.csv,.json,.md,.xml,.yaml,.yml,.log,text/plain"
                                    onChange={handleStdinFileSelected}
                                  />
                                  <Paper
                                    variant="outlined"
                                    sx={{
                                      overflow: 'hidden',
                                      borderRadius: 2.25,
                                      borderColor: 'rgba(148, 163, 184, 0.18)',
                                      backgroundColor: '#0f172a',
                                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)',
                                    }}
                                  >
                                    <Stack
                                      direction={{ xs: 'column', md: 'row' }}
                                      spacing={1}
                                      alignItems={{ xs: 'flex-start', md: 'center' }}
                                      justifyContent="space-between"
                                      sx={{
                                        px: 1.1,
                                        py: 0.95,
                                        borderBottom: '1px solid rgba(148, 163, 184, 0.12)',
                                        backgroundColor: 'rgba(15, 23, 42, 0.98)',
                                      }}
                                    >
                                      <Stack spacing={0.1}>
                                        <Typography
                                          variant="caption"
                                          sx={{
                                            color: 'rgba(148, 163, 184, 0.9)',
                                            textTransform: 'uppercase',
                                            letterSpacing: 0.6,
                                          }}
                                        >
                                          stdin source
                                        </Typography>
                                        <Typography
                                          variant="body2"
                                          sx={{
                                            fontWeight: 700,
                                            color: '#f8fafc',
                                            fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
                                          }}
                                        >
                                          {stdinSourceLabel || ''}
                                        </Typography>
                                      </Stack>
                                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                                        <Button
                                          size="small"
                                          variant="outlined"
                                          startIcon={<UploadRounded />}
                                          onClick={openStdinFilePicker}
                                          sx={{
                                            borderColor: 'rgba(129, 140, 248, 0.65)',
                                            color: '#c7d2fe',
                                            '&:hover': {
                                              borderColor: 'rgba(165, 180, 252, 0.9)',
                                              backgroundColor: 'rgba(79, 70, 229, 0.16)',
                                            },
                                          }}
                                        >
                                          Upload stdin file
                                        </Button>
                                        <Button
                                          size="small"
                                          variant="text"
                                          onClick={clearStdin}
                                          disabled={!stdinText && !stdinSourceLabel}
                                          sx={{
                                            color: 'rgba(148, 163, 184, 0.96)',
                                            '&:hover': {
                                              backgroundColor: 'rgba(148, 163, 184, 0.08)',
                                            },
                                          }}
                                        >
                                          Clear stdin
                                        </Button>
                                      </Stack>
                                    </Stack>
                                    <Box
                                      sx={{
                                        px: 1.1,
                                        py: 0.9,
                                        borderBottom: '1px solid rgba(148, 163, 184, 0.1)',
                                        backgroundColor: 'rgba(15, 23, 42, 0.92)',
                                        fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
                                        fontSize: 12.5,
                                        color: '#cbd5e1',
                                        overflowX: 'auto',
                                        whiteSpace: 'pre',
                                      }}
                                    >
                                      {'$ stdin'}
                                    </Box>
                                    <TextField
                                      label="stdin (optional)"
                                      size="small"
                                      value={stdinText}
                                      onChange={(event) => {
                                        setStdinText(event.target.value)
                                        setStdinUploadError('')
                                      }}
                                      multiline
                                      minRows={4}
                                      maxRows={12}
                                      fullWidth
                                      sx={{
                                        ...terminalTextFieldSx,
                                        '& .MuiOutlinedInput-root': {
                                          ...terminalTextFieldSx['& .MuiOutlinedInput-root'],
                                          borderRadius: 0,
                                          '& fieldset': {
                                            border: 'none',
                                          },
                                        },
                                      }}
                                    />
                                    <Box
                                      sx={{
                                        px: 1.1,
                                        py: 0.8,
                                        backgroundColor: 'rgba(15, 23, 42, 0.98)',
                                        borderTop: '1px solid rgba(148, 163, 184, 0.1)',
                                      }}
                                    >
                                      <Typography
                                        variant="caption"
                                        sx={{
                                          color: 'rgba(148, 163, 184, 0.9)',
                                          fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
                                        }}
                                      >
                                        {`Type input here or load a text file up to ${formatBytes(MAX_STDIN_UPLOAD_BYTES)}.`}
                                      </Typography>
                                    </Box>
                                  </Paper>
                                  {stdinUploadError ? <Alert severity="error">{stdinUploadError}</Alert> : null}
                                </Stack>
                              ) : null}
                            </Stack>
                          </Collapse>

                          <Collapse in={isFileCapability && selectedSetupPanel === 'files'}>
                            <Stack spacing={1}>
                              <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                                <Box>
                                  <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#f8fafc' }}>
                                    Temporary input files
                                  </Typography>
                                  <Typography variant="caption" sx={{ color: 'rgba(226, 232, 240, 0.72)' }}>
                                    These files exist only for this run.
                                  </Typography>
                                </Box>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  startIcon={<AddRounded />}
                                  onClick={addInputFile}
                                  sx={{
                                    borderColor: 'rgba(129, 140, 248, 0.65)',
                                    color: '#c7d2fe',
                                    '&:hover': {
                                      borderColor: 'rgba(165, 180, 252, 0.9)',
                                      backgroundColor: 'rgba(79, 70, 229, 0.16)',
                                    },
                                  }}
                                >
                                  Add file
                                </Button>
                              </Stack>
                              {inputFiles.length ? (
                                <Stack spacing={1}>
                                  {inputFiles.map((entry) => (
                                    <Paper
                                      key={entry.id}
                                      variant="outlined"
                                      sx={{
                                        p: 1,
                                        borderRadius: 2,
                                        borderColor: 'rgba(148, 163, 184, 0.18)',
                                        backgroundColor: 'rgba(15, 23, 42, 0.6)',
                                      }}
                                    >
                                      <Stack spacing={1}>
                                        <Stack direction="row" spacing={1} alignItems="center">
                                          <TextField
                                            label="File path"
                                            size="small"
                                            value={entry.path}
                                            onChange={(event) => updateInputFile(entry.id, 'path', event.target.value)}
                                            fullWidth
                                            sx={terminalTextFieldSx}
                                          />
                                          <Tooltip title="Remove file">
                                            <span>
                                              <IconButton
                                                size="small"
                                                onClick={() => removeInputFile(entry.id)}
                                                sx={{ color: '#fca5a5' }}
                                              >
                                                <DeleteRounded fontSize="small" />
                                              </IconButton>
                                            </span>
                                          </Tooltip>
                                        </Stack>
                                        <TextField
                                          label="File content"
                                          size="small"
                                          value={entry.content}
                                          onChange={(event) => updateInputFile(entry.id, 'content', event.target.value)}
                                          multiline
                                          minRows={4}
                                          fullWidth
                                          sx={terminalTextFieldSx}
                                        />
                                      </Stack>
                                    </Paper>
                                  ))}
                                </Stack>
                              ) : (
                                <Typography variant="body2" sx={{ color: 'rgba(226, 232, 240, 0.72)' }}>
                                  No temporary files yet. Add one if your program expects file-based input.
                                </Typography>
                              )}
                            </Stack>
                          </Collapse>
                        </Stack>
                      </Box>
                    </Collapse>

                    <Box
                      component="pre"
                      sx={{
                        m: 0,
                        px: 1.35,
                        py: 1.25,
                        minHeight: 280,
                        maxHeight: 420,
                        overflow: 'auto',
                        backgroundColor: '#020617',
                        color: runError ? '#fecaca' : '#e2e8f0',
                        fontSize: 12.5,
                        lineHeight: 1.6,
                        fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {terminalOutput}
                    </Box>
                  </Stack>
                </Paper>

                {isFileCapability && runResult ? (
                  <Stack spacing={1.5}>
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 0,
                        borderRadius: 2.5,
                        overflow: 'hidden',
                        borderColor: 'rgba(15, 23, 42, 0.08)',
                        backgroundColor: '#0f172a',
                      }}
                    >
                      <Stack spacing={1}>
                        <Stack
                          direction="row"
                          justifyContent="space-between"
                          alignItems="center"
                          gap={1}
                          sx={{
                            px: 1.35,
                            py: 1,
                            borderBottom: '1px solid rgba(255,255,255,0.08)',
                            backgroundColor: 'rgba(15, 23, 42, 0.92)',
                          }}
                        >
                          <Box>
                            <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#f8fafc' }}>
                              Produced files
                            </Typography>
                            <Typography variant="body2" sx={{ color: 'rgba(226, 232, 240, 0.72)' }}>
                              Inspect files created or modified during this run.
                            </Typography>
                          </Box>
                          <Typography variant="caption" sx={{ color: 'rgba(148, 163, 184, 0.9)' }}>
                            {Array.isArray(runResult.produced_files) ? `${runResult.produced_files.length} file${runResult.produced_files.length === 1 ? '' : 's'}` : '0 files'}
                          </Typography>
                        </Stack>

                        {runResult.produced_files?.length ? (
                          <Box
                            sx={{
                              px: 1.35,
                              py: 1.2,
                              display: 'grid',
                              gridTemplateColumns: { xs: '1fr', lg: '260px minmax(0, 1fr)' },
                              gap: 1,
                              alignItems: 'start',
                            }}
                          >
                            <Stack spacing={0.75}>
                              {runResult.produced_files.map((entry) => {
                                const selected = selectedProducedFile?.name === entry.name
                                return (
                                  <Button
                                    key={entry.name}
                                    onClick={() => setSelectedProducedFileName(entry.name)}
                                    sx={{
                                      justifyContent: 'space-between',
                                      alignItems: 'flex-start',
                                      textTransform: 'none',
                                      px: 1.1,
                                      py: 0.9,
                                      borderRadius: 2,
                                      border: '1px solid',
                                      borderColor: selected ? 'rgba(129, 140, 248, 0.9)' : 'rgba(148, 163, 184, 0.18)',
                                      backgroundColor: selected ? 'rgba(79, 70, 229, 0.16)' : 'rgba(15, 23, 42, 0.58)',
                                      color: '#e2e8f0',
                                      '&:hover': {
                                        backgroundColor: selected ? 'rgba(79, 70, 229, 0.22)' : 'rgba(30, 41, 59, 0.92)',
                                        borderColor: selected ? 'rgba(165, 180, 252, 0.95)' : 'rgba(129, 140, 248, 0.42)',
                                      },
                                    }}
                                  >
                                    <Stack spacing={0.2} alignItems="flex-start" sx={{ minWidth: 0, flex: 1 }}>
                                      <Typography
                                        variant="body2"
                                        sx={{
                                          fontWeight: 700,
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          whiteSpace: 'nowrap',
                                          width: '100%',
                                          textAlign: 'left',
                                        }}
                                      >
                                        {entry.name}
                                      </Typography>
                                      <Typography variant="caption" sx={{ color: 'rgba(148, 163, 184, 0.88)' }}>
                                        {`${entry.kind === 'modified' ? 'Modified' : 'New'} • ${formatBytes(entry.size || 0)}`}
                                      </Typography>
                                    </Stack>
                                  </Button>
                                )
                              })}
                            </Stack>

                            <Paper
                              variant="outlined"
                              sx={{
                                p: 1.1,
                                borderRadius: 2,
                                borderColor: 'rgba(148, 163, 184, 0.18)',
                                backgroundColor: 'rgba(15, 23, 42, 0.58)',
                                minHeight: 220,
                              }}
                            >
                              {selectedProducedFile ? (
                                <Stack spacing={0.8} sx={{ height: '100%' }}>
                                  <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
                                    <Typography variant="body2" sx={{ fontWeight: 700, color: '#f8fafc' }}>
                                      {selectedProducedFile.name}
                                    </Typography>
                                    <Typography variant="caption" sx={{ color: 'rgba(148, 163, 184, 0.88)' }}>
                                      {`${selectedProducedFile.kind === 'modified' ? 'Modified' : 'New'} • ${formatBytes(selectedProducedFile.size || 0)}`}
                                    </Typography>
                                  </Stack>
                                  {selectedProducedFile.is_text ? (
                                    <Box
                                      component="pre"
                                      sx={{
                                        m: 0,
                                        flex: 1,
                                        minHeight: 180,
                                        maxHeight: 360,
                                        overflow: 'auto',
                                        borderRadius: 2,
                                        border: '1px solid',
                                        borderColor: 'rgba(148, 163, 184, 0.12)',
                                        backgroundColor: '#020617',
                                        p: 1.1,
                                        color: '#e2e8f0',
                                        fontSize: 12,
                                        lineHeight: 1.55,
                                        fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word',
                                      }}
                                    >
                                      {selectedProducedFile.content || '(empty file)'}
                                    </Box>
                                  ) : (
                                    <Typography variant="body2" sx={{ color: 'rgba(226, 232, 240, 0.72)' }}>
                                      Binary file preview is not shown here.
                                    </Typography>
                                  )}
                                </Stack>
                              ) : (
                                <Typography variant="body2" sx={{ color: 'rgba(226, 232, 240, 0.72)' }}>
                                  Select a produced file to preview it.
                                </Typography>
                              )}
                            </Paper>
                          </Box>
                        ) : (
                          <Typography variant="body2" sx={{ px: 1.35, py: 1.2, color: 'rgba(226, 232, 240, 0.72)' }}>
                            This run did not create or modify any files.
                          </Typography>
                        )}
                      </Stack>
                    </Paper>
                  </Stack>
                ) : null}
              </>
            ) : null}
          </Stack>
        </Paper>
      ) : null}
    </Stack>
  )
}

export default AssignmentRunWorkspace
