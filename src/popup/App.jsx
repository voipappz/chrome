import { useEffect, useMemo } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { CacheProvider } from '@emotion/react';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { createPopupTheme, ltrCache, rtlCache } from './theme.js';
import { isAuthenticated } from '../session.js';
import LoginPage from './LoginPage.jsx';
import MainPage from './MainPage.jsx';

// The login page is English and left to right; the main page is Hebrew and
// right to left, as in the Angular popup. Direction drives the MUI theme and
// the Emotion cache (see theme.js), and
// changing the cache regenerates every class, hence the key.
function Themed({ children }) {
  const { pathname } = useLocation();
  const direction = pathname.startsWith('/main') ? 'rtl' : 'ltr';
  const theme = useMemo(() => createPopupTheme(direction), [direction]);

  useEffect(() => {
    document.documentElement.dir = direction;
    document.documentElement.lang = direction === 'rtl' ? 'he' : 'en';
  }, [direction]);

  return (
    <CacheProvider value={direction === 'rtl' ? rtlCache : ltrCache} key={direction}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </CacheProvider>
  );
}

const RequireSession = ({ children }) => (isAuthenticated() ? children : <Navigate to="/login" replace />);

// Hash routes, because the manifest opens the popup as index.html and the e2e
// specs open index.html#/main: there is no server to route paths.
export default function App() {
  return (
    <HashRouter>
      <Themed>
        <Routes>
          <Route path="/main" element={<RequireSession><MainPage /></RequireSession>} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/main" replace />} />
        </Routes>
      </Themed>
    </HashRouter>
  );
}
