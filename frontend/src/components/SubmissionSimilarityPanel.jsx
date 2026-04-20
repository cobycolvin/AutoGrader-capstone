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
  MenuItem,
  Paper,
  Stack,
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
        p: 1.25,
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
            minHeight: 320,
            maxHeight: 520,
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

function SimilarityReviewDialog({ open, onClose, loading, error, reviewData, onSelectPair }) {
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
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
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

const normalizeSubmissionId = (value) => String(value || '')

const findingMatchesSubmission = (finding, submissionId) => {
  const targetId = normalizeSubmissionId(submissionId)
  return (
    normalizeSubmissionId(finding?.submission_context?.id) === targetId
    || normalizeSubmissionId(finding?.matched_submission_context?.id) === targetId
  )
}

const buildFindingPerspective = (finding, submissionId) => {
  const targetId = normalizeSubmissionId(submissionId)
  const currentIsLeft = normalizeSubmissionId(finding?.submission_context?.id) === targetId
  return {
    currentSubmissionContext: currentIsLeft ? finding?.submission_context : finding?.matched_submission_context,
    counterpartSubmissionContext: currentIsLeft ? finding?.matched_submission_context : finding?.submission_context,
    currentOwnerLabel: currentIsLeft ? finding?.owner_label : finding?.matched_owner_label,
    counterpartOwnerLabel: currentIsLeft ? finding?.matched_owner_label : finding?.owner_label,
    currentOwnerMembers: currentIsLeft ? finding?.owner_members : finding?.matched_owner_members,
    counterpartOwnerMembers: currentIsLeft ? finding?.matched_owner_members : finding?.owner_members,
  }
}

export default function SubmissionSimilarityPanel({ assignmentId, submissionId, courseId }) {
  const [scans, setScans] = useState([])
  const [selectedScanId, setSelectedScanId] = useState('')
  const [findings, setFindings] = useState([])
  const [scanThreshold, setScanThreshold] = useState(35)
  const [scanExcludedPaths, setScanExcludedPaths] = useState([])
  const [loadingScans, setLoadingScans] = useState(true)
  const [loadingFindings, setLoadingFindings] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const [reviewFinding, setReviewFinding] = useState(null)
  const [reviewData, setReviewData] = useState(null)

  const selectedScan = useMemo(
    () => scans.find((scan) => String(scan.id) === String(selectedScanId || '')) || null,
    [scans, selectedScanId],
  )

  const filteredFindings = useMemo(
    () => findings.filter((finding) => findingMatchesSubmission(finding, submissionId)),
    [findings, submissionId],
  )

  const loadScans = async (preferredScanId = '') => {
    setLoadingScans(true)
    setError('')
    try {
      const data = await apiRequest(`/api/assignments/${assignmentId}/integrity-scans/`)
      const rows = Array.isArray(data) ? data : []
      setScans(rows)
      const nextScanId =
        (preferredScanId && rows.some((scan) => String(scan.id) === String(preferredScanId)) && preferredScanId)
        || rows[0]?.id
        || ''
      setSelectedScanId(nextScanId)
    } catch (err) {
      setError(extractApiErrorMessage(err, 'Unable to load similarity scans.'))
      setScans([])
      setSelectedScanId('')
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
        setScanThreshold(Number(data.threshold ?? 35))
        setScanExcludedPaths(Array.isArray(data.excluded_paths) ? data.excluded_paths : [])
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
    if (!assignmentId || !selectedScanId) {
      setFindings([])
      return
    }
    let active = true
    const run = async () => {
      setLoadingFindings(true)
      setError('')
      try {
        const data = await apiRequest(`/api/assignments/${assignmentId}/integrity-scans/${selectedScanId}/findings/`)
        if (!active) return
        setFindings(Array.isArray(data?.findings) ? data.findings : [])
      } catch (err) {
        if (!active) return
        setError(extractApiErrorMessage(err, 'Unable to load similarity findings.'))
        setFindings([])
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
          threshold: Number(scanThreshold) || 35,
          latest_only: true,
          excluded_paths: scanExcludedPaths,
        },
      })
      await loadScans(created.id)
    } catch (err) {
      setError(extractApiErrorMessage(err, 'Unable to run similarity scan.'))
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
    <Stack spacing={1.25}>
      <Paper
        variant="outlined"
        sx={{
          p: 1.1,
          borderRadius: 1,
          backgroundColor: 'rgba(248,250,252,0.72)',
        }}
      >
        <Stack spacing={1}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', md: 'center' }}
          >
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                Similarity review
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Compare this submission against flagged matches from the assignment-wide similarity scan.
              </Typography>
            </Box>
            <Button
              size="small"
              variant="contained"
              onClick={handleRunScan}
              disabled={running}
              sx={{ borderRadius: 999, textTransform: 'none' }}
            >
              {running ? 'Scanning…' : scans.length ? 'Re-scan assignment' : 'Run similarity scan'}
            </Button>
          </Stack>

          {error ? <Alert severity="error">{error}</Alert> : null}

          {loadingScans ? (
            <Stack direction="row" spacing={1} alignItems="center" color="text.secondary">
              <CircularProgress size={18} />
              <Typography variant="body2">Loading similarity scans…</Typography>
            </Stack>
          ) : scans.length ? (
            <Stack spacing={1}>
              {scans.length > 1 ? (
                <TextField
                  select
                  size="small"
                  label="Similarity scan"
                  value={selectedScanId}
                  onChange={(event) => setSelectedScanId(event.target.value)}
                  sx={{ maxWidth: 340 }}
                >
                  {scans.map((scan) => (
                    <MenuItem key={scan.id} value={scan.id}>
                      {formatDate(scan.created_at)} · {scan.status}
                    </MenuItem>
                  ))}
                </TextField>
              ) : null}

              {selectedScan ? (
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  <Chip size="small" variant="outlined" label={`Status: ${selectedScan.status}`} />
                  <Chip size="small" variant="outlined" label={`Findings: ${selectedScan.findings_count || 0}`} />
                  {selectedScan.highest_score != null ? (
                    <Chip
                      size="small"
                      color="warning"
                      variant="outlined"
                      label={`Top match ${Number(selectedScan.highest_score).toFixed(1)}%`}
                    />
                  ) : null}
                  <Chip size="small" variant="outlined" label={`Scanned ${formatDate(selectedScan.created_at)}`} />
                </Stack>
              ) : null}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No similarity scans have been run for this assignment yet.
            </Typography>
          )}
        </Stack>
      </Paper>

      {loadingFindings ? (
        <Stack direction="row" spacing={1} alignItems="center" color="text.secondary">
          <CircularProgress size={18} />
          <Typography variant="body2">Loading matches for this submission…</Typography>
        </Stack>
      ) : selectedScan?.status !== 'DONE' ? (
        <Alert severity="info" variant="outlined">
          {selectedScan
            ? `The selected similarity scan is ${String(selectedScan.status || '').toLowerCase()}. Results will appear here when it finishes.`
            : 'Run a similarity scan to compare this submission with the rest of the class.'}
        </Alert>
      ) : filteredFindings.length ? (
        filteredFindings.map((finding) => {
          const perspective = buildFindingPerspective(finding, submissionId)
          const counterpart = perspective.counterpartSubmissionContext
          return (
            <Paper
              key={finding.id}
              variant="outlined"
              sx={{
                p: 1.25,
                borderRadius: 1,
                backgroundColor: '#fff',
              }}
            >
              <Stack spacing={1}>
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={1}
                  justifyContent="space-between"
                  alignItems={{ xs: 'flex-start', md: 'center' }}
                >
                  <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Chip
                      size="small"
                      color="warning"
                      label={`${Number(finding.score || 0).toFixed(1)}% similarity`}
                    />
                    <Typography variant="body2" color="text.secondary">
                      {finding.matched_files_count} matching file{finding.matched_files_count === 1 ? '' : 's'}
                    </Typography>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    Scanned {formatDate(finding.created_at)}
                  </Typography>
                </Stack>

                <Stack spacing={0.4}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                    Matched with {perspective.counterpartOwnerLabel}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {perspective.counterpartOwnerMembers?.length
                      ? `Members: ${perspective.counterpartOwnerMembers.join(', ')}`
                      : 'No member list available'}
                  </Typography>
                  {counterpart ? (
                    <Typography variant="caption" color="text.secondary">
                      Attempt {counterpart.attempt_number || '—'} · {formatDate(counterpart.submitted_at)} · submitted by {counterpart.submitted_by_username || '—'}
                    </Typography>
                  ) : null}
                </Stack>

                {(finding.matched_files || []).length ? (
                  <Stack spacing={0.35}>
                    {(finding.matched_files || []).slice(0, 3).map((fileMatch) => (
                      <Typography
                        key={`${fileMatch.left_path}:${fileMatch.right_path}`}
                        variant="body2"
                        color="text.secondary"
                      >
                        {fileMatch.left_path} ↔ {fileMatch.right_path} · {Number(fileMatch.score || 0).toFixed(1)}%
                      </Typography>
                    ))}
                  </Stack>
                ) : null}

                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Button size="small" variant="contained" onClick={() => handleOpenReview(finding)}>
                    Compare code
                  </Button>
                  {counterpart?.id ? (
                    <Button
                      size="small"
                      variant="outlined"
                      component={RouterLink}
                      to={`/course/${courseId}/assignments/${assignmentId}/submissions/${counterpart.id}?focus=review`}
                    >
                      Open matched submission
                    </Button>
                  ) : null}
                </Stack>
              </Stack>
            </Paper>
          )
        })
      ) : selectedScan ? (
        <Alert severity="success" variant="outlined">
          No flagged similarity findings involve this submission in the selected scan.
        </Alert>
      ) : null}

      <SimilarityReviewDialog
        open={reviewOpen}
        onClose={() => {
          setReviewOpen(false)
          setReviewFinding(null)
          setReviewData(null)
          setReviewError('')
        }}
        loading={reviewLoading}
        error={reviewError}
        reviewData={reviewData}
        onSelectPair={(leftPath, rightPath) => loadReview(reviewFinding, { left_path: leftPath, right_path: rightPath })}
      />
    </Stack>
  )
}
