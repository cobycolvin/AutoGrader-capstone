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

function Navbar({ onMenuClick, user, onLogout, busy, mode, onToggleMode }) {
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
      position="sticky"
      elevation={0}
      sx={{
        top: 0,
        zIndex: (theme) => theme.zIndex.appBar - 1,
        mt: 1.5,
        borderRadius: 3,
        bgcolor: 'background.paper',
        color: 'text.primary',
        border: (theme) => `1px solid ${theme.palette.divider}`,
        backdropFilter: 'blur(16px)',
      }}
    >
      <Toolbar sx={{ minHeight: 68 }}>
        <IconButton
          edge="start"
          onClick={onMenuClick}
          sx={{ mr: 2, display: { md: 'none' } }}
          aria-label="Open navigation"
        >
          <MenuIcon />
        </IconButton>
        <Stack direction="row" spacing={2} alignItems="center" sx={{ flex: 1 }}>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <Box
              component="img"
              src="/GFI.png"
              alt="Gradeforge"
              sx={{
                width: 34,
                height: 34,
                borderRadius: 1.2,
                objectFit: 'cover',
                boxShadow: '0 10px 24px rgba(79,70,229,0.18)',
              }}
            />
            <Box>
              <Typography variant="h6" color="primary" sx={{ fontWeight: 800 }}>
                Gradeforge
              </Typography>
              
            </Box>
          </Stack>

          <Box
            sx={{
              ml: 1,
              display: { xs: 'none', md: 'flex' },
              alignItems: 'center',
              gap: 1,
              px: 2,
              py: 0.75,
              borderRadius: 999,
              border: (theme) => `1px solid ${theme.palette.divider}`,
              bgcolor: (theme) =>
                theme.palette.mode === 'dark' ? 'rgba(17,27,46,0.7)' : 'rgba(255,255,255,0.7)',
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
