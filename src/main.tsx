import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Ensure Service Worker checks for updates on load so mobile devices don't serve stale cached bundles
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const reg of registrations) {
      reg.update();
    }
  }).catch(() => {});
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
