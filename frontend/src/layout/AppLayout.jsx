import { Box, useMediaQuery } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useMemo, useState } from 'react'
import Footer from './Footer.jsx'
import Navbar from './Navbar.jsx'
import Sidebar from './Sidebar.jsx'
import AppBreadcrumbs from './AppBreadcrumbs.jsx'

const expandedDrawerWidth = 260
const collapsedDrawerWidth = 84

function AppLayout({ children, user, onLogout, busy, mode, onToggleMode }) {
  const theme = useTheme()
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'))
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarHovered, setSidebarHovered] = useState(false)

  const drawerVariant = useMemo(() => (isDesktop ? 'permanent' : 'temporary'), [isDesktop])
  const sidebarExpanded = isDesktop ? sidebarHovered : true
  const drawerWidth = isDesktop ? (sidebarExpanded ? expandedDrawerWidth : collapsedDrawerWidth) : expandedDrawerWidth

  const handleMenuClick = () => {
    setMobileOpen((prev) => !prev)
  }

  const handleClose = () => {
    setMobileOpen(false)
  }

  const handleSidebarHoverChange = (hovered) => {
    if (!isDesktop) return
    setSidebarHovered(hovered)
  }

  return (
    <Box
      sx={{
        display: 'flex',
        minHeight: '100vh',
        bgcolor: '#050912',
        p: { xs: 1, md: 2 },
        gap: { xs: 0, md: 2 },
      }}
    >
      <Sidebar
        open={isDesktop ? true : mobileOpen}
        onClose={handleClose}
        variant={drawerVariant}
        drawerWidth={drawerWidth}
        expanded={sidebarExpanded}
        isDesktop={isDesktop}
        onHoverChange={handleSidebarHoverChange}
        user={user}
      />
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: '100%',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          overflow: 'hidden',
          bgcolor: 'background.paper',
          borderRadius: { xs: 3, md: 4 },
          border: '1px solid',
          borderColor: 'divider',
          boxShadow: '0 24px 50px rgba(2, 8, 23, 0.35)',
        }}
      >
        <Box
          sx={{
            position: 'relative',
            zIndex: 1,
            flex: 1,
            overflow: 'auto',
            px: { xs: 1.5, sm: 2.5, lg: 3.5 },
            pb: { xs: 4, md: 6 },
          }}
        >
          <Box sx={{ width: '100%' }}>
            <Navbar
              onMenuClick={handleMenuClick}
              user={user}
              onLogout={onLogout}
              busy={busy}
              mode={mode}
              onToggleMode={onToggleMode}
            />
            <AppBreadcrumbs />
            {children}
          </Box>
        </Box>
        <Footer />
      </Box>
    </Box>
  )
}

export default AppLayout
