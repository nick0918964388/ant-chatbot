// 台指期回測策略引擎
import {
  DailyPrice,
  StrategyState,
  Trade,
  DailySnapshot,
  BacktestResult,
  BacktestMetrics,
  BacktestConfig,
  DEFAULT_CONFIG,
} from './types';

/**
 * 計算應持有的口數（基於已實現獲利）
 * 初始1口，每獲利 profitPerContract 加碼1口
 */
function calcTargetContracts(realizedPnl: number, config: BacktestConfig): number {
  return 1 + Math.floor(Math.max(0, realizedPnl) / config.profitPerContract);
}

/**
 * 計算停損門檻（兩階段）
 * - 尚無獲利時：初期停損 10%
 * - 有獲利後：30% - (口數 * 5%)，最低不小於 5%
 */
function calcDrawdownThreshold(contracts: number, hasProfit: boolean, config: BacktestConfig): number {
  if (!hasProfit) {
    return config.initialDrawdownPct; // 初期 10%
  }
  const threshold = config.baseDrawdownPct - contracts * config.contractDrawdownPenalty;
  return Math.max(threshold, 0.05);
}

/**
 * 執行回測
 */
export function runBacktest(
  priceData: DailyPrice[],
  config: BacktestConfig = DEFAULT_CONFIG,
): BacktestResult {
  if (priceData.length === 0) {
    throw new Error('No price data provided');
  }

  const trades: Trade[] = [];
  const snapshots: DailySnapshot[] = [];

  // 策略狀態
  let state: StrategyState = 'HOLDING';
  let contracts = 0;
  let avgEntryPrice = 0;
  let realizedPnl = 0;
  let pricePeak = 0;    // 持倉期間追蹤的價格峰值
  let priceLow = Infinity; // 停損後追蹤的價格低點
  let maxEquity = config.initialCapital;

  // 統計
  let stopLossCount = 0;
  let reentryCount = 0;
  let maxContracts = 0;
  const roundPnls: number[] = []; // 每輪(入場到停損)的損益
  let roundEntryEquity = 0;

  // === 第一天：初始入場 ===
  const firstDay = priceData[0];
  const initialContracts = 1;
  contracts = initialContracts;
  avgEntryPrice = firstDay.close;
  pricePeak = firstDay.close;
  roundEntryEquity = config.initialCapital;

  trades.push({
    type: 'ENTRY',
    date: firstDay.date,
    price: firstDay.close,
    contracts: initialContracts,
    totalContracts: initialContracts,
    reason: `初始入場，買進${initialContracts}口 @ ${firstDay.close}`,
  });

  // === 逐日模擬 ===
  for (let i = 0; i < priceData.length; i++) {
    const day = priceData[i];
    const close = day.close;

    if (state === 'HOLDING') {
      // 更新價格峰值
      if (close > pricePeak) {
        pricePeak = close;
      }

      // 計算未實現損益
      const unrealizedPnl = (close - avgEntryPrice) * contracts * config.contractMultiplier;
      const equity = config.initialCapital + realizedPnl + unrealizedPnl;

      // 追蹤最高權益
      if (equity > maxEquity) {
        maxEquity = equity;
      }

      // 判斷是否已有獲利（權益 > 初始資金）
      const hasProfit = equity > config.initialCapital;

      // 計算停損門檻：初期10%，有獲利後 30%-(口數×5%)
      const drawdownThreshold = calcDrawdownThreshold(contracts, hasProfit, config);
      const priceDrawdownPct = pricePeak > 0 ? (pricePeak - close) / pricePeak : 0;

      // 檢查是否觸發停損（價格從峰值回撤超過門檻）
      if (priceDrawdownPct >= drawdownThreshold && i > 0) {
        // 停損：平倉所有部位
        const closePnl = (close - avgEntryPrice) * contracts * config.contractMultiplier;
        realizedPnl += closePnl;

        // 記錄本輪損益
        roundPnls.push(realizedPnl - (roundEntryEquity - config.initialCapital));

        const phaseLabel = hasProfit ? `獲利階段 ${(drawdownThreshold * 100).toFixed(1)}%` : `初期 ${(config.initialDrawdownPct * 100).toFixed(0)}%`;
        trades.push({
          type: 'STOP_LOSS',
          date: day.date,
          price: close,
          contracts: -contracts,
          totalContracts: 0,
          reason: `停損出場！價格從峰值 ${pricePeak.toFixed(0)} 回撤 ${(priceDrawdownPct * 100).toFixed(1)}% >= 門檻 ${(drawdownThreshold * 100).toFixed(1)}% [${phaseLabel}] (${contracts}口)`,
          pnl: closePnl,
        });

        stopLossCount++;
        contracts = 0;
        avgEntryPrice = 0;
        priceLow = close;
        state = 'STOPPED_OUT';
      } else {
        // 檢查是否需要加碼
        const targetContracts = calcTargetContracts(realizedPnl + unrealizedPnl, config);
        if (targetContracts > contracts) {
          const addContracts = targetContracts - contracts;
          // 加碼：以當日收盤價買進
          // 更新平均成本
          const totalCost = avgEntryPrice * contracts + close * addContracts;
          const newTotal = contracts + addContracts;
          avgEntryPrice = totalCost / newTotal;
          contracts = newTotal;

          if (contracts > maxContracts) {
            maxContracts = contracts;
          }

          trades.push({
            type: 'ADD',
            date: day.date,
            price: close,
            contracts: addContracts,
            totalContracts: contracts,
            reason: `獲利加碼！累計獲利 ${((realizedPnl + unrealizedPnl) / 10000).toFixed(1)}萬，加碼${addContracts}口 @ ${close}，共${contracts}口`,
          });
        }
      }

      // 記錄快照
      const snapshotUnrealizedPnl = contracts > 0
        ? (close - avgEntryPrice) * contracts * config.contractMultiplier
        : 0;

      snapshots.push({
        date: day.date,
        close,
        state,
        contracts,
        avgEntryPrice,
        unrealizedPnl: snapshotUnrealizedPnl,
        realizedPnl,
        equity: config.initialCapital + realizedPnl + snapshotUnrealizedPnl,
        priceFromPeak: pricePeak > 0 ? (pricePeak - close) / pricePeak : 0,
        drawdownThreshold: calcDrawdownThreshold(Math.max(contracts, 1), equity > config.initialCapital, config),
        pricePeak,
        priceLow,
      });

    } else if (state === 'STOPPED_OUT' || state === 'WAITING_REENTRY') {
      // 追蹤價格低點
      if (close < priceLow) {
        priceLow = close;
      }

      state = 'WAITING_REENTRY';

      // 檢查是否從低點回漲20%
      const recoveryPct = priceLow > 0 ? (close - priceLow) / priceLow : 0;

      if (recoveryPct >= config.reentryRecoveryPct) {
        // 重新入場
        const targetContracts = calcTargetContracts(realizedPnl, config);
        contracts = targetContracts;
        avgEntryPrice = close;
        pricePeak = close;
        roundEntryEquity = config.initialCapital + realizedPnl;

        if (contracts > maxContracts) {
          maxContracts = contracts;
        }

        trades.push({
          type: 'REENTRY',
          date: day.date,
          price: close,
          contracts: contracts,
          totalContracts: contracts,
          reason: `重新入場！價格從低點 ${priceLow.toFixed(0)} 回漲 ${(recoveryPct * 100).toFixed(1)}% >= 20%，買進${contracts}口 @ ${close}`,
        });

        reentryCount++;
        state = 'HOLDING';
      }

      // 記錄快照
      snapshots.push({
        date: day.date,
        close,
        state,
        contracts,
        avgEntryPrice,
        unrealizedPnl: 0,
        realizedPnl,
        equity: config.initialCapital + realizedPnl,
        priceFromPeak: 0,
        drawdownThreshold: 0,
        pricePeak,
        priceLow,
      });
    }
  }

  // 更新最大口數（含初始）
  if (maxContracts < 1) maxContracts = 1;

  // 計算最終指標
  const finalSnapshot = snapshots[snapshots.length - 1];
  const finalEquity = finalSnapshot.equity;

  // 計算最大權益回撤
  let equityPeak = config.initialCapital;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  for (const snap of snapshots) {
    if (snap.equity > equityPeak) equityPeak = snap.equity;
    const dd = equityPeak - snap.equity;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      maxDrawdownPct = equityPeak > 0 ? dd / equityPeak : 0;
    }
  }

  // 勝率計算（以每輪入場到停損為基準）
  const winRounds = roundPnls.filter(p => p > 0).length;
  const winRate = roundPnls.length > 0 ? winRounds / roundPnls.length : (finalEquity > config.initialCapital ? 1 : 0);

  const metrics: BacktestMetrics = {
    totalReturn: (finalEquity - config.initialCapital) / config.initialCapital,
    totalPnl: finalEquity - config.initialCapital,
    finalEquity,
    maxEquity: equityPeak,
    maxDrawdown,
    maxDrawdownPct,
    totalTrades: trades.length,
    stopLossCount,
    reentryCount,
    maxContracts,
    winRate,
    startDate: priceData[0].date,
    endDate: priceData[priceData.length - 1].date,
    tradingDays: priceData.length,
  };

  return {
    config,
    snapshots,
    trades,
    metrics,
    priceData,
  };
}
