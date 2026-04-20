import {
  Box,
  Divider,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import DashboardIcon from '@mui/icons-material/Dashboard'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import SchoolIcon from '@mui/icons-material/School'
import TravelExploreIcon from '@mui/icons-material/TravelExplore'
import SettingsIcon from '@mui/icons-material/Settings'
import { NavLink, useLocation } from 'react-router-dom'

function Sidebar({
  open,
  onClose,
  variant,
  drawerWidth,
  expanded,
  isDesktop,
  onHoverChange,
  user,
}) {
  const location = useLocation()
  const isAdmin = Boolean(user?.is_superuser)
  const isInstructor = Boolean(user?.is_instructor) || isAdmin
  const showLabels = !isDesktop || expanded
  const showSections = showLabels

  const primaryItems = [
    { label: 'Overview', icon: <DashboardIcon />, to: '/' },
    { label: 'Calendar', icon: <CalendarMonthIcon />, to: '/calendar' },
    { label: 'My Courses', icon: <SchoolIcon />, to: '/my-courses' },
    ...(isInstructor ? [{ label: 'Course Catalog', icon: <TravelExploreIcon />, to: '/catalog' }] : []),
  ]

  const workspaceItems = [
    { label: 'Settings', icon: <SettingsIcon />, to: '/settings' },
    ...(isAdmin ? [{ label: 'Admin Users', icon: <SettingsIcon />, to: '/admin/users' }] : []),
    ...(isAdmin ? [{ label: 'Admin Groups', icon: <SettingsIcon />, to: '/admin/groups' }] : []),
    ...(isAdmin ? [{ label: 'Admin Languages', icon: <SettingsIcon />, to: '/admin/languages' }] : []),
  ]

  const renderNavItem = (item, tone = 'default') => {
    const button = (
      <ListItemButton
        key={item.label}
        component={NavLink}
        to={item.to}
        selected={location.pathname === item.to}
        sx={{
          minHeight: 46,
          px: showLabels ? 1.25 : 0.9,
          justifyContent: showLabels ? 'flex-start' : 'center',
          borderRadius: 2.5,
          mb: 0.5,
          color: 'rgba(226,232,240,0.9)',
          transition: 'all 180ms ease',
          '& .MuiListItemIcon-root': {
            minWidth: showLabels ? 34 : 0,
            mr: showLabels ? 1.1 : 0,
            justifyContent: 'center',
            color: 'rgba(148,163,184,0.95)',
          },
          '& .MuiListItemText-primary': {
            fontWeight: 600,
            fontSize: 14,
            whiteSpace: 'nowrap',
          },
          '&.Mui-selected': tone === 'primary'
            ? {
                background: 'linear-gradient(135deg, #4F46E5 0%, #4338CA 100%)',
                color: '#FFFFFF',
                '& .MuiListItemIcon-root': {
                  color: '#FFFFFF',
                },
              }
            : {
                backgroundColor: 'rgba(79,70,229,0.26)',
                color: '#FFFFFF',
                '& .MuiListItemIcon-root': {
                  color: '#FFFFFF',
                },
              },
        }}
      >
        <ListItemIcon>{item.icon}</ListItemIcon>
        {showLabels ? <ListItemText primary={item.label} /> : null}
      </ListItemButton>
    )

    if (showLabels) return button

    return (
      <Tooltip key={item.label} title={item.label} placement="right">
        {button}
      </Tooltip>
    )
  }

  return (
    <Drawer
      variant={variant}
      open={open}
      onClose={onClose}
      ModalProps={{ keepMounted: true }}
      PaperProps={{
        onMouseEnter: () => onHoverChange?.(true),
        onMouseLeave: () => onHoverChange?.(false),
      }}
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        transition: 'width 220ms ease',
        '& .MuiDrawer-paper': {
          width: drawerWidth,
          boxSizing: 'border-box',
          px: showLabels ? 1.5 : 1,
          py: 2,
          overflow: 'hidden',
          bgcolor: '#060B14',
          color: 'rgba(231,237,248,0.92)',
          borderRight: '1px solid rgba(148,163,184,0.14)',
          borderRadius: { md: 4 },
          boxShadow: '0 20px 40px rgba(2,8,23,0.45)',
          transition: 'width 220ms ease, padding 220ms ease',
        },
      }}
    >
      <Stack spacing={2} sx={{ height: '100%' }}>
        <Stack
          direction={showLabels ? 'row' : 'column'}
          spacing={showLabels ? 1.1 : 1}
          alignItems="center"
          justifyContent={showLabels ? 'flex-start' : 'center'}
          sx={{ px: showLabels ? 1 : 0, pt: 0.25 }}
        >
          <Stack direction="row" spacing={showLabels ? 1.1 : 0} alignItems="center" justifyContent="center" sx={{ width: showLabels ? 'auto' : '100%' }}>
            <Box
              component="img"
              src="/GFI.png"
              alt="Gradeforge"
              sx={{
                width: 30,
                height: 30,
                borderRadius: 1,
                objectFit: 'cover',
                boxShadow: '0 12px 30px rgba(79,70,229,0.22)',
              }}
            />
            {showLabels ? (
              <Typography variant="h6" sx={{ color: '#F8FAFC', fontWeight: 700, whiteSpace: 'nowrap' }}>
                Gradeforge
              </Typography>
            ) : null}
          </Stack>
        </Stack>

        <Divider sx={{ borderColor: 'rgba(148,163,184,0.16)' }} />

        <List
          dense
          disablePadding
          subheader={showSections ? (
            <ListSubheader
              disableGutters
              sx={{
                bgcolor: 'transparent',
                color: 'rgba(148,163,184,0.8)',
                px: 1,
                py: 0.5,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
                lineHeight: 1.6,
              }}
            >
              Dashboards
            </ListSubheader>
          ) : null}
          sx={{ flex: 0 }}
        >
          {primaryItems.map((item) => renderNavItem(item, 'primary'))}
        </List>

        <List
          dense
          disablePadding
          subheader={showSections ? (
            <ListSubheader
              disableGutters
              sx={{
                bgcolor: 'transparent',
                color: 'rgba(148,163,184,0.8)',
                px: 1,
                py: 0.5,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
                lineHeight: 1.6,
              }}
            >
              General
            </ListSubheader>
          ) : null}
          sx={{
            flex: 1,
            overflowY: 'auto',
            pr: showLabels ? 0.5 : 0,
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(99,102,241,0.55) transparent',
            '&::-webkit-scrollbar': {
              width: 7,
            },
            '&::-webkit-scrollbar-track': {
              backgroundColor: 'transparent',
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: 'rgba(99,102,241,0.48)',
              borderRadius: 999,
            },
          }}
        >
          {workspaceItems.map((item) => renderNavItem(item))}
        </List>

        <Box
          sx={{
            p: showLabels ? 1.2 : 1,
            borderRadius: 2.5,
            bgcolor: 'rgba(148,163,184,0.08)',
            border: '1px solid rgba(148,163,184,0.2)',
            textAlign: showLabels ? 'left' : 'center',
          }}
        >
          {showLabels ? (
            <>
              <Typography variant="caption" sx={{ color: 'rgba(148,163,184,0.9)' }}>
                Workspace User
              </Typography>
              <Typography variant="body2" sx={{ color: '#E2E8F0', fontWeight: 600 }}>
                {user?.username || 'User'}
              </Typography>
              <Typography variant="caption" sx={{ color: 'rgba(148,163,184,0.9)' }}>
                v0.1 • Private beta
              </Typography>
            </>
          ) : (
            <Tooltip title={user?.username || 'User'} placement="right">
              <Typography
                variant="body2"
                sx={{
                  color: '#E2E8F0',
                  fontWeight: 700,
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: 'rgba(79,70,229,0.28)',
                }}
              >
                {(user?.username || 'U').charAt(0).toUpperCase()}
              </Typography>
            </Tooltip>
          )}
        </Box>
      </Stack>
    </Drawer>
  )
}

export default Sidebar
