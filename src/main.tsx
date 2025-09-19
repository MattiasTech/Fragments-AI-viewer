import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Mount the React application onto the root element. Vite injects
// this module during development and build, so the script tag in
// index.html references this entry point.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);