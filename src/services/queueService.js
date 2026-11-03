import EventEmitter from 'events';
import mongoose from 'mongoose';
import { JobQueue } from '../models/JobQueue.js';
import { logger } from '../utils/logger.js';

class QueueManager extends EventEmitter {
  constructor() {
    super();
    this.workers = new Map();
    this.inMemoryJobs = new Map();
    this.concurrency = 3;
    this.activeWorkersCount = 0;
    this.isProcessing = false;
    this.pollInterval = null;
    this.isInitialized = false;
  }

  isDBConnected() {
    return mongoose.connection.readyState === 1;
  }

  /**
   * Navbat tizimini initsializatsiya qilish va restartdan keyingi tiklash (Reboot Recovery)
   */
  async initQueue() {
    if (this.isInitialized) return;

    logger.info('Fon vazifalari navbati (JobQueue) initsializatsiya qilinmoqda...');

    // 1. Crash/Restart tiklash: Tizim to'satdan o'chganida 'RUNNING' holatida qolgan vazifalarni 'PENDING'ga qaytarish
    if (this.isDBConnected()) {
      try {
        const recovered = await JobQueue.updateMany(
          { status: 'RUNNING' },
          { 
            $set: { 
              status: 'PENDING', 
              error: 'Tizim qayta ishga tushishi natijasida avtomatik qayta tiklandi (Crash Recovery).' 
            } 
          }
        );
        if (recovered.modifiedCount > 0) {
          logger.warn(`[Reboot Recovery] ${recovered.modifiedCount} ta chala qolgan vazifa qayta tiklandi.`);
        }
      } catch (err) {
        logger.error(`Reboot recovery xatoligi: ${err.message}`);
      }
    }

    // In-memory keshdagi chala qolgan vazifalarni ham tiklash
    for (const job of this.inMemoryJobs.values()) {
      if (job.status === 'RUNNING') {
        job.status = 'PENDING';
        job.error = 'Tizim qayta ishga tushishi natijasida avtomatik qayta tiklandi (Crash Recovery).';
      }
    }

    // 2. Fon poller'ni ishga tushirish (har 1 sekundda)
    this.pollInterval = setInterval(() => {
      this.processNextJobs().catch((err) => {
        logger.error(`Navbatni qayta ishlashda xatolik: ${err.message}`);
      });
    }, 1000);

    this.isInitialized = true;
    logger.info('JobQueue muvaffaqiyatli ishga tushdi.');
  }

  /**
   * Vazifa uchun bajaruvchi (Worker) ro'yxatdan o'tkazish
   * @param {string} name - Vazifa nomi (job name)
   * @param {Function} handler - async (data, job) => result
   */
  registerWorker(name, handler) {
    if (typeof handler !== 'function') {
      throw new Error(`Worker handler funksiya bo'lishi shart (${name})`);
    }
    this.workers.set(name, handler);
    logger.info(`Vazifa workeri ro'yxatga olindi: "${name}"`);
  }

  /**
   * Yangi fon vazifasini navbatga qo'shish
   */
  async addJob(name, data = {}, options = {}) {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();
    const delayMs = Number(options.delayMs) || 0;
    const scheduledAt = new Date(now.getTime() + delayMs);

    const jobData = {
      jobId,
      name,
      data,
      status: delayMs > 0 ? 'DELAYED' : 'PENDING',
      priority: Number(options.priority) || 5,
      attempts: 0,
      maxAttempts: Number(options.maxAttempts) || 3,
      backoffDelayMs: Number(options.backoffDelayMs) || 2000,
      scheduledAt,
      createdAt: now,
    };

    // In-memory keshga saqlash
    this.inMemoryJobs.set(jobId, jobData);

    // MongoDB ga saqlash
    if (this.isDBConnected()) {
      try {
        await JobQueue.create(jobData);
      } catch (err) {
        logger.error(`Jobni DB ga yozishda xatolik: ${err.message}`);
      }
    }

    logger.info(`Yangi vazifa navbatga qo'shildi: [${jobId}] "${name}" (delay: ${delayMs}ms)`);
    this.emit('job_added', jobData);

    // Darhol qayta ishlashga urinib ko'rish
    if (delayMs === 0) {
      setImmediate(() => this.processNextJobs());
    }

    return jobData;
  }

  /**
   * Navbatdagi bajarilishga tayyor vazifani topish
   */
  async getNextJob() {
    const now = new Date();

    if (this.isDBConnected()) {
      try {
        const job = await JobQueue.findOneAndUpdate(
          {
            status: { $in: ['PENDING', 'DELAYED'] },
            scheduledAt: { $lte: now },
          },
          {
            $set: { status: 'RUNNING', processedAt: now },
            $inc: { attempts: 1 },
          },
          {
            sort: { priority: -1, scheduledAt: 1 },
            returnDocument: 'after',
          }
        );

        if (job) {
          this.inMemoryJobs.set(job.jobId, job.toObject());
          return job.toObject();
        }
      } catch (err) {
        logger.error(`DB dan job olishda xatolik: ${err.message}`);
      }
    }

    // In-memory fallback
    for (const [jobId, job] of this.inMemoryJobs.entries()) {
      if ((job.status === 'PENDING' || job.status === 'DELAYED') && new Date(job.scheduledAt) <= now) {
        job.status = 'RUNNING';
        job.processedAt = now;
        job.attempts = (job.attempts || 0) + 1;
        return job;
      }
    }

    return null;
  }

