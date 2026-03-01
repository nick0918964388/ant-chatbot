'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, Area, AreaChart, ComposedChart,
  Bar, Legend,
} from 'recharts';
import dayjs from 'dayjs';
import type { BacktestResult, Trade } from '@/lib/backtest/types';

// ============================================================
// 格式化工具
// ============================================================
const fmt = {
  money: (v: number) => {
    if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(2)}億`;
    if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(1)}萬`;
    return v.toLocaleString();
  },
  pct: (v: number) => `${(v * 100).toFixed(2)}%`,
  price: (v: number) => v.toFixed(0),
  date: (d: string) => dayjs(d).format('YY/MM'),
  fullDate: (d: string) => dayjs(d).format('YYYY/MM/DD'),
};

// ============================================================
// 自訂 Tooltip
// ============================================================
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string; payload?: Record<string, unknown> }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const displayDate = (payload[0]?.payload?.fullDate as string) || label;
  return (
    <div style={{
      background: 'rgba(15, 23, 42, 0.95)', padding: '10px 14px', borderRadius: 8,
      border: '1px solid rgba(148,163,184,0.2)', fontSize: 13,
    }}>
      <div style={{ color: '#94a3b8', marginBottom: 4 }}>{displayDate}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, margin: '2px 0' }}>
          {p.name}: <strong>{typeof p.value === 'number' && p.name.includes('率') ? fmt.pct(p.value) : typeof p.value === 'number' ? p.value.toLocaleString() : p.value}</strong>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// 指標卡片
