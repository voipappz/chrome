import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Alert, AppBar, Backdrop, Box, Button, Card, CircularProgress, InputAdornment, Snackbar, TextField, Toolbar, Typography,
} from '@mui/material';
import PersonOutline from '@mui/icons-material/PersonOutline';
import LockOutlined from '@mui/icons-material/LockOutlined';
import { login } from '../api.js';
import { endpoint, rememberCredentials, rememberedCredentials, rememberSession, cableEndpoint } from '../session.js';
import { buildStamp, buildStampDetail } from '../buildStamp.js';
import { tellWorker } from './useWorker.js';

export default function LoginPage() {
  const navigate = useNavigate();
  // Prefilled rather than auto-submitted: a wrong stored password would
  // otherwise burn a login attempt on every popup open with no way to fix it.
  const [form, setForm] = useState(rememberedCredentials);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const field = (name) => ({
    name,
    value: form[name],
    onChange: (e) => setForm((f) => ({ ...f, [name]: e.target.value })),
  });

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const domain = endpoint();
    try {
      const data = await login(form.username, form.password);
      rememberCredentials(form.username, form.password);
      rememberSession(domain, { token: data.token, userUuid: data.user.uuid });
      // The worker has no storage of its own and cannot read this page's, so
      // it is handed the session to open the socket with.
      tellWorker({ event: 'login', data: { ...data, user_uuid: data.user.uuid }, domain, cable: cableEndpoint() });
      navigate('/main', { state: { user: data.user } });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ width: 400, minHeight: 250, mx: 'auto', display: 'flex', alignItems: 'center' }}>
      <Backdrop open={loading} sx={{ zIndex: 2, bgcolor: 'rgba(255,255,255,0.2)' }}>
        <CircularProgress />
      </Backdrop>
      <Box sx={{ width: '100%' }}>
        <AppBar position="static" elevation={0}>
          <Toolbar variant="dense" sx={{ justifyContent: 'center' }}>Login</Toolbar>
        </AppBar>
        <Card sx={{ p: 2, borderRadius: 0 }}>
          {/* Sized in CSS: the popup is a fixed width, and a taller tenant logo
              would otherwise push the form below the fold. */}
          <Box component="img" src="/images/logo.png" alt=""
            sx={{ display: 'block', mx: 'auto', mt: 1, mb: 1, maxWidth: 160, maxHeight: 96, objectFit: 'contain' }} />
          <form noValidate onSubmit={onSubmit}>
            <TextField {...field('username')} autoFocus fullWidth margin="dense" variant="standard"
              placeholder="Username" inputProps={{ 'aria-label': 'Username' }}
              InputProps={{ startAdornment: <InputAdornment position="start"><PersonOutline /></InputAdornment> }} />
            <TextField {...field('password')} type="password" autoComplete="off" fullWidth margin="dense" variant="standard"
              placeholder="Password" inputProps={{ 'aria-label': 'Password' }}
              InputProps={{ startAdornment: <InputAdornment position="start"><LockOutlined /></InputAdornment> }} />
            <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }}>Login</Button>
          </form>
          {/* Which build and whose, on the LOGIN page because a portal that
              moved fails here, before anyone reaches the main popup. */}
          <Typography title={buildStampDetail()} data-testid="build-stamp"
            sx={{ mt: 1.75, textAlign: 'center', fontSize: 11, letterSpacing: '0.04em', color: 'text.disabled', userSelect: 'text' }}>
            {buildStamp()}
          </Typography>
        </Card>
      </Box>
      <Snackbar open={!!error} autoHideDuration={2000} onClose={() => setError('')}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert severity="error" variant="filled" onClose={() => setError('')}>{error}</Alert>
      </Snackbar>
    </Box>
  );
}
