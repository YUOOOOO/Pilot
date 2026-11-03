// Translate parent IPC/disconnect into the official CLI's SIGTERM handler.
// This runs before the unmodified CLI via Node --import.
let requested = false;
function shutdown() {
  if (requested) return;
  requested = true;
  const notify = () => {
    if (process.listenerCount('SIGTERM')) process.emit('SIGTERM');
    else process.exit(0); // Parent disappeared before CLI initialization.
  };
  setImmediate(notify);
}
process.on('message', message => { if (message?.type === 'pilot:shutdown') shutdown(); });
process.on('disconnect', shutdown);
