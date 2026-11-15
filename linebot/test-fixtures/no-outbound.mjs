// Loaded only by the integration test, never by the deployed application.
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';

const refuse = () => {
  process.send?.({ kind: 'outbound-attempt' });
  throw new Error('Test process cannot make outbound connections');
};
globalThis.fetch = refuse;
net.Socket.prototype.connect = refuse;
http.request = refuse;
https.request = refuse;
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function(port, callback) {
  this.once('listening', () => process.send?.({ kind: 'listening', address: this.address() }));
  return listen.call(this, { port, host: '127.0.0.1' }, callback);
};
syncBuiltinESMExports();
