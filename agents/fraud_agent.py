import os
import json
import re
from flask import Flask, request, jsonify
from flask_cors import CORS
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "../.env"))

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
    user = data.get("user", "0x6632B36cBf9ebEc8c4DF8ad37d176C706DAC5F84").lower()
    recipient = data.get("recipient", "").lower()
    amount = float(data.get("amount", 0))
    urgency_text = data.get("urgency_text", data.get("message", ""))
    context = data.get("context", "")
    
    if isinstance(context, dict):
        context = json.dumps(context)

    if not user or not recipient or amount <= 0:
        return jsonify({"error": "Invalid request parameters"}), 400

    # Retrieve history
    stats = get_user_stats(user)
    history = load_history()
    is_known_scam = recipient in history.get("scam_addresses", [])
    is_new_recipient = recipient not in stats["known_recipients"]
    avg_amount = stats["avg_amount"]

    # Call verification agent
    recipient_trust_score = "Unverified — treat with caution"
    try:
        import urllib.request
        import json
        req = urllib.request.Request(
            "http://localhost:5004/verify-address",
            data=json.dumps({"address": recipient}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=3) as r:
            res_data = json.loads(r.read().decode())
            trust_level = res_data.get("trust_level", "UNVERIFIED")
            reason = res_data.get("reason", "")
            recipient_trust_score = f"{trust_level} (Reason: {reason})"
    except Exception as e:
        print(f"Error calling verification agent: {e}")
        
    data["recipient_trust_score"] = recipient_trust_score

    # Craft prompt
    prompt = f"""
You are a financial fraud detection AI protecting an elderly Japanese person from financial scams.

Analyze this payment request carefully for ALL of the following risk factors:

1. URGENCY LANGUAGE — pressure to act immediately, threats, countdown deadlines, "act now or lose everything"
2. AUTHORITY IMPERSONATION — someone claiming to be police, FSA, tax office, bank official, court, government
3. CONTEXT MISMATCH — stated reason doesn't match the nature of the request (e.g. "grocery payment" but sent to unknown overseas address)
4. KNOWN SCAM PATTERNS:
   - Refund/overpayment scams ("we overpaid you, send back the difference")
   - Prize/lottery scams ("you won, pay a small fee to claim")
   - Investment guarantee scams ("guaranteed returns, no risk")
   - Romantic scams ("I love you, please send money")
   - Grandchild impersonation ("grandma it's me, I'm in trouble")
5. ISOLATION TACTICS — "don't tell your family", "this is our secret", "your family won't understand"
6. RECIPIENT TRUST — consider the recipient trust score provided below
7. FEAR OR SHAME TACTICS — threatening arrest, legal action, public embarrassment

Payment details:
- Recipient Address: {data.get('recipient', 'Unknown')}
- Recipient Trust Score: {data.get('recipient_trust_score', 'Unverified — treat with caution')}
- Message / Urgency Text: {data.get('urgency_text', '')}
- Context provided by user: {data.get('context', '')}

Based on all factors above, return your analysis in this exact JSON format:
{{
  "verdict": "BLOCKED" or "FLAGGED" or "CLEARED",
  "risk_score": <integer 0-100>,
  "explanation": "<plain English explanation, simple enough for an 80 year old>",
  "explanation_ja": "<same explanation in simple Japanese>",
  "reasoning": "<brief technical reasoning for audit log>"
}}

Return only the JSON. No preamble, no markdown.
"""

    try:
        model = genai.GenerativeModel(MODEL_NAME)
        
        import google.ai.generativelanguage as glm
        fraud_schema = glm.Schema(
            type=glm.Type.OBJECT,
            properties={
                "verdict": glm.Schema(type=glm.Type.STRING, enum=["CLEARED", "FLAGGED", "BLOCKED"]),
                "risk_score": glm.Schema(type=glm.Type.INTEGER),
                "explanation": glm.Schema(type=glm.Type.STRING),
                "explanation_ja": glm.Schema(type=glm.Type.STRING),
                "reasoning": glm.Schema(type=glm.Type.STRING),
            },
            required=["verdict", "risk_score", "explanation", "explanation_ja", "reasoning"]
        )

        response = model.generate_content(
            prompt,
            generation_config={
                "response_mime_type": "application/json",
                "response_schema": fraud_schema
            }
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
        print(f"Gemini API error: {e}")
        urgency = (data.get('urgency_text', '') or '').lower()
        context = (data.get('context', '') or '').lower()
        combined = urgency + ' ' + context
        
        scam_keywords = [
            # urgency
            'immediately', 'urgent', 'right now', 'hurry', 'deadline', 'expire',
            # authority
            'police', 'fsa', 'tax office', 'court', 'government', 'arrest', 'legal action',
            # isolation
            "don't tell", "dont tell", 'keep secret', 'no one else', 'just between us', 'tell no one',
            # grandchild scam
            "it's me", "its me", 'in trouble', 'please help', 'don\'t tell anyone', 'dont tell anyone',
            # prize/refund
            'you won', 'lottery', 'prize', 'refund', 'overpaid', 'claim your',
            # investment
            'guaranteed', 'no risk', 'double your',
            # fear
            'frozen', 'penalty', 'fine', 'suspended', 'blocked'
        ]
        
        matched = [kw for kw in scam_keywords if kw in combined]
        is_scam = len(matched) > 0
        
        return jsonify({
            'verdict': 'BLOCKED' if is_scam else 'CLEARED',
            'risk_score': 90 if is_scam else 15,
            'explanation': f'Suspicious pattern detected: {", ".join(matched[:3])}. This may be a scam. Do not send money.' if is_scam else 'No suspicious patterns detected.',
            'explanation_ja': '不審なパターンが検出されました。詐欺の可能性があります。送金しないでください。' if is_scam else '不審なパターンは検出されませんでした。',
            'reasoning': f'Keyword fallback (Gemini quota exceeded). Matched: {matched}'
        })

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "healthy"})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001)
