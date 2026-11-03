import dns from 'dns';
import mongoose from 'mongoose';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

// Windows va mahalliy tarmoqlarda MongoDB SRV yozuvlarini ishonchli hal qilish
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // Standart DNS bilan davom etish
}

export const connectDB = async () => {
  try {
    const conn = await mongoose.connect(config.mongodbUri, {
      serverSelectionTimeoutMS: 5000,
    });
    logger.info(`MongoDB ulandi: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    logger.warn(`MongoDB-ga ulanishda ogohlantirish: ${error.message}. Offline yoki kesh rejimida davom etiladi.`);
    return null;
  }
};

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB bilan aloqa uzildi');
});

mongoose.connection.on('error', (err) => {
  logger.error(`MongoDB xatoligi: ${err.message}`);
});
