import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import { apiRequest } from '../api/client.js'

function CourseCatalogPage() {
  const [rows, setRows] = useState([])
  const [enrolledIds, setEnrolledIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [catalog, myCourses] = await Promise.all([
        apiRequest('/api/course-catalog/'),
        apiRequest('/api/my-courses/'),
      ])
      setRows(catalog)
      setEnrolledIds(new Set(myCourses.map((course) => course.id)))
    } catch (err) {
      setError(err.message || 'Unable to load courses')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleEnroll = async (courseId) => {
    setSaving(true)
    setError('')
    try {
      await apiRequest(`/api/courses/${courseId}/self-enroll/`, { method: 'POST' })
      await loadData()
    } catch (err) {
      setError(err.message || 'Unable to enroll in course')
    } finally {
      setSaving(false)
    }
  }

  const columns = useMemo(
    () => [
      { field: 'code', headerName: 'Code', flex: 1, minWidth: 120 },
      { field: 'title', headerName: 'Title', flex: 2, minWidth: 200 },
      { field: 'term', headerName: 'Term', flex: 1, minWidth: 120 },
      { field: 'section', headerName: 'Section', flex: 1, minWidth: 120 },
      {
        field: 'is_active',
        headerName: 'Status',
        minWidth: 120,
        renderCell: (params) => (
          <Chip
            label={params.value ? 'Active' : 'Inactive'}
            color={params.value ? 'primary' : 'default'}
            variant={params.value ? 'filled' : 'outlined'}
            size="small"
          />
        ),
      },
      {
        field: 'enroll',
        headerName: 'Enroll',
        minWidth: 160,
        sortable: false,
        renderCell: (params) => {
          const isEnrolled = enrolledIds.has(params.row.id)
          return isEnrolled ? (
            <Chip label="Enrolled" size="small" variant="outlined" />
          ) : (
            <Button
              size="small"
              variant="contained"
              disabled={saving}
              onClick={() => handleEnroll(params.row.id)}
            >
              Enroll
            </Button>
          )
        },
      },
    ],
    [enrolledIds, saving],
  )

  return (
    <Box sx={{ py: { xs: 4, md: 6 } }}>
      <Stack spacing={3}>
        {error ? <Alert severity="error">{error}</Alert> : null}

        <Box sx={{ height: 520 }}>
          <DataGrid
            rows={rows}
            columns={columns}
            loading={loading}
            disableRowSelectionOnClick
            slots={{ toolbar: GridToolbar }}
            sx={{
              backgroundColor: 'background.paper',
              borderRadius: 3,
            }}
          />
        </Box>
      </Stack>
    </Box>
  )
}

export default CourseCatalogPage
