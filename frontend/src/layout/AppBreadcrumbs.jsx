import { Breadcrumbs, Link, Typography } from '@mui/material'
import { NavigateNextRounded } from '@mui/icons-material'
import { Link as RouterLink, useLocation } from 'react-router-dom'

const titleCase = (value) =>
  value
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())

const topLevelMap = {
  'my-courses': 'My Courses',
  catalog: 'Course Catalog',
  courses: 'Course Admin',
  assignments: 'Assignments',
  submissions: 'Submissions',
  integrity: 'Integrity',
  settings: 'Settings',
}

const adminMap = {
  users: 'Users',
  groups: 'Groups',
  languages: 'Languages',
}

const courseMap = {
  overview: 'Overview',
  people: 'People',
  assignments: 'Assignments',
  submissions: 'Submissions',
  grades: 'Grades',
}

const shortCourseId = (courseId) => {
  if (!courseId) return 'Course'
  return `Course ${courseId.slice(0, 8)}`
}

const getCrumbs = (pathname) => {
  if (!pathname || pathname === '/') {
    return [{ label: 'Dashboard' }]
  }

  const segments = pathname.split('/').filter(Boolean)
  const crumbs = [{ label: 'Dashboard', to: '/' }]

  if (segments[0] === 'course' && segments[1]) {
    const courseId = segments[1]
    crumbs.push({
      label: shortCourseId(courseId),
      to: `/course/${courseId}/overview`,
    })

    const section = segments[2]
    if (section) {
      crumbs.push({
        label: courseMap[section] || titleCase(section),
        to: section === 'assignments' && segments[3] ? `/course/${courseId}/assignments` : undefined,
      })
    }

    if (section === 'assignments' && segments[3]) {
      crumbs.push({ label: 'Assignment Details' })
    }

    return crumbs
  }

  if (segments[0] === 'admin') {
    crumbs.push({ label: 'Admin' })
    if (segments[1]) {
      crumbs.push({ label: adminMap[segments[1]] || titleCase(segments[1]) })
    }
    return crumbs
  }

  if (segments.length === 1) {
    crumbs.push({ label: topLevelMap[segments[0]] || titleCase(segments[0]) })
    return crumbs
  }

  segments.forEach((segment, index) => {
    const path = `/${segments.slice(0, index + 1).join('/')}`
    crumbs.push({
      label: topLevelMap[segment] || titleCase(segment),
      to: index === segments.length - 1 ? undefined : path,
    })
  })

  return crumbs
}

function AppBreadcrumbs() {
  const location = useLocation()
  const crumbs = getCrumbs(location.pathname)

  return (
    <Breadcrumbs
      aria-label="breadcrumb"
      separator={<NavigateNextRounded fontSize="small" />}
      sx={{
        mt: { xs: 1.25, md: 1.75 },
        mb: { xs: 2.5, md: 3 },
        '& .MuiBreadcrumbs-li': {
          lineHeight: 1,
        },
      }}
    >
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1
        if (!crumb.to || isLast) {
          return (
            <Typography key={`${crumb.label}-${index}`} variant="body2" color={isLast ? 'text.primary' : 'text.secondary'} sx={{ fontWeight: isLast ? 700 : 500 }}>
              {crumb.label}
            </Typography>
          )
        }
        return (
          <Link
            key={`${crumb.label}-${index}`}
            component={RouterLink}
            to={crumb.to}
            underline="hover"
            color="text.secondary"
            sx={{ fontSize: 14, fontWeight: 500 }}
          >
            {crumb.label}
          </Link>
        )
      })}
    </Breadcrumbs>
  )
}

export default AppBreadcrumbs
