import { createRequire } from 'node:module';
import type { createGameServer as createGameServerSource } from '../server/socket.ts';

// Vercel includes the compiled backend via vercel.json. The type import is erased.
const require = createRequire(import.meta.url);
const { createGameServer } = require('../server-build/socket.cjs') as {
  createGameServer: typeof createGameServerSource;
};
export default createGameServer().server;
