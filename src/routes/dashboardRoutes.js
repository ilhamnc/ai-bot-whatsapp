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

function isSameOriginMutation(request) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return true;
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = request.headers.origin;
  if (!origin) return true; // CLI dan aplikasi lokal dapat mengirim permintaan tanpa Origin.
  try {
    const parsedOrigin = new URL(origin);
    const forwardedHost = String(request.headers['x-forwarded-host'] || request.headers.host || '').split(',')[0].trim();
    const forwardedProto = String(request.headers['x-forwarded-proto'] || (request.socket.encrypted ? 'https' : 'http'))
      .split(',')[0].trim().toLowerCase();
    return parsedOrigin.host.toLowerCase() === forwardedHost.toLowerCase()
      && parsedOrigin.protocol === `${forwardedProto}:`;
  } catch {
    return false;
  }
}

function isSecureRequest(request) {
  const forwardedProto = String(request.headers['x-forwarded-proto'] || '')
    .split(',')[0].trim().toLowerCase();
  return request.socket.encrypted === true || forwardedProto === 'https';
}

function setDashboardSecurityHeaders(response) {
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('content-security-policy', "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
}

export function createDashboardServer(syncSchedules, getConnectionInfo, connectionManager, credentials = {}) {
  return createServer((request, response) => {
    setDashboardSecurityHeaders(response);
    const secureRequest = isSecureRequest(request);
    if (secureRequest) response.setHeader('strict-transport-security', 'max-age=31536000');
    if (credentials.requireHttps && !secureRequest) {
      response.writeHead(426, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      response.end('Dashboard harus dibuka melalui HTTPS.');
      return;
    }
    if (!isAuthorized(request, credentials)) {
      response.writeHead(401, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'www-authenticate': 'Basic realm="AiBot Dashboard"'
      });
      response.end('Login dashboard diperlukan.');
      return;
    }
    if (!isSameOriginMutation(request)) {
      response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      response.end('Permintaan lintas situs ditolak.');
      return;
    }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)
      && !String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      response.writeHead(415, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      response.end('Perubahan dashboard harus memakai JSON.');
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
