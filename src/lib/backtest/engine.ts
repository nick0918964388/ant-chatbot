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
 * 計算保證金允許的最大口數
 */
function calcMaxContractsByMargin(equity: number, config: BacktestConfig): number {
  if (equity <= 0) return 0;
  return Math.floor(equity / config.marginPerContract);
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
 * 待執行動作（當日信號 → 隔日執行）
 */
type PendingAction =
  | { type: 'STOP_LOSS'; signalDate: string; signalPrice: number; pricePeak: number; drawdownPct: number; threshold: number; hasProfit: boolean }
  | { type: 'ADD'; targetContracts: number; signalDate: string }
  | { type: 'REENTRY'; targetContracts: number; signalDate: string; priceLow: number; recoveryPct: number }
  | null;

/**
 * 執行回測（隔日進場版）
 *
 * 邏輯：
 * - 當日收盤判斷信號（停損/加碼/重入場）
 * - 隔日收盤價執行進出場
 * - 追繳斷頭（MARGIN_CALL）為強制即時執行
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
  let pendingAction: PendingAction = null;

  // 統計
  let stopLossCount = 0;
  let marginCallCount = 0;
  let reentryCount = 0;
  let maxContracts = 0;
  const roundPnls: number[] = [];
  let roundEntryEquity = 0;

  // === 第一天：初始入場 ===
  const firstDay = priceData[0];
  const maxByMargin = calcMaxContractsByMargin(config.initialCapital, config);
  const initialContracts = Math.min(1, maxByMargin);

  if (initialContracts <= 0) {
    throw new Error(`初始資金 ${config.initialCapital} 不足以支付一口保證金 ${config.marginPerContract}`);
  }

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
    reason: `初始入場，買進${initialContracts}口 @ ${firstDay.close} (保證金: ${(initialContracts * config.marginPerContract).toLocaleString()}/${config.initialCapital.toLocaleString()})`,
  });

  // === 逐日模擬 ===
  for (let i = 0; i < priceData.length; i++) {
    const day = priceData[i];
    const close = day.close;

    // ─── 步驟1：執行昨日產生的待執行動作 ───
    if (pendingAction !== null) {
      if (pendingAction.type === 'STOP_LOSS') {
        // 隔日收盤價停損
        const closePnl = (close - avgEntryPrice) * contracts * config.contractMultiplier;
        realizedPnl += closePnl;
        roundPnls.push(realizedPnl - (roundEntryEquity - config.initialCapital));

        const pa = pendingAction;
        const phaseLabel = pa.hasProfit
          ? `獲利階段 ${(pa.threshold * 100).toFixed(1)}%`
          : `初期 ${(config.initialDrawdownPct * 100).toFixed(0)}%`;
        trades.push({
          type: 'STOP_LOSS',
          date: day.date,
          price: close,
          contracts: -contracts,
          totalContracts: 0,
          reason: `停損出場！(信號日 ${pa.signalDate}) 價格從峰值 ${pa.pricePeak.toFixed(0)} 回撤 ${(pa.drawdownPct * 100).toFixed(1)}% >= 門檻 ${(pa.threshold * 100).toFixed(1)}% [${phaseLabel}]，隔日 ${day.date} 以 ${close} 執行 (${contracts}口)`,
          pnl: closePnl,
        });

        stopLossCount++;
        contracts = 0;
        avgEntryPrice = 0;
        priceLow = close;
        state = 'STOPPED_OUT';
        pendingAction = null;

        // 記錄快照後 continue，今日不再產生新信號
        snapshots.push({
          date: day.date, close, state, contracts: 0, avgEntryPrice: 0,
          unrealizedPnl: 0, realizedPnl,
          equity: config.initialCapital + realizedPnl,
          priceFromPeak: 0, drawdownThreshold: 0, pricePeak, priceLow,
        });
        continue;

      } else if (pendingAction.type === 'ADD') {
        // 隔日收盤價加碼
        const pa = pendingAction;
        const unrealizedPnl = (close - avgEntryPrice) * contracts * config.contractMultiplier;
        const equity = config.initialCapital + realizedPnl + unrealizedPnl;

        // 重新計算隔日的合理加碼口數（用今日收盤價和權益）
        const targetByProfit = calcTargetContracts(realizedPnl + unrealizedPnl, config);
        const targetByMargin = calcMaxContractsByMargin(equity, config);
        const targetContracts = Math.min(targetByProfit, targetByMargin);

        if (targetContracts > contracts) {
          const addContracts = targetContracts - contracts;
          const totalCost = avgEntryPrice * contracts + close * addContracts;
          const newTotal = contracts + addContracts;
          avgEntryPrice = totalCost / newTotal;
          contracts = newTotal;

          if (contracts > maxContracts) maxContracts = contracts;

          const newMargin = contracts * config.marginPerContract;
          trades.push({
            type: 'ADD',
            date: day.date,
            price: close,
            contracts: addContracts,
            totalContracts: contracts,
            reason: `獲利加碼！(信號日 ${pa.signalDate}) 累計獲利 ${((realizedPnl + unrealizedPnl) / 10000).toFixed(1)}萬，隔日加碼${addContracts}口 @ ${close}，共${contracts}口 (保證金: ${newMargin.toLocaleString()}/${Math.round(equity).toLocaleString()})`,
          });
        }
        pendingAction = null;
        // 繼續往下產生今日信號

      } else if (pendingAction.type === 'REENTRY') {
        // 隔日收盤價重新入場
        const pa = pendingAction;
        const currentEquity = config.initialCapital + realizedPnl;

        if (currentEquity >= config.marginPerContract) {
          const targetByProfit = calcTargetContracts(realizedPnl, config);
          const targetByMargin = calcMaxContractsByMargin(currentEquity, config);
          contracts = Math.min(targetByProfit, targetByMargin);
          avgEntryPrice = close;
          pricePeak = close;
          roundEntryEquity = currentEquity;

          if (contracts > maxContracts) maxContracts = contracts;

          const usedMargin = contracts * config.marginPerContract;
          trades.push({
            type: 'REENTRY',
            date: day.date,
            price: close,
            contracts,
            totalContracts: contracts,
            reason: `重新入場！(信號日 ${pa.signalDate}) 價格從低點 ${pa.priceLow.toFixed(0)} 回漲 ${(pa.recoveryPct * 100).toFixed(1)}% >= 20%，隔日買進${contracts}口 @ ${close} (保證金: ${usedMargin.toLocaleString()}/${Math.round(currentEquity).toLocaleString()})`,
          });

          reentryCount++;
          state = 'HOLDING';
        }
        pendingAction = null;
        // 若入場成功，繼續往下檢查今日持倉狀態
      }
    }

    // ─── 步驟2：根據今日收盤價產生信號 ───
    if (state === 'HOLDING') {
      // 更新價格峰值
      if (close > pricePeak) pricePeak = close;

      // 計算未實現損益
      const unrealizedPnl = (close - avgEntryPrice) * contracts * config.contractMultiplier;
      const equity = config.initialCapital + realizedPnl + unrealizedPnl;

      if (equity > maxEquity) maxEquity = equity;

      // === 追繳斷頭：即時強制執行（不等隔日）===
      const requiredMargin = contracts * config.marginPerContract;
      if (equity < requiredMargin && contracts > 0 && i > 0) {
        const closePnl = (close - avgEntryPrice) * contracts * config.contractMultiplier;
        realizedPnl += closePnl;
        roundPnls.push(realizedPnl - (roundEntryEquity - config.initialCapital));

        trades.push({
          type: 'MARGIN_CALL',
          date: day.date,
          price: close,
          contracts: -contracts,
          totalContracts: 0,
          reason: `追繳斷頭！權益 ${Math.round(equity).toLocaleString()} < 維持保證金 ${requiredMargin.toLocaleString()} (${contracts}口×${config.marginPerContract.toLocaleString()})，強制平倉`,
          pnl: closePnl,
        });

        marginCallCount++;
        contracts = 0;
        avgEntryPrice = 0;
        priceLow = close;
        state = 'STOPPED_OUT';

        snapshots.push({
          date: day.date, close, state, contracts: 0, avgEntryPrice: 0,
          unrealizedPnl: 0, realizedPnl,
          equity: config.initialCapital + realizedPnl,
          priceFromPeak: 0, drawdownThreshold: 0, pricePeak, priceLow,
        });
        continue;
      }

      const hasProfit = equity > config.initialCapital;
      const drawdownThreshold = calcDrawdownThreshold(contracts, hasProfit, config);
      const priceDrawdownPct = pricePeak > 0 ? (pricePeak - close) / pricePeak : 0;

      // 檢查停損信號（產生信號，隔日執行）
      if (priceDrawdownPct >= drawdownThreshold && i > 0 && pendingAction === null) {
        pendingAction = {
          type: 'STOP_LOSS',
          signalDate: day.date,
          signalPrice: close,
          pricePeak,
          drawdownPct: priceDrawdownPct,
          threshold: drawdownThreshold,
          hasProfit,
        };
      }
      // 檢查加碼信號（沒有停損信號時才檢查）
      else if (pendingAction === null) {
        const targetByProfit = calcTargetContracts(realizedPnl + unrealizedPnl, config);
        const targetByMargin = calcMaxContractsByMargin(equity, config);
        const targetContracts = Math.min(targetByProfit, targetByMargin);

        if (targetContracts > contracts) {
          pendingAction = {
            type: 'ADD',
            targetContracts,
            signalDate: day.date,
          };
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
      if (close < priceLow) priceLow = close;

      state = 'WAITING_REENTRY';

      // 檢查重入場信號（隔日執行）
      const recoveryPct = priceLow > 0 ? (close - priceLow) / priceLow : 0;
      const currentEquity = config.initialCapital + realizedPnl;

      if (recoveryPct >= config.reentryRecoveryPct && currentEquity >= config.marginPerContract && pendingAction === null) {
        pendingAction = {
          type: 'REENTRY',
          targetContracts: 0,
          signalDate: day.date,
          priceLow,
          recoveryPct,
        };
      }

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

  // 勝率計算
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
    marginCallCount,
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
