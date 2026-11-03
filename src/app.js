import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import os from 'os';
import { isUserbotConnected } from './userbot/client.js';
import { queueManager } from './services/queueService.js';
import { getAutoReplyConfig } from './services/autoReplyService.js';
import { logger } from './utils/logger.js';

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// So'rovlarni loglash middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

// To'liq monitoring va Health check endpointi (24/7 monitoring uchun)
app.get('/health', async (req, res) => {
  const mem = process.memoryUsage();
  const queueStats = await queueManager.getQueueStats();
  const uptimeSec = Math.floor(process.uptime());

  const healthData = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: {
      seconds: uptimeSec,
      formatted: `${Math.floor(uptimeSec / 3600)} soat ${Math.floor((uptimeSec % 3600) / 60)} daqiqa ${uptimeSec % 60} soniya`,
    },
    system: {
      platform: process.platform,
      nodeVersion: process.version,
      memory: {
        heapUsedMB: (mem.heapUsed / 1024 / 1024).toFixed(2),
        heapTotalMB: (mem.heapTotal / 1024 / 1024).toFixed(2),
        rssMB: (mem.rss / 1024 / 1024).toFixed(2),
        freeSystemMemoryMB: (os.freemem() / 1024 / 1024).toFixed(2),
      },
    },
    database: {
      status: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    },
    userbot: {
      status: isUserbotConnected() ? 'connected' : 'disconnected',
    },
    queue: queueStats,
    autoReply: getAutoReplyConfig(),
  };

  res.json(healthData);
});

// Prometheus / Monitoring metrics endpoint
app.get('/metrics', async (req, res) => {
  const mem = process.memoryUsage();
  const queueStats = await queueManager.getQueueStats();

  const lines = [
    `# HELP process_uptime_seconds Process uptime in seconds`,
    `# TYPE process_uptime_seconds gauge`,
    `process_uptime_seconds ${process.uptime()}`,
    `# HELP process_heap_bytes Process heap memory used`,
    `# TYPE process_heap_bytes gauge`,
    `process_heap_bytes ${mem.heapUsed}`,
    `# HELP queue_jobs_total Total jobs in queue`,
    `# TYPE queue_jobs_total gauge`,
    `queue_jobs_total{status="pending"} ${queueStats.PENDING}`,
    `queue_jobs_total{status="running"} ${queueStats.RUNNING}`,
    `queue_jobs_total{status="completed"} ${queueStats.COMPLETED}`,
    `queue_jobs_total{status="failed"} ${queueStats.FAILED}`,
  ];

  res.set('Content-Type', 'text/plain; version=0.0.4');
  res.send(lines.join('\n'));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint topilmadi' });
});

// Xatoliklarni markaziy qayta ishlash (Central Error Handler)
app.use((err, req, res, next) => {
  logger.error(`Kutilmagan server xatoligi: ${err.message}`, { stack: err.stack });
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Ichki server xatoligi yuz berdi',
    },
  });
});

export default app;
