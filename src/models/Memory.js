import mongoose from 'mongoose';

/**
 * Uzoq muddatli xotira (Memory) sxemasi
 */
const memorySchema = new mongoose.Schema(
  {
    chatId: {
      type: String,
      default: 'global',
      index: true,
    },
    key: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: ['FACT', 'PREFERENCE', 'GOAL', 'INSTRUCTION', 'SUMMARY', 'OTHER'],
      default: 'FACT',
      index: true,
    },
    source: {
      type: String,
      enum: ['DIRECT_INPUT', 'EXTRACTED_FROM_CHAT', 'AGENT_TOOL', 'SYSTEM'],
      default: 'AGENT_TOOL',
    },
    tags: {
      type: [String],
      default: [],
    },
    importance: {
      type: Number,
      min: 1,
      max: 5,
      default: 3,
    },
    lastAccessedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Matnli qidiruv uchun matn indeksi (Text Index)
memorySchema.index(
  { key: 'text', content: 'text', tags: 'text' },
  { weights: { key: 5, content: 3, tags: 2 }, name: 'MemoryTextIndex' }
);

// Bitta chat ichida kalit so'z unikal bo'lishi uchun aralash indeks
memorySchema.index({ chatId: 1, key: 1 });

export const Memory = mongoose.models.Memory || mongoose.model('Memory', memorySchema);
