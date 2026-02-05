import { Box, Typography } from '@mui/material'

function ComingSoon({ title }) {
  return (
    <Box sx={{ py: { xs: 4, md: 6 } }}>
      <Typography variant="h3" sx={{ fontWeight: 900, letterSpacing: -0.8 }}>
        {title}
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 1 }}>
        This section is ready for build-out. Tell me what you want to ship next.
      </Typography>
    </Box>
  )
}

export default ComingSoon