  /**
   * Navbatdagi mavjud vazifalarni oqim bo'yicha bajarish
   */
  async processNextJobs() {
    if (this.activeWorkersCount >= this.concurrency) {
      return;
    }

    const job = await this.getNextJob();
    if (!job) return;

    this.activeWorkersCount++;

    (async () => {
      const worker = this.workers.get(job.name);

      if (!worker) {
        const errMsg = `Ushbu vazifa uchun worker topilmadi: "${job.name}"`;
        logger.error(errMsg);
        await this.handleJobFailure(job, new Error(errMsg));
        this.activeWorkersCount--;
        this.processNextJobs();
        return;
      }

      try {
        logger.info(`Vazifa bajarilmoqda [${job.jobId}]: "${job.name}" (Urinish: ${job.attempts}/${job.maxAttempts})`);
        const result = await worker(job.data, job);
        await this.handleJobSuccess(job, result);
      } catch (error) {
        logger.warn(`Vazifa xatolik bilan yakunlandi [${job.jobId}]: ${error.message}`);
        await this.handleJobFailure(job, error);
      } finally {
        this.activeWorkersCount--;
        this.processNextJobs();
      }
    })();
  }

  /**
   * Vazifa muvaffaqiyatli bajarilganda
   */
  async handleJobSuccess(job, result) {
    const now = new Date();
    const update = {
      status: 'COMPLETED',
      result,
      completedAt: now,
      error: null,
    };

    if (this.inMemoryJobs.has(job.jobId)) {
      Object.assign(this.inMemoryJobs.get(job.jobId), update);
    }

    if (this.isDBConnected()) {
      try {
        await JobQueue.updateOne({ jobId: job.jobId }, { $set: update });
      } catch (err) {
        logger.error(`Job holatini yangilashda xatolik: ${err.message}`);
      }
    }

    logger.info(`✅ Vazifa muvaffaqiyatli bajarildi [${job.jobId}]: "${job.name}"`);
    this.emit('job_completed', { jobId: job.jobId, name: job.name, result });
  }

  /**
   * Vazifa xato berganda (Retry va Exponential Backoff)
   */
  async handleJobFailure(job, error) {
    const attempts = job.attempts;
    const maxAttempts = job.maxAttempts || 3;

    if (attempts < maxAttempts) {
      // Qayta urinish (Retry) va eksponentsial kechikish (Backoff)
      const backoffDelay = (job.backoffDelayMs || 2000) * Math.pow(2, attempts - 1);
      const nextScheduled = new Date(Date.now() + backoffDelay);

      const update = {
        status: 'DELAYED',
        error: error.message,
        scheduledAt: nextScheduled,
      };

      if (this.inMemoryJobs.has(job.jobId)) {
        Object.assign(this.inMemoryJobs.get(job.jobId), update);
      }

      if (this.isDBConnected()) {
        try {
          await JobQueue.updateOne({ jobId: job.jobId }, { $set: update });
        } catch (err) {
          logger.error(`Job retry holatini saqlashda xatolik: ${err.message}`);
        }
      }

      logger.warn(`[Retry & Backoff] Vazifa [${job.jobId}] ${backoffDelay}ms dan keyin qayta uriniladi (Keyingi: ${attempts + 1}/${maxAttempts})`);
      this.emit('job_retry', { jobId: job.jobId, nextAttempt: attempts + 1, delay: backoffDelay });
    } else {
      // Barcha urinishlar tugadi
      const update = {
        status: 'FAILED',
        error: error.message,
        completedAt: new Date(),
      };

      if (this.inMemoryJobs.has(job.jobId)) {
        Object.assign(this.inMemoryJobs.get(job.jobId), update);
      }

      if (this.isDBConnected()) {
        try {
          await JobQueue.updateOne({ jobId: job.jobId }, { $set: update });
        } catch (err) {
          logger.error(`Job failed holatini saqlashda xatolik: ${err.message}`);
        }
      }

      logger.error(`❌ Vazifa to'liq muvaffaqiyatsiz yakunlandi [${job.jobId}]: ${error.message}`);
      this.emit('job_failed', { jobId: job.jobId, error: error.message });
    }
  }

  /**
   * Navbat statistikasi
   */
  async getQueueStats() {
    if (this.isDBConnected()) {
      try {
        const stats = await JobQueue.aggregate([
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]);
        const result = { PENDING: 0, RUNNING: 0, DELAYED: 0, COMPLETED: 0, FAILED: 0 };
        stats.forEach((s) => {
          result[s._id] = s.count;
        });
        return {
          ...result,
          activeWorkers: this.activeWorkersCount,
          total: Object.values(result).reduce((a, b) => a + b, 0),
        };
      } catch {
        // Fallback to in-memory
      }
    }

    const counts = { PENDING: 0, RUNNING: 0, DELAYED: 0, COMPLETED: 0, FAILED: 0 };
    for (const job of this.inMemoryJobs.values()) {
      counts[job.status] = (counts[job.status] || 0) + 1;
    }

    return {
      ...counts,
      activeWorkers: this.activeWorkersCount,
      total: this.inMemoryJobs.size,
    };
  }

  /**
   * Navbatni xavfsiz to'xtatish
   */
  stopQueue() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isInitialized = false;
    logger.info('JobQueue to\'xtatildi.');
  }
}

export const queueManager = new QueueManager();
