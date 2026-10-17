import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-600.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import '@fontsource/zen-maru-gothic/500.css';
import { MotionConfig } from 'motion/react';
import App from './App';
import './themes/tokens.css';
import './styles.css';

const giftPreferences = localStorage.getItem('usagi-gift-imported')
  ? undefined
  : await window.desktop?.getGiftPreferences();
if (giftPreferences && !localStorage.getItem('usagi-gift-imported')) {
  for (const key of ['usagi-theme', 'usagi-favorites', 'usagi-volume', 'usagi-outfit']) {
    if (typeof giftPreferences[key] === 'string') localStorage.setItem(key, giftPreferences[key]);
  }
  localStorage.setItem('usagi-gift-imported', '1');
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><MotionConfig reducedMotion="user"><App /></MotionConfig></React.StrictMode>);
