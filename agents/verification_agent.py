import os
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
from web3 import Web3
from dotenv import load_dotenv

# Load env variables
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "../.env"))

app = Flask(__name__)
CORS(app)

RPC_URL = "https://testnet.hsk.xyz"
w3 = Web3(Web3.HTTPProvider(RPC_URL))

HISTORY_FILE = os.path.join(os.path.dirname(__file__), "history.json")

def load_history():
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "users": {},
        "scam_addresses": [
            "0x5555555555555555555555555555555555555555",
            "0x9999999999999999999999999999999999999999"
        ]
    }

def score_balance(balance_wei: int) -> int:
    hsk_balance = balance_wei / 10**18
    if hsk_balance <= 0:
        return 0
    if hsk_balance < 1:
        return 5
    if hsk_balance < 10:
        return 15
    if hsk_balance < 100:
        return 25
    return 30

def score_deploy_count(count: int) -> int:
    if count == 0:
        return 0
    if count <= 2:
        return 10
    if count <= 5:
        return 20
    if count <= 15:
        return 30
    return 35

def score_age(count: int) -> int:
    # Estimate account age score from transaction count (nonce) to adapt Casper's age score
    if count == 0:
        return 0
    if count <= 2:
        return 5
    if count <= 5:
        return 15
    if count <= 15:
        return 25
    return 35

@app.route("/verify-address", methods=["POST"])
def verify_address():
    data = request.json or {}
    address = data.get("address", "").strip()
    
    if not address:
        return jsonify({"error": "Missing address parameter"}), 400
        
    # Standardize address
    try:
        checksum_address = w3.to_checksum_address(address)
        clean_address = checksum_address.lower()
    except Exception:
        return jsonify({"error": "Invalid EVM address format"}), 400

    # 1. Check blacklist
    history = load_history()
    blacklist = [addr.lower() for addr in history.get("scam_addresses", [])]
    if clean_address in blacklist:
        return jsonify({
            "trust_level": "BLACKLISTED",
            "risk": 100,
            "reason": "Address is listed on the on-chain scam blacklist database."
        })

    balance_pts, deploy_pts, age_pts = 0, 0, 0
    balance_hsk = 0.0
    tx_count = 0
    errors = []
    
    # Check if connected
    if not w3.is_connected():
        # Fallback if RPC is down
        return jsonify({
            "trust_level": "UNVERIFIED",
            "risk": 50,
            "reason": "Unable to connect to HSK Chain node. Address status is unverified."
        })

    try:
        balance_wei = w3.eth.get_balance(checksum_address)
        balance_hsk = balance_wei / 10**18
        balance_pts = score_balance(balance_wei)
    except Exception as e:
        errors.append(f"Balance check failed: {e}")
        balance_pts = 0

    try:
        tx_count = w3.eth.get_transaction_count(checksum_address)
        deploy_pts = score_deploy_count(tx_count)
        age_pts = score_age(tx_count)
    except Exception as e:
        errors.append(f"Transaction count check failed: {e}")
        deploy_pts = 0
        age_pts = 0

    total_score = balance_pts + deploy_pts + age_pts
    
    # Determine trust level and risk based on score
    if total_score < 25:
        trust_level = "SUSPICIOUS"
        risk = 80
        reason = f"Address has high risk signals (Score: {total_score}/100). Balance: {balance_hsk:.4f} HSK, Outgoing Tx Count: {tx_count}."
    elif total_score < 60:
        trust_level = "UNVERIFIED"
        risk = 45
        reason = f"Address is unverified with moderate signals (Score: {total_score}/100). Balance: {balance_hsk:.4f} HSK, Outgoing Tx Count: {tx_count}."
    else:
        trust_level = "TRUSTED"
        risk = 10
        reason = f"Address is verified with strong history (Score: {total_score}/100). Balance: {balance_hsk:.4f} HSK, Outgoing Tx Count: {tx_count}."

    return jsonify({
        "trust_level": trust_level,
        "risk": risk,
        "reason": reason
    })

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "healthy"})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5004)
