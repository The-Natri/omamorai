import os
import json
import uuid
from flask import Flask, request, jsonify
from flask_cors import CORS
from web3 import Web3
from eth_account import Account
from eth_account.messages import encode_defunct
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "../.env"))

app = Flask(__name__)
CORS(app)

# Load configuration
api_key = os.getenv("GEMINI_API_KEY")
genai.configure(api_key=api_key)
MODEL_NAME = "gemini-flash-latest"

private_key = os.getenv("HSK_PRIVATE_KEY", "f825a569604559a1384b7afd7ace6c48a1d5714dfccbbac6f4f8b8d98fc0b970")
auditor_account = Account.from_key(private_key)
auditor_address = auditor_account.address

# Web3 and HSK Testnet setup
rpc_url = "https://testnet.hsk.xyz"
w3 = Web3(Web3.HTTPProvider(rpc_url))

# Load deployed contract addresses
ADDRESSES_FILE = "../contracts/deployed_addresses.json"

def get_contract_addresses():
    if os.path.exists(ADDRESSES_FILE):
        try:
            with open(ADDRESSES_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "verdictLog": "0x0000000000000000000000000000000000000000",
        "policyVault": "0x0000000000000000000000000000000000000000"
    }

# Minimal VerdictLog ABI
VERDICT_LOG_ABI = [
    {
        "inputs": [
            {"internalType": "address", "name": "user", "type": "address"},
            {"internalType": "address", "name": "recipient", "type": "address"},
            {"internalType": "uint256", "name": "amount", "type": "uint256"},
            {"internalType": "uint8", "name": "riskScore", "type": "uint8"},
            {"internalType": "string", "name": "verdict", "type": "string"},
            {"internalType": "string", "name": "reasoningHash", "type": "string"}
        ],
        "name": "logVerdict",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
]

@app.route("/audit-payment", methods=["POST"])
def audit_payment():
    """
    Independently verifies the payment intent, checks the FraudAgent's verdict,
    signs the verdict, and writes to VerdictLog.sol.
    Input JSON:
    {
      "user": "0x123...",
      "recipient": "0x456...",
      "amount": 150.0,
      "urgency_text": "...",
      "context": "...",
      "fraud_verdict": {
        "verdict": "CLEARED",
        "risk_score": 10,
        "explanation": "...",
        "explanation_ja": "...",
        "reasoning": "..."
      }
    }
    """
    data = request.json or {}
    user = Web3.to_checksum_address(data.get("user", ""))
    recipient = Web3.to_checksum_address(data.get("recipient", ""))
    amount = float(data.get("amount", 0))
    urgency_text = data.get("urgency_text", "")
    context = data.get("context", "")
    fraud_verdict = data.get("fraud_verdict", {})

    if not user or not recipient or amount <= 0 or not fraud_verdict:
        return jsonify({"error": "Invalid request parameters"}), 400

    # 1. Independent Veritas Verification using Gemini
    prompt = f"""
You are the AuditorAgent of Omamorai. Your role is the "Veritas Layer" (independent audit).
You must review a payment intent and decide if the FraudAgent's decision is compliant with safety guidelines.

Payment Details:
- User: {user}
- Recipient: {recipient}
- Amount: {amount} USDC
- Urgency message: "{urgency_text}"
- Context: "{context}"

FraudAgent Verdict:
- Verdict: {fraud_verdict.get("verdict")}
- Risk Score: {fraud_verdict.get("risk_score")}
- Reasoning: "{fraud_verdict.get("reasoning")}"

Is the FraudAgent's decision compliant?
Look for any false negatives (e.g. FraudAgent cleared a highly urgent scam payment or a blacklisted address).
Output a JSON response containing:
- audit_passed: true/false (true if FraudAgent made the correct safe decision, false if it missed a scam).
- recommended_verdict: "CLEARED" / "FLAGGED" / "BLOCKED".
- auditor_reasoning: Short explanation of audit findings.

Do not output any markdown formatting, only raw JSON.
"""

    try:
        model = genai.GenerativeModel(MODEL_NAME)
        response = model.generate_content(
            prompt,
            generation_config={"response_mime_type": "application/json"}
        )
        audit_result = json.loads(response.text)
    except Exception as e:
        print("Gemini AuditorAgent Error:", e)
        # Fallback to approving FraudAgent's decision if Gemini fails
        audit_result = {
            "audit_passed": True,
            "recommended_verdict": fraud_verdict.get("verdict", "FLAGGED"),
            "auditor_reasoning": f"Fallback mode active. Auditor Gemini check failed: {str(e)}"
        }

    # Determine final verdict
    final_verdict = audit_result.get("recommended_verdict", fraud_verdict.get("verdict", "FLAGGED"))
    risk_score = int(fraud_verdict.get("risk_score", 50))
    reasoning = f"FraudAgent reasoning: {fraud_verdict.get('reasoning')}. AuditorAudit: {audit_result.get('auditor_reasoning')}"

    # 2. Cryptographic signature generation
    # Generate unique verdict ID
    import secrets
    verdict_id = secrets.token_bytes(32)
    verdict_id_hex = "0x" + verdict_id.hex()

    # Raw amount representation (assuming USDC.e has 6 decimals)
    amount_raw = int(amount * 10**6)

    # Reconstruct message hash for PolicyVault: keccak256(abi.encodePacked(user, recipient, amount, verdictId, verdict))
    message_hash = Web3.solidity_keccak(
        ['address', 'address', 'uint256', 'bytes32', 'string'],
        [user, recipient, amount_raw, verdict_id, final_verdict]
    )

    signable_message = encode_defunct(primitive=message_hash)
    signed_message = auditor_account.sign_message(signable_message)
    signature_hex = signed_message.signature.hex()

    # 3. Write audit verdict to VerdictLog.sol on-chain
    addresses = get_contract_addresses()
    verdict_log_address = addresses.get("verdictLog")
    tx_hash = ""
    on_chain_status = "Pending"

    if verdict_log_address and verdict_log_address != "0x0000000000000000000000000000000000000000":
        try:
            # Check if web3 is connected
            if w3.is_connected():
                verdict_log_contract = w3.eth.contract(
                    address=Web3.to_checksum_address(verdict_log_address),
                    abi=VERDICT_LOG_ABI
                )

                # Build logging tx (reasoningHash can just be the start of reasoning string for prototype simplicity)
                reasoning_hash = str(uuid.uuid4()) # Mock IPFS CID
                
                # Check gas price
                gas_price = w3.eth.gas_price
                nonce = w3.eth.get_transaction_count(auditor_address)

                tx = verdict_log_contract.functions.logVerdict(
                    user,
                    recipient,
                    amount_raw,
                    risk_score,
                    final_verdict,
                    reasoning_hash
                ).build_transaction({
                    'from': auditor_address,
                    'nonce': nonce,
                    'gas': 250000,
                    'gasPrice': gas_price,
                    'chainId': 133 # HSK Testnet
                })

                signed_tx = w3.eth.account.sign_transaction(tx, private_key=private_key)
                tx_hash_bytes = w3.eth.send_raw_transaction(signed_tx.rawTransaction)
                tx_hash = tx_hash_bytes.hex()
                on_chain_status = "Logged"
                print(f"Logged verdict on-chain. TX Hash: {tx_hash}")
            else:
                on_chain_status = "Skipped - RPC disconnected"
        except Exception as e:
            print("Failed to log verdict on-chain:", e)
            on_chain_status = f"Failed: {str(e)}"
    else:
        on_chain_status = "Skipped - Contract not deployed yet"

    return jsonify({
        "verdict": final_verdict,
        "risk_score": risk_score,
        "verdict_id": verdict_id_hex,
        "signature": signature_hex if signature_hex.startswith("0x") else "0x" + signature_hex,
        "audit_passed": audit_result.get("audit_passed", True),
        "auditor_reasoning": audit_result.get("auditor_reasoning", ""),
        "on_chain_status": on_chain_status,
        "tx_hash": tx_hash
    })

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "healthy"})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5003)
