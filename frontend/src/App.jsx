import React, { useState, useEffect } from 'react';
import { 
  Shield, 
  ShieldAlert, 
  TrendingUp, 
  History, 
  User, 
  ArrowRight, 
  Lock, 
  AlertTriangle, 
  CheckCircle, 
  XCircle, 
  Bell, 
  Coins, 
  Loader2 
} from 'lucide-react';

// API endpoints
const FRAUD_AGENT_URL = 'http://localhost:5001';
const AUDITOR_AGENT_URL = 'http://localhost:5003';
const YIELD_AGENT_URL = 'http://localhost:5002';

export default function App() {
  // UI states
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [urgencyText, setUrgencyText] = useState('');
  const [context, setContext] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('SAFE'); // SAFE, WARNING, BLOCKED
  
  // Evaluation results
  const [evalResult, setEvalResult] = useState(null);
  const [logs, setLogs] = useState([]);

  const [yieldData, setYieldData] = useState({
    options: [],
    recommended_portfolio: [],
    overall_apy: 2.73
  });

  // Fetch conservative yield options
  useEffect(() => {
    fetch(`${YIELD_AGENT_URL}/yield-opportunities`)
      .then(res => res.json())
      .then(data => setYieldData(data))
      .catch(err => {
        console.warn('Yield Agent not running, using mock yield data.');
        setYieldData({
          overall_apy: 2.73,
          options: [
            { id: 'rwa-jgb', name: 'Tokenized JGB (Japanese Government Bonds)', apy: 1.25, risk_profile: 'Ultra-Low', type: 'Government Bonds' },
            { id: 'rwa-ust', name: 'Tokenized US Treasury Bills (USD Hedged)', apy: 5.10, risk_profile: 'Low', type: 'Treasury Bills' },
            { id: 'hsk-usdc-yield', name: 'HSK USDC.e Stable Yield Vault', apy: 4.50, risk_profile: 'Low-Medium', type: 'Stable Yield' }
          ]
        });
      });
  }, []);

  const runSimulation = async (e) => {
    e.preventDefault();
    setLoading(true);
    setEvalResult(null);

    try {
      // 1. Call FraudAgent
      const fraudRes = await axiosPost(`${FRAUD_AGENT_URL}/check-fraud`, {
        user: '0x90F8bf65DCCf190e0006867664B90d54F859239D', // Mock User
        recipient,
        amount: parseFloat(amount),
        urgency_text: urgencyText,
        context
      });

      // 2. Call AuditorAgent
      const auditRes = await axiosPost(`${AUDITOR_AGENT_URL}/audit-payment`, {
        user: '0x90F8bf65DCCf190e0006867664B90d54F859239D',
        recipient,
        amount: parseFloat(amount),
        urgency_text: urgencyText,
        context,
        fraud_verdict: fraudRes
      });

      setEvalResult({
        fraud: fraudRes,
        audit: auditRes
      });

      // Update status banner
      if (auditRes.verdict === 'BLOCKED') {
        setStatus('BLOCKED');
      } else if (auditRes.verdict === 'FLAGGED') {
        setStatus('WARNING');
      } else {
        setStatus('SAFE');
      }

      // Add to logs
      setLogs(prev => [
        {
          timestamp: new Date().toLocaleString(),
          recipient: recipient,
          amount: amount,
          verdict: auditRes.verdict,
          riskScore: auditRes.risk_score,
          explanation: fraudRes.explanation,
          explanation_ja: fraudRes.explanation_ja || '安全確認が完了しました。'
        },
        ...prev
      ]);

    } catch (error) {
      console.error('Simulation check failed', error);
      // fallback mock behavior
      let mockVerdict = 'CLEARED';
      let mockRisk = 12;
      let mockJp = '通常の送金として安全が確認されました。';
      
      if (urgencyText.toLowerCase().includes('immediately') || urgencyText.includes('frozen') || urgencyText.includes('police')) {
        mockVerdict = 'BLOCKED';
        mockRisk = 92;
        mockJp = '警告：還付金詐欺やなりすまし等の恐れがあるため、送金を自動ブロックしました。';
      } else if (parseFloat(amount) > 200) {
        mockVerdict = 'FLAGGED';
        mockRisk = 65;
        mockJp = '注意：高額な送金です。ご家族（後見人）の確認と承認が必要になります。';
      }

      const mockRes = {
        verdict: mockVerdict,
        risk_score: mockRisk,
        explanation_ja: mockJp,
        explanation: 'Check completed via simulator fallback.'
      };

      setEvalResult({
        fraud: mockRes,
        audit: { verdict: mockVerdict, risk_score: mockRisk, on_chain_status: 'Logged' }
      });

      if (mockVerdict === 'BLOCKED') setStatus('BLOCKED');
      else if (mockVerdict === 'FLAGGED') setStatus('WARNING');
      else setStatus('SAFE');

      setLogs(prev => [
        {
          timestamp: new Date().toLocaleString(),
          recipient: recipient,
          amount: amount,
          verdict: mockVerdict,
          riskScore: mockRisk,
          explanation: mockRes.explanation,
          explanation_ja: mockJp
        },
        ...prev
      ]);
    } finally {
      setLoading(false);
    }
  };

  // Helper for mock fetching
  async function axiosPost(url, data) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    return res.json();
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header Branding */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ background: 'var(--primary)', color: 'white', padding: '0.75rem', borderRadius: '16px' }}>
            <Shield size={32} />
          </div>
          <div>
            <h1 style={{ fontSize: '2rem', color: 'var(--primary)', fontFamily: 'var(--font-display)' }}>おまもりアイ (Omamorai)</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>高齢者向け AIオンチェーン金融ガーディアン</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <div className="glass" style={{ padding: '0.5rem 1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <User size={18} color="var(--primary)" />
            <span style={{ fontSize: '0.95rem', fontWeight: 600 }}>鈴木 茂 様 (82歳)</span>
          </div>
        </div>
      </header>

      {/* Guardian Status Banner */}
      <div 
        className="glass pulse" 
        style={{ 
          padding: '1.5rem 2rem', 
          marginBottom: '2rem', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          backgroundColor: status === 'SAFE' ? 'var(--color-safe-bg)' : status === 'WARNING' ? 'var(--color-alert-bg)' : 'var(--color-danger-bg)',
          borderColor: status === 'SAFE' ? 'var(--color-safe)' : status === 'WARNING' ? 'var(--color-alert)' : 'var(--color-danger)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          {status === 'SAFE' && <CheckCircle size={44} color="var(--color-safe)" />}
          {status === 'WARNING' && <AlertTriangle size={44} color="var(--color-alert)" />}
          {status === 'BLOCKED' && <XCircle size={44} color="var(--color-danger)" />}
          <div>
            <h2 style={{ 
              fontSize: '1.6rem', 
              color: status === 'SAFE' ? 'var(--color-safe)' : status === 'WARNING' ? 'var(--color-alert)' : 'var(--color-danger)'
            }}>
              {status === 'SAFE' && '穏やか — おまもり起動中 (Protected)'}
              {status === 'WARNING' && '確認中 — 家族の承認待ち (Alert)'}
              {status === 'BLOCKED' && '警告 — 不審送金を阻止しました (Blocked)'}
            </h2>
            <p style={{ fontSize: '1.05rem', color: '#475569', marginTop: '0.25rem' }}>
              {status === 'SAFE' && '現在のお財布は完全に保護されています。不審な動きはありません。'}
              {status === 'WARNING' && '普段と異なる高額な取引を検知したため、ご家族の承認を確認しています。'}
              {status === 'BLOCKED' && '詐欺の可能性が極めて高い送金指示を自動検知し、送金をブロックしました。'}
            </p>
          </div>
        </div>
        <div style={{ fontSize: '1rem', fontWeight: 'bold', color: 'var(--text-muted)' }}>
          HSK Testnet
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '2rem' }}>
        
        {/* Simulator & Security Evaluation Panel */}
        <section className="glass" style={{ padding: '2rem' }}>
          <h3 style={{ fontSize: '1.4rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)' }}>
            <Coins size={24} /> 取引テスト・シミュレーター
          </h3>
          <form onSubmit={runSimulation} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            <div>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem', fontSize: '1.05rem' }}>送金先アドレス (Recipient Wallet)</label>
              <input 
                type="text" 
                value={recipient}
                onChange={e => setRecipient(e.target.value)}
                style={{ width: '100%', padding: '0.8rem 1rem', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '1rem' }}
                required 
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem', fontSize: '1.05rem' }}>送金金額 (USDC)</label>
                <input 
                  type="number" 
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  style={{ width: '100%', padding: '0.8rem 1rem', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '1rem' }}
                  required 
                />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem', fontSize: '1.05rem' }}>急かす言葉・プレッシャー文言</label>
                <input 
                  type="text" 
                  value={urgencyText}
                  onChange={e => setUrgencyText(e.target.value)}
                  style={{ width: '100%', padding: '0.8rem 1rem', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '1rem' }}
                  placeholder="例：警察、至急、口座凍結など"
                />
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem', fontSize: '1.05rem' }}>送金の理由や背景 (Context)</label>
              <textarea 
                value={context}
                onChange={e => setContext(e.target.value)}
                style={{ width: '100%', padding: '0.8rem 1rem', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '1rem', height: '80px', resize: 'none' }}
              />
            </div>
            <button 
              type="submit" 
              disabled={loading}
              style={{ 
                background: 'var(--primary)', 
                color: 'white', 
                padding: '1rem', 
                borderRadius: '12px', 
                border: 'none', 
                fontSize: '1.1rem', 
                fontWeight: 600, 
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '0.5rem',
                opacity: loading ? 0.7 : 1
              }}
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  AIエージェントによる検証中...
                </>
              ) : (
                <>
                  安全確認を行って送金
                  <ArrowRight size={20} />
                </>
              )}
            </button>
          </form>

          {/* AI Result Card */}
          {evalResult && (
            <div style={{ marginTop: '2rem', padding: '1.5rem', borderRadius: '16px', background: 'var(--primary-light)', border: '1px solid rgba(42,82,190,0.15)' }}>
              <h4 style={{ color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.15rem', marginBottom: '0.75rem' }}>
                <Shield size={20} /> AIガーディアンの判定結果
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1rem', fontSize: '1.05rem' }}>
                <div>
                  <div style={{ color: 'var(--text-muted)' }}>総合判定:</div>
                  <div style={{ 
                    fontWeight: 'bold', 
                    fontSize: '1.3rem',
                    color: evalResult.audit.verdict === 'CLEARED' ? 'var(--color-safe)' : evalResult.audit.verdict === 'FLAGGED' ? 'var(--color-alert)' : 'var(--color-danger)'
                  }}>
                    {evalResult.audit.verdict}
                  </div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)' }}>リスクスコア:</div>
                  <div style={{ fontWeight: 'bold', fontSize: '1.3rem' }}>
                    {evalResult.audit.risk_score || evalResult.fraud.risk_score} / 100
                  </div>
                </div>
              </div>
              <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: '0.75rem' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>説明 (解説):</div>
                <p style={{ color: 'var(--text-main)', fontSize: '1.05rem', lineHeight: '1.5' }}>
                  {evalResult.fraud.explanation_ja}
                </p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.5rem', fontStyle: 'italic' }}>
                  English: {evalResult.fraud.explanation}
                </p>
              </div>
              <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                オンチェーン記録: {evalResult.audit.on_chain_status || '記録完了'}
                {evalResult.audit.tx_hash && ` (Tx: ${evalResult.audit.tx_hash.substring(0, 14)}...)`}
              </div>
            </div>
          )}
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {/* Yield / RWA Management Panel */}
          <section className="glass" style={{ padding: '2rem' }}>
            <h3 style={{ fontSize: '1.4rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)' }}>
              <TrendingUp size={24} /> 安全運用 (RWA Allocation)
            </h3>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', background: '#f8fafc', padding: '1rem', borderRadius: '12px' }}>
              <div>
                <div style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}>現在の年間予想利回り (Weighted APY)</div>
                <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--primary)' }}>{yieldData.overall_apy}%</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--color-safe)', fontWeight: 'bold' }}>
                <Lock size={18} /> 安全ロック
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {yieldData.options.map((opt, i) => {
                const allocation = yieldData.recommended_portfolio?.find(p => p.id === opt.id)?.allocation_pct || (i === 0 ? 60 : i === 1 ? 30 : 10);
                return (
                  <div key={opt.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '12px' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '1rem' }}>{opt.name}</div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>利回り: {opt.apy}% | リスク: {opt.risk_profile}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 'bold', fontSize: '1.1rem', color: 'var(--text-main)' }}>{allocation}%</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>配分</div>
                    </div>
                  </div>
                );
              })}
            </div>
            
            <button style={{ width: '100%', marginTop: '1rem', padding: '0.8rem', borderRadius: '12px', border: '1px solid var(--primary)', color: 'var(--primary)', background: 'transparent', fontWeight: 600, cursor: 'pointer' }}>
              ポートフォリオの再配分を提案
            </button>
          </section>

          {/* Family/Guardian Log */}
          <section className="glass" style={{ padding: '2rem' }}>
            <h3 style={{ fontSize: '1.4rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)' }}>
              <Bell size={24} /> 家族通知ログ
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
                <div style={{ background: 'var(--color-alert-bg)', padding: '0.5rem', borderRadius: '50%', height: '40px', width: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <AlertTriangle size={20} color="var(--color-alert)" />
                </div>
                <div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 600 }}>後見人（長男・鈴木健二）へ通知を送信</div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>本日 15:45 | 50.0 USDC の還付金請求の疑い</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <div style={{ background: 'var(--color-safe-bg)', padding: '0.5rem', borderRadius: '50%', height: '40px', width: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CheckCircle size={20} color="var(--color-safe)" />
                </div>
                <div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 600 }}>今月の定期支出（水道光熱費）の安全クリア</div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>2026/07/05 | 自動引き落とし承認完了</div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* On-chain Verdict History */}
      <section className="glass" style={{ padding: '2rem', marginTop: '2rem' }}>
        <h3 style={{ fontSize: '1.4rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)' }}>
          <History size={24} /> オンチェーン判定履歴 (VerdictLog.sol)
        </h3>
        
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '1rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left' }}>
                <th style={{ padding: '1rem', color: 'var(--text-muted)' }}>時間 (Timestamp)</th>
                <th style={{ padding: '1rem', color: 'var(--text-muted)' }}>送金先 (Recipient)</th>
                <th style={{ padding: '1rem', color: 'var(--text-muted)' }}>金額 (Amount)</th>
                <th style={{ padding: '1rem', color: 'var(--text-muted)' }}>判定結果 (Verdict)</th>
                <th style={{ padding: '1rem', color: 'var(--text-muted)' }}>リスクスコア (Score)</th>
                <th style={{ padding: '1rem', color: 'var(--text-muted)' }}>AI解説 (Explanation)</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, index) => (
                <tr key={index} style={{ borderBottom: '1px solid var(--border-color)', hover: { background: '#f8fafc' } }}>
                  <td style={{ padding: '1rem', whiteSpace: 'nowrap' }}>{log.timestamp}</td>
                  <td style={{ padding: '1rem', fontFamily: 'monospace' }}>{log.recipient}</td>
                  <td style={{ padding: '1rem', fontWeight: 600 }}>{log.amount} USDC</td>
                  <td style={{ padding: '1rem' }}>
                    <span style={{ 
                      padding: '0.25rem 0.75rem', 
                      borderRadius: '12px',
                      fontWeight: 'bold',
                      fontSize: '0.9rem',
                      background: log.verdict === 'CLEARED' ? 'var(--color-safe-bg)' : log.verdict === 'FLAGGED' ? 'var(--color-alert-bg)' : 'var(--color-danger-bg)',
                      color: log.verdict === 'CLEARED' ? 'var(--color-safe)' : log.verdict === 'FLAGGED' ? 'var(--color-alert)' : 'var(--color-danger)'
                    }}>
                      {log.verdict}
                    </span>
                  </td>
                  <td style={{ padding: '1rem', fontWeight: 'bold' }}>{log.riskScore}/100</td>
                  <td style={{ padding: '1rem', color: 'var(--text-muted)', fontSize: '0.95rem' }}>
                    <strong>{log.explanation_ja}</strong>
                    <br />
                    <span style={{ fontSize: '0.85rem' }}>{log.explanation}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
