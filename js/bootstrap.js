// ES-module bootstrap for the staged v18 migration.
// vol-core.js is a real ES module. The remaining application files are still classic
// scripts for now, so this bridge exposes the core API on window before loading them.
import * as Core from './vol-core.js';

Object.assign(window, Core);

const legacyScripts = [
  './viewer.js',
  './editor-core.js',
  './strat-assembler.js',
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
