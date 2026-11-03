import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { logger } from '../utils/logger.js';

// Session va python fayl yo'llari
const homedir = os.homedir();
const defaultPythonWin = path.join(homedir, 'agy-telegram-mcp', '.venv', 'Scripts', 'python.exe');
const defaultPythonUnix = path.join(homedir, 'agy-telegram-mcp', '.venv', 'bin', 'python');
const defaultVenvPython = process.platform === 'win32' ? defaultPythonWin : defaultPythonUnix;

const PYTHON_PATH = process.env.PYTHON_PATH || (fs.existsSync(defaultVenvPython) ? defaultVenvPython : 'python');

const localSessionPath = path.resolve(process.cwd(), 'session', 'my_personal.session');
const mcpSessionPath = path.join(homedir, 'agy-telegram-mcp', 'my_personal.session');
const defaultSessionPath = fs.existsSync(localSessionPath) ? localSessionPath : mcpSessionPath;
const bridgeScriptPath = path.resolve(process.cwd(), 'scripts', 'telethonBridge.py');

/**
 * Telethon sessiyasi va muhiti mavjudligini tekshirish
 */
export const isTelethonBridgeAvailable = () => {
  return fs.existsSync(defaultSessionPath) && fs.existsSync(bridgeScriptPath);
};

/**
 * Telethon bridge orqali buyruq bajarish
 * @param {string} action - Bajariladigan amal nomi
 * @param {Object} params - Parametrlar
 */
export const callTelethonBridge = (action, params = {}) => {
  return new Promise((resolve, reject) => {
    if (!isTelethonBridgeAvailable()) {
      return reject(new Error('Telethon bridge topilmadi yoki .session fayli mavjud emas.'));
    }

    const payload = JSON.stringify({ action, ...params });
    const pyProcess = spawn(PYTHON_PATH, [bridgeScriptPath], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    let stdoutData = '';
    let stderrData = '';

    pyProcess.stdout.on('data', (data) => {
      stdoutData += data.toString('utf-8');
    });

    pyProcess.stderr.on('data', (data) => {
      stderrData += data.toString('utf-8');
    });

    pyProcess.on('close', (code) => {
      if (code !== 0 && !stdoutData.trim()) {
        logger.error(`Telethon bridge xatoligi [code: ${code}]: ${stderrData}`);
        return reject(new Error(`Telethon jarayoni xato bilan tugadi (${code}): ${stderrData}`));
      }

      try {
        const json = JSON.parse(stdoutData.trim());
        if (json.error) {
          return reject(new Error(json.error));
        }
        resolve(json);
      } catch (err) {
        logger.error(`Telethon javobini JSON ga o'girishda xatolik: ${err.message}. Raw: ${stdoutData}`);
        reject(new Error(`Noto'g'ri javob qaytdi: ${stdoutData.slice(0, 150)}`));
      }
    });

    pyProcess.on('error', (err) => {
      reject(err);
    });

    // Stdin orqali so'rov yuborish
    pyProcess.stdin.write(payload);
    pyProcess.stdin.end();
  });
};
