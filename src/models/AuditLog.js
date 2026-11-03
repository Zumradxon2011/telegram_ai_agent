import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    actionId: {
      type: String,
      required: true,
      index: true,
    },
    actionType: {
      type: String,
      required: true,
      enum: ['SEND_MESSAGE', 'DELETE_MESSAGE', 'OTHER'],
      default: 'SEND_MESSAGE',
    },
    targetChat: {
      type: String,
      required: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ['PENDING_APPROVAL', 'APPROVED', 'EXECUTED', 'REJECTED', 'FAILED'],
      default: 'PENDING_APPROVAL',
      index: true,
    },
    initiatedBy: {
      type: String,
      default: 'AI_AGENT',
    },
    reviewedBy: {
      type: String,
      default: null,
    },
    errorMessage: {
      type: String,
      default: null,
    },
    executedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
