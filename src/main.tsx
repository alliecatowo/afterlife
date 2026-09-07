/**
 * Entry point. Owned by the architect until the UI agent takes over `App`.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/base.css';
import { App } from '@/ui/App';

const host = document.getElementById('root');
if (!host) throw new Error('#root host element missing from index.html');

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
