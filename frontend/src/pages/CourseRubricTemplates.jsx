import { useEffect, useState } from 'react'
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
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  AddRounded,
  DeleteRounded,
  EditRounded,
  ExpandMoreRounded,
  LibraryBooksRounded,
} from '@mui/icons-material'
import { useParams } from 'react-router-dom'
import { apiRequest } from '../api/client.js'

const CARD_RADIUS = 2

function extractError(err, fallback) {
  return err?.message || fallback
}

function formatRubricNumber(value) {
  const parsed = Number(value)
  if (Number.isNaN(parsed)) return String(value ?? '')
  if (Number.isInteger(parsed)) return String(parsed)
  return parsed.toFixed(2).replace(/\.?0+$/, '')
}

function formatPointRange(minPoints, maxPoints) {
  const min = Number(minPoints)
  const max = Number(maxPoints)
  if (Number.isNaN(min) || Number.isNaN(max)) return ''
  if (min === max) return `${formatRubricNumber(max)} pts`
  return `${formatRubricNumber(min)}-${formatRubricNumber(max)} pts`
}

function hasScoringGuide(criteria) {
  return (criteria || []).some((criterion) => (criterion.levels || []).length > 0)
}

function CriteriaBar({ criteria }) {
  const total = criteria.reduce((s, c) => s + Number(c.max_points || 0), 0)
  if (!total || !criteria.length) return null
  return (
    <Stack direction="row" sx={{ height: 6, borderRadius: 999, overflow: 'hidden', bgcolor: 'grey.100' }}>
      {criteria.map((c, i) => {
        const pct = (Number(c.max_points || 0) / total) * 100
        const hues = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444']
        return <Box key={c.id || i} sx={{ width: `${pct}%`, bgcolor: hues[i % hues.length], borderRight: i < criteria.length - 1 ? '2px solid white' : 'none' }} />
      })}
    </Stack>
  )
}

