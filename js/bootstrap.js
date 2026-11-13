// ES-module bootstrap. All application modules import their dependencies directly.
try {
  await import('./editor-ui.js?v=step10a-prefab-import-fix');
  document.documentElement.dataset.editorReady = 'true';
  console.info('I-Ninja Editor v18: ES-module application loaded.');
} catch (error) {
  console.error('I-Ninja Editor startup failed:', error);
  const status = document.getElementById('st');
  if (status) status.textContent = `Startup error: ${error.message}`;
  document.documentElement.dataset.editorReady = 'error';
}
