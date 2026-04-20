import { Box, Container, Divider, Stack, Typography, Link } from '@mui/material'

function Footer() {
  return (
    <Box
      component="footer"
      sx={{
        borderTop: '1px solid',
        borderColor: 'divider',
        bgcolor: 'transparent',
      }}
    >
      <Container maxWidth="lg" sx={{ py: 2.5 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          justifyContent="space-between"
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <Box
              component="img"
              src="/GFI.png"
              alt="Gradeforge"
              sx={{
                width: 24,
                height: 24,
                borderRadius: 0.9,
                objectFit: 'cover',
              }}
            />
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              Gradeforge
            </Typography>
          </Stack>

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

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }}>
          <Typography variant="caption" color="text.secondary">
            © {new Date().getFullYear()} Gradeforge
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Dedicated to Dr. Lon Smith
          </Typography>
        </Stack>
      </Container>
    </Box>
  )
}

export default Footer
