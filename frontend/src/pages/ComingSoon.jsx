import { Box, Typography } from '@mui/material'

function ComingSoon({ title }) {
  return (
    <Box sx={{ py: { xs: 4, md: 6 } }}>
      <Typography color="text.secondary" sx={{ mt: 1 }}>
        The {title.toLowerCase()} section is ready for build-out. Tell me what you want to ship next.
      </Typography>
    </Box>
  )
}

export default ComingSoon
