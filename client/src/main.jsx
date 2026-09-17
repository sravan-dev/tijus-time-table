import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth';
import { BrandingProvider } from './branding';
import { ToastProvider } from './components/Toast';
import App from './App';
import './styles.css';

// The app draws its own right-click menus, so hide the browser's everywhere —
// except in text fields, where copy / paste still needs it.
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return;
  e.preventDefault();
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <BrandingProvider>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </BrandingProvider>
    </BrowserRouter>
  </React.StrictMode>
);
