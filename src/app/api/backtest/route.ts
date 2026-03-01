import { NextResponse } from 'next/server';
import { runBacktest } from '@/lib/backtest/engine';
import { DailyPrice, BacktestConfig, DEFAULT_CONFIG } from '@/lib/backtest/types';
import { getFallbackData } from '@/lib/backtest/fallback-data';
import { parseTAIFEXCsv } from '@/lib/backtest/taifex-csv-parser';
import { loadAccumulatedData } from '@/lib/backtest/taifex-store';

/**
 * 從 Yahoo Finance 取得台指加權指數歷史資料
 * 使用 ^TWII 作為台指期的近似代理
 */
async function fetchTAIEXData(startDate: string, endDate: string): Promise<DailyPrice[]> {
  const start = Math.floor(new Date(startDate).getTime() / 1000);
  const end = Math.floor(new Date(endDate).getTime() / 1000);

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?period1=${start}&period2=${end}&interval=1d`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`Yahoo Finance API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const result = data.chart?.result?.[0];

  if (!result || !result.timestamp) {
    throw new Error('No data returned from Yahoo Finance');
  }

  const timestamps: number[] = result.timestamp;
  const quotes = result.indicators.quote[0];

  const prices: DailyPrice[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = quotes.close[i];
    const open = quotes.open[i];
    const high = quotes.high[i];
    const low = quotes.low[i];
    const volume = quotes.volume[i];

    // 跳過缺失的資料
    if (close == null || open == null || high == null || low == null) continue;

    const date = new Date(timestamps[i] * 1000);
    const dateStr = date.toISOString().split('T')[0];

    prices.push({
      date: dateStr,
      open: Math.round(open * 100) / 100,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      close: Math.round(close * 100) / 100,
      volume: volume || 0,
    });
  }

  return prices;
}

/**
 * 使用內建歷史資料（當 Yahoo Finance 無法連線時）
 * 資料基於 TWSE 官方數據、Taipei Times、Focus Taiwan 等來源
 */
function getLocalData(startDate: string, endDate: string): DailyPrice[] {
  const allData = getFallbackData();
  return allData.filter(d => d.date >= startDate && d.date <= endDate);
}

/**
 * 建構回測設定（GET & POST 共用）
 */
function buildConfig(params: {
  contractType?: string | null;
  profitPerContract?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  partialStopLoss?: string | null;
  tieredReentry?: string | null;
  initialCapital?: string | null;
  maxContractsLimit?: string | null;
}): BacktestConfig {
  const isMTX = params.contractType === 'MTX';
  return {
    ...DEFAULT_CONFIG,
    startDate: params.startDate || DEFAULT_CONFIG.startDate,
    endDate: params.endDate || DEFAULT_CONFIG.endDate,
    contractType: isMTX ? 'MTX' : 'TX',
    contractMultiplier: isMTX ? 50 : 200,
    marginPerContract: isMTX ? 95_000 : 374_000,
    initialCapital: Number(params.initialCapital) || DEFAULT_CONFIG.initialCapital,
    profitPerContract: Number(params.profitPerContract) || DEFAULT_CONFIG.profitPerContract,
    partialStopLossEnabled: params.partialStopLoss === 'true',
    tieredReentryEnabled: params.tieredReentry === 'true',
    maxContractsLimit: Number(params.maxContractsLimit) || 0,
  };
}

/**
 * GET: 使用 Yahoo Finance 或內建資料
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const config = buildConfig({
      contractType: searchParams.get('contractType'),
      profitPerContract: searchParams.get('profitPerContract'),
      startDate: searchParams.get('startDate'),
      endDate: searchParams.get('endDate'),
      partialStopLoss: searchParams.get('partialStopLoss'),
      tieredReentry: searchParams.get('tieredReentry'),
      initialCapital: searchParams.get('initialCapital'),
      maxContractsLimit: searchParams.get('maxContractsLimit'),
    });

    // 優先使用累積的 TAIFEX 期貨數據，否則 Yahoo Finance，最後內建資料
    let priceData: DailyPrice[];
    let dataSource: string;

    const accumulated = loadAccumulatedData();
    if (accumulated.prices.length > 0) {
      priceData = accumulated.prices.filter(d => d.date >= config.startDate && d.date <= config.endDate);
      dataSource = `TAIFEX 期貨合約 (${priceData.length} 筆, 累積 ${accumulated.totalDays} 日)`;
    } else {
      try {
        priceData = await fetchTAIEXData(config.startDate, config.endDate);
        dataSource = 'Yahoo Finance (^TWII)';
      } catch {
        console.log('Yahoo Finance unavailable, using built-in historical data');
        priceData = getLocalData(config.startDate, config.endDate);
        dataSource = '內建歷史資料 (基於 TWSE/Taipei Times/Focus Taiwan)';
      }
    }

    if (priceData.length === 0) {
      return NextResponse.json({ error: '無法取得價格資料' }, { status: 400 });
    }

    const result = runBacktest(priceData, config);
    return NextResponse.json({ ...result, dataSource });
  } catch (error) {
    console.error('Backtest API error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST: 接收 TAIFEX 資料進行回測
 * 支援兩種模式：
 *   1. { priceData: DailyPrice[] }  — 前端已解析+累積的數據（推薦）
 *   2. { csvData: string }          — 原始 CSV 文字（向後相容）
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { csvData, priceData: rawPriceData, ...params } = body;

    const config = buildConfig(params);
    const contractFilter = config.contractType === 'MTX' ? 'MTX' : 'TX';

    let priceData: DailyPrice[];

    if (Array.isArray(rawPriceData) && rawPriceData.length > 0) {
      // 模式1: 前端已解析的累積數據
      priceData = rawPriceData;
    } else if (csvData && typeof csvData === 'string') {
      // 模式2: 原始 CSV
      try {
        priceData = parseTAIFEXCsv(csvData, contractFilter);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'CSV 解析失敗';
        return NextResponse.json({ error: msg }, { status: 400 });
      }
    } else {
      return NextResponse.json({ error: '缺少 priceData 或 csvData' }, { status: 400 });
    }

    // 按日期篩選
    priceData = priceData.filter(d => d.date >= config.startDate && d.date <= config.endDate);

    if (priceData.length === 0) {
      return NextResponse.json({
        error: `所選日期範圍 (${config.startDate} ~ ${config.endDate}) 內無資料`,
      }, { status: 400 });
    }

    const result = runBacktest(priceData, config);
    return NextResponse.json({
      ...result,
      dataSource: `TAIFEX (${contractFilter} 最近月合約, ${priceData.length} 筆)`,
    });
  } catch (error) {
    console.error('Backtest POST API error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
