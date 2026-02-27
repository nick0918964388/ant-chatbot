// 台指期回測策略 - 類型定義

export interface DailyPrice {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type StrategyState = 'HOLDING' | 'STOPPED_OUT' | 'WAITING_REENTRY';

export interface Trade {
  type: 'ENTRY' | 'ADD' | 'STOP_LOSS' | 'REENTRY';
  date: string;
  price: number;
  contracts: number;       // 此次交易口數 (正=買進, 負=賣出)
  totalContracts: number;  // 交易後總口數
  reason: string;
  pnl?: number;            // 此次交易已實現損益 (僅平倉時)
}

export interface DailySnapshot {
  date: string;
  close: number;
  state: StrategyState;
  contracts: number;
  avgEntryPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  equity: number;          // 總權益 = 初始資金 + 已實現損益 + 未實現損益
  priceFromPeak: number;   // 價格距離峰值的回撤比例
  drawdownThreshold: number; // 當前停損門檻
  pricePeak: number;       // 追蹤的價格峰值
  priceLow: number;        // 停損後追蹤的價格低點
}

export interface BacktestResult {
  config: BacktestConfig;
  snapshots: DailySnapshot[];
  trades: Trade[];
  metrics: BacktestMetrics;
  priceData: DailyPrice[];
}

export interface BacktestMetrics {
  totalReturn: number;        // 總報酬率
  totalPnl: number;           // 總損益
  finalEquity: number;        // 最終權益
  maxEquity: number;          // 最高權益
  maxDrawdown: number;        // 最大權益回撤
  maxDrawdownPct: number;     // 最大權益回撤比例
  totalTrades: number;        // 總交易次數
  stopLossCount: number;      // 停損次數
  reentryCount: number;       // 重新入場次數
  maxContracts: number;       // 最大持倉口數
  winRate: number;            // 勝率 (以停損-重入場為一輪計算)
  startDate: string;
  endDate: string;
  tradingDays: number;
}

export interface BacktestConfig {
  initialCapital: number;       // 初始資金
  contractMultiplier: number;   // 每點價值 (大台=200, 小台=50)
  contractType: 'TX' | 'MTX';  // 合約類型
  profitPerContract: number;    // 每獲利多少加碼一口
  initialDrawdownPct: number;   // 初期停損比例 (尚無獲利時, 10%)
  baseDrawdownPct: number;      // 基礎回撤停損比例 (有獲利後, 30%)
  contractDrawdownPenalty: number; // 每口額外回撤扣減 (5%)
  reentryRecoveryPct: number;   // 重新入場所需回漲比例 (20%)
  startDate: string;
  endDate: string;
}

export const DEFAULT_CONFIG: BacktestConfig = {
  initialCapital: 1_000_000,
  contractMultiplier: 200,       // 大台每點200元
  contractType: 'TX',
  profitPerContract: 500_000,    // 每獲利50萬加碼一口
  initialDrawdownPct: 0.10,      // 初期10%停損
  baseDrawdownPct: 0.30,         // 有獲利後30%
  contractDrawdownPenalty: 0.05, // 5%
  reentryRecoveryPct: 0.20,     // 20%
  startDate: '2024-07-01',
  endDate: new Date().toISOString().split('T')[0],
};
