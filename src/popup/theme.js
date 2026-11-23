import { createTheme } from '@mui/material/styles';
import createCache from '@emotion/cache';
import { prefixer } from 'stylis';
import rtlPlugin from 'stylis-plugin-rtl';

// The popup's look: the web app's palette (voipappz/app
// packages/dashboard-ui/src/theme/tokens.js), so the extension and the portal
// look like one product.
export const createPopupTheme = (direction = 'ltr') => createTheme({
  direction,
  palette: {
    primary: { main: '#5c6bc0', dark: '#3f4fb5', light: '#7986cb', contrastText: '#ffffff' },
    secondary: { main: '#EEA740', dark: '#E49728', light: '#f4c27a', contrastText: '#ffffff' },
  },
  typography: { fontFamily: 'Rubik, Roboto, "Helvetica Neue", Arial, sans-serif' },
  shape: { borderRadius: 8 },
});

// Right to left mirrors every MUI/Emotion style (margin-left -> margin-right).
// Passing stylisPlugins replaces Emotion's defaults, so prefixer is listed again.
export const ltrCache = createCache({ key: 'css' });
export const rtlCache = createCache({ key: 'muirtl', stylisPlugins: [prefixer, rtlPlugin] });
