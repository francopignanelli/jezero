import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../i18n';
import '../ui/app.css';
import './game.css';
import { GameApp } from './GameApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GameApp />
  </StrictMode>,
);