function TemplateCard({ template, onEdit, onDelete, onNewVersion, readOnly }) {
  const [expanded, setExpanded] = useState(false)
  const version = template.active_version
  const criteria = version?.criteria || []
  const hasLevels = hasScoringGuide(criteria)

  return (
    <Paper
      elevation={0}
      sx={{
        borderRadius: CARD_RADIUS,
        border: '1px solid',
        borderColor: 'divider',
        overflow: 'hidden',
        transition: 'box-shadow 0.15s',
        '&:hover': { boxShadow: readOnly ? 'none' : '0 2px 12px rgba(99,102,241,0.10)' },
      }}
    >
      <Stack
        direction="row"
        alignItems="flex-start"
        sx={{ px: 2, pt: 1.75, pb: criteria.length ? 1.25 : 1.75 }}
        spacing={1.5}
      >
        {/* Icon accent */}
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: 1.5,
            bgcolor: readOnly ? 'primary.50' : 'grey.100',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            mt: 0.25,
          }}
        >
          <LibraryBooksRounded sx={{ fontSize: 18, color: readOnly ? 'primary.main' : 'text.secondary' }} />
        </Box>

        {/* Content */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" spacing={0.75} flexWrap="wrap">
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
              {template.name}
            </Typography>
            {readOnly && <Chip size="small" label="Standard" color="primary" variant="outlined" sx={{ fontSize: 10, height: 18 }} />}
            {!readOnly && version && (
              <Chip size="small" label={`v${version.version_number}`} variant="outlined" sx={{ fontSize: 10, height: 18 }} />
            )}
            {hasLevels && (
              <Chip size="small" label="Scoring guide" variant="outlined" sx={{ fontSize: 10, height: 18 }} />
            )}
            {version?.is_weighted && (
              <Chip size="small" label="Weighted" sx={{ fontSize: 10, height: 18, bgcolor: 'warning.50', color: 'warning.dark', border: '1px solid', borderColor: 'warning.200' }} />
            )}
          </Stack>
          {template.description ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.2, lineHeight: 1.4 }}>
              {template.description}
            </Typography>
          ) : null}
          {version ? (
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 0.75 }}>
              <Typography variant="caption" color="text.secondary">
                {version.criteria_count || 0} criteria
              </Typography>
              <Box sx={{ width: 3, height: 3, borderRadius: '50%', bgcolor: 'text.disabled' }} />
              <Typography variant="caption" color="text.secondary">
                {version.total_points || 0} pts
              </Typography>
              {version.is_weighted && (
                <>
                  <Box sx={{ width: 3, height: 3, borderRadius: '50%', bgcolor: 'text.disabled' }} />
                  <Typography variant="caption" color="text.secondary">{version.total_weight || 0} wt</Typography>
                </>
              )}
              {criteria.length > 0 && (
                <Button
                  size="small"
                  onClick={() => setExpanded((v) => !v)}
                  endIcon={<ExpandMoreRounded sx={{ fontSize: '14px !important', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />}
                  sx={{ textTransform: 'none', fontSize: 11, color: 'text.secondary', px: 0.5, py: 0, minWidth: 0, ml: 0.5 }}
                >
                  {expanded ? 'Hide' : 'Show'} {hasLevels ? 'rubric' : 'criteria'}
                </Button>
              )}
            </Stack>
          ) : null}
        </Box>

        {/* Actions */}
        {!readOnly && (
          <Stack direction="row" spacing={0} flexShrink={0} sx={{ mt: -0.25 }}>
            <Tooltip title="Edit name / description">
              <IconButton size="small" onClick={() => onEdit(template)} sx={{ color: 'text.secondary' }}>
                <EditRounded sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Save new version">
              <IconButton size="small" onClick={() => onNewVersion(template)} sx={{ color: 'text.secondary' }}>
                <LibraryBooksRounded sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete template">
              <IconButton size="small" color="error" onClick={() => onDelete(template)}>
                <DeleteRounded sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Stack>
        )}
      </Stack>

      {/* Proportional bar */}
      {!expanded && criteria.length > 0 && (
        <Box sx={{ px: 2, pb: 1.5 }}>
          <CriteriaBar criteria={criteria} isWeighted={version?.is_weighted} />
        </Box>
      )}

      {/* Expanded criteria table */}
      <Collapse in={expanded}>
        <Divider />
        <Stack>
          {criteria.map((c, i) => (
            <Stack
              key={c.id || i}
              sx={{
                px: 2,
                py: 1.1,
                bgcolor: i % 2 === 0 ? 'transparent' : 'grey.50',
              }}
              spacing={0.9}
            >
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1.25}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444'][i % 7], flexShrink: 0 }} />
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{c.name}</Typography>
                </Stack>
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexShrink: 0, ml: 2 }}>
                  {(c.levels || []).length > 0 && (
                    <Chip
                      size="small"
                      label={`${c.levels.length} levels`}
                      variant="outlined"
                      sx={{ fontSize: 10, height: 18 }}
                    />
                  )}
                  <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {c.max_points} pts{version?.is_weighted && c.weight ? ` · ${c.weight} wt` : ''}
                  </Typography>
                </Stack>
              </Stack>
              {(c.levels || []).length > 0 && (
                <Stack
                  spacing={0.75}
                  sx={{
                    pl: 2.25,
                    pr: 0.25,
                  }}
                >
                  {(c.levels || []).map((level) => (
                    <Box
                      key={level.id || `${c.id}-${level.order_index}`}
                      sx={{
                        borderRadius: 1.5,
                        border: '1px solid',
                        borderColor: 'divider',
                        bgcolor: 'background.paper',
                        px: 1,
                        py: 0.85,
                      }}
                    >
                      <Stack spacing={0.45}>
                        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                          <Chip
                            size="small"
                            label={level.label}
                            sx={{ height: 20, fontSize: 10, fontWeight: 700, bgcolor: 'primary.50', color: 'primary.main' }}
                          />
                          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                            {formatPointRange(level.min_points, level.max_points)}
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
              )}
            </Stack>
          ))}
        </Stack>
      </Collapse>
    </Paper>
  )
}

