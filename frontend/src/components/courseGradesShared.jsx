import { useEffect, useState } from 'react'
import {
  Chip,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material'

export function formatNumber(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return '0.00'
  }
  return number.toFixed(2)
}

export function formatPercent(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return '0.0%'
  }
  return `${number.toFixed(1)}%`
}

export function statusChip(statusRaw) {
  const status = String(statusRaw || 'NOT_SUBMITTED')
  let color = 'default'
  if (status === 'GRADED') color = 'success'
  if (status === 'FAILED') color = 'error'
  if (status === 'QUEUED' || status === 'RUNNING') color = 'warning'
  const label = status === 'GRADED' ? 'PASS' : status.replaceAll('_', ' ')
  return <Chip label={label} size="small" color={color} variant="outlined" />
}

export function resolveGradeState(stateRaw, row) {
  if (stateRaw) {
    return String(stateRaw)
  }
  if (row?.attempt_number || row?.submitted_at || (row?.status && String(row.status) !== 'NOT_SUBMITTED')) {
    return 'UNGRADED'
  }
  return 'NOT_SUBMITTED'
}

export function gradeStateChip(stateRaw, row) {
  const state = resolveGradeState(stateRaw, row)
  let color = 'default'
  if (state === 'GRADED') color = 'success'
  if (state === 'UNGRADED') color = 'warning'
  if (state === 'MISSING') color = 'error'
  const labelMap = {
    GRADED: 'Graded',
    UNGRADED: 'Needs grading',
    MISSING: 'Missing',
    NOT_SUBMITTED: 'Not submitted',
  }
  return <Chip label={labelMap[state] || state.replaceAll('_', ' ')} size="small" color={color} variant="outlined" />
}

export function formatGradeStateLabel(stateRaw, row) {
  const state = resolveGradeState(stateRaw, row)
  const labelMap = {
    GRADED: 'Graded',
    UNGRADED: 'Needs grading',
    MISSING: 'Missing',
    NOT_SUBMITTED: 'Not submitted',
  }
  return labelMap[state] || state.replaceAll('_', ' ')
}

export function formatRunLabel(statusRaw) {
  const status = String(statusRaw || 'NOT_SUBMITTED')
  if (status === 'GRADED') return 'Pass'
  if (status === 'FAILED') return 'Fail'
  if (status === 'NOT_SUBMITTED') return '—'
  return status.replaceAll('_', ' ')
}

export function buildEditableGradeRows(list) {
  return list.map((row) => {
    const score = Number(row.score || 0)
    const maxScore = Number(row.max_score || 0)
    const percent = Number(row.percent ?? (maxScore > 0 ? (score / maxScore) * 100 : 0))
    return {
      ...row,
      score,
      max_score: maxScore,
      percent,
      _saving: false,
      _error: '',
      _dirty: false,
      _original_score: score,
      _original_max_score: maxScore,
    }
  })
}

export function renderSaveState(row) {
  if (!row?.attempt_number) {
    return (
      <Typography variant="caption" color="text.secondary">
        No submission
      </Typography>
    )
  }
  if (row?._saving) {
    return (
      <Stack direction="row" spacing={0.75} alignItems="center">
        <CircularProgress size={12} />
        <Typography variant="caption">Saving</Typography>
      </Stack>
    )
  }
  if (row?._error) {
    return (
      <Typography variant="caption" color="error.main" title={row._error} noWrap>
        {row._error}
      </Typography>
    )
  }
  if (row?._dirty) {
    return (
      <Typography variant="caption" color="warning.main">
        Pending
      </Typography>
    )
  }
  return '—'
}

export function InlineNumberCell({ value, disabled, onCommit }) {
  const normalized = formatNumber(value)
  const [draft, setDraft] = useState(normalized)

  useEffect(() => {
    setDraft(normalized)
  }, [normalized])

  const commit = () => {
    if (disabled) {
      return
    }
    if (String(draft).trim() === normalized) {
      return
    }
    onCommit(String(draft).trim())
  }

  return (
    <TextField
      size="small"
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') {
          return
        }
        event.preventDefault()
        event.currentTarget.blur()
      }}
      inputProps={{ inputMode: 'decimal' }}
      sx={{ width: 104 }}
    />
  )
}
