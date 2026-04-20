import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import { apiRequest } from '../api/client.js'

const formatDate = (value) => {
  if (!value) return 'Pending'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Pending'
  return date.toLocaleString()
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

const parseExcludedPaths = (value) =>
  Array.from(
    new Set(
      String(value || '')
        .split(/[\n,]+/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  )

function CodeDiffPanel({ title, source, highlightRanges }) {
  const normalizedRanges = (highlightRanges || [])
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end))
    .map((range) => ({
      start: Number(range.start),
      end: Number(range.end),
    }))

  const lines = String(source || '').split('\n')

  const isHighlighted = (lineNumber) =>
    normalizedRanges.some((range) => lineNumber >= range.start && lineNumber <= range.end)

  return (
    <Paper
      elevation={0}
      sx={{
        flex: 1,
        p: 1.5,
        borderRadius: 1,
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Stack spacing={1}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
          {title}
        </Typography>
        <Box
          sx={{
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'divider',
            backgroundColor: 'background.default',
            overflow: 'auto',
            minHeight: 360,
            maxHeight: 560,
            fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
            fontSize: 13,
          }}
        >
          {lines.map((line, index) => {
            const lineNumber = index + 1
            const highlighted = isHighlighted(lineNumber)
            return (
              <Box
                key={`${title}:${lineNumber}`}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '56px 1fr',
                  gap: 1.5,
                  px: 1.25,
                  py: 0.25,
                  backgroundColor: highlighted ? 'rgba(251, 191, 36, 0.18)' : 'transparent',
                }}
              >
                <Typography
                  component="span"
                  variant="caption"
                  sx={{
                    textAlign: 'right',
                    color: 'text.secondary',
                    userSelect: 'none',
                    fontFamily: 'inherit',
                  }}
                >
                  {lineNumber}
                </Typography>
                <Typography
                  component="span"
                  variant="caption"
                  sx={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: 'text.primary',
                    fontFamily: 'inherit',
                  }}
                >
                  {line || ' '}
                </Typography>
              </Box>
            )
          })}
        </Box>
      </Stack>
    </Paper>
  )
}

