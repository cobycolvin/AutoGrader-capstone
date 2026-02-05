import { Box, Toolbar, useMediaQuery } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useMemo, useState } from 'react'
import Footer from './Footer.jsx'
import Navbar from './Navbar.jsx'
import Sidebar from './Sidebar.jsx'

const drawerWidth = 260

function AppLayout({ children, status }) {
  const theme = useTheme()
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'))
  const [mobileOpen, setMobileOpen] = useState(false)

  const drawerVariant = useMemo(() => (isDesktop ? 'permanent' : 'temporary'), [isDesktop])

  const handleMenuClick = () => {
    setMobileOpen((prev) => !prev)
  }

  const handleClose = () => {
    setMobileOpen(false)
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Navbar onMenuClick={handleMenuClick} drawerWidth={drawerWidth} status={status} />
      <Sidebar
        open={isDesktop ? true : mobileOpen}
        onClose={handleClose}
        variant={drawerVariant}
        drawerWidth={drawerWidth}
      />
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width:'100%',
          display: 'flex',
          flexDirection: 'column',
          px: { xs: 2, sm: 4 },
          position: 'relative',
          overflow: 'hidden',
         
        }}
      >
        <Toolbar sx={{ minHeight: 72 }} />
        <Box sx={{ position: 'relative', zIndex: 1, flex: 1, pb: 6 }}>
          <Box sx={{ width: '100%', maxWidth: 1200, mx: 'auto' }}>{children}</Box>
        </Box>
        <Footer />
      </Box>
    </Box>
  )
}

export default AppLayout
