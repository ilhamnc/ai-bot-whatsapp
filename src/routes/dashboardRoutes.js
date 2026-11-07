// Route HTTP dashboard dan proteksi login saat dipasang pada hosting.
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { handleDashboardRequest } from '../controllers/dashboardController.js';

function matchesCredential(actual, expected) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function isAuthorized(request, credentials) {
  if (!credentials.user) return true;
  const header = request.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) return false;
  return matchesCredential(decoded.slice(0, separator), credentials.user)
    && matchesCredential(decoded.slice(separator + 1), credentials.password);
}

export function createDashboardServer(syncSchedules, getConnectionInfo, connectionManager, credentials = {}) {
  return createServer((request, response) => {
    if (!isAuthorized(request, credentials)) {
      response.writeHead(401, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'www-authenticate': 'Basic realm="AiBot Dashboard"'
      });
      response.end('Login dashboard diperlukan.');
      return;
    }
    void handleDashboardRequest(request, response, syncSchedules, getConnectionInfo, connectionManager).catch(error => {
      console.error('Kesalahan dashboard:', error);
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Terjadi error pada dashboard.' }));
      }
    });
  });
}
