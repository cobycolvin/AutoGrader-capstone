import {
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material'
import {
  AssignmentRounded,
  GroupsRounded,
  InfoRounded,
  UploadFileRounded,
  GradeRounded,
} from '@mui/icons-material'
import { NavLink, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import CoursePeople from './CoursePeople.jsx'
import CourseAssignments from './CourseAssignments.jsx'
import CourseAssignmentDetail from './CourseAssignmentDetail.jsx'
import CourseSubmissions from './CourseSubmissions.jsx'
import CourseGrades from './CourseGrades.jsx'
import CourseOverviewStudent from './CourseOverviewStudent.jsx'

const instructorTabs = [
  { label: 'Overview', to: 'overview', icon: <InfoRounded fontSize="small" /> },
  { label: 'People', to: 'people', icon: <GroupsRounded fontSize="small" /> },
  { label: 'Assignments', to: 'assignments', icon: <AssignmentRounded fontSize="small" /> },
  { label: 'Submissions', to: 'submissions', icon: <UploadFileRounded fontSize="small" /> },
  { label: 'Grades', to: 'grades', icon: <GradeRounded fontSize="small" /> },
]

const studentTabs = [
  { label: 'Overview', to: 'overview', icon: <InfoRounded fontSize="small" /> },
  { label: 'Assignments', to: 'assignments', icon: <AssignmentRounded fontSize="small" /> },
  { label: 'Submissions', to: 'submissions', icon: <UploadFileRounded fontSize="small" /> },
  { label: 'Grades', to: 'grades', icon: <GradeRounded fontSize="small" /> },
]

function PlaceholderPanel({ title, description }) {
  return (
    <Paper elevation={0} sx={{ p: 3 }}>
      <Typography variant="h6" sx={{ fontWeight: 800 }}>
        {title}
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 1 }}>
        {description}
      </Typography>
    </Paper>
  )
}

function CourseWorkspace({ user }) {
  const { courseId } = useParams()
  const location = useLocation()
  const isInstructor = Boolean(user?.is_superuser || user?.is_instructor)
  const tabs = isInstructor ? instructorTabs : studentTabs
  const tabIndex = Math.max(
    0,
    tabs.findIndex((tab) => location.pathname.includes(`/${tab.to}`)),
  )

  return (
    <Box sx={{ py: { xs: 2, md: 3 } }}>
      <Stack spacing={2}>
        <Paper elevation={0} sx={{ px: { xs: 1, sm: 2 }, py: 1 }}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            alignItems={{ xs: 'stretch', md: 'center' }}
          >
            <Tabs
              value={tabIndex}
              variant="scrollable"
              allowScrollButtonsMobile
              sx={{
                flex: 1,
                minHeight: 48,
                borderBottom: { xs: '1px solid rgba(15,23,42,0.08)', md: 'none' },
                '& .MuiTabs-indicator': { height: 3, borderRadius: 2 },
              }}
            >
              {tabs.map((tab) => (
                <Tab
                  key={tab.to}
                  icon={tab.icon}
                  iconPosition="start"
                  label={tab.label}
                  component={NavLink}
                  to={`/course/${courseId}/${tab.to}`}
                  sx={{
                    textTransform: 'none',
                    fontWeight: 700,
                    minHeight: 48,
                    px: { xs: 1.25, sm: 2 },
                  }}
                />
              ))}
            </Tabs>
            <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
              <Chip label={`Course ID: ${courseId}`} variant="outlined" size="small" />
            </Stack>
          </Stack>
        </Paper>

        <Box>
          <Routes>
            <Route index element={<Navigate to="overview" replace />} />
            <Route
              path="overview"
              element={
                isInstructor ? (
                  <PlaceholderPanel
                    title="Overview"
                    description="Course-level metrics, activity, and quick actions will live here."
                  />
                ) : (
                  <CourseOverviewStudent />
                )
              }
            />
            <Route
              path="people"
              element={
                isInstructor ? (
                  <CoursePeople user={user} />
                ) : (
                  <Navigate to="overview" replace />
                )
              }
            />
            <Route
              path="assignments"
              element={<CourseAssignments user={user} />}
            />
            <Route
              path="assignments/:assignmentId"
              element={<CourseAssignmentDetail user={user} />}
            />
            <Route
              path="submissions"
              element={<CourseSubmissions user={user} />}
            />
            <Route
              path="grades"
              element={<CourseGrades user={user} />}
            />
          </Routes>
        </Box>
      </Stack>
    </Box>
  )
}

export default CourseWorkspace
