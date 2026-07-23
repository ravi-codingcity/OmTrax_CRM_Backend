/**
 * cPanel / Phusion Passenger entry point.
 *
 * cPanel's "Setup Node.js App" loads this file (app.js at the application
 * root is its default "Application startup file"). It simply boots the real
 * server in src/server.js, which loads environment variables, connects to
 * MongoDB, and calls app.listen() on the socket/port Passenger provides.
 *
 * Do NOT run `node src/server.js` manually on the server — that binds a real
 * TCP port and prevents Passenger from managing the app. Let Passenger start
 * this file instead (Application Manager → Restart, or touch tmp/restart.txt).
 */
require('./src/server');
