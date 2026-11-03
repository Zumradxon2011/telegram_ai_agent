import mongoose from 'mongoose';

/**
 * Suhbat xabari sub-sxemasi
 */
const messageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      required: true,
      enum: ['user', 'model', 'system'],
    },
    content: {
      type: String,
      required: true,
    },
    toolCalls: {
      type: Array,
      default: [],
    },
    toolResults: {
      type: Array,
      default: [],
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

/**
 * Muloqot sessiyasi sxemasi
 */
const conversationSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    title: {
      type: String,
      default: 'Yangi muloqot',
    },
    messages: [messageSchema],
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    lastActiveAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// So'nggi faollikni avtomatik yangilash
conversationSchema.pre('save', function (next) {
  this.lastActiveAt = new Date();
  next();
});

export const Conversation = mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);
