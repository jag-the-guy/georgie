import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './styles.css';
import './themes/redesign.css'; // design experiment (temporary)
import './themes/design-switch.css'; // design experiment (temporary)
import { DesignSwitch } from './themes/DesignSwitch'; // design experiment (temporary)
import './themes/theme'; // design experiment (temporary)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <DesignSwitch /> {/* design experiment (temporary) */}
    </BrowserRouter>
  </StrictMode>,
);
