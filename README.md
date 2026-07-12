# Omamorai (お守りAI)

> On-chain financial guardian for Japan's elderly — AI that protects, not just invests.

## The Problem

In 2025, Japan lost **¥324 billion** to financial fraud. Elderly people were **59.2% of victims** and **51.3% of all fraud cases**. One victim alone lost ¥1.2 billion between Dec 2025–Feb 2026.

Fraud types targeting Japan's elderly:
- Fake police / FSA impersonation with urgency pressure
- Crypto-based money laundering schemes
- Digital payment scams exploiting low financial literacy

The same crypto infrastructure being used to scam them — **we use to protect them instead.**

## What Omamorai Does

Named after **お守り (Omamori)** — the protective shrine charms every elderly Japanese person carries — Omamorai is a multi-agent AI financial guardian built on HSK Chain.

Every payment intent passes through our trust verification pipeline before settlement executes:

1. **VerificationAgent** — Evaluates target address balance and transaction history on HSK Chain via RPC, scoring recipient trust levels (TRUSTED/UNVERIFIED/SUSPICIOUS/BLACKLISTED).
2. **FraudAgent** — Gemini Flash + keyword fallback screens for urgency language, family/grandchild impersonation, isolation tactics, and prize/refund scams.
3. **AuditorAgent** — Independently re-evaluates every decision (Veritas architecture). Cryptographically signs cleared verdicts with ECDSA. Nothing executes without this second layer.
4. **PolicyVault.sol** — Holds user funds. Only releases payment if AuditorAgent's signature is valid and spending limits from GuardianRegistry are respected.
5. **HSP Settlement** — Payment executes via HSP SDK only after all checks pass. Guardian family notification triggered on FLAGGED transactions.

All verdicts written permanently to **VerdictLog.sol** — immutable, queryable by anyone.

## Architecture
```
Payment Intent
      ↓
VerificationAgent (HSK RPC — on-chain recipient trust scoring)
      ↓ TRUSTED / SUSPICIOUS / BLACKLISTED
FraudAgent (Gemini Flash + keyword fallback)
      ↓ CLEARED / FLAGGED / BLOCKED
AuditorAgent (independent ECDSA signing + VerdictLog.sol)
      ↓ signed verdict
PolicyVault.sol (HSK Chain)
      ↓ CLEARED only
HSP Settlement Layer
      ↓
VerdictLog.sol (immutable audit log)
```

## Live Demo Results

**BLOCKED — Scam detected (Risk Score: 95/100):**
- Input: "Please transfer immediately to avoid fee penalties!"
- Verdict: BLOCKED
- Explanation: Real tax offices will never demand immediate cryptocurrency payment. Do not send any funds. Contact your family immediately.
- On-chain: VerdictLog tx logged to HSK Testnet

**SETTLED — HSP payment confirmed:**
- HSP Payment ID: `0xfe9ec2589d1a75c2e06283392ce62cc4b2179154f04da40614ca238ebd501efb`
- HSP Tx Hash:    `0x338d39b22c39e5d7591eb2db889bf6ef8cf524212223634763744c0fe3cd9364`
- HSP Status:     SETTLED

## Deployed Contracts (HSK Testnet, Chain ID 133)

| Contract | Address |
|---|---|
| GuardianRegistry | `0x8ec7DB3062717D5e992D183780d1FD756BF19242` |
| PolicyVault | `0x6D5C4F1592CCdC91cB04A5Ce48F9F328C30936B6` |
| VerdictLog | `0xE3A78c06157CAE17Cc954505adA16181150B31D2` |
| MockUSDC | `0x2cF85E31448BD79E53C6483f24f3E6184c7d4be9` |

> Note: Deployed on HSK Testnet (Chain ID 133). Mainnet deployment pending gas acquisition.

## Tech Stack

| Layer | Technology |
|---|---|
| AI Agents | Python 3.11, Gemini Flash |
| Payment Layer | HSP SDK v1 (wire v1, post June 29 2026) |
| Smart Contracts | Solidity 0.8.25, Hardhat, OpenZeppelin |
| Chain | HSK Chain (testnet 133 / mainnet 177) |
| Frontend | React, Vite, ethers.js |

## Project Structure
```
omamorai/
├── agents/
│   ├── fraud_agent.py        # Gemini fraud screening (port 5001)
│   ├── yield_agent.py        # Conservative RWA allocation (port 5002)
│   ├── auditor_agent.py      # ECDSA signing + on-chain logging (port 5003)
│   └── verification_agent.py # On-chain recipient verification (port 5004)
├── contracts/
│   ├── GuardianRegistry.sol  # User + guardian + spending policy registry
│   ├── PolicyVault.sol       # Fund custody + verdict-gated release
│   ├── VerdictLog.sol        # Immutable on-chain audit trail
│   └── MockUSDC.sol          # Testnet stablecoin
├── hsp-integration/
│   └── hsp/
│       └── examples/
│           └── omamorai-interceptor.ts  # HSP payment interceptor
└── frontend/                 # React dashboard
```

## Setup

```bash
# 1. Smart contracts
cd contracts
npm install
npx hardhat compile
npx hardhat run scripts/deploy.js --network hskTestnet

# 2. AI agents
cd agents
py -3.11 -m venv venv
venv\Scripts\pip install -r requirements.txt
# copy .env.example to .env and fill keys
venv\Scripts\python fraud_agent.py        # port 5001
venv\Scripts\python yield_agent.py        # port 5002
venv\Scripts\python auditor_agent.py      # port 5003
venv\Scripts\python verification_agent.py # port 5004

# 3. HSP interceptor
cd hsp-integration/hsp
npm install
npx tsx examples/omamorai-interceptor.ts

# 4. Frontend
cd frontend
npm install
npm run dev
```

## Environment Variables
```env
HSK_PRIVATE_KEY=your_wallet_private_key
HSK_TESTNET_RPC=https://testnet.hsk.xyz
HSK_MAINNET_RPC=https://mainnet.hsk.xyz
HSP_COORDINATOR_URL=https://hsp-hackathon.hashkeymerchant.com
HSP_API_KEY=your_hsp_api_key
GEMINI_API_KEY=your_gemini_api_key
```

## Hackathon

Built for **HSK Chain Horizon Hackathon · Japan 2026** — AI Track.

## License

MIT
