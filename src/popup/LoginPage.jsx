import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Alert, Box, Button, CircularProgress, IconButton, InputAdornment, TextField, Typography,
} from '@mui/material';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined';
import { login } from '../api.js';
import { endpoint, rememberCredentials, rememberedCredentials, rememberSession, cableEndpoint } from '../session.js';
import { buildStamp, buildStampDetail } from '../buildStamp.js';
import { tellWorker } from './useWorker.js';

// The sign-in, laid out like the web app's user sign-in (voipappz/app
// src/components/Login/UserLogin.jsx): a centred title and subtitle, outlined
// "Email or extension" and password fields with show/hide, one full-width
// contained button with a spinner, the error inline above the form. No logo.
export default function LoginPage() {
  const navigate = useNavigate();
  // Prefilled rather than auto-submitted: a wrong stored password would
  // otherwise burn a login attempt on every popup open with no way to fix it.
  const [form, setForm] = useState(rememberedCredentials);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const field = (name) => ({
    name,
    value: form[name],
    onChange: (e) => { setError(''); setForm((f) => ({ ...f, [name]: e.target.value })); },
  });

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!form.username?.trim() || !form.password) {
      setError('Enter your email or extension and your password.');
      return;
    }
    setLoading(true);
    setError('');
    const domain = endpoint();
    try {
      const data = await login(form.username.trim(), form.password);
      rememberCredentials(form.username.trim(), form.password);
      rememberSession(domain, { token: data.token, userUuid: data.user.uuid });
      // The worker has no storage of the popup's, so it is handed the session
      // to open the socket with (and keeps its own copy for restarts).
      tellWorker({ event: 'login', data: { ...data, user_uuid: data.user.uuid }, domain, cable: cableEndpoint() });
      navigate('/main', { state: { user: data.user } });
    } catch (err) {
      setError(err.message || 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ width: 380, boxSizing: 'border-box', minHeight: 360, px: 4, py: 4, bgcolor: 'background.paper', display: 'flex', flexDirection: 'column' }}>
      <Typography component="h1" sx={{ fontWeight: 600, fontSize: '1.6rem', textAlign: 'center', color: '#1a2b4c', mb: 1 }}>
        Welcome back
      </Typography>
      <Typography variant="body2" sx={{ textAlign: 'center', color: 'text.secondary', mb: 3 }}>
        Sign in to get your screen pops and call status.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} data-testid="login-error">{error}</Alert>
      )}

      <Box component="form" noValidate onSubmit={onSubmit}>
        <TextField
          {...field('username')}
          label="Email or extension"
          placeholder="you@example.com or 2300"
          variant="outlined"
          fullWidth
          autoFocus
          // text, not email: an extension number is a valid sign-in too.
          type="text"
          autoComplete="username"
          sx={{ mb: 2.5 }}
          inputProps={{ 'aria-label': 'Email or extension' }}
        />
        <TextField
          {...field('password')}
          label="Password"
          placeholder="Your password"
          variant="outlined"
          fullWidth
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          inputProps={{ 'aria-label': 'Password' }}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((v) => !v)}
                  edge="end"
                  size="small"
                >
                  {showPassword ? <VisibilityOffOutlined fontSize="small" /> : <VisibilityOutlined fontSize="small" />}
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
        <Button
          type="submit"
          variant="contained"
          fullWidth
          size="large"
          disabled={loading}
          startIcon={loading ? <CircularProgress size={20} color="inherit" /> : null}
          sx={{ mt: 3, py: 1.25, fontWeight: 600, textTransform: 'none', borderRadius: 2 }}
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </Button>
      </Box>

      {/* Which build and whose, on the sign-in because a server that moved
          fails here, before anyone reaches the main popup. */}
      <Typography title={buildStampDetail()} data-testid="build-stamp"
        sx={{ mt: 'auto', pt: 3, textAlign: 'center', fontSize: 11, letterSpacing: '0.04em', color: 'text.disabled', userSelect: 'text' }}>
        {buildStamp()}
      </Typography>
    </Box>
  );
}
