import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Chip, Stack, Typography } from '@mui/material'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import { useParams } from 'react-router-dom'
import { apiRequest } from '../api/client.js'

function CourseGrades({ user }) {
  const { courseId } = useParams()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const canViewAll = Boolean(user?.is_superuser || user?.is_instructor)

  const loadGrades = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiRequest(`/api/courses/${courseId}/grades/`)
      setRows(data)
    } catch (err) {
      setError(err.message || 'Unable to load grades')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadGrades()
  }, [courseId])

  const columns = useMemo(() => {
    const base = [
      {
        field: 'total_score',
        headerName: 'Total score',
        flex: 0.8,
        minWidth: 120,
      },
      {
        field: 'total_max_score',
        headerName: 'Max',
        flex: 0.8,
        minWidth: 120,
      },
      {
        field: 'percent',
        headerName: 'Percent',
        flex: 0.8,
        minWidth: 120,
        renderCell: (params) => {
          if (!Number.isFinite(params.value)) {
            return <Chip label="—" size="small" variant="outlined" />
          }
          return <Chip label={`${params.value.toFixed(1)}%`} size="small" variant="outlined" />
        },
      },
    ]

    if (!canViewAll) {
      return base
    }

    return [
      {
        field: 'display_name',
        headerName: 'Student',
        flex: 1.4,
        minWidth: 180,
      },
      { field: 'email', headerName: 'Email', flex: 1.4, minWidth: 200 },
      { field: 'cwid', headerName: 'CWID', flex: 0.8, minWidth: 120 },
      ...base,
    ]
  }, [canViewAll])

  return (
    <Box sx={{ py: { xs: 2, md: 3 } }}>
      <Stack spacing={3}>
        {error ? <Alert severity="error">{error}</Alert> : null}

        <Box sx={{ height: 520 }}>
          <DataGrid
            rows={rows}
            columns={columns}
            loading={loading}
            disableRowSelectionOnClick
            slots={{ toolbar: GridToolbar }}
            sx={{ backgroundColor: 'background.paper', borderRadius: 3 }}
          />
        </Box>
      </Stack>
    </Box>
  )
}

export default CourseGrades
