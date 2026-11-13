// ES-module bootstrap for the staged v18 migration.
// All application subsystems are ES modules. The legacy UI compatibility
// surface is installed by editor-ui.js immediately before its UI initialises.
import * as Core from './vol-core.js';
import { EC } from './editor-core.js';
import { IA } from './strat-assembler.js';

// Temporary compatibility bridge for existing viewer/UI code. Core APIs are
// still published here until the next cleanup stage removes bare global use.
Object.assign(window, Core, { EC, IA });

try {
  // editor-ui.js statically imports the viewer module and installs its live
  // compatibility accessors before running the existing editor UI.
  await import('./editor-ui.js');
  document.documentElement.dataset.editorReady = 'true';
  console.info('I-Ninja Editor v18: ES-module application loaded.');
} catch (error) {
  console.error('I-Ninja Editor startup failed:', error);
  const status = document.getElementById('st');
  if (status) status.textContent = `Startup error: ${error.message}`;
  document.documentElement.dataset.editorReady = 'error';
}
