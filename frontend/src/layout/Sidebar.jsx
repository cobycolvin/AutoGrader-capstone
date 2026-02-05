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

const navItems = [
  { label: 'Overview', icon: <DashboardIcon />, to: '/' },
  { label: 'Courses', icon: <SchoolIcon />, to: '/courses' },
  { label: 'Assignments', icon: <AssignmentIcon />, to: '/assignments' },
  { label: 'Submissions', icon: <UploadFileIcon />, to: '/submissions' },
  { label: 'Integrity', icon: <PolicyIcon />, to: '/integrity' },
  { label: 'Settings', icon: <SettingsIcon />, to: '/settings' },
]

function Sidebar({ open, onClose, variant, drawerWidth }) {
  const location = useLocation()

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
        },
      }}
    >
      <Stack spacing={2} sx={{ height: '100%' }}>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Workspace
          </Typography>
          <Typography variant="h6">Autograder</Typography>
        </Box>
        <Divider />
        <List sx={{ flex: 1 }}>
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
