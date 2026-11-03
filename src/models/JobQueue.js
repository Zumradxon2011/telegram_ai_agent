import mongoose from 'mongoose';

/**
 * Fon vazifalari navbati (Job Queue) sxemasi
 */
const jobQueueSchema = new mongoose.Schema(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      index: true,
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'DELAYED'],
      default: 'PENDING',
      index: true,
    },
    priority: {
      type: Number,
      default: 5,
      index: true, // Yuqori raqam = yuqori ustuvorlik
    },
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 3,
    },
    backoffDelayMs: {
      type: Number,
      default: 2000,
    },
    scheduledAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    error: {
      type: String,
      default: null,
    },
    result: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Eng ustuvor va eng avval rejalashtirilgan vazifalarni tez topish indeksi
jobQueueSchema.index({ status: 1, priority: -1, scheduledAt: 1 });

export const JobQueue = mongoose.models.JobQueue || mongoose.model('JobQueue', jobQueueSchema);
