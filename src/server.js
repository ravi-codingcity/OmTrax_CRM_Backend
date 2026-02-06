require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');
const { port, nodeEnv } = require('./config/constants');

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION! Shutting down...');
    console.error(err.name, err.message);
    process.exit(1);
});

// Connect to Database
connectDB();

// Start server
const server = app.listen(port, () => {
    console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║     OmTrax CRM Backend Server Started                 ║
║                                                       ║
║     Environment: ${nodeEnv.padEnd(35)}║
║     Port: ${String(port).padEnd(42)}║
║     URL: http://localhost:${String(port).padEnd(27)}║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
    `);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
    console.error('UNHANDLED REJECTION! Shutting down...');
    console.error(err.name, err.message);
    server.close(() => {
        process.exit(1);
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
        console.log('Process terminated!');
    });
});
