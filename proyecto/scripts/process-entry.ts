// Local supervisor entry: IPC only carries shutdown, never config/secrets.
const service = process.argv[2];
const entries = {
  api: '../apps/api/src/main.ts',
  worker: '../apps/worker/src/main.ts',
  web: '../apps/web/dev.ts',
};
if (!service || !(service in entries)) throw new Error('Servicio local desconocido');
process.on('message', (message) => {
  if (message === 'shutdown') process.emit('SIGTERM');
});
process.on('disconnect', () => process.emit('SIGTERM'));
process.channel?.unref();
await import(new URL(entries[service as keyof typeof entries], import.meta.url).href);
