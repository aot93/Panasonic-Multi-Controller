import { HTTP_HOST, HTTP_PORT, DB_PATH } from './config.js';
import { commandsRouter } from './commands/routes.js';
import { ensureDefaultCredentials } from './credentials/store.js';
import { getDb, closeDb } from './db/index.js';
import { seed } from './db/seed.js';
import { createDispatcher } from './dispatch/dispatch.js';
import { dispatchRouter } from './dispatch/routes.js';
import { devicesRouter } from './devices/routes.js';
import { listDevicesWithState } from './devices/read-model.js';
import { eventsRouter } from './events/routes.js';
import { groupsRouter } from './groups/routes.js';
import { macrosRouter } from './macros/routes.js';
import { Poller } from './poller/poller.js';
import { pollerRouter } from './poller/routes.js';
import { projectRouter } from './project/routes.js';
import { Scheduler } from './scheduler/scheduler.js';
import { schedulesRouter } from './scheduler/routes.js';
import { settingsRouter } from './settings/routes.js';
import { buildServer, finalizeRoutes } from './server.js';
import { ExternalTriggerServer } from './triggers/external-trigger-server.js';
import { triggersRouter } from './triggers/routes.js';
import { lanAddresses } from './util/network.js';

async function main(): Promise<void> {
  const db = getDb();
  // Idempotent: tops up the built-in catalogue after an upgrade adds commands.
  seed(db);
  // Idempotent: only seeds Panasonic's factory default login if nothing is configured yet.
  ensureDefaultCredentials(db);

  const { app, http, io } = buildServer();

  const poller = new Poller(db, io);
  const dispatch = createDispatcher(db, io, poller);
  const triggerServer = new ExternalTriggerServer(db, dispatch);
  const scheduler = new Scheduler(db, dispatch);

  app.use('/api/devices', devicesRouter(db, poller));
  app.use('/api/groups', groupsRouter(db));
  app.use('/api/commands', commandsRouter(db));
  app.use('/api/dispatch', dispatchRouter(dispatch));
  app.use('/api/triggers', triggersRouter(db, triggerServer));
  app.use('/api/schedules', schedulesRouter(db, scheduler, dispatch));
  app.use('/api/macros', macrosRouter(db, dispatch));
  app.use('/api/settings', settingsRouter(db));
  app.use('/api/events', eventsRouter(db));
  app.use('/api/project', projectRouter(db, poller));
  app.use('/api/poller', pollerRouter(poller));

  finalizeRoutes(app);

  io.on('connection', (socket) => {
    socket.on('devices:subscribe', () => {
      // No bulk "here's everyone" event in the socket contract — replay
      // 'device:state' per already-polled device to just this socket so a
      // freshly-connected dashboard doesn't have to wait a full poll cycle
      // for its first render.
      for (const device of listDevicesWithState(db)) {
        if (device.state) socket.emit('device:state', device.state);
      }
    });

    socket.on('devices:refresh', (payload) => {
      void poller.pollNow(payload?.deviceIds);
    });
  });

  poller.start();
  await triggerServer.start();
  scheduler.start();

  http.listen(HTTP_PORT, HTTP_HOST, () => {
    console.log(`[ppc] database   ${DB_PATH}`);
    console.log(`[ppc] listening  http://localhost:${HTTP_PORT}`);
    for (const addr of lanAddresses()) {
      console.log(`[ppc] on the LAN http://${addr}:${HTTP_PORT}`);
    }
  });

  const shutdown = (signal: string) => {
    console.log(`\n[ppc] ${signal} received, shutting down`);
    poller.stop();
    scheduler.stop();
    void triggerServer.stop().finally(() => {
      http.close(() => {
        closeDb();
        process.exit(0);
      });
    });
    // Don't hang forever on a wedged socket.
    setTimeout(() => process.exit(1), 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
