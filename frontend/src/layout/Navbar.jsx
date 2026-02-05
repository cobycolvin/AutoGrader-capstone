import {
  AppBar,
  Box,
  Chip,
  IconButton,
  Stack,
  Toolbar,
  Typography,
} from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'

function Navbar({ onMenuClick, drawerWidth, status }) {
  return (
    <AppBar
      position="fixed"
      elevation={0}
      sx={{
        ml: { md: `${drawerWidth}px` },
        width: { md: `calc(100% - ${drawerWidth}px)` },
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
        <Box sx={{ flex: 1 }}>
          <Typography variant="h6" color="primary">
            CAPSTON
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Autograder control center
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip
            label={status || 'Checking...'}
            color={status?.startsWith('Logged in') ? 'primary' : 'default'}
            variant={status?.startsWith('Logged in') ? 'filled' : 'outlined'}
          />
        </Stack>
      </Toolbar>
    </AppBar>
  )
}

export default Navbar
