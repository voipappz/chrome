// FIRST: installs a `chrome` stand-in when there is none, so the popup also
// runs as a plain page under `vite dev`. Inside the extension it does nothing.
import '../chromeShim.js';
import { healStaleSession } from '../session.js';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

// SECOND: drop a session that belongs to a previous CONFIG.API_ENDPOINT, before
// the router runs, or the guard sends a foreign token to the main page.
healStaleSession();

createRoot(document.getElementById('root')).render(<App />);