// ============================================================
function MetricCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{
      background: 'rgba(30, 41, 59, 0.8)', borderRadius: 12, padding: '16px 20px',
      border: '1px solid rgba(148,163,184,0.1)', flex: '1 1 180px', minWidth: 160,
    }}>
      <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 6 }}>{label}</div>
      <div style={{ color: color || '#f1f5f9', fontSize: 22, fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ============================================================
// 交易紀錄表
// ============================================================
function TradeTable({ trades }: { trades: Trade[] }) {
  const typeColor: Record<string, string> = {
    ENTRY: '#3b82f6', ADD: '#22c55e', STOP_LOSS: '#ef4444', PARTIAL_STOP_LOSS: '#fb923c', SECONDARY_STOP_LOSS: '#dc2626', MARGIN_CALL: '#f59e0b', REENTRY: '#a855f7',
  };
  const typeLabel: Record<string, string> = {
    ENTRY: '初始入場', ADD: '獲利加碼', STOP_LOSS: '停損出場', PARTIAL_STOP_LOSS: '分批停損', SECONDARY_STOP_LOSS: '二次停損', MARGIN_CALL: '追繳斷頭', REENTRY: '重新入場',
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(148,163,184,0.2)' }}>
            {['日期', '類型', '價格', '口數', '持倉', '損益', '說明'].map(h => (
              <th key={h} style={{ padding: '10px 12px', color: '#94a3b8', fontWeight: 600, textAlign: 'left' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trades.map((t, i) => (
            <tr key={i} style={{ borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
              <td style={{ padding: '8px 12px', color: '#e2e8f0' }}>{fmt.fullDate(t.date)}</td>
              <td style={{ padding: '8px 12px' }}>
                <span style={{
                  color: typeColor[t.type], fontWeight: 600,
                  background: `${typeColor[t.type]}15`, padding: '2px 8px', borderRadius: 4,
                }}>{typeLabel[t.type]}</span>
              </td>
              <td style={{ padding: '8px 12px', color: '#e2e8f0' }}>{fmt.price(t.price)}</td>
              <td style={{ padding: '8px 12px', color: t.contracts > 0 ? '#22c55e' : '#ef4444' }}>
                {t.contracts > 0 ? `+${t.contracts}` : t.contracts}
              </td>
              <td style={{ padding: '8px 12px', color: '#e2e8f0' }}>{t.totalContracts}</td>
              <td style={{ padding: '8px 12px', color: t.pnl != null ? (t.pnl >= 0 ? '#22c55e' : '#ef4444') : '#64748b' }}>
                {t.pnl != null ? `${t.pnl >= 0 ? '+' : ''}${fmt.money(t.pnl)}` : '-'}
              </td>
              <td style={{ padding: '8px 12px', color: '#94a3b8', maxWidth: 300 }}>{t.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// 主頁面
// ============================================================
export default function BacktestPage() {
  const [result, setResult] = useState<(BacktestResult & { dataSource?: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contractType, setContractType] = useState<'TX' | 'MTX'>('TX');
  const [profitPerContract, setProfitPerContract] = useState(500_000);
  const [initialCapital, setInitialCapital] = useState(1_000_000);
  const [startDate, setStartDate] = useState('2015-01-05');
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [partialStopLoss, setPartialStopLoss] = useState(false);
  const [tieredReentry, setTieredReentry] = useState(false);
  const [maxContractsLimit, setMaxContractsLimit] = useState(0);
  const [marginRatio, setMarginRatio] = useState(3.0);
  const [dataInfo, setDataInfo] = useState<{ totalDays: number; dateRange: { from: string; to: string } | null } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // 查詢累積數據狀態
  const fetchDataInfo = useCallback(async () => {
    try {
      const res = await fetch('/api/backtest/data');
      if (res.ok) {
        const info = await res.json();
        setDataInfo(info);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchDataInfo(); }, [fetchDataInfo]);

  const fetchBacktest = useCallback(async (ct: 'TX' | 'MTX', ppc?: number, sd?: string, ed?: string, psl?: boolean, tr?: boolean, ic?: number, mcl?: number, mr?: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ contractType: ct });
      if (ppc) params.set('profitPerContract', String(ppc));
      if (sd) params.set('startDate', sd);
      if (ed) params.set('endDate', ed);
      if (psl) params.set('partialStopLoss', 'true');
      if (tr) params.set('tieredReentry', 'true');
      if (ic) params.set('initialCapital', String(ic));
      if (mcl && mcl > 0) params.set('maxContractsLimit', String(mcl));
      if (mr && mr > 0) params.set('marginRatio', String(mr));
      const res = await fetch(`/api/backtest?${params}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'API error');
      }
      const data: BacktestResult = await res.json();
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  // 上傳 CSV → 伺服器端累積（自動偵測 Big5 / UTF-8 編碼）
  const handleCsvUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploading(true);
    setUploadMsg(null);
    try {
      const buffer = await file.arrayBuffer();
      // 先嘗試 UTF-8，若表頭無法辨識則改用 Big5（期交所預設編碼）
      let text = new TextDecoder('utf-8').decode(buffer);
      if (!text.includes('交易日期') && !text.includes('契約')) {
        text = new TextDecoder('big5').decode(buffer);
      }
      const res = await fetch('/api/backtest/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvData: text, contractType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUploadMsg(`${file.name}: ${data.message}`);
      setDataInfo({ totalDays: data.totalDays, dateRange: data.dateRange });
      setRefreshKey(k => k + 1); // 觸發回測重跑
    } catch (err) {
      setUploadMsg(`上傳失敗: ${err instanceof Error ? err.message : '未知錯誤'}`);
    } finally {
      setUploading(false);
    }
  }, [contractType]);

  // 清除所有累積資料
  const handleClearData = useCallback(async () => {
    await fetch('/api/backtest/data', { method: 'DELETE' });
    setDataInfo({ totalDays: 0, dateRange: null });
    setUploadMsg(null);
    setRefreshKey(k => k + 1);
  }, []);

  const runBacktestNow = useCallback(() => {
    fetchBacktest(contractType, profitPerContract, startDate, endDate, partialStopLoss, tieredReentry, initialCapital, maxContractsLimit, marginRatio);
  }, [fetchBacktest, contractType, profitPerContract, startDate, endDate, partialStopLoss, tieredReentry, initialCapital, maxContractsLimit, marginRatio]);

  // 首次載入 + 上傳資料後自動跑一次
  useEffect(() => { runBacktestNow(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={{ textAlign: 'center', padding: '120px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>Loading...</div>
          <div style={{ color: '#94a3b8' }}>正在從 Yahoo Finance 取得台指加權指數資料並執行回測...</div>
        </div>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div style={containerStyle}>
        <div style={{ textAlign: 'center', padding: '120px 0' }}>
          <div style={{ fontSize: 24, color: '#ef4444', marginBottom: 16 }}>回測失敗</div>
          <div style={{ color: '#94a3b8', marginBottom: 24 }}>{error}</div>
          <button onClick={() => fetchBacktest(contractType)} style={btnStyle}>重新執行</button>
        </div>
      </div>
    );
  }

  const { metrics: m, snapshots, trades, config } = result;

  // 準備圖表資料
  const chartData = snapshots.map(s => ({
    date: fmt.date(s.date),
    fullDate: fmt.fullDate(s.date),
    close: s.close,
    equity: Math.round(s.equity),
    contracts: s.contracts,
    unrealizedPnl: Math.round(s.unrealizedPnl),
    drawdownPct: s.priceFromPeak,
    threshold: s.drawdownThreshold,
    state: s.state,
  }));

  // 權益回撤資料
  let eqPeak = config.initialCapital;
  const ddData = snapshots.map(s => {
    if (s.equity > eqPeak) eqPeak = s.equity;
    const dd = eqPeak > 0 ? (eqPeak - s.equity) / eqPeak : 0;
    return { date: fmt.date(s.date), fullDate: fmt.fullDate(s.date), drawdown: -dd };
  });

  const pnlColor = m.totalPnl >= 0 ? '#22c55e' : '#ef4444';

  return (
    <div style={containerStyle}>
      {/* 標題 + 合約切換 */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#f1f5f9', margin: 0 }}>
            台指期回測策略
          </h1>
          <div style={{ display: 'flex', gap: 4, background: 'rgba(30,41,59,0.8)', borderRadius: 8, padding: 3 }}>
            {([['TX', '大台 TX', '200元/點 | 保證金37.4萬'], ['MTX', '小台 MTX', '50元/點 | 保證金9.5萬']] as const).map(([key, label, desc]) => (
              <button
                key={key}
                onClick={() => setContractType(key)}
                title={desc}
                style={{
                  padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: 600, transition: 'all 0.2s',
                  background: contractType === key ? '#3b82f6' : 'transparent',
                  color: contractType === key ? '#fff' : '#94a3b8',
                }}
              >{label}</button>
            ))}
          </div>
        </div>
        {/* 參數設定列 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#94a3b8', fontSize: 13 }}>起始資金:</span>
            <div style={{ display: 'flex', gap: 3, background: 'rgba(30,41,59,0.8)', borderRadius: 6, padding: 2 }}>
              {([500_000, 1_000_000, 2_000_000, 5_000_000] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setInitialCapital(v)}
                  style={{
                    padding: '4px 12px', borderRadius: 4, border: 'none', cursor: 'pointer',
                    fontSize: 12, fontWeight: 600, transition: 'all 0.2s',
                    background: initialCapital === v ? '#3b82f6' : 'transparent',
                    color: initialCapital === v ? '#fff' : '#94a3b8',
                  }}
                >{fmt.money(v)}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#94a3b8', fontSize: 13 }}>加碼門檻:</span>
            <div style={{ display: 'flex', gap: 3, background: 'rgba(30,41,59,0.8)', borderRadius: 6, padding: 2 }}>
              {([200_000, 300_000, 500_000] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setProfitPerContract(v)}
                  style={{
                    padding: '4px 12px', borderRadius: 4, border: 'none', cursor: 'pointer',
                    fontSize: 12, fontWeight: 600, transition: 'all 0.2s',
                    background: profitPerContract === v ? '#22c55e' : 'transparent',
                    color: profitPerContract === v ? '#fff' : '#94a3b8',
                  }}
                >{fmt.money(v)}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#94a3b8', fontSize: 13 }}>口數上限:</span>
            <div style={{ display: 'flex', gap: 3, background: 'rgba(30,41,59,0.8)', borderRadius: 6, padding: 2 }}>
              {([0, 2, 3, 5, 10] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setMaxContractsLimit(v)}
                  style={{
                    padding: '4px 12px', borderRadius: 4, border: 'none', cursor: 'pointer',
                    fontSize: 12, fontWeight: 600, transition: 'all 0.2s',
                    background: maxContractsLimit === v ? '#f59e0b' : 'transparent',
                    color: maxContractsLimit === v ? '#fff' : '#94a3b8',
                  }}
                >{v === 0 ? '不限' : `${v}口`}</button>
              ))}
            </div>
            <input
              type="number"
              min={0}
              max={99}
              value={maxContractsLimit || ''}
              placeholder="自訂"
              onChange={e => setMaxContractsLimit(Math.max(0, Number(e.target.value) || 0))}
              style={{
                width: 52, background: 'rgba(30,41,59,0.8)', color: '#e2e8f0',
                border: `1px solid ${maxContractsLimit > 0 && ![0,2,3,5,10].includes(maxContractsLimit) ? '#f59e0b' : 'rgba(148,163,184,0.2)'}`,
                borderRadius: 6, padding: '3px 8px', fontSize: 12, textAlign: 'center',
              }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#94a3b8', fontSize: 13 }}>權益/保證金:</span>
            <div style={{ display: 'flex', gap: 3, background: 'rgba(30,41,59,0.8)', borderRadius: 6, padding: 2 }}>
              {([1.5, 2.0, 3.0, 5.0] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setMarginRatio(v)}
                  style={{
                    padding: '4px 12px', borderRadius: 4, border: 'none', cursor: 'pointer',
                    fontSize: 12, fontWeight: 600, transition: 'all 0.2s',
                    background: marginRatio === v ? '#06b6d4' : 'transparent',
                    color: marginRatio === v ? '#fff' : '#94a3b8',
                  }}
                >{(v * 100).toFixed(0)}%</button>
              ))}
            </div>
            <input
              type="number"
              min={1}
              max={20}
              step={0.1}
              value={marginRatio}
              onChange={e => setMarginRatio(Math.max(0.1, Number(e.target.value) || 3.0))}
              style={{
                width: 52, background: 'rgba(30,41,59,0.8)', color: '#e2e8f0',
                border: `1px solid ${![1.5,2.0,3.0,5.0].includes(marginRatio) ? '#06b6d4' : 'rgba(148,163,184,0.2)'}`,
                borderRadius: 6, padding: '3px 8px', fontSize: 12, textAlign: 'center',
              }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ color: '#94a3b8', fontSize: 13 }}>期間:</span>
            <div style={{ display: 'flex', gap: 3, background: 'rgba(30,41,59,0.8)', borderRadius: 6, padding: 2 }}>
              {([['2015-01-05', '2015'], ['2018-01-02', '2018'], ['2020-01-02', '2020'], ['2022-01-03', '2022'], ['2024-07-01', '2024/07']] as const).map(([d, label]) => (
                <button
                  key={d}
                  onClick={() => setStartDate(d)}
                  style={{
                    padding: '4px 10px', borderRadius: 4, border: 'none', cursor: 'pointer',
                    fontSize: 12, fontWeight: 600, transition: 'all 0.2s',
                    background: startDate === d ? '#a855f7' : 'transparent',
                    color: startDate === d ? '#fff' : '#94a3b8',
                  }}
                >{label}</button>
              ))}
            </div>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              style={{
                background: 'rgba(30,41,59,0.8)', color: '#e2e8f0', border: '1px solid rgba(148,163,184,0.2)',
                borderRadius: 6, padding: '3px 8px', fontSize: 12, cursor: 'pointer',
              }}
            />
            <span style={{ color: '#64748b', fontSize: 13 }}>～</span>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              style={{
                background: 'rgba(30,41,59,0.8)', color: '#e2e8f0', border: '1px solid rgba(148,163,184,0.2)',
                borderRadius: 6, padding: '3px 8px', fontSize: 12, cursor: 'pointer',
              }}
            />
          </div>
        </div>
        {/* 數據來源 & CSV 上傳 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ color: '#94a3b8', fontSize: 13 }}>期貨數據:</span>
          {dataInfo && dataInfo.totalDays > 0 ? (
            <>
              <span style={{ color: '#22c55e', fontSize: 12, fontWeight: 600, background: 'rgba(34,197,94,0.1)', padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(34,197,94,0.3)' }}>
                TAIFEX {dataInfo.totalDays} 交易日 ({dataInfo.dateRange?.from} ~ {dataInfo.dateRange?.to})
              </span>
              <label style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(59,130,246,0.3)', background: 'rgba(59,130,246,0.1)', color: '#3b82f6', cursor: 'pointer', fontSize: 12, fontWeight: 600, opacity: uploading ? 0.5 : 1 }}>
                {uploading ? '上傳中...' : '追加 CSV'}
                <input type="file" accept=".csv" onChange={handleCsvUpload} disabled={uploading} style={{ display: 'none' }} />
              </label>
              <button
                onClick={handleClearData}
                style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: '#ef4444', cursor: 'pointer', fontSize: 12 }}
              >清除全部</button>
            </>
          ) : (
            <>
              <span style={{ color: '#64748b', fontSize: 12 }}>Yahoo Finance (^TWII)</span>
              <label style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(59,130,246,0.3)', background: 'rgba(59,130,246,0.1)', color: '#3b82f6', cursor: 'pointer', fontSize: 12, fontWeight: 600, opacity: uploading ? 0.5 : 1 }}>
                {uploading ? '上傳中...' : '上傳期交所 CSV'}
                <input type="file" accept=".csv" onChange={handleCsvUpload} disabled={uploading} style={{ display: 'none' }} />
              </label>
            </>
          )}
          {uploadMsg && <span style={{ color: '#94a3b8', fontSize: 11 }}>{uploadMsg}</span>}
        </div>
        {/* 優化策略開關 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ color: '#94a3b8', fontSize: 13 }}>優化策略:</span>
          {([
            { key: 'partialStopLoss', label: '分批停損', desc: '停損時保留25%倖存倉', active: partialStopLoss, toggle: () => setPartialStopLoss(v => !v), color: '#ef4444' },
            { key: 'tieredReentry', label: '分批重入場', desc: '8%/14%/20%分階段買回', active: tieredReentry, toggle: () => setTieredReentry(v => !v), color: '#a855f7' },
          ] as const).map(opt => (
            <button
              key={opt.key}
              onClick={opt.toggle}
              title={opt.desc}
              style={{
                padding: '4px 14px', borderRadius: 6, border: `1px solid ${opt.active ? opt.color : 'rgba(148,163,184,0.2)'}`,
                cursor: 'pointer', fontSize: 12, fontWeight: 600, transition: 'all 0.2s',
                background: opt.active ? `${opt.color}20` : 'transparent',
                color: opt.active ? opt.color : '#64748b',
              }}
            >
              {opt.active ? '\u2713 ' : ''}{opt.label}
            </button>
          ))}
          <button
            onClick={runBacktestNow}
            disabled={loading}
            style={{
              padding: '6px 24px', borderRadius: 8, border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 14, fontWeight: 700, transition: 'all 0.2s',
              background: loading ? '#334155' : 'linear-gradient(135deg, #3b82f6, #2563eb)',
              color: '#fff', boxShadow: loading ? 'none' : '0 2px 8px rgba(59,130,246,0.3)',
              marginLeft: 8,
            }}
          >{loading ? '計算中...' : '執行回測'}</button>
        </div>
        <p style={{ color: '#94a3b8', marginTop: 8, fontSize: 14 }}>
          {config.contractType === 'TX' ? '大台' : '小台'} ({config.contractMultiplier}元/點) | 起始資金 {fmt.money(config.initialCapital)} |
          每獲利 {fmt.money(config.profitPerContract)} 加碼一口 |
          維持保證金 {fmt.money(config.marginPerContract)}/口 |
          初期停損 {(config.initialDrawdownPct * 100).toFixed(0)}% → 獲利後 {(config.baseDrawdownPct * 100).toFixed(0)}%-(口數×{(config.contractDrawdownPenalty * 100).toFixed(0)}%) |
          回漲 {(config.reentryRecoveryPct * 100).toFixed(0)}% 重新入場 |
          {fmt.fullDate(m.startDate)} ~ {fmt.fullDate(m.endDate)}
          {config.partialStopLossEnabled && ` | 分批停損: 賣${(config.partialStopLossRatio * 100).toFixed(0)}%留${((1 - config.partialStopLossRatio) * 100).toFixed(0)}%, 二次停損${(config.secondaryStopLossPct * 100).toFixed(0)}%`}
          {config.tieredReentryEnabled && ` | 分批重入場: ${config.reentryTiers.map(t => `${(t.recoveryPct * 100).toFixed(0)}%→${(t.targetPct * 100).toFixed(0)}%`).join('/')}`}
        </p>
      </div>

      {/* 指標卡片 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 32 }}>
        <MetricCard label="總報酬率" value={fmt.pct(m.totalReturn)} color={pnlColor} sub={`損益 ${m.totalPnl >= 0 ? '+' : ''}${fmt.money(m.totalPnl)}`} />
        <MetricCard label="最終權益" value={fmt.money(m.finalEquity)} sub={`最高 ${fmt.money(m.maxEquity)}`} />
        <MetricCard label="最大回撤" value={fmt.pct(m.maxDrawdownPct)} color="#ef4444" sub={`金額 ${fmt.money(m.maxDrawdown)}`} />
        <MetricCard label="交易天數" value={`${m.tradingDays}`} sub={`${m.totalTrades} 筆交易`} />
        <MetricCard label="停損/追繳" value={`${m.stopLossCount + m.partialStopLossCount}/${m.marginCallCount}`} color="#f59e0b"
          sub={`${m.partialStopLossCount > 0 ? `分批${m.partialStopLossCount} 二次${m.secondaryStopLossCount} | ` : ''}重入場 ${m.reentryCount} 次`} />
        <MetricCard label="最大持倉" value={`${m.maxContracts} 口`} sub={`保證金 ${fmt.money(m.maxContracts * config.marginPerContract)}`} />
      </div>

      {/* 台指加權指數走勢 + 交易信號 */}
      <Section title="台指加權指數走勢">
        <ResponsiveContainer width="100%" height={350}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
            <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} interval={Math.floor(chartData.length / 10)} />
            <YAxis tick={{ fill: '#64748b', fontSize: 11 }} domain={['auto', 'auto']} />
            <Tooltip content={<ChartTooltip />} />
            <Line type="monotone" dataKey="close" stroke="#3b82f6" strokeWidth={2} dot={false} name="收盤價" />
            {/* 交易標記 */}
            {trades.map((t, i) => {
              const color = t.type === 'STOP_LOSS' || t.type === 'SECONDARY_STOP_LOSS' ? '#ef4444'
                : t.type === 'PARTIAL_STOP_LOSS' ? '#fb923c'
                : t.type === 'ADD' ? '#22c55e'
                : t.type === 'MARGIN_CALL' ? '#f59e0b'
                : '#a855f7';
              return (
                <ReferenceLine
                  key={i}
                  x={fmt.date(t.date)}
                  stroke={color}
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </Section>

      {/* 權益曲線 */}
      <Section title="權益曲線">
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
            <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} interval={Math.floor(chartData.length / 10)} />
            <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
            <Tooltip content={<ChartTooltip />} />
            <defs>
              <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="equity" stroke="#22c55e" fill="url(#eqGrad)" strokeWidth={2} name="權益" />
            <ReferenceLine y={config.initialCapital} stroke="#64748b" strokeDasharray="5 5" label={{ value: '初始資金', fill: '#64748b', fontSize: 11 }} />
          </AreaChart>
        </ResponsiveContainer>
      </Section>

      {/* 持倉口數 */}
      <Section title="持倉口數變化">
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
            <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} interval={Math.floor(chartData.length / 10)} />
            <YAxis tick={{ fill: '#64748b', fontSize: 11 }} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="contracts" fill="#6366f1" name="持倉口數" opacity={0.7} />
          </ComposedChart>
        </ResponsiveContainer>
      </Section>

      {/* 權益回撤 */}
      <Section title="權益回撤">
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={ddData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
            <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} interval={Math.floor(ddData.length / 10)} />
            <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
            <Tooltip content={<ChartTooltip />} />
            <defs>
              <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0.3} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="drawdown" stroke="#ef4444" fill="url(#ddGrad)" strokeWidth={2} name="回撤率" />
          </AreaChart>
        </ResponsiveContainer>
      </Section>

      {/* 價格回撤 vs 停損門檻 */}
      <Section title="價格回撤 vs 停損門檻">
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={chartData.filter(d => d.state === 'HOLDING' || d.drawdownPct > 0)}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
            <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} interval={Math.floor(chartData.length / 12)} />
            <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
            <Tooltip content={<ChartTooltip />} />
            <Legend />
            <Line type="stepAfter" dataKey="threshold" stroke="#f59e0b" strokeWidth={2} dot={false} name="停損門檻" strokeDasharray="5 5" />
            <Line type="monotone" dataKey="drawdownPct" stroke="#ef4444" strokeWidth={1.5} dot={false} name="價格回撤" />
          </LineChart>
        </ResponsiveContainer>
      </Section>

      {/* 交易紀錄 */}
      <Section title="交易紀錄">
        <TradeTable trades={trades} />
      </Section>

      {/* 底部資訊 */}
      <div style={{ textAlign: 'center', color: '#475569', fontSize: 12, padding: '32px 0 16px', borderTop: '1px solid rgba(148,163,184,0.1)' }}>
        資料來源: {result.dataSource || 'Yahoo Finance (^TWII 台灣加權指數)'} | 回測結果僅供參考，不構成投資建議
      </div>
    </div>
  );
}

// ============================================================
// 區塊元件
// ============================================================
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'rgba(30, 41, 59, 0.5)', borderRadius: 12, padding: 24,
      border: '1px solid rgba(148,163,184,0.1)', marginBottom: 24,
    }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 16, marginTop: 0 }}>{title}</h2>
      {children}
    </div>
  );
}

// ============================================================
// 共用樣式
// ============================================================
const containerStyle: React.CSSProperties = {
  maxWidth: 1100,
  margin: '0 auto',
  padding: '32px 24px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  background: '#0f172a',
  minHeight: '100vh',
  color: '#f1f5f9',
};

const btnStyle: React.CSSProperties = {
  background: '#3b82f6',
  color: 'white',
  border: 'none',
  padding: '10px 24px',
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 600,
};
