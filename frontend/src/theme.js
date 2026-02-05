import { createTheme } from '@mui/material/styles'

const getDesignTokens = (mode = 'light') => {
  const isDark = mode === 'dark'

  return {
    palette: {
      mode,

      // From your UI: chart blue + top-bar blue
      primary: {
        main: '#3878D0',        // chart / accent blue
        dark: '#2B5BB9',        // top bar blue (light screenshot)
        light: '#73A3F0',
        contrastText: '#FFFFFF',
      },

      // From donut: orange segment
      secondary: {
        main: '#F88820',
        light: '#FFB15A',
        dark: '#C96A14',
        contrastText: '#0B1220',
      },

      // From donut: red segment (+ keep a clean green)
      error: { main: '#F83830' },
      success: { main: '#22C55E' },

      background: {
        default: isDark ? '#19222E' : '#F1F3F6', // page bg
        paper: isDark ? '#202E43' : '#FFFFFF',   // cards
      },

      text: {
        primary: isDark ? '#E8EEF8' : '#0F172A',
        secondary: isDark ? '#A7B3C9' : '#475569',
      },

      divider: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)',

      action: {
        hover: isDark ? 'rgba(56,120,208,0.10)' : 'rgba(56,120,208,0.08)',
        selected: isDark ? 'rgba(56,120,208,0.18)' : 'rgba(56,120,208,0.12)',
      },
    },

    shape: { borderRadius: 16 },

    typography: {
      fontFamily: '"Plus Jakarta Sans", "Segoe UI", Arial, sans-serif',
      h1: { fontWeight: 700, letterSpacing: -1 },
      h2: { fontWeight: 700, letterSpacing: -0.8 },
      h3: { fontWeight: 700, letterSpacing: -0.6 },
      h6: { fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600 },
    },

    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: isDark ? '#19222E' : '#F1F3F6',
          },
        },
      },

      // Top bar matches your screenshots (blue in light, dark navy in dark)
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: isDark ? '#1A232F' : '#2B5BB9',
            color: '#FFFFFF',
            borderBottom: isDark ? '1px solid rgba(255,255,255,0.06)' : 'none',
            boxShadow: isDark
              ? '0 10px 25px rgba(0,0,0,0.35)'
              : '0 10px 25px rgba(15,23,42,0.10)',
          },
        },
      },

      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundImage: 'none',
            backgroundColor: isDark ? '#222D3D' : '#FFFFFF',
            borderRight: isDark
              ? '1px solid rgba(255,255,255,0.06)'
              : '1px solid rgba(15,23,42,0.08)',
          },
        },
      },

      // Cards look like your UI: clean, subtle border, soft shadow
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            border: isDark
              ? '1px solid rgba(255,255,255,0.06)'
              : '1px solid rgba(15,23,42,0.06)',
            boxShadow: isDark
              ? '0 12px 28px rgba(0,0,0,0.35)'
              : '0 12px 28px rgba(15,23,42,0.06)',
          },
        },
      },

      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            paddingInline: 16,
            paddingBlock: 10,
          },
          containedPrimary: {
            boxShadow: isDark
              ? '0 10px 20px rgba(0,0,0,0.25)'
              : '0 10px 20px rgba(43,91,185,0.25)',
          },
        },
      },

      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 999,
            fontWeight: 600,
          },
          filled: {
            backgroundColor: isDark
              ? 'rgba(56,120,208,0.18)'
              : 'rgba(56,120,208,0.12)',
          },
        },
      },

      MuiListItemButton: {
        styleOverrides: {
          root: { borderRadius: 12 },
        },
      },
    },
  }
}

// default = light (your 2nd screenshot)
const theme = createTheme(getDesignTokens('light'))

// optional: use createTheme(getDesignTokens('dark')) for your dark screenshot
export const buildTheme = (mode) => createTheme(getDesignTokens(mode))

export default theme
