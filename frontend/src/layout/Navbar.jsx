import {
  AppBar,
  Avatar,
  Box,
  ButtonBase,
  Chip,
  Divider,
  IconButton,
  InputBase,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Toolbar,
  Typography,
} from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import NotificationsNoneRoundedIcon from '@mui/icons-material/NotificationsNoneRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import HelpOutlineRoundedIcon from '@mui/icons-material/HelpOutlineRounded'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded'
import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded'
import { useState } from 'react'

function Navbar({ onMenuClick, drawerWidth, user, onLogout, busy, mode, onToggleMode }) {
  const displayName = user?.username || 'User'
  const roleLabel = user?.is_superuser
    ? 'Admin'
    : user?.is_instructor
      ? 'Instructor'
      : 'Student'
  const [accountAnchor, setAccountAnchor] = useState(null)
  const accountOpen = Boolean(accountAnchor)

  const openAccountMenu = (event) => {
    setAccountAnchor(event.currentTarget)
  }

  const closeAccountMenu = () => {
    setAccountAnchor(null)
  }

  const handleLogout = async () => {
    closeAccountMenu()
    if (onLogout) {
      await onLogout()
    }
  }

  const handleToggleMode = () => {
    closeAccountMenu()
    if (onToggleMode) {
      onToggleMode()
    }
  }

  return (
    <AppBar
      position="fixed"
      elevation={0}
      sx={{
        ml: { md: `${drawerWidth}px` },
        width: { md: `calc(100% - ${drawerWidth}px)` },
        bgcolor: 'background.paper',
        color: 'text.primary',
        borderBottom: '1px solid rgba(15,23,42,0.08)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <Toolbar sx={{ minHeight: 72 }}>
        <IconButton
          edge="start"
          onClick={onMenuClick}
          sx={{ mr: 2, display: { md: 'none' } }}
          aria-label="Open navigation"
        >
          <MenuIcon />
        </IconButton>
        <Stack direction="row" spacing={2} alignItems="center" sx={{ flex: 1 }}>
          <Box>
            <Typography variant="h6" color="primary" sx={{ fontWeight: 800 }}>
              Gradeforge
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Autograder control center
            </Typography>
          </Box>

          <Box
            sx={{
              ml: 1,
              display: { xs: 'none', md: 'flex' },
              alignItems: 'center',
              gap: 1,
              px: 2,
              py: 0.75,
              borderRadius: 999,
              border: '1px solid rgba(15,23,42,0.08)',
              bgcolor: 'rgba(255,255,255,0.6)',
              minWidth: 280,
            }}
          >
            <SearchRoundedIcon fontSize="small" />
            <InputBase
              placeholder="Search courses, assignments…"
              sx={{ flex: 1, fontSize: 14 }}
              inputProps={{ 'aria-label': 'Search' }}
            />
          </Box>
        </Stack>

        <Stack direction="row" spacing={1.5} alignItems="center">
          <Chip label={roleLabel} size="small" variant="outlined" />
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
          <Tooltip title="Help">
            <IconButton aria-label="Help">
              <HelpOutlineRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Notifications">
            <IconButton aria-label="Notifications">
              <NotificationsNoneRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <ButtonBase
            onClick={openAccountMenu}
            disabled={busy}
            sx={{
              borderRadius: 999,
              px: 0.75,
              py: 0.25,
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <Avatar sx={{ width: 32, height: 32 }}>
                {displayName.charAt(0).toUpperCase()}
              </Avatar>
              <Box sx={{ display: { xs: 'none', md: 'block' } }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {displayName}
                </Typography>
              </Box>
              <KeyboardArrowDownRoundedIcon fontSize="small" color="action" />
            </Stack>
          </ButtonBase>
          <Menu
            anchorEl={accountAnchor}
            open={accountOpen}
            onClose={closeAccountMenu}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            <MenuItem onClick={handleToggleMode}>
              <ListItemIcon>
                {mode === 'dark' ? (
                  <LightModeRoundedIcon fontSize="small" />
                ) : (
                  <DarkModeRoundedIcon fontSize="small" />
                )}
              </ListItemIcon>
              <ListItemText>
                {mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              </ListItemText>
            </MenuItem>
            <MenuItem onClick={handleLogout} disabled={busy}>
              <ListItemIcon>
                <LogoutRoundedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>Log out</ListItemText>
            </MenuItem>
          </Menu>
        </Stack>
      </Toolbar>
    </AppBar>
  )
}

export default Navbar
