import { NextResponse } from 'next/server';
import { runBacktest } from '@/lib/backtest/engine';
import { DailyPrice, BacktestConfig, DEFAULT_CONFIG } from '@/lib/backtest/types';
import { getFallbackData } from '@/lib/backtest/fallback-data';

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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const config: BacktestConfig = {
      ...DEFAULT_CONFIG,
      startDate: searchParams.get('startDate') || DEFAULT_CONFIG.startDate,
      endDate: searchParams.get('endDate') || DEFAULT_CONFIG.endDate,
      contractType: (searchParams.get('contractType') as 'TX' | 'MTX') || DEFAULT_CONFIG.contractType,
      contractMultiplier: searchParams.get('contractType') === 'MTX' ? 50 : 200,
      initialCapital: Number(searchParams.get('initialCapital')) || DEFAULT_CONFIG.initialCapital,
    };

    // 嘗試從 Yahoo Finance 取得資料，失敗時使用內建歷史資料
    let priceData: DailyPrice[];
    let dataSource: string;
    try {
      priceData = await fetchTAIEXData(config.startDate, config.endDate);
      dataSource = 'Yahoo Finance (^TWII)';
    } catch {
      console.log('Yahoo Finance unavailable, using built-in historical data');
      priceData = getLocalData(config.startDate, config.endDate);
      dataSource = '內建歷史資料 (基於 TWSE/Taipei Times/Focus Taiwan)';
    }

    if (priceData.length === 0) {
      return NextResponse.json({ error: '無法取得價格資料' }, { status: 400 });
    }

    // 執行回測
    const result = runBacktest(priceData, config);

    return NextResponse.json({ ...result, dataSource });
  } catch (error) {
    console.error('Backtest API error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