function ReviewDialog({ open, onClose, loading, error, reviewData, onSelectPair }) {
  const matchedFiles = reviewData?.matched_files || []
  const selectedPair = reviewData?.selected_pair || null
  const leftRanges = (selectedPair?.matched_regions || []).map((region) => ({
    start: region.left_start_line,
    end: region.left_end_line,
  }))
  const rightRanges = (selectedPair?.matched_regions || []).map((region) => ({
    start: region.right_start_line,
    end: region.right_end_line,
  }))

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>Review similarity</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {loading ? (
            <Stack direction="row" spacing={1} alignItems="center" color="text.secondary">
              <CircularProgress size={18} />
              <Typography variant="body2">Loading matched files…</Typography>
            </Stack>
          ) : null}

          {reviewData ? (
            <>
              {matchedFiles.length > 1 ? (
                <TextField
                  select
                  size="small"
                  label="Matched file pair"
                  value={`${selectedPair?.left_path || ''}::${selectedPair?.right_path || ''}`}
                  onChange={(event) => {
                    const [leftPath, rightPath] = String(event.target.value || '').split('::')
                    onSelectPair(leftPath, rightPath)
                  }}
                  sx={{ maxWidth: 420 }}
                >
                  {matchedFiles.map((entry) => (
                    <MenuItem
                      key={`${entry.left_path}:${entry.right_path}`}
                      value={`${entry.left_path}::${entry.right_path}`}
                    >
                      {entry.left_path} ↔ {entry.right_path}
                    </MenuItem>
                  ))}
                </TextField>
              ) : null}

              {selectedPair ? (
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                  <Chip
                    size="small"
                    color="warning"
                    label={`${Number(selectedPair.score || 0).toFixed(1)}% file similarity`}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {selectedPair.left_token_count || 0} tokens vs {selectedPair.right_token_count || 0} tokens
                  </Typography>
                </Stack>
              ) : null}

              {selectedPair?.matched_regions?.length ? (
                <Stack spacing={0.5}>
                  {selectedPair.matched_regions.slice(0, 4).map((region, index) => (
                    <Typography key={`region-${index}`} variant="caption" color="text.secondary">
                      Match {index + 1}: left lines {region.left_start_line}-{region.left_end_line} · right lines {region.right_start_line}-{region.right_end_line}
                    </Typography>
                  ))}
                </Stack>
              ) : null}

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <CodeDiffPanel
                  title={selectedPair?.left_path || 'Left submission'}
                  source={reviewData.left_source}
                  highlightRanges={leftRanges}
                />
                <CodeDiffPanel
                  title={selectedPair?.right_path || 'Right submission'}
                  source={reviewData.right_source}
                  highlightRanges={rightRanges}
                />
              </Stack>
            </>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}

function FindingCard({ finding, courseId, assignmentId, onReview }) {
  const left = finding.submission_context
  const right = finding.matched_submission_context
  const matchedFiles = finding.matched_files || []

  return (
    <Paper
      elevation={0}
      sx={{
        p: 1.75,
        borderRadius: 1,
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Stack spacing={1.25}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', md: 'center' }}
        >
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Chip size="small" color="warning" label={`${Number(finding.score || 0).toFixed(1)}% similarity`} />
            <Typography variant="body2" color="text.secondary">
              {finding.matched_files_count} matching file{finding.matched_files_count === 1 ? '' : 's'}
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Scanned {formatDate(finding.created_at)}
          </Typography>
        </Stack>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
              {finding.owner_label}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {finding.owner_members?.length ? `Members: ${finding.owner_members.join(', ')}` : 'No members'}
            </Typography>
            {left ? (
              <>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  Attempt {left.attempt_number} · {formatDate(left.submitted_at)} · submitted by {left.submitted_by_username}
                </Typography>
                <Button
                  size="small"
                  variant="text"
                  component={RouterLink}
                  to={`/course/${courseId}/assignments/${assignmentId}/submissions/${left.id}`}
                  sx={{ mt: 0.5, px: 0, minWidth: 0, fontWeight: 700 }}
                >
                  View submission
                </Button>
              </>
            ) : null}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
              {finding.matched_owner_label}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {finding.matched_owner_members?.length
                ? `Members: ${finding.matched_owner_members.join(', ')}`
                : 'No members'}
            </Typography>
            {right ? (
              <>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  Attempt {right.attempt_number} · {formatDate(right.submitted_at)} · submitted by {right.submitted_by_username}
                </Typography>
                <Button
                  size="small"
                  variant="text"
                  component={RouterLink}
                  to={`/course/${courseId}/assignments/${assignmentId}/submissions/${right.id}`}
                  sx={{ mt: 0.5, px: 0, minWidth: 0, fontWeight: 700 }}
                >
                  View submission
                </Button>
              </>
            ) : null}
          </Box>
        </Stack>

        {matchedFiles.length ? (
          <Stack spacing={0.5}>
            {matchedFiles.slice(0, 3).map((fileMatch) => (
              <Typography key={`${fileMatch.left_path}:${fileMatch.right_path}`} variant="body2" color="text.secondary">
                {fileMatch.left_path} ↔ {fileMatch.right_path} · {Number(fileMatch.score || 0).toFixed(1)}%
              </Typography>
            ))}
          </Stack>
        ) : null}

        <Stack direction="row" spacing={1}>
          <Button size="small" variant="contained" onClick={() => onReview(finding)}>
            Compare code
          </Button>
        </Stack>
      </Stack>
    </Paper>
  )
}

export default function CourseAssignmentIntegrity({ assignmentId, courseId }) {
  const [scans, setScans] = useState([])
  const [selectedScanId, setSelectedScanId] = useState('')
  const [findings, setFindings] = useState([])
  const [threshold, setThreshold] = useState(35)
  const [latestOnly] = useState(true)
  const [autoExcludedPaths, setAutoExcludedPaths] = useState([])
  const [loadingScans, setLoadingScans] = useState(true)
  const [loadingFindings, setLoadingFindings] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [excludedPathsInput, setExcludedPathsInput] = useState('')
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const [reviewFinding, setReviewFinding] = useState(null)
  const [reviewData, setReviewData] = useState(null)
  const [showSettings, setShowSettings] = useState(false)

  const selectedScan = useMemo(
    () => scans.find((scan) => String(scan.id) === String(selectedScanId || '')) || null,
    [scans, selectedScanId],
  )

  const loadScans = async (preferredScanId = '') => {
    setLoadingScans(true)
    setError('')
    try {
      const data = await apiRequest(`/api/assignments/${assignmentId}/integrity-scans/`)
      setScans(data)
      const nextScanId =
        (preferredScanId && data.some((scan) => String(scan.id) === String(preferredScanId)) && preferredScanId) ||
        data[0]?.id ||
        ''
      setSelectedScanId(nextScanId)
    } catch (err) {
      setError(extractApiErrorMessage(err, 'Unable to load integrity scans.'))
    } finally {
      setLoadingScans(false)
    }
  }

  useEffect(() => {
    if (!assignmentId) return
    loadScans()
  }, [assignmentId])

  useEffect(() => {
    if (!assignmentId) return
    let active = true
    const run = async () => {
      try {
        const data = await apiRequest(`/api/assignments/${assignmentId}/integrity-settings/`)
        if (!active) return
        setThreshold(Number(data.threshold ?? 35))
        setLatestOnly(true)
        setExcludedPathsInput((data.excluded_paths || []).join(', '))
        setAutoExcludedPaths(data.auto_excluded_paths || [])
      } catch (_err) {
        if (!active) return
      }
    }
    run()
    return () => {
      active = false
    }
  }, [assignmentId])

  useEffect(() => {
    if (!selectedScanId) {
      setFindings([])
      return
    }
    let active = true
    const run = async () => {
      setLoadingFindings(true)
      setError('')
      try {
        const data = await apiRequest(
          `/api/assignments/${assignmentId}/integrity-scans/${selectedScanId}/findings/`,
        )
        if (!active) return
        setFindings(data.findings || [])
      } catch (err) {
        if (!active) return
        setError(extractApiErrorMessage(err, 'Unable to load scan findings.'))
      } finally {
        if (active) setLoadingFindings(false)
      }
    }
    run()
    return () => {
      active = false
    }
  }, [assignmentId, selectedScanId])

  const handleRunScan = async () => {
    setRunning(true)
    setError('')
    try {
          const created = await apiRequest(`/api/assignments/${assignmentId}/integrity-scans/`, {
        method: 'POST',
        body: {
          threshold: Number(threshold),
          latest_only: true,
          excluded_paths: parseExcludedPaths(excludedPathsInput),
        },
      })
      await loadScans(created.id)
    } catch (err) {
      setError(extractApiErrorMessage(err, 'Unable to run plagiarism scan.'))
    } finally {
      setRunning(false)
    }
  }

  const loadReview = async (finding, selectedPair = null) => {
    if (!finding?.id || !selectedScanId) return
    setReviewLoading(true)
    setReviewError('')
    try {
      const params = new URLSearchParams()
      if (selectedPair?.left_path && selectedPair?.right_path) {
        params.set('left_path', selectedPair.left_path)
        params.set('right_path', selectedPair.right_path)
      }
      const query = params.toString()
      const data = await apiRequest(
        `/api/assignments/${assignmentId}/integrity-scans/${selectedScanId}/findings/${finding.id}/review/${query ? `?${query}` : ''}`,
      )
      setReviewData(data)
    } catch (err) {
      setReviewError(extractApiErrorMessage(err, 'Unable to load matched code.'))
    } finally {
      setReviewLoading(false)
    }
  }

  const handleOpenReview = async (finding) => {
    setReviewFinding(finding)
    setReviewData(null)
    setReviewOpen(true)
    await loadReview(finding)
  }

  return (
    <Stack spacing={2}>
      <Paper
        elevation={0}
        sx={{
          p: 1.75,
          borderRadius: 1,
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Stack spacing={1}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1}
            justifyContent="space-between"
            alignItems={{ xs: 'stretch', md: 'center' }}
          >
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                Integrity
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Compare submissions for suspicious code similarity.
              </Typography>
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
              <Button
                variant="text"
                size="small"
                onClick={() => setShowSettings((value) => !value)}
                sx={{ px: 0, minWidth: 0, fontWeight: 700 }}
              >
                {showSettings ? 'Hide scan settings' : 'Scan settings'}
              </Button>
              <Button variant="contained" onClick={handleRunScan} disabled={running}>
                {running ? 'Running…' : 'Run scan'}
              </Button>
            </Stack>
          </Stack>

          {error ? <Alert severity="error">{error}</Alert> : null}

          {showSettings ? (
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={1}
              alignItems={{ xs: 'stretch', md: 'center' }}
            >
              <TextField
                size="small"
                type="number"
                label="Threshold"
                value={threshold}
                onChange={(event) => setThreshold(event.target.value)}
                inputProps={{ min: 0, max: 100, step: 1 }}
                sx={{ width: 120 }}
              />
              <TextField
                size="small"
                label="Extra files to ignore"
                placeholder="Driver.java, Starter.java"
                value={excludedPathsInput}
                onChange={(event) => setExcludedPathsInput(event.target.value)}
                helperText={
                  autoExcludedPaths.length
                    ? `Assignment files are ignored automatically. Add only extra paths here.`
                    : 'Comma or line separated file paths.'
                }
                sx={{ minWidth: { xs: '100%', sm: 260 } }}
              />
            </Stack>
          ) : null}

          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            justifyContent="space-between"
            alignItems={{ xs: 'stretch', md: 'center' }}
          >
            <TextField
              select
              size="small"
              label="Review scan"
              value={selectedScanId}
              onChange={(event) => setSelectedScanId(event.target.value)}
              sx={{ minWidth: { xs: '100%', md: 280 } }}
              disabled={loadingScans || !scans.length}
            >
              {scans.map((scan) => (
                <MenuItem key={scan.id} value={scan.id}>
                  {formatDate(scan.created_at)} · {scan.findings_count} finding{scan.findings_count === 1 ? '' : 's'}
                </MenuItem>
              ))}
            </TextField>

            {selectedScan ? (
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Chip
                  size="small"
                  label={selectedScan.status}
                  color={
                    selectedScan.status === 'DONE'
                      ? 'success'
                      : selectedScan.status === 'FAILED'
                      ? 'error'
                      : 'default'
                  }
                />
                <Typography variant="caption" color="text.secondary">
                  {selectedScan.threshold}% · {selectedScan.latest_only ? 'Latest only' : 'All attempts'}
                  {selectedScan.auto_excluded_paths?.length
                    ? ` · Auto-ignore ${selectedScan.auto_excluded_paths.length}`
                    : ''}
                  {selectedScan.manual_excluded_paths?.length
                    ? ` · Manual ${selectedScan.manual_excluded_paths.length}`
                    : ''}
                </Typography>
              </Stack>
            ) : null}
          </Stack>
        </Stack>
      </Paper>

      <Paper
        elevation={0}
        sx={{
          p: 2,
          borderRadius: 1,
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Stack spacing={1.5}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
              Findings
            </Typography>
            {selectedScan ? (
              <Typography variant="caption" color="text.secondary">
                {selectedScan.findings_count} suspicious pair{selectedScan.findings_count === 1 ? '' : 's'}
              </Typography>
            ) : null}
          </Stack>
          <Divider />
          {loadingScans || loadingFindings ? (
            <Stack direction="row" spacing={1} alignItems="center" color="text.secondary">
              <CircularProgress size={18} />
              <Typography variant="body2">Loading findings…</Typography>
            </Stack>
          ) : !selectedScan ? (
            <Alert severity="info">Run a plagiarism scan to review suspicious pairs.</Alert>
          ) : !findings.length ? (
            <Alert severity="success">
              No suspicious pairs crossed the selected threshold for this scan.
            </Alert>
          ) : (
            <Stack spacing={1.5}>
              {findings.map((finding) => (
                <FindingCard
                  key={finding.id}
                  finding={finding}
                  assignmentId={assignmentId}
                  courseId={courseId}
                  onReview={handleOpenReview}
                />
              ))}
            </Stack>
          )}
        </Stack>
      </Paper>

      <ReviewDialog
        open={reviewOpen}
        onClose={() => {
          setReviewOpen(false)
          setReviewError('')
          setReviewData(null)
          setReviewFinding(null)
        }}
        loading={reviewLoading}
        error={reviewError}
        reviewData={reviewData}
        onSelectPair={(leftPath, rightPath) =>
          loadReview(reviewFinding, {
            left_path: leftPath,
            right_path: rightPath,
          })
        }
      />
    </Stack>
  )
}
