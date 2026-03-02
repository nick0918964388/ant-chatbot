import { NextResponse } from 'next/server';
import { parseTAIFEXCsv } from '@/lib/backtest/taifex-csv-parser';
import { mergeAndSave, getDataSummary, clearData } from '@/lib/backtest/taifex-store';
import { DailyPrice } from '@/lib/backtest/types';

/**
 * GET: 查詢累積數據狀態
 */
export async function GET() {
  const summary = getDataSummary();
  return NextResponse.json(summary);
}

/**
 * POST: 上傳 CSV 並合併到累積資料
 *
 * 支援兩種格式：
 * 1. Content-Type: text/csv — 直接上傳原始 CSV 檔案內容
 *    curl -X POST http://localhost:3000/api/backtest/data \
 *      -H "Content-Type: text/csv" \
 *      --data-binary @Daily_2026_03.csv
 *
 *    可加 query param ?contractType=MTX (預設 TX)
 *
 * 2. Content-Type: application/json — JSON 包裝
 *    { csvData: string, contractType?: 'TX' | 'MTX' }
 */
export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') || '';

    let csvData: string;
    let contractType: string | undefined;

    if (contentType.includes('text/csv') || contentType.includes('text/plain')) {
      // 原始 CSV 直接上傳
      csvData = await request.text();
      const url = new URL(request.url);
      contractType = url.searchParams.get('contractType') || undefined;
    } else {
      // JSON 格式 (向下相容)
      const body = await request.json();
      csvData = body.csvData;
      contractType = body.contractType;

      if (!csvData || typeof csvData !== 'string') {
        return NextResponse.json({ error: '缺少 csvData' }, { status: 400 });
      }
    }

    const filter = contractType === 'MTX' ? 'MTX' : 'TX';
    const newPrices = parseTAIFEXCsv(csvData, filter);

    const result = mergeAndSave(newPrices);

    return NextResponse.json({
      message: `成功匯入 ${newPrices.length} 筆新資料`,
      newDays: newPrices.length,
      totalDays: result.totalDays,
      dateRange: result.dateRange,
      updatedAt: result.updatedAt,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '上傳失敗';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

/**
 * PUT: 直接追加 JSON 價格資料（不需要 CSV 格式）
 *
 * Body: DailyPrice[] 或 { prices: DailyPrice[] }
 *
 * DailyPrice = { date: "YYYY-MM-DD", open, high, low, close, volume }
 *
 * 範例：
 *   curl -X PUT http://localhost:3000/api/backtest/data \
 *     -H "Content-Type: application/json" \
 *     -d '[{"date":"2026-03-02","open":20000,"high":20100,"low":19900,"close":20050,"volume":12345}]'
 *
 *   或包在物件中：
 *   curl -X PUT http://localhost:3000/api/backtest/data \
 *     -H "Content-Type: application/json" \
 *     -d '{"prices":[{"date":"2026-03-02","open":20000,"high":20100,"low":19900,"close":20050,"volume":12345}]}'
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json();

    // 支援陣列或 { prices: [...] } 兩種格式
    const rawPrices: unknown[] = Array.isArray(body) ? body : body.prices;

    if (!Array.isArray(rawPrices) || rawPrices.length === 0) {
      return NextResponse.json(
        { error: '請提供價格陣列，格式: [{ date, open, high, low, close, volume }] 或 { prices: [...] }' },
        { status: 400 }
      );
    }

    // 驗證並轉換每筆資料
    const validated: DailyPrice[] = [];
    for (let i = 0; i < rawPrices.length; i++) {
      const row = rawPrices[i] as Record<string, unknown>;
      const { date, open, high, low, close, volume } = row;

      if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return NextResponse.json(
          { error: `第 ${i + 1} 筆: date 必須為 YYYY-MM-DD 格式` },
          { status: 400 }
        );
      }
      if (typeof close !== 'number' || close <= 0) {
        return NextResponse.json(
          { error: `第 ${i + 1} 筆 (${date}): close 必須為正數` },
          { status: 400 }
        );
      }

      validated.push({
        date,
        open: typeof open === 'number' && open > 0 ? open : close,
        high: typeof high === 'number' && high > 0 ? high : close,
        low: typeof low === 'number' && low > 0 ? low : close,
        close,
        volume: typeof volume === 'number' && volume >= 0 ? volume : 0,
      });
    }

    const result = mergeAndSave(validated);

    return NextResponse.json({
      message: `成功追加 ${validated.length} 筆價格資料`,
      newDays: validated.length,
      totalDays: result.totalDays,
      dateRange: result.dateRange,
      updatedAt: result.updatedAt,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '追加失敗';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

/**
 * DELETE: 清除所有累積資料
 */
export async function DELETE() {
  clearData();
  return NextResponse.json({ message: '已清除所有 TAIFEX 資料' });
}
