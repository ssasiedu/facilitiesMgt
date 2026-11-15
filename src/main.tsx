import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

/* Each deploy writes new hashed chunk files and removes the old ones. A tab opened before a
   deploy still holds the previous index.html, so opening a new page asks for a chunk that is no
   longer there. Reload once to pick up the current index.html; the timestamp stops a reload loop
   if the chunk is missing for some other reason. */
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  const key = 'fm:chunk-reload-at';
  const last = Number(sessionStorage.getItem(key) ?? 0);
  if (Date.now() - last < 10_000) return;
  sessionStorage.setItem(key, String(Date.now()));
  window.location.reload();
});

// PWA: cache the app shell so it installs on the home screen and opens on poor connections.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
}
