import os
from flask import Flask, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "../.env"))

app = Flask(__name__)
CORS(app)

@app.route("/yield-opportunities", methods=["GET"])
def yield_opportunities():
    """
    Returns available RWA conservative yield opportunities on HSK Chain
    """
    options = [
        {
            "id": "rwa-jgb",
            "name": "Tokenized JGB (Japanese Government Bonds)",
            "apy": 1.25,
            "risk_profile": "Ultra-Low (Safe-Haven)",
            "type": "Government Bonds",
            "currency": "JPY / Tokenized"
        },
        {
            "id": "rwa-ust",
            "name": "Tokenized US Treasury Bills (USD Hedged)",
            "apy": 5.10,
            "risk_profile": "Low (Government backed)",
            "type": "Treasury Bills",
            "currency": "USD / Tokenized"
        },
        {
            "id": "hsk-usdc-yield",
            "name": "HSK USDC.e Stable Yield Vault",
            "apy": 4.50,
            "risk_profile": "Low-Medium (Smart Contract Risk)",
            "type": "Stable Yield",
            "currency": "USDC.e"
        }
    ]
    return jsonify({
        "options": options,
        "recommended_portfolio": [
            {"id": "rwa-jgb", "allocation_pct": 60},
            {"id": "rwa-ust", "allocation_pct": 30},
            {"id": "hsk-usdc-yield", "allocation_pct": 10}
        ],
        "overall_apy": 2.73, # Weighted average APY
        "description": "Omamorai is locked to the most conservative allocation. High risk or speculative yields are excluded."
    })

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "healthy"})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5002)
