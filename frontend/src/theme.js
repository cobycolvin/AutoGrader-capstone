import { alpha, createTheme } from '@mui/material/styles'

const getDesignTokens = (mode = 'light') => {
  const isDark = mode === 'dark'
  const surfaceGradient = isDark
    ? 'linear-gradient(180deg, rgba(99,102,241,0.14) 0%, rgba(17,27,46,0.98) 30%, rgba(17,27,46,0.98) 100%)'
    : 'linear-gradient(180deg, rgba(99,102,241,0.08) 0%, rgba(255,255,255,0.98) 28%, rgba(255,255,255,0.98) 100%)'

  const palette = {
    mode,
    primary: {
      main: '#4F46E5',
      dark: '#4338CA',
      light: '#6366F1',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: '#3B82F6',
      dark: '#2563EB',
      light: '#60A5FA',
      contrastText: '#0B1220',
    },
    error: { main: '#DC2626' },
    warning: { main: '#D97706' },
    success: { main: '#059669' },
    info: { main: '#0284C7' },
    background: {
      default: isDark ? '#0A1222' : '#F4F7FC',
      paper: isDark ? '#111B2E' : '#FFFFFF',
    },
    text: {
      primary: isDark ? '#E7EDF8' : '#0F172A',
      secondary: isDark ? '#A7B4CC' : '#475569',
    },
    divider: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(15,23,42,0.10)',
    action: {
      hover: isDark ? 'rgba(99,102,241,0.18)' : 'rgba(79,70,229,0.08)',
      selected: isDark ? 'rgba(99,102,241,0.24)' : 'rgba(79,70,229,0.14)',
    },
  }

  return {
    palette,
    shape: { borderRadius: 14 },
    typography: {
      fontFamily: '"Manrope", "Segoe UI", Helvetica, Arial, sans-serif',
      h1: {
        fontFamily: '"Space Grotesk", "Manrope", "Segoe UI", sans-serif',
        fontWeight: 700,
        letterSpacing: -1.1,
      },
      h2: {
        fontFamily: '"Space Grotesk", "Manrope", "Segoe UI", sans-serif',
        fontWeight: 700,
        letterSpacing: -0.9,
      },
      h3: {
        fontFamily: '"Space Grotesk", "Manrope", "Segoe UI", sans-serif',
        fontWeight: 700,
        letterSpacing: -0.7,
      },
      h4: {
        fontFamily: '"Space Grotesk", "Manrope", "Segoe UI", sans-serif',
        fontWeight: 700,
        letterSpacing: -0.5,
      },
      h5: {
        fontFamily: '"Space Grotesk", "Manrope", "Segoe UI", sans-serif',
        fontWeight: 650,
      },
      h6: {
        fontFamily: '"Space Grotesk", "Manrope", "Segoe UI", sans-serif',
        fontWeight: 650,
      },
      subtitle1: { fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 650, letterSpacing: 0 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: palette.background.default,
            backgroundImage: isDark
              ? 'radial-gradient(1200px 600px at 20% -10%, rgba(99,102,241,0.24), transparent 60%), radial-gradient(900px 500px at 90% 0%, rgba(59,130,246,0.14), transparent 55%)'
              : 'radial-gradient(1200px 600px at 10% -10%, rgba(79,70,229,0.14), transparent 60%), radial-gradient(900px 500px at 90% 0%, rgba(59,130,246,0.10), transparent 55%)',
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: alpha(palette.background.paper, isDark ? 0.82 : 0.92),
            color: palette.text.primary,
            borderBottom: `1px solid ${palette.divider}`,
            backdropFilter: 'blur(16px)',
            boxShadow: isDark
              ? '0 12px 26px rgba(2, 8, 23, 0.42)'
              : '0 10px 24px rgba(15, 23, 42, 0.08)',
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundImage: 'none',
            backgroundColor: alpha(palette.background.paper, isDark ? 0.95 : 0.98),
            borderRight: `1px solid ${palette.divider}`,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: surfaceGradient,
            backgroundColor: isDark ? '#111B2E' : '#FFFFFF',
            border: `1px solid ${palette.divider}`,
            boxShadow: isDark
              ? '0 16px 32px rgba(2,8,23,0.34)'
              : '0 14px 30px rgba(15,23,42,0.07)',
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 18,
            backgroundImage: surfaceGradient,
            backgroundColor: isDark ? '#111B2E' : '#FFFFFF',
          },
        },
      },
      MuiButton: {
        defaultProps: {
          disableElevation: true,
        },
        styleOverrides: {
          root: {
            borderRadius: 12,
            paddingInline: 16,
            paddingBlock: 10,
          },
          contained: {
            color: palette.primary.contrastText,
            '&.Mui-disabled': {
              backgroundImage: 'none',
              backgroundColor: isDark ? 'rgba(71, 85, 105, 0.38)' : 'rgba(148, 163, 184, 0.32)',
              color: isDark ? 'rgba(226, 232, 240, 0.72)' : 'rgba(15, 23, 42, 0.42)',
              boxShadow: 'none',
            },
          },
          containedPrimary: {
            backgroundImage: 'linear-gradient(135deg, #4F46E5 0%, #4338CA 100%)',
            color: palette.primary.contrastText,
            boxShadow: isDark
              ? '0 10px 20px rgba(2,8,23,0.35)'
              : '0 10px 20px rgba(79,70,229,0.28)',
            '&:hover': {
              backgroundImage: 'linear-gradient(135deg, #4338CA 0%, #3730A3 100%)',
            },
            '&.Mui-disabled': {
              backgroundImage: 'none',
            },
          },
          outlined: {
            borderWidth: 1.5,
          },
        },
      },
      MuiTextField: {
        defaultProps: {
          variant: 'outlined',
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            backgroundColor: isDark ? 'rgba(17,27,46,0.72)' : '#FFFFFF',
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: palette.divider,
            },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: alpha(palette.primary.main, 0.5),
            },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderWidth: 2,
              borderColor: palette.primary.main,
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 999,
            fontWeight: 650,
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            '&.Mui-selected': {
              backgroundColor: palette.action.selected,
              color: palette.text.primary,
            },
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 18,
          },
        },
      },
      MuiDataGrid: {
        defaultProps: {
          disableRowSelectionOnClick: true,
        },
        styleOverrides: {
          root: {
            borderColor: palette.divider,
            borderRadius: 14,
            overflow: 'hidden',
            backgroundColor: alpha(palette.background.paper, isDark ? 0.9 : 0.97),
            color: palette.text.primary,
            '--DataGrid-rowBorderColor': palette.divider,
            '& .MuiDataGrid-columnSeparator': {
              color: alpha(palette.text.secondary, 0.28),
            },
            '& .MuiDataGrid-toolbarContainer': {
              paddingInline: 10,
              paddingBlock: 10,
              borderBottom: `1px solid ${palette.divider}`,
              backgroundColor: isDark ? alpha('#0B1220', 0.35) : alpha('#FFFFFF', 0.8),
              gap: 8,
            },
            '& .MuiDataGrid-toolbarContainer .MuiButton-root': {
              color: palette.text.secondary,
              borderColor: alpha(palette.primary.main, 0.24),
            },
            '& .MuiDataGrid-toolbarContainer .MuiIconButton-root': {
              color: palette.text.secondary,
            },
            '& .MuiDataGrid-overlayWrapper': {
              backgroundColor: alpha(palette.background.paper, isDark ? 0.94 : 0.98),
            },
            '& .MuiDataGrid-row': {
              borderBottom: `1px solid ${palette.divider}`,
              transition: 'background-color 120ms ease',
            },
            '& .MuiDataGrid-row:nth-of-type(even)': {
              backgroundColor: isDark ? alpha('#0B1220', 0.24) : alpha('#EEF2FF', 0.35),
            },
            '& .MuiDataGrid-row:hover': {
              backgroundColor: alpha(palette.primary.main, isDark ? 0.2 : 0.08),
            },
            '& .MuiDataGrid-row.Mui-selected': {
              backgroundColor: alpha(palette.primary.main, isDark ? 0.3 : 0.14),
            },
            '& .MuiDataGrid-row.Mui-selected:hover': {
              backgroundColor: alpha(palette.primary.main, isDark ? 0.36 : 0.2),
            },
            '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within, & .MuiDataGrid-columnHeader:focus, & .MuiDataGrid-columnHeader:focus-within':
              {
                outline: 'none',
              },
          },
          columnHeaders: {
            backgroundColor: isDark ? alpha('#0B1220', 0.45) : alpha('#EEF2FF', 0.75),
            borderBottom: `1px solid ${palette.divider}`,
            minHeight: 52,
            maxHeight: 52,
          },
          columnHeaderTitle: {
            fontWeight: 700,
            letterSpacing: 0.2,
            fontSize: 13,
          },
          cell: {
            borderBottom: `1px solid ${palette.divider}`,
          },
          footerContainer: {
            borderTop: `1px solid ${palette.divider}`,
            backgroundColor: isDark ? alpha('#0B1220', 0.35) : alpha('#FFFFFF', 0.8),
          },
          virtualScroller: {
            backgroundColor: 'transparent',
          },
          withBorderColor: {
            borderColor: palette.divider,
          },
        },
      },
    },
  }
}

const theme = createTheme(getDesignTokens('light'))

export const buildTheme = (mode) => createTheme(getDesignTokens(mode))

export default theme
