import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  AppBar, Badge, Box, Button, Card, CardActions, IconButton, MenuItem, Select, Toolbar, Tooltip, Typography,
} from '@mui/material';
import Logout from '@mui/icons-material/Logout';
import CallEnd from '@mui/icons-material/CallEnd';
import { getBreakStatuses, getUser, hangUp } from '../api.js';
import { currentSession, endpoint, forgetSession, cableEndpoint } from '../session.js';
import { buildStampDetail } from '../buildStamp.js';
import { CALL_STATUS_LABEL } from '../realtime.js';
import { secondsToString } from '../timer.js';
import { tellWorker, useWorker } from './useWorker.js';

const pill = { bgcolor: '#fff', color: 'primary.main', px: 1.875, borderRadius: 10, marginInlineEnd: 0.625, display: 'flex', alignItems: 'center' };

// The realtime light: green when the socket is up and the server reported its
// cable ready, amber when up but not, grey when there is no socket. Grey is the
// honest default, shown before the worker has answered.
function ConnDot({ realtime }) {
  const on = realtime.connected && realtime.cable_ready;
  const degraded = realtime.connected && !realtime.cable_ready;
  const state = !realtime.connected ? 'לא מחובר לשרת' : on ? 'מחובר לשרת' : 'מחובר, אך הערוץ אינו מוכן';
  const color = on ? '#4caf50' : degraded ? '#ff9800' : '#9e9e9e';
  return (
    <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{`${state}\n${buildStampDetail()}`}</span>}>
      <Box data-testid="conn-dot" data-state={on ? 'on' : degraded ? 'degraded' : 'off'} aria-label={state}
        sx={{ flex: '0 0 auto', width: 11, height: 11, borderRadius: '50%', marginInlineEnd: 1, bgcolor: color,
          boxShadow: on || degraded ? `0 0 6px ${color}` : 'none', transition: 'background-color .2s, box-shadow .2s' }} />
    </Tooltip>
  );
}

// The availability timer: counts from zero since the last availability or
// break change, as the Angular popup did. Local only; nothing is sent.
function useTimer() {
  const [seconds, setSeconds] = useState(null);
  const ref = useRef(null);
  const start = useCallback(() => {
    clearInterval(ref.current);
    setSeconds(0);
    ref.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  }, []);
  useEffect(() => () => clearInterval(ref.current), []);
  return { text: seconds === null ? '' : secondsToString(seconds), start };
}

export default function MainPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(location.state?.user || null);
  const [availability, setAvailability] = useState('');
  const [status, setStatus] = useState('');
  const [statuses, setStatuses] = useState([]);
  const [call, setCall] = useState({ id: '', status: '' });
  const timer = useTimer();

  const onCall = useCallback((msg) => {
    if (!msg.call?.uuid) return;
    setCall((c) => ({ id: msg.call.uuid, status: CALL_STATUS_LABEL[msg.status] || c.status }));
  }, []);
  const { realtime, post } = useWorker({ onCall });

  useEffect(() => {
    // Reopen the socket after MV3 tore the worker down. The worker needs the
    // whole session to do that (it has no storage of its own), so the shape
    // matches what login posts.
    const { userUuid, token } = currentSession();
    if (userUuid && token) post({ event: 'login', data: { user_uuid: userUuid, token }, domain: endpoint(), cable: cableEndpoint() });

    const load = user ? Promise.resolve(user) : getUser(userUuid).catch((err) => { console.error('loading user', err); return {}; });
    load.then((u) => {
      setUser(u);
      // The user's own state shows as loaded, as the Angular popup bound it;
      // only a user with no break status defaults to available and starts the timer.
      setAvailability(u.available_flag || '');
      setStatus(u.status || '');
      if (!u.status) {
        setAvailability('available');
        timer.start();
      }
    });
    getBreakStatuses().then((s) => setStatuses(Array.isArray(s) ? s : [])).catch((err) => console.error('statuses', err));
    // Once, on open: the worker answers on the same port for the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onAvailability = (value) => {
    setAvailability(value);
    setStatus('');
    if (value === 'available') timer.start();
  };

  const onStatus = (value) => {
    setStatus(value);
    if (value !== '') {
      setAvailability('logged_out');
      timer.start();
    }
  };

  const onHangUp = () => {
    hangUp(call.id).catch((err) => console.error(err)).finally(() => setCall((c) => ({ ...c, id: '' })));
  };

  const onLogout = () => {
    tellWorker({ event: 'logout' });
    forgetSession();
    navigate('/login');
  };

  const userIcon = availability === 'logged_out' && !status
    ? '/images/NotActiveUser.svg'
    : status ? '/images/NotReadyUser.svg' : '/images/ActiveUser.svg';

  return (
    <Box sx={{ width: 650, minHeight: 250 }}>
      <AppBar position="static" elevation={0}>
        <Toolbar variant="dense" sx={{ justifyContent: 'space-between', fontSize: 16 }}>
          <ConnDot realtime={realtime} />
          <Box sx={{ ...pill, justifyContent: 'space-between' }} data-testid="user-name">
            <Box component="img" src={userIcon} alt=""
              sx={{ marginInlineStart: -1.875, marginInlineEnd: 0.5, bgcolor: 'rgba(0,0,0,0.2)', px: 0.625, py: 0.5, borderRadius: 6, height: 25 }} />
            {user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.name || '' : ''}
          </Box>
          <Box sx={{ display: 'flex', flex: 1, alignItems: 'center' }}>
            <Box sx={{ ...pill, maxWidth: 230 }}>
              <Select variant="standard" disableUnderline value={availability} sx={{ width: 100 }}
                onChange={(e) => onAvailability(e.target.value)} inputProps={{ 'aria-label': 'זמינות' }}
                data-testid="availability">
                <MenuItem value="available">זמין</MenuItem>
                <MenuItem value="logged_out">לא זמין</MenuItem>
              </Select>
            </Box>
            <Box sx={pill}>
              <Select variant="standard" disableUnderline value={status} sx={{ minWidth: 100, maxWidth: 150 }}
                onChange={(e) => onStatus(e.target.value)} inputProps={{ 'aria-label': 'הפסקה' }}
                data-testid="break-status">
                {statuses.map((s) => <MenuItem key={s.uuid} value={s.uuid}>{s.name}</MenuItem>)}
              </Select>
            </Box>
            <Typography className="timer" data-testid="timer" sx={{ px: 1.875, fontVariantNumeric: 'tabular-nums' }}>
              {timer.text}
            </Typography>
          </Box>
          <IconButton color="inherit" onClick={onLogout} aria-label="logout">
            <Logout sx={{ transform: 'scaleX(-1)' }} />
          </IconButton>
        </Toolbar>
      </AppBar>
      <Box sx={{ p: 0.75 }}>
        <Card data-testid="call-card" sx={{ p: 2 }}>
          {call.id ? (
            <>
              <Badge badgeContent={1} color="secondary">
                {/* Inline style, not sx: the RTL cache would flip the side,
                    and this text is left to right inside a right-to-left page. */}
                <span dir="ltr" style={{ paddingLeft: 16 }}>Call id: {call.id}</span>
              </Badge>
              <Typography variant="h4" component="h1" sx={{ my: 1 }}>{call.status || 'none'}</Typography>
              <CardActions sx={{ p: 0 }}>
                <Button variant="contained" onClick={onHangUp} endIcon={<CallEnd />}>HANG UP</Button>
              </CardActions>
            </>
          ) : (
            <Typography variant="h4" component="h1">No active calls</Typography>
          )}
        </Card>
      </Box>
    </Box>
  );
}
