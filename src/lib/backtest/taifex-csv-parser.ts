import { DailyPrice } from './types';

/**
 * 解析 TAIFEX（期交所）每日行情下載 CSV
 * 從多合約中自動選取「最近月」合約收盤價
 *
 * 實際 CSV 格式（期交所下載）:
 * 交易日期,契約,到期月份(週別),開盤價,最高價,最低價,收盤價,漲跌價,漲跌%,成交量,結算價,未沖銷契約數,最後最佳買價,最後最佳賣價,歷史最高價,歷史最低價,是否因訊息面暫停交易,交易時段,價差對單式委託成交量
 *
 * 合約代碼：TXF=台指期, MXF=小台指
 * 交易時段：一般 / 盤後（只使用「一般」時段）
 * 價格欄位可能是 "-"（無交易）
 */

interface RawRow {
  date: string;         // YYYY-MM-DD
  contract: string;     // TXF, MXF, etc.
  deliveryMonth: string; // e.g. "202403"
  open: number;
  high: number;
  low: number;
  close: number;
  settlement: number;
  volume: number;
}

/** TAIFEX 合約代碼對應 */
const CONTRACT_MAP: Record<string, string> = {
  TX: 'TXF',
  MTX: 'MXF',
};

/**
 * 計算某月的第三個星期三（台指期結算日）
 */
function getThirdWednesday(year: number, month: number): Date {
  const d = new Date(year, month - 1, 1);
  const dayOfWeek = d.getDay();
  const firstWed = dayOfWeek <= 3 ? 3 - dayOfWeek + 1 : 10 - dayOfWeek + 1;
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
    return `${year}${String(month).padStart(2, '0')}`;
  } else {
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    return `${nextYear}${String(nextMonth).padStart(2, '0')}`;
  }
}

/**
 * 解析價格欄位："-" 代表無交易，回傳 0
 */
function parsePrice(s: string): number {
  const cleaned = s.replace(/,/g, '').trim();
  if (cleaned === '-' || cleaned === '') return 0;
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
}

/**
 * 標準化日期格式：YYYY/MM/DD → YYYY-MM-DD
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
 * 標準化到期月份：去除空白，只取前6碼 YYYYMM
 * 過濾掉週選（W1, W2 等）
 */
function normalizeDeliveryMonth(raw: string): string {
  const s = raw.replace(/[/\s]/g, '').trim();
  if (/W\d/i.test(s)) return '';
  return s.slice(0, 6);
}

/**
 * 解析 TAIFEX CSV 字串，回傳每日收盤價（使用最近月合約）
 *
 * @param csvText - CSV 原始文字
 * @param contractType - 'TX'（大台）或 'MTX'（小台），自動對應 TXF/MXF
 */
export function parseTAIFEXCsv(csvText: string, contractType: string = 'TX'): DailyPrice[] {
  const text = csvText.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim());

  if (lines.length < 2) return [];

  // 對應實際合約代碼
  const csvContractCode = CONTRACT_MAP[contractType] || contractType;

  // 自動偵測表頭位置
  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    if (lines[i].includes('交易日期') || lines[i].includes('契約') || /Trading\s*Date/i.test(lines[i])) {
      headerIdx = i;
      break;
    }
  }

  const headers = lines[headerIdx].split(',').map(h => h.trim().replace(/"/g, ''));

  // 找出各欄位 index
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
    session: headers.findIndex(h => h.includes('交易時段') || /Session/i.test(h)),
  };

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
    if (cols.length < 5) continue;

    // 只要「一般」時段（過濾掉「盤後」）
    if (colMap.session >= 0) {
      const session = cols[colMap.session]?.trim();
      if (session && session !== '一般') continue;
    }

    const contract = cols[colMap.contract]?.trim();
    if (contract !== csvContractCode) continue;

    const deliveryRaw = colMap.delivery >= 0 ? cols[colMap.delivery] : '';
    const deliveryMonth = normalizeDeliveryMonth(deliveryRaw);
    if (!deliveryMonth) continue;

    const close = parsePrice(cols[colMap.close]);
    if (close <= 0) continue; // 跳過 "-" 無交易的列

    const open = colMap.open >= 0 ? parsePrice(cols[colMap.open]) : 0;
    const high = colMap.high >= 0 ? parsePrice(cols[colMap.high]) : 0;
    const low = colMap.low >= 0 ? parsePrice(cols[colMap.low]) : 0;
    const settlement = colMap.settlement >= 0 ? parsePrice(cols[colMap.settlement]) : 0;

    rows.push({
      date: normalizeDate(cols[colMap.date]),
      contract,
      deliveryMonth,
      open: open || close,
      high: high || close,
      low: low || close,
      close,
      settlement: settlement || close,
      volume: colMap.volume >= 0 ? parsePrice(cols[colMap.volume]) : 0,
    });
  }

  if (rows.length === 0) {
    throw new Error(`CSV 中找不到 ${csvContractCode} 合約資料（一般時段）`);
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

    // 優先精確匹配近月合約，否則找最接近的
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

  result.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}
