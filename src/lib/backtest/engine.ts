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
  const target = 1 + Math.floor(Math.max(0, realizedPnl) / config.profitPerContract);
  if (config.maxContractsLimit > 0) return Math.min(target, config.maxContractsLimit);
  return target;
}

/**
 * 計算保證金允許的最大口數
 */
function calcMaxContractsByMargin(equity: number, config: BacktestConfig): number {
  if (equity <= 0) return 0;
  const marginPerContract = config.marginPerContract * config.marginRatio;
  return Math.floor(equity / marginPerContract);
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
  | { type: 'PARTIAL_STOP_LOSS'; signalDate: string; signalPrice: number; pricePeak: number; drawdownPct: number; threshold: number; hasProfit: boolean; contractsToSell: number }
  | { type: 'ADD'; targetContracts: number; signalDate: string }
  | { type: 'REENTRY'; targetContracts: number; signalDate: string; priceLow: number; recoveryPct: number; tierIndex?: number }
  | null;

/**
 * 執行回測（隔日進場版）
 *
 * 邏輯：
 * - 當日收盤判斷信號（停損/加碼/重入場）
 * - 隔日收盤價執行進出場
 * - 追繳斷頭（MARGIN_CALL）為強制即時執行
 *
 * 方案4: 分批停損 — 停損時先賣出 75%，保留倖存倉，若再跌 5% 全部清倉
 * 方案5: 分批重入場 — 分階段逐步買回 (8%/14%/20% 回漲)
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

  // 方案4: 分批停損狀態
  let partialStopActive = false;     // 是否在分批停損的倖存倉狀態
  let partialStopNewPeak = 0;        // 分批停損後的新價格峰值（用於二次停損判斷）

  // 方案5: 分批重入場狀態
  let tieredReentryActive = false;   // 是否在分批重入場中
  let tieredReentryLow = 0;          // 分批重入場追蹤的低點
  let nextTierIndex = 0;             // 下一個要觸發的 tier 索引
  let fullTargetAtReentry = 0;       // 重入場時的完整目標口數

  // 統計
  let stopLossCount = 0;
  let partialStopLossCount = 0;
  let secondaryStopLossCount = 0;
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
        // 隔日收盤價全額停損
        const closePnl = (close - avgEntryPrice) * contracts * config.contractMultiplier;
        realizedPnl += closePnl;
        roundPnls.push(realizedPnl - (roundEntryEquity - config.initialCapital));

        const pa = pendingAction;
        const phaseLabel = pa.hasProfit
          ? `獲利階段 ${(pa.threshold * 100).toFixed(1)}%`
          : `初期 ${(config.initialDrawdownPct * 100).toFixed(0)}%`;
        const isSecondary = partialStopActive;
        trades.push({
          type: isSecondary ? 'SECONDARY_STOP_LOSS' : 'STOP_LOSS',
          date: day.date,
          price: close,
          contracts: -contracts,
          totalContracts: 0,
          reason: isSecondary
            ? `二次停損！(信號日 ${pa.signalDate}) 倖存倉價格從 ${pa.pricePeak.toFixed(0)} 再跌 ${(pa.drawdownPct * 100).toFixed(1)}% >= ${(pa.threshold * 100).toFixed(1)}%，全部清倉 ${contracts}口 @ ${close}`
            : `停損出場！(信號日 ${pa.signalDate}) 價格從峰值 ${pa.pricePeak.toFixed(0)} 回撤 ${(pa.drawdownPct * 100).toFixed(1)}% >= 門檻 ${(pa.threshold * 100).toFixed(1)}% [${phaseLabel}]，隔日 ${day.date} 以 ${close} 執行 (${contracts}口)`,
          pnl: closePnl,
        });

        if (isSecondary) {
          secondaryStopLossCount++;
        } else {
          stopLossCount++;
        }
        contracts = 0;
        avgEntryPrice = 0;
        priceLow = close;
        state = 'STOPPED_OUT';
        partialStopActive = false;
        partialStopNewPeak = 0;
        tieredReentryActive = false;
        pendingAction = null;

        // 記錄快照後 continue，今日不再產生新信號
        snapshots.push({
          date: day.date, close, state, contracts: 0, avgEntryPrice: 0,
          unrealizedPnl: 0, realizedPnl,
          equity: config.initialCapital + realizedPnl,
          priceFromPeak: 0, drawdownThreshold: 0, pricePeak, priceLow,
        });
        continue;

      } else if (pendingAction.type === 'PARTIAL_STOP_LOSS') {
        // 方案4: 隔日收盤價分批停損（賣出部分，保留倖存倉）
        const pa = pendingAction;
        const contractsToSell = pa.contractsToSell;
        const closePnl = (close - avgEntryPrice) * contractsToSell * config.contractMultiplier;
        realizedPnl += closePnl;

        const remaining = contracts - contractsToSell;
        const phaseLabel = pa.hasProfit
          ? `獲利階段 ${(pa.threshold * 100).toFixed(1)}%`
          : `初期 ${(config.initialDrawdownPct * 100).toFixed(0)}%`;
        trades.push({
          type: 'PARTIAL_STOP_LOSS',
          date: day.date,
          price: close,
          contracts: -contractsToSell,
          totalContracts: remaining,
          reason: `分批停損！(信號日 ${pa.signalDate}) 價格從峰值 ${pa.pricePeak.toFixed(0)} 回撤 ${(pa.drawdownPct * 100).toFixed(1)}% >= 門檻 ${(pa.threshold * 100).toFixed(1)}% [${phaseLabel}]，賣出${contractsToSell}口，保留${remaining}口倖存倉 @ ${close}`,
          pnl: closePnl,
        });

        partialStopLossCount++;
        contracts = remaining;
        // avgEntryPrice 不變（剩餘口數的成本基礎不變）
        // 重設峰值追蹤：倖存倉從現在開始追蹤新的峰值
        partialStopActive = true;
        partialStopNewPeak = close;
        pricePeak = close;
        pendingAction = null;

        // 記錄快照後 continue（停損日不再產生其他信號）
        const unrealized = (close - avgEntryPrice) * contracts * config.contractMultiplier;
        snapshots.push({
          date: day.date, close, state: 'HOLDING', contracts, avgEntryPrice,
          unrealizedPnl: unrealized, realizedPnl,
          equity: config.initialCapital + realizedPnl + unrealized,
          priceFromPeak: 0, drawdownThreshold: config.secondaryStopLossPct, pricePeak, priceLow,
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
          const fullTarget = Math.min(targetByProfit, targetByMargin);

          // 方案5: 分批重入場 — 第一階段只買部分
          let buyContracts: number;
          if (config.tieredReentryEnabled && pa.tierIndex !== undefined) {
            const tier = config.reentryTiers[pa.tierIndex];
            buyContracts = Math.max(1, Math.round(fullTarget * tier.targetPct));
            buyContracts = Math.min(buyContracts, targetByMargin);

            // 設定分批重入場追蹤狀態
            tieredReentryActive = pa.tierIndex < config.reentryTiers.length - 1;
            tieredReentryLow = pa.priceLow;
            nextTierIndex = pa.tierIndex + 1;
            fullTargetAtReentry = fullTarget;
          } else {
            buyContracts = fullTarget;
          }

          contracts = buyContracts;
          avgEntryPrice = close;
          pricePeak = close;
          roundEntryEquity = currentEquity;

          if (contracts > maxContracts) maxContracts = contracts;

          const usedMargin = contracts * config.marginPerContract;
          const tierLabel = config.tieredReentryEnabled && pa.tierIndex !== undefined
            ? `[Tier ${pa.tierIndex + 1}/${config.reentryTiers.length}] `
            : '';
          trades.push({
            type: 'REENTRY',
            date: day.date,
            price: close,
            contracts,
            totalContracts: contracts,
            reason: `${tierLabel}重新入場！(信號日 ${pa.signalDate}) 價格從低點 ${pa.priceLow.toFixed(0)} 回漲 ${(pa.recoveryPct * 100).toFixed(1)}%，隔日買進${contracts}口 @ ${close} (保證金: ${usedMargin.toLocaleString()}/${Math.round(currentEquity).toLocaleString()})`,
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
      if (partialStopActive && close > partialStopNewPeak) partialStopNewPeak = close;

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
        partialStopActive = false;
        partialStopNewPeak = 0;
        tieredReentryActive = false;

        snapshots.push({
          date: day.date, close, state, contracts: 0, avgEntryPrice: 0,
          unrealizedPnl: 0, realizedPnl,
          equity: config.initialCapital + realizedPnl,
          priceFromPeak: 0, drawdownThreshold: 0, pricePeak, priceLow,
        });
        continue;
      }

      // === 方案4: 倖存倉二次停損檢查 ===
      if (partialStopActive && partialStopNewPeak > 0 && i > 0 && pendingAction === null) {
        const secondaryDrawdown = (partialStopNewPeak - close) / partialStopNewPeak;
        if (secondaryDrawdown >= config.secondaryStopLossPct) {
          // 倖存倉二次停損：全部清倉
          pendingAction = {
            type: 'STOP_LOSS',
            signalDate: day.date,
            signalPrice: close,
            pricePeak: partialStopNewPeak,
            drawdownPct: secondaryDrawdown,
            threshold: config.secondaryStopLossPct,
            hasProfit: equity > config.initialCapital,
          };

          // 記錄快照
          snapshots.push({
            date: day.date, close, state, contracts, avgEntryPrice,
            unrealizedPnl, realizedPnl,
            equity,
            priceFromPeak: secondaryDrawdown,
            drawdownThreshold: config.secondaryStopLossPct,
            pricePeak: partialStopNewPeak, priceLow,
          });
          continue;
        }

        // 倖存倉恢復檢查：若價格已回到分批停損前的峰值水準，解除倖存倉狀態
        // （不需要完全回到原峰值，只要新峰值高於停損執行時的價格即可恢復正常追蹤）
        // partialStopActive 會在不符合二次停損時自然繼續，直到被解除
      }

      const hasProfit = equity > config.initialCapital;
      const drawdownThreshold = calcDrawdownThreshold(contracts, hasProfit, config);
      const priceDrawdownPct = pricePeak > 0 ? (pricePeak - close) / pricePeak : 0;

      // 檢查停損信號（產生信號，隔日執行）
      // 注意：倖存倉模式下用二次停損邏輯（上方），不走這裡的一般停損
      if (!partialStopActive && priceDrawdownPct >= drawdownThreshold && i > 0 && pendingAction === null) {
        // 方案4: 決定是分批停損還是全額停損
        if (config.partialStopLossEnabled && contracts > 1) {
          const contractsToSell = Math.ceil(contracts * config.partialStopLossRatio);
          pendingAction = {
            type: 'PARTIAL_STOP_LOSS',
            signalDate: day.date,
            signalPrice: close,
            pricePeak,
            drawdownPct: priceDrawdownPct,
            threshold: drawdownThreshold,
            hasProfit,
            contractsToSell,
          };
        } else {
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
      }
      // 方案5: 分批重入場 — 持倉中檢查是否有更高 tier 的加碼
      else if (tieredReentryActive && pendingAction === null && !partialStopActive) {
        if (nextTierIndex < config.reentryTiers.length) {
          const tier = config.reentryTiers[nextTierIndex];
          const recoveryFromLow = tieredReentryLow > 0 ? (close - tieredReentryLow) / tieredReentryLow : 0;

          if (recoveryFromLow >= tier.recoveryPct) {
            // 計算此 tier 的目標口數
            const tierTargetContracts = Math.max(1, Math.round(fullTargetAtReentry * tier.targetPct));
            const marginAllowed = calcMaxContractsByMargin(equity, config);
            const targetContracts = Math.min(tierTargetContracts, marginAllowed);

            if (targetContracts > contracts) {
              pendingAction = {
                type: 'ADD',
                targetContracts,
                signalDate: day.date,
              };
            }
            nextTierIndex++;
            if (nextTierIndex >= config.reentryTiers.length) {
              tieredReentryActive = false;
            }
          }
        }
      }
      // 檢查加碼信號（沒有停損信號、不在倖存倉模式時才檢查）
      else if (pendingAction === null && !partialStopActive) {
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

      const currentThreshold = partialStopActive
        ? config.secondaryStopLossPct
        : calcDrawdownThreshold(Math.max(contracts, 1), equity > config.initialCapital, config);
      const currentDrawdown = partialStopActive
        ? (partialStopNewPeak > 0 ? (partialStopNewPeak - close) / partialStopNewPeak : 0)
        : (pricePeak > 0 ? (pricePeak - close) / pricePeak : 0);

      snapshots.push({
        date: day.date,
        close,
        state,
        contracts,
        avgEntryPrice,
        unrealizedPnl: snapshotUnrealizedPnl,
        realizedPnl,
        equity: config.initialCapital + realizedPnl + snapshotUnrealizedPnl,
        priceFromPeak: currentDrawdown,
        drawdownThreshold: currentThreshold,
        pricePeak: partialStopActive ? partialStopNewPeak : pricePeak,
        priceLow,
      });

    } else if (state === 'STOPPED_OUT' || state === 'WAITING_REENTRY') {
      // 追蹤價格低點
      if (close < priceLow) priceLow = close;

      state = 'WAITING_REENTRY';

      // 檢查重入場信號（隔日執行）
      const recoveryPct = priceLow > 0 ? (close - priceLow) / priceLow : 0;
      const currentEquity = config.initialCapital + realizedPnl;

      if (currentEquity >= config.marginPerContract && pendingAction === null) {
        // 方案5: 分批重入場
        if (config.tieredReentryEnabled && config.reentryTiers.length > 0) {
          const firstTier = config.reentryTiers[0];
          if (recoveryPct >= firstTier.recoveryPct) {
            pendingAction = {
              type: 'REENTRY',
              targetContracts: 0,
              signalDate: day.date,
              priceLow,
              recoveryPct,
              tierIndex: 0,
            };
          }
        } else {
          // 原始邏輯：固定 20% 回漲
          if (recoveryPct >= config.reentryRecoveryPct) {
            pendingAction = {
              type: 'REENTRY',
              targetContracts: 0,
              signalDate: day.date,
              priceLow,
              recoveryPct,
            };
          }
        }
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
    partialStopLossCount,
    secondaryStopLossCount,
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
