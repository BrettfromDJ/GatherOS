import React from 'react';
import { createRoot } from 'react-dom/client';
import AppGate from './AppGate.jsx';
import './styles/variables.css';
import './styles/global.css';

const container = document.getElementById('root');
createRoot(container).render(
  <React.StrictMode>
    <AppGate />
  </React.StrictMode>,
);
