import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { startWarmup } from './net/serverStatus';
import './styles.css';
import './ui.css';
import './play.css';

// start waking the game server the moment the site opens, before anyone clicks anything
startWarmup();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
