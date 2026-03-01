import { DailyPrice } from './types';

/**
 * 解析 TAIFEX（期交所）每日行情下載 CSV
 * 從多合約中自動選取「最近月」合約收盤價
 *
 * CSV 格式（期交所下載）:
 * 交易日期, 契約, 到期月份(週別), 開盤價, 最高價, 最低價, 收盤價, 結算價, 成交量, ...
 */

interface RawRow {
  date: string;         // YYYY-MM-DD
  contract: string;     // TX, MTX, etc.
  deliveryMonth: string; // e.g. "202403"
  open: number;
  high: number;
  low: number;
  close: number;
  settlement: number;
  volume: number;
}

/**
 * 計算某月的第三個星期三（台指期結算日）
 */
function getThirdWednesday(year: number, month: number): Date {
  const d = new Date(year, month - 1, 1);
  // 找到第一個星期三
  const dayOfWeek = d.getDay();
  const firstWed = dayOfWeek <= 3 ? 3 - dayOfWeek + 1 : 10 - dayOfWeek + 1;
  // 第三個星期三 = 第一個 + 14
  return new Date(year, month - 1, firstWed + 14);
}

/**
 * 判斷某日的最近月份合約
 * 規則：結算日(含)之前用當月合約，結算日之後用次月合約
 */
function getNearMonthKey(dateStr: string): string {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const thirdWed = getThirdWednesday(year, month);

  if (d <= thirdWed) {
    // 結算日當天或之前 → 當月合約
    return `${year}${String(month).padStart(2, '0')}`;
  } else {
    // 結算日之後 → 次月合約
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    return `${nextYear}${String(nextMonth).padStart(2, '0')}`;
  }
}

/**
 * 清除數值中的逗號（例如 "23,456" → 23456）
 */
function parseNum(s: string): number {
  const cleaned = s.replace(/,/g, '').trim();
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
}

/**
 * 標準化日期格式：支援 YYYY/MM/DD 和 YYYYMMDD → YYYY-MM-DD
 */
function normalizeDate(raw: string): string {
  const s = raw.trim();
  if (s.includes('/')) {
    const [y, m, d] = s.split('/');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  if (s.length === 8 && !s.includes('-')) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  return s;
}

/**
 * 標準化到期月份：支援 "202403"、"2024/03"、"202403W1" 等格式
 * 只取前6碼 YYYYMM
 */
function normalizeDeliveryMonth(raw: string): string {
  const s = raw.replace(/[/\s]/g, '').trim();
  // 過濾掉週選（W1, W2 等）— 只要月合約
  if (/W\d/i.test(s)) return '';
  return s.slice(0, 6);
}

/**
 * 解析 TAIFEX CSV 字串，回傳每日收盤價（使用最近月合約）
 */
export function parseTAIFEXCsv(csvText: string, contractFilter: string = 'TX'): DailyPrice[] {
  // 移除 BOM
  const text = csvText.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim());

  if (lines.length < 2) return [];

  // 自動偵測表頭位置
  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    if (lines[i].includes('交易日期') || lines[i].includes('契約') || /Trading\s*Date/i.test(lines[i])) {
      headerIdx = i;
      break;
    }
  }

  const headers = lines[headerIdx].split(',').map(h => h.trim().replace(/"/g, ''));

  // 找出各欄位的 index
  const colMap = {
    date: headers.findIndex(h => h.includes('交易日期') || /Trading.*Date/i.test(h)),
    contract: headers.findIndex(h => h.includes('契約') || /Contract/i.test(h)),
    delivery: headers.findIndex(h => h.includes('到期月份') || /Delivery/i.test(h)),
    open: headers.findIndex(h => h === '開盤價' || /^Open$/i.test(h)),
    high: headers.findIndex(h => h === '最高價' || /^High$/i.test(h)),
    low: headers.findIndex(h => h === '最低價' || /^Low$/i.test(h)),
    close: headers.findIndex(h => h === '收盤價' || /^Close$/i.test(h)),
    settlement: headers.findIndex(h => h.includes('結算價') || /Settlement/i.test(h)),
    volume: headers.findIndex(h => h === '成交量' || /Volume/i.test(h)),
  };

  // 驗證必要欄位
  if (colMap.date < 0 || colMap.contract < 0 || colMap.close < 0) {
    throw new Error(
      `CSV 格式無法辨識。需要至少包含「交易日期」「契約」「收盤價」欄位。\n` +
      `偵測到的表頭: ${headers.join(', ')}`
    );
  }

  // 解析所有資料列
  const rows: RawRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
    if (cols.length < headers.length) continue;

    const contract = cols[colMap.contract]?.trim();
    if (contract !== contractFilter) continue;

    const deliveryRaw = colMap.delivery >= 0 ? cols[colMap.delivery] : '';
    const deliveryMonth = normalizeDeliveryMonth(deliveryRaw);
    if (!deliveryMonth) continue; // 跳過週選

    const close = parseNum(cols[colMap.close]);
    if (close <= 0) continue; // 跳過無效價格

    rows.push({
      date: normalizeDate(cols[colMap.date]),
      contract,
      deliveryMonth,
      open: colMap.open >= 0 ? parseNum(cols[colMap.open]) : close,
      high: colMap.high >= 0 ? parseNum(cols[colMap.high]) : close,
      low: colMap.low >= 0 ? parseNum(cols[colMap.low]) : close,
      close,
      settlement: colMap.settlement >= 0 ? parseNum(cols[colMap.settlement]) : close,
      volume: colMap.volume >= 0 ? parseNum(cols[colMap.volume]) : 0,
    });
  }

  if (rows.length === 0) {
    throw new Error(`CSV 中找不到 ${contractFilter} 合約資料`);
  }

  // 按日期分組，選取最近月合約
  const byDate = new Map<string, RawRow[]>();
  for (const row of rows) {
    const existing = byDate.get(row.date) || [];
    existing.push(row);
    byDate.set(row.date, existing);
  }

  const result: DailyPrice[] = [];
  for (const [date, dayRows] of byDate) {
    const nearMonthKey = getNearMonthKey(date);

    // 優先選最近月份合約
    // 1. 精確匹配 nearMonthKey
    // 2. 找最接近且 >= nearMonthKey 的合約
    let selected = dayRows.find(r => r.deliveryMonth === nearMonthKey);
    if (!selected) {
      const sorted = [...dayRows].sort((a, b) => a.deliveryMonth.localeCompare(b.deliveryMonth));
      selected = sorted.find(r => r.deliveryMonth >= nearMonthKey) || sorted[0];
    }

    if (selected) {
      result.push({
        date,
        open: selected.open,
        high: selected.high,
        low: selected.low,
        close: selected.close,
        volume: selected.volume,
      });
    }
  }

  // 按日期排序
  result.sort((a, b) => a.date.localeCompare(b.date));

  return result;
}
