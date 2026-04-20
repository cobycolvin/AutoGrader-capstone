import {
  Box,
  Chip,
  Paper,
  Stack,
  Tab,
  Tabs,
} from '@mui/material'
import {
  AssignmentRounded,
  GroupsRounded,
  GradeRounded,
  GroupWorkRounded,
  InfoRounded,
  StyleRounded,
} from '@mui/icons-material'
import { NavLink, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import CoursePeople from './CoursePeople.jsx'
import CourseGroups from './CourseGroups.jsx'
import CourseAssignments from './CourseAssignments.jsx'
import CourseAssignmentDetail from './CourseAssignmentDetail.jsx'
import CourseAssignmentWorkspace from './CourseAssignmentWorkspace.jsx'
import CourseTestSuiteBuilder from './CourseTestSuiteBuilder.jsx'
import CourseGrades from './CourseGrades.jsx'
import CourseOverviewStudent from './CourseOverviewStudent.jsx'
import CourseStudentGrades from './CourseStudentGrades.jsx'
import CourseSubmissionDetailPage from './CourseSubmissionDetailPage.jsx'
import CourseRubricTemplates from './CourseRubricTemplates.jsx'

const staffTabs = [
  { label: 'People', to: 'people', icon: <GroupsRounded fontSize="small" /> },
  { label: 'Groups', to: 'groups', icon: <GroupWorkRounded fontSize="small" /> },
  { label: 'Assignments', to: 'assignments', icon: <AssignmentRounded fontSize="small" /> },
  { label: 'Grades', to: 'grades', icon: <GradeRounded fontSize="small" /> },
  { label: 'Rubric Templates', to: 'rubric-templates', icon: <StyleRounded fontSize="small" /> },
]

const studentTabs = [
  { label: 'Overview', to: 'overview', icon: <InfoRounded fontSize="small" /> },
  { label: 'People', to: 'people', icon: <GroupsRounded fontSize="small" /> },
  { label: 'Assignments', to: 'assignments', icon: <AssignmentRounded fontSize="small" /> },
  { label: 'Grades', to: 'grades', icon: <GradeRounded fontSize="small" /> },
]


function CourseWorkspace({ user }) {
  const { courseId } = useParams()
  const location = useLocation()
  const isStaff = Boolean(user?.is_superuser || user?.is_instructor || user?.is_ta)
  const tabs = isStaff ? staffTabs : studentTabs
  const defaultTab = isStaff ? 'assignments' : 'overview'
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
            <Route index element={<Navigate to={defaultTab} replace />} />
            <Route
              path="overview"
              element={
                isStaff ? (
                  <Navigate to="../assignments" replace />
                ) : (
                  <CourseOverviewStudent />
                )
              }
            />
            <Route
              path="people"
              element={<CoursePeople user={user} />}
            />
            <Route
              path="groups"
              element={isStaff ? <CourseGroups user={user} /> : <Navigate to="../people" replace />}
            />
            <Route
              path="assignments"
              element={<CourseAssignments user={user} />}
            />
            <Route
              path="assignments/:assignmentId/tests/build"
              element={<CourseTestSuiteBuilder user={user} />}
            />
            <Route
              path="assignments/:assignmentId"
              element={<CourseAssignmentDetail user={user} />}
            />
            <Route
              path="assignments/:assignmentId/workspace"
              element={<CourseAssignmentWorkspace user={user} />}
            />
            <Route
              path="assignments/:assignmentId/submissions/:submissionId"
              element={<CourseSubmissionDetailPage user={user} />}
            />
            <Route
              path="submissions"
              element={<Navigate to="assignments" replace />}
            />
            <Route
              path="grades"
              element={<CourseGrades user={user} />}
            />
            <Route
              path="grades/student/:userId"
              element={<CourseStudentGrades user={user} />}
            />
            <Route
              path="rubric-templates"
              element={isStaff ? <CourseRubricTemplates user={user} /> : <Navigate to="../assignments" replace />}
            />
          </Routes>
        </Box>
      </Stack>
    </Box>
  )
}

export default CourseWorkspace
