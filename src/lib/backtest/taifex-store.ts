import fs from 'fs';
import path from 'path';
import { DailyPrice } from './types';

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'taifex-prices.json');

interface StoredData {
  updatedAt: string;
  totalDays: number;
  dateRange: { from: string; to: string } | null;
  prices: DailyPrice[];
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * 讀取已累積的 TAIFEX 期貨數據
 */
export function loadAccumulatedData(): StoredData {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Failed to load TAIFEX data:', e);
  }
  return { updatedAt: '', totalDays: 0, dateRange: null, prices: [] };
}

/**
 * 合併新數據到累積資料中（同日期覆蓋）
 */
export function mergeAndSave(newPrices: DailyPrice[]): StoredData {
  ensureDir();
  const existing = loadAccumulatedData();

  // 用 Map 合併，新資料覆蓋舊資料
  const map = new Map<string, DailyPrice>();
  for (const p of existing.prices) {
    map.set(p.date, p);
  }
  for (const p of newPrices) {
    map.set(p.date, p);
  }

  const merged = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));

  const stored: StoredData = {
    updatedAt: new Date().toISOString(),
    totalDays: merged.length,
    dateRange: merged.length > 0
      ? { from: merged[0].date, to: merged[merged.length - 1].date }
      : null,
    prices: merged,
  };

  fs.writeFileSync(DATA_FILE, JSON.stringify(stored), 'utf-8');
  return stored;
}

/**
 * 清除所有累積資料
 */
export function clearData(): void {
  if (fs.existsSync(DATA_FILE)) {
    fs.unlinkSync(DATA_FILE);
  }
}

/**
 * 取得累積資料的摘要（不含完整價格資料）
 */
export function getDataSummary(): Omit<StoredData, 'prices'> {
  const data = loadAccumulatedData();
  return {
    updatedAt: data.updatedAt,
    totalDays: data.totalDays,
    dateRange: data.dateRange,
  };
}