export default function CourseRubricTemplates() {
  const { courseId } = useParams()

  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState({ severity: '', message: '' })
  const [bootstrapping, setBootstrapping] = useState(false)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState('create') // 'create' | 'edit' | 'version'
  const [dialogTarget, setDialogTarget] = useState(null)
  const [dialogName, setDialogName] = useState('')
  const [dialogDesc, setDialogDesc] = useState('')
  const [dialogWeighted, setDialogWeighted] = useState(false)
  const [dialogCriteria, setDialogCriteria] = useState([{ name: '', max_points: '', weight: '', levels: [] }])
  const [dialogLevelsOpen, setDialogLevelsOpen] = useState({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [deleting, setDeleting] = useState(null)

  const systemTemplates = templates.filter((t) => t.scope === 'SYSTEM')
  const courseTemplates = templates.filter((t) => t.scope === 'COURSE')

  const loadTemplates = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiRequest(`/api/rubric-templates/?course_id=${encodeURIComponent(courseId)}`)
      setTemplates(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(extractError(err, 'Failed to load rubric templates.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadTemplates() }, [courseId])

  const handleBootstrapStarters = async () => {
    setBootstrapping(true)
    setError('')
    setNotice({ severity: '', message: '' })
    try {
      const data = await apiRequest('/api/rubric-templates/bootstrap/', {
        method: 'POST',
        body: { course_id: courseId },
      })
      await loadTemplates()
      setNotice({
        severity: data?.created_count ? 'success' : 'info',
        message: data?.detail || 'Starter rubric templates are ready.',
      })
    } catch (err) {
      setError(extractError(err, 'Failed to add starter rubric templates.'))
    } finally {
      setBootstrapping(false)
    }
  }

  const openCreate = () => {
    setDialogMode('create')
    setDialogTarget(null)
    setDialogName('')
    setDialogDesc('')
    setDialogWeighted(false)
    setDialogCriteria([{ name: '', max_points: '', weight: '', levels: [] }])
    setDialogLevelsOpen({})
    setSaveError('')
    setDialogOpen(true)
  }

  const openEdit = (template) => {
    setDialogMode('edit')
    setDialogTarget(template)
    setDialogName(template.name)
    setDialogDesc(template.description || '')
    setDialogLevelsOpen({})
    setSaveError('')
    setDialogOpen(true)
  }

  const openNewVersion = (template) => {
    const criteria = (template.active_version?.criteria || []).map((c) => ({
      name: c.name,
      max_points: String(c.max_points),
      weight: String(c.weight ?? ''),
      levels: Array.isArray(c.levels)
        ? c.levels.map((l) => ({ label: l.label || '', min_points: String(l.min_points ?? ''), max_points: String(l.max_points ?? ''), description: l.description || '' }))
        : [],
    }))
    setDialogMode('version')
    setDialogTarget(template)
    setDialogName(template.name)
    setDialogDesc(template.description || '')
    setDialogWeighted(Boolean(template.active_version?.is_weighted))
    setDialogCriteria(criteria.length ? criteria : [{ name: '', max_points: '', weight: '', levels: [] }])
    setDialogLevelsOpen({})
    setSaveError('')
    setDialogOpen(true)
  }

  const handleAddCriterion = () =>
    setDialogCriteria((prev) => [...prev, { name: '', max_points: '', weight: '', levels: [] }])

  const handleCriterionChange = (index, field, value) =>
    setDialogCriteria((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)))

  const handleRemoveCriterion = (index) =>
    setDialogCriteria((prev) => prev.filter((_, i) => i !== index))

  const handleAddLevel = (ci) =>
    setDialogCriteria((prev) => prev.map((c, i) => i === ci
      ? { ...c, levels: [...(c.levels || []), { label: '', min_points: '', max_points: '', description: '' }] }
      : c))

  const handleRemoveLevel = (ci, li) =>
    setDialogCriteria((prev) => prev.map((c, i) => i === ci
      ? { ...c, levels: (c.levels || []).filter((_, j) => j !== li) }
      : c))

  const handleLevelChange = (ci, li, field, value) =>
    setDialogCriteria((prev) => prev.map((c, i) => {
      if (i !== ci) return c
      const levels = [...(c.levels || [])]
      levels[li] = { ...levels[li], [field]: value }
      return { ...c, levels }
    }))

  const handleSave = async () => {
    if (!dialogName.trim()) { setSaveError('Name is required.'); return }
    setSaving(true)
    setSaveError('')
    try {
      const buildCriteria = (items) =>
        items
          .filter((c) => c.name.trim())
          .map((c, i) => ({
            name: c.name.trim(),
            max_points: Number(c.max_points) || 0,
            weight: Number(c.weight) || 0,
            order_index: i,
            levels: (c.levels || [])
              .filter((l) => l.label && l.label.trim())
              .map((l, li) => ({
                label: l.label.trim(),
                min_points: Number(l.min_points) || 0,
                max_points: Number(l.max_points) || 0,
                description: l.description || '',
                order_index: li,
              })),
          }))
      if (dialogMode === 'create') {
        await apiRequest('/api/rubric-templates/', {
          method: 'POST',
          body: { name: dialogName.trim(), description: dialogDesc, is_weighted: dialogWeighted, criteria: buildCriteria(dialogCriteria), course_id: courseId },
        })
      } else if (dialogMode === 'edit') {
        await apiRequest(`/api/rubric-templates/${dialogTarget.id}/`, {
          method: 'PATCH',
          body: { name: dialogName.trim(), description: dialogDesc },
        })
      } else {
        await apiRequest(`/api/rubric-templates/${dialogTarget.id}/versions/`, {
          method: 'POST',
          body: { name: dialogName.trim(), description: dialogDesc, is_weighted: dialogWeighted, criteria: buildCriteria(dialogCriteria) },
        })
      }
      await loadTemplates()
      setDialogOpen(false)
    } catch (err) {
      setSaveError(extractError(err, 'Failed to save.'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (template) => {
    const confirmed = window.confirm(`Delete "${template.name}"? This cannot be undone.`)
    if (!confirmed) return
    setDeleting(template.id)
    try {
      await apiRequest(`/api/rubric-templates/${template.id}/`, { method: 'DELETE' })
      await loadTemplates()
    } catch (err) {
      setError(extractError(err, 'Failed to delete template.'))
    } finally {
      setDeleting(null)
    }
  }

  const showCriteriaEditor = dialogMode === 'create' || dialogMode === 'version'

  return (
    <Stack spacing={2}>
      {/* Page header */}
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.3 }}>
            Rubric Templates
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            Reusable rubrics for this course — load any template when setting up an assignment.
          </Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ flexShrink: 0 }}>
          <Button
            variant="outlined"
            startIcon={<LibraryBooksRounded />}
            onClick={handleBootstrapStarters}
            disabled={bootstrapping}
            sx={{ textTransform: 'none', borderRadius: 999, fontWeight: 700 }}
          >
            {bootstrapping ? 'Adding starters…' : 'Add starter templates'}
          </Button>
          <Button
            variant="contained"
            startIcon={<AddRounded />}
            onClick={openCreate}
            sx={{ textTransform: 'none', borderRadius: 999, fontWeight: 700 }}
          >
            New template
          </Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {notice.message ? (
        <Alert severity={notice.severity || 'info'} onClose={() => setNotice({ severity: '', message: '' })}>
          {notice.message}
        </Alert>
      ) : null}

      {loading ? (
        <LinearProgress sx={{ borderRadius: 999 }} />
      ) : (
        <Stack spacing={3}>
          {/* Course templates */}
          <Stack spacing={1.5}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Your templates
              </Typography>
              {courseTemplates.length > 0 && (
                <Chip
                  size="small"
                  label={courseTemplates.length}
                  sx={{ height: 18, fontSize: 11, bgcolor: 'primary.50', color: 'primary.main', fontWeight: 700, border: '1px solid', borderColor: 'primary.200' }}
                />
              )}
            </Stack>

            {courseTemplates.length === 0 ? (
              <Paper
                elevation={0}
                sx={{
                  px: 3,
                  py: 4,
                  borderRadius: CARD_RADIUS,
                  border: '1px dashed',
                  borderColor: 'divider',
                  textAlign: 'center',
                  bgcolor: 'grey.50',
                }}
              >
                <Stack spacing={1} alignItems="center">
                  <Box
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: 2,
                      bgcolor: 'primary.50',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      mb: 0.5,
                    }}
                  >
                    <LibraryBooksRounded sx={{ fontSize: 24, color: 'primary.main' }} />
                  </Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    No templates yet
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 340 }}>
                    Start with sample course rubrics and built-in scoring guides, or create reusable rubrics from scratch.
                  </Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1 }}>
                    <Button
                      variant="contained"
                      startIcon={<LibraryBooksRounded />}
                      onClick={handleBootstrapStarters}
                      disabled={bootstrapping}
                      sx={{ textTransform: 'none', borderRadius: 999, fontWeight: 700 }}
                    >
                      {bootstrapping ? 'Adding starters…' : 'Add starter templates'}
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<AddRounded />}
                      onClick={openCreate}
                      sx={{ textTransform: 'none', borderRadius: 999, fontWeight: 700 }}
                    >
                      Create from scratch
                    </Button>
                  </Stack>
                </Stack>
              </Paper>
            ) : (
              <Stack spacing={1}>
                {courseTemplates.map((template) => (
                  <Box key={template.id} sx={{ opacity: deleting === template.id ? 0.4 : 1, transition: 'opacity 0.2s' }}>
                    <TemplateCard
                      template={template}
                      onEdit={openEdit}
                      onDelete={handleDelete}
                      onNewVersion={openNewVersion}
                    />
                  </Box>
                ))}
              </Stack>
            )}
          </Stack>

          {/* Standard templates (read-only) */}
          {systemTemplates.length > 0 && (
            <Stack spacing={1.5}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Standard templates
                </Typography>
                <Chip
                  size="small"
                  label="Read-only"
                  sx={{ height: 18, fontSize: 11, bgcolor: 'grey.100', color: 'text.secondary', fontWeight: 600 }}
                />
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ mt: -0.75 }}>
                Built-in rubrics you can load into any assignment and customise there.
              </Typography>
              <Stack spacing={1}>
                {systemTemplates.map((template) => (
                  <TemplateCard key={template.id} template={template} readOnly />
                ))}
              </Stack>
            </Stack>
          )}
        </Stack>
      )}

      {/* Create / Edit / New version dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {dialogMode === 'create' ? 'New course template'
            : dialogMode === 'edit' ? 'Edit template'
            : 'Save new version'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {saveError && <Alert severity="error">{saveError}</Alert>}
            <TextField
              label="Template name"
              value={dialogName}
              onChange={(e) => setDialogName(e.target.value)}
              fullWidth
              required
              autoFocus
            />
            <TextField
              label="Description"
              value={dialogDesc}
              onChange={(e) => setDialogDesc(e.target.value)}
              fullWidth
              multiline
              minRows={2}
            />

            {showCriteriaEditor && (
              <>
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Criteria</Typography>
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={dialogWeighted ? 'WEIGHTED' : 'UNWEIGHTED'}
                    onChange={(_, v) => { if (v) setDialogWeighted(v === 'WEIGHTED') }}
                  >
                    <ToggleButton value="UNWEIGHTED">Unweighted</ToggleButton>
                    <ToggleButton value="WEIGHTED">Weighted</ToggleButton>
                  </ToggleButtonGroup>
                </Stack>

                <Stack spacing={1}>
                  {dialogCriteria.map((criterion, index) => (
                    <Box key={index} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1, py: 0.75 }}>
                        <TextField
                          label={`Criterion ${index + 1}`}
                          value={criterion.name}
                          onChange={(e) => handleCriterionChange(index, 'name', e.target.value)}
                          size="small"
                          sx={{ flex: 1 }}
                        />
                        <TextField
                          label="Points"
                          type="number"
                          value={criterion.max_points}
                          onChange={(e) => handleCriterionChange(index, 'max_points', e.target.value)}
                          size="small"
                          sx={{ width: 78 }}
                        />
                        {dialogWeighted && (
                          <TextField
                            label="Weight"
                            type="number"
                            value={criterion.weight}
                            onChange={(e) => handleCriterionChange(index, 'weight', e.target.value)}
                            size="small"
                            sx={{ width: 72 }}
                          />
                        )}
                        <Tooltip title="Scoring guide">
                          <IconButton
                            size="small"
                            onClick={() => setDialogLevelsOpen((prev) => ({ ...prev, [index]: !prev[index] }))}
                            sx={{ color: (criterion.levels || []).length ? 'primary.main' : 'text.secondary' }}
                          >
                            <ExpandMoreRounded
                              fontSize="small"
                              sx={{ transform: dialogLevelsOpen[index] ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
                            />
                          </IconButton>
                        </Tooltip>
                        <IconButton size="small" color="error" onClick={() => handleRemoveCriterion(index)} disabled={dialogCriteria.length === 1}>
                          <DeleteRounded fontSize="small" />
                        </IconButton>
                      </Stack>
                      <Collapse in={Boolean(dialogLevelsOpen[index])}>
                        <Box sx={{ borderTop: '1px solid', borderColor: 'divider', px: 1.25, py: 1, backgroundColor: 'grey.50' }}>
                          <Stack spacing={0.75}>
                            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                              Scoring levels — suggest a comment when score falls in range
                            </Typography>
                            {(criterion.levels || []).map((level, li) => (
                              <Stack key={li} direction="row" spacing={0.75} alignItems="center">
                                <TextField label="Label" value={level.label} onChange={(e) => handleLevelChange(index, li, 'label', e.target.value)} size="small" sx={{ width: 100 }} placeholder="e.g. Full" />
                                <TextField label="Min" type="number" value={level.min_points} onChange={(e) => handleLevelChange(index, li, 'min_points', e.target.value)} size="small" sx={{ width: 64 }} />
                                <TextField label="Max" type="number" value={level.max_points} onChange={(e) => handleLevelChange(index, li, 'max_points', e.target.value)} size="small" sx={{ width: 64 }} />
                                <TextField label="Suggested comment" value={level.description} onChange={(e) => handleLevelChange(index, li, 'description', e.target.value)} size="small" sx={{ flex: 1 }} />
                                <IconButton size="small" color="error" onClick={() => handleRemoveLevel(index, li)}>
                                  <DeleteRounded fontSize="small" />
                                </IconButton>
                              </Stack>
                            ))}
                            <Button size="small" onClick={() => handleAddLevel(index)} sx={{ alignSelf: 'flex-start', textTransform: 'none' }}>
                              + Add level
                            </Button>
                          </Stack>
                        </Box>
                      </Collapse>
                    </Box>
                  ))}
                  <Button size="small" onClick={handleAddCriterion} sx={{ alignSelf: 'flex-start', textTransform: 'none' }}>
                    + Add criterion
                  </Button>
                </Stack>
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : dialogMode === 'create' ? 'Create' : dialogMode === 'edit' ? 'Save changes' : 'Save version'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
