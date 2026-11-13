// ES-module bootstrap for the staged v18 migration.
// The binary core, editor subsystem and script assembler are modules; the viewer and UI
// remain classic scripts temporarily and consume the compatibility bridge below.
import * as Core from './vol-core.js';
import { EC } from './editor-core.js';
import { IA } from './strat-assembler.js';

// Temporary compatibility bridge for the remaining classic-script UI.
// Core APIs and the two converted subsystems are published only at this boundary.
Object.assign(window, Core, { EC, IA });

const legacyScripts = [
  './viewer.js',
  './editor-ui.js'
];

function loadClassicScript(relativePath) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(relativePath, import.meta.url).href;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${relativePath}`));
    document.head.appendChild(script);
  });
}

try {
  for (const path of legacyScripts) {
    await loadClassicScript(path);
  }
  document.documentElement.dataset.editorReady = 'true';
  console.info('I-Ninja Editor v18: ES-module core and legacy UI loaded.');
} catch (error) {
  console.error('I-Ninja Editor startup failed:', error);
  const status = document.getElementById('st');
  if (status) status.textContent = `Startup error: ${error.message}`;
  document.documentElement.dataset.editorReady = 'error';
}
