import { createTheme } from '@mui/material/styles';
import createCache from '@emotion/cache';
import { prefixer } from 'stylis';
import rtlPlugin from 'stylis-plugin-rtl';

// The popup's look: the indigo toolbar and amber badge of the Angular build it
// replaced, so agents see the same extension.
export const createPopupTheme = (direction = 'ltr') => createTheme({
  direction,
  palette: {
    primary: { main: '#3f51b5' },
    secondary: { main: '#ff9800' },
  },
  typography: { fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif' },
});

// Right to left mirrors every MUI/Emotion style (margin-left -> margin-right).
// Passing stylisPlugins replaces Emotion's defaults, so prefixer is listed again.
export const ltrCache = createCache({ key: 'css' });
export const rtlCache = createCache({ key: 'muirtl', stylisPlugins: [prefixer, rtlPlugin] });
