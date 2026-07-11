import os
import json
import re
from flask import Flask, request, jsonify
from flask_cors import CORS
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv(dotenv_path="../.env")

app = Flask(__name__)
CORS(app)

# Configure Gemini
api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise ValueError("GEMINI_API_KEY is not set in the environment variables.")
genai.configure(api_key=api_key)

# We use gemini-flash-latest as the stable production model name
MODEL_NAME = "gemini-flash-latest"

# Local transaction history database for tracking averages and known recipients
HISTORY_FILE = "history.json"

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
            "0x5555555555555555555555555555555555555555", # Example flagged scam address
            "0x9999999999999999999999999999999999999999"
        ]
    }

def save_history(history):
    with open(HISTORY_FILE, "w") as f:
        json.dump(history, f, indent=4)

def update_user_history(user_address, recipient, amount):
    history = load_history()
    if user_address not in history["users"]:
        history["users"][user_address] = {
            "transactions": [],
            "known_recipients": []
        }
    
    user_data = history["users"][user_address]
    user_data["transactions"].append(amount)
    
    if recipient not in user_data["known_recipients"]:
        user_data["known_recipients"].append(recipient)
        
    save_history(history)

def get_user_stats(user_address):
    history = load_history()
    if user_address not in history["users"] or not history["users"][user_address]["transactions"]:
        return {
            "avg_amount": 50.0, # default $50 / 50 USDC
            "known_recipients": []
        }
    
    txs = history["users"][user_address]["transactions"]
    avg_amount = sum(txs) / len(txs)
    return {
        "avg_amount": avg_amount,
        "known_recipients": history["users"][user_address]["known_recipients"]
    }

@app.route("/check-fraud", methods=["POST"])
def check_fraud():
    """
    Exposes fraud screening.
    Input JSON:
    {
      "user": "0x123...",
      "recipient": "0x456...",
      "amount": 150.0,
      "urgency_text": "Please transfer 150 USDC immediately to update your account, or it will be frozen.",
      "context": "Received a call from someone claiming to be FSA (Financial Services Agency) staff."
    }
    """
    data = request.json or {}
    user = data.get("user", "").lower()
    recipient = data.get("recipient", "").lower()
    amount = float(data.get("amount", 0))
    urgency_text = data.get("urgency_text", "")
    context = data.get("context", "")

    if not user or not recipient or amount <= 0:
        return jsonify({"error": "Invalid request parameters"}), 400

    # Retrieve history
    stats = get_user_stats(user)
    history = load_history()
    is_known_scam = recipient in history.get("scam_addresses", [])
    is_new_recipient = recipient not in stats["known_recipients"]
    avg_amount = stats["avg_amount"]

    # Craft prompt
    prompt = f"""
You are the AI engine of Omamorai, a financial guardian for Japan's elderly.
Analyze this payment intent for potential fraud.

User Wallet: {user}
Recipient: {recipient}
Amount: {amount} USDC
Urgency/Message from Recipient: "{urgency_text}"
Context/Details of transaction: "{context}"

Security Parameters from History:
- User's average transaction size: {avg_amount:.2f} USDC
- Recipient is new (never paid before): {is_new_recipient}
- Recipient is a known blacklisted scam address: {is_known_scam}

Analysis guidelines:
1. Urgency Pressure: Look for urgent, threatening language like "transfer now", "frozen", "police", "arrest", "FSA", "tax agency", "emergency".
2. Anomalies: Amount is significantly larger (> 2x) than average transaction size.
3. Impersonation: Ore Ore ("it's me") family emergencies, official government/police pressure.
4. Scam Blacklist: If blacklisted, verdict MUST be BLOCKED.

You must output a single JSON response with the following fields:
- verdict: "CLEARED" (safe), "FLAGGED" (suspicious or large, requires guardian), or "BLOCKED" (very high risk or known scam).
- risk_score: integer from 0 to 100 representing the risk.
- explanation: A clear, friendly explanation in English for the elderly user.
- explanation_ja: A very polite, soft, clear Japanese explanation for the elderly user (using polite Keigo, explaining safety actions).
- reasoning: A detailed technical reason in English outlining why this decision was reached.

Do not output any markdown formatting or extra text outside the JSON block.
"""

    try:
        model = genai.GenerativeModel(MODEL_NAME)
        response = model.generate_content(
            prompt,
            generation_config={"response_mime_type": "application/json"}
        )
        
        result = json.loads(response.text)
        
        # If database check overrides, force BLOCKED
        if is_known_scam:
            result["verdict"] = "BLOCKED"
            result["risk_score"] = max(result.get("risk_score", 0), 95)
            result["reasoning"] = "Recipient is listed on the on-chain scam blacklist database. " + result.get("reasoning", "")
            result["explanation_ja"] = "この送金先アドレスは詐欺アドレスとして登録されているため、送金をブロックしました。"
        
        # If cleared or flagged, save to history for next time (once it gets processed/settled)
        # Note: We will record to actual history when the client confirms settlement.
        
        return jsonify(result)
        
    except Exception as e:
        print("Gemini FraudAgent Error:", e)
        # Safe fallback: Flag if API fails
        return jsonify({
            "verdict": "FLAGGED",
            "risk_score": 50,
            "explanation": "Security check is temporarily offline. Guardian authorization requested.",
            "explanation_ja": "セキュリティ確認システムが一時的にオフラインです。安全のため、ご家族の承認が必要です。",
            "reasoning": f"Gemini API failure: {str(e)}"
        })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001)
