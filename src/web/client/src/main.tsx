import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createApi } from './api/client.js';
import { App } from './app/App.js';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App api={createApi()} />
  </StrictMode>,
);
