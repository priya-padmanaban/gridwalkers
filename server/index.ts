import { createGameServer } from './socket.ts';

const { server } = createGameServer();
const port = Number(process.env.PORT ?? 3000);
server.listen(port, '127.0.0.1', () => console.log('Gridwalkers socket server listening on ' + port));
