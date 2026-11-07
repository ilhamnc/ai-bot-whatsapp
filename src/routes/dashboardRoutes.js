// Route HTTP lokal untuk halaman dashboard pengingat.
import { createServer } from 'node:http';
import { handleDashboardRequest } from '../controllers/dashboardController.js';

export function createDashboardServer(syncSchedules, getConnectionInfo, connectionManager) {
  return createServer((request, response) => {
    void handleDashboardRequest(request, response, syncSchedules, getConnectionInfo, connectionManager).catch(error => {
      console.error('Kesalahan dashboard:', error);
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Terjadi error pada dashboard.' }));
      }
    });
  });
}
