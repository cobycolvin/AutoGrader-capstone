import { Box, Container, Divider, Stack, Typography, Link } from '@mui/material'

function Footer() {
  return (
    <Box
      component="footer"
      sx={{
        mt: 6,
        borderTop: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          justifyContent="space-between"
        >
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            CAPSTON
          </Typography>

          <Stack direction="row" spacing={2} alignItems="center">
            <Link href="#" underline="hover" color="text.secondary" variant="body2">
              Help
            </Link>
            <Link href="#" underline="hover" color="text.secondary" variant="body2">
              Privacy
            </Link>
            <Link href="#" underline="hover" color="text.secondary" variant="body2">
              Terms
            </Link>
          </Stack>
        </Stack>

        <Divider sx={{ my: 2 }} />

        <Typography variant="caption" color="text.secondary">
          © {new Date().getFullYear()} CAPSTON
        </Typography>
      </Container>
    </Box>
  )
}

export default Footer
