import {
  Box,
  Divider,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import DashboardIcon from '@mui/icons-material/Dashboard'
import SchoolIcon from '@mui/icons-material/School'
import AssignmentIcon from '@mui/icons-material/Assignment'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import PolicyIcon from '@mui/icons-material/Policy'
import SettingsIcon from '@mui/icons-material/Settings'
import { NavLink, useLocation } from 'react-router-dom'

function Sidebar({ open, onClose, variant, drawerWidth, user }) {
  const location = useLocation()
  const isAdmin = Boolean(user?.is_superuser)
  const isInstructor = Boolean(user?.is_instructor) || isAdmin

  const navItems = [
    { label: 'Overview', icon: <DashboardIcon />, to: '/' },
    { label: 'My Courses', icon: <SchoolIcon />, to: '/my-courses' },
    ...(isInstructor ? [{ label: 'Course Catalog', icon: <SchoolIcon />, to: '/catalog' }] : []),
    ...(isAdmin ? [{ label: 'Course Admin', icon: <SchoolIcon />, to: '/courses' }] : []),
    ...(isAdmin ? [{ label: 'Admin Users', icon: <SettingsIcon />, to: '/admin/users' }] : []),
    ...(isAdmin ? [{ label: 'Admin Groups', icon: <SettingsIcon />, to: '/admin/groups' }] : []),
    ...(isAdmin ? [{ label: 'Admin Languages', icon: <SettingsIcon />, to: '/admin/languages' }] : []),
    { label: 'Assignments', icon: <AssignmentIcon />, to: '/assignments' },
    { label: 'Submissions', icon: <UploadFileIcon />, to: '/submissions' },
    { label: 'Integrity', icon: <PolicyIcon />, to: '/integrity' },
    { label: 'Settings', icon: <SettingsIcon />, to: '/settings' },
  ]

  return (
    <Drawer
      variant={variant}
      open={open}
      onClose={onClose}
      ModalProps={{ keepMounted: true }}
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: drawerWidth,
          boxSizing: 'border-box',
          px: 2,
          py: 3,
          overflow: 'hidden',
        },
      }}
    >
      <Stack spacing={2} sx={{ height: '100%' }}>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Workspace
          </Typography>
          <Typography variant="h6">Gradeforge</Typography>
        </Box>
        <Divider />
        <List
          sx={{
            flex: 1,
            overflowY: 'auto',
            pr: 0.5,
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(122,0,38,0.42) transparent',
            '&::-webkit-scrollbar': {
              width: 8,
            },
            '&::-webkit-scrollbar-track': {
              backgroundColor: 'transparent',
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: 'rgba(122,0,38,0.34)',
              borderRadius: 999,
              border: '2px solid transparent',
              backgroundClip: 'content-box',
            },
            '&:hover::-webkit-scrollbar-thumb': {
              backgroundColor: 'rgba(122,0,38,0.5)',
            },
          }}
        >
          {navItems.map((item, index) => (
            <ListItemButton
              key={item.label}
              component={NavLink}
              to={item.to}
              selected={location.pathname === item.to}
              sx={{
                borderRadius: 2,
                mb: 1,
              }}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          ))}
        </List>
        <Box>
          <Typography variant="caption" color="text.secondary">
            System
          </Typography>
          <Typography variant="body2">v0.1 • Private beta</Typography>
        </Box>
      </Stack>
    </Drawer>
  )
}

export default Sidebar
