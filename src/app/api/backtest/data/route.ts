import { NextResponse } from 'next/server';
import { parseTAIFEXCsv } from '@/lib/backtest/taifex-csv-parser';
import { mergeAndSave, getDataSummary, clearData } from '@/lib/backtest/taifex-store';

/**
 * GET: 查詢累積數據狀態
 */
export async function GET() {
  const summary = getDataSummary();
  return NextResponse.json(summary);
}

/**
 * POST: 上傳 CSV 並合併到累積資料
 * Body: { csvData: string, contractType?: 'TX' | 'MTX' }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { csvData, contractType } = body;

    if (!csvData || typeof csvData !== 'string') {
      return NextResponse.json({ error: '缺少 csvData' }, { status: 400 });
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
 * DELETE: 清除所有累積資料
 */
export async function DELETE() {
  clearData();
  return NextResponse.json({ message: '已清除所有 TAIFEX 資料' });
}
