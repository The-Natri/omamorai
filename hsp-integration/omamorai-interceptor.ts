import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { ethers } from 'ethers';
import { resolveChain } from '../packages/core/src/chains/index';
import { HSPClient } from '../packages/sdk/src/client';
import * as dotenv from 'dotenv';

// Load .env
dotenv.config({ path: path.resolve('../../.env') });

const HSK_PRIVATE_KEY = process.env.HSK_PRIVATE_KEY || '';
const HSP_COORDINATOR_URL = process.env.HSP_COORDINATOR_URL || 'https://hsp-hackathon.hashkeymerchant.com';
const HSP_API_KEY = process.env.HSP_API_KEY || '';
const HSP_CHAIN = process.env.HSP_CHAIN || 'hashkey-testnet';

// ABI definitions
const POLICY_VAULT_ABI = [
  'function executePayment(address user, address recipient, uint256 amount, bytes32 verdictId, string verdict, bytes agentSignature) external',
  'function executeFlaggedPayment(address user, address recipient, uint256 amount, bytes32 verdictId, bytes agentSignature, bytes guardianSignature) external',
  'function deposit(uint256 amount) external',
  'function balances(address user) view returns (uint256)',
  'function token() view returns (address)'
];

const GUARDIAN_REGISTRY_ABI = [
  'function registerUser(address _guardian, uint256 _maxPerTx, uint256 _dailyLimit, address[] _allowedRecipients) external',
  'function checkPolicy(address user, address recipient, uint256 amount) view returns (bool isValid, string reason)',
  'function policies(address user) view returns (address guardian, uint256 maxPerTx, uint256 dailyLimit, bool isRegistered)'
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function mint(address to, uint256 amount) external'
];

async function main() {
  console.log('=== Omamorai HSP Payment Interceptor ===');

  if (!HSK_PRIVATE_KEY) {
    console.error('Error: HSK_PRIVATE_KEY is not defined in .env');
    return;
  }

  // Set up provider & signer
  const provider = new ethers.JsonRpcProvider('https://testnet.hsk.xyz');
  const userSigner = new ethers.Wallet(HSK_PRIVATE_KEY, provider);
  console.log(`User/Deployer Address: ${userSigner.address}`);

  // Load deployed addresses
  const addressesPath = path.resolve('../../contracts/deployed_addresses.json');
  if (!fs.existsSync(addressesPath)) {
    console.error(`Error: Deployed addresses file not found at ${addressesPath}. Please run deploy.js first.`);
    return;
  }
  const addresses = JSON.parse(fs.readFileSync(addressesPath, 'utf8'));
  console.log('Loaded deployed contract addresses:');
  console.log(JSON.stringify(addresses, null, 2));

  const mockUSDCAddress = addresses.mockUSDC;
  const guardianRegistryAddress = addresses.guardianRegistry;
  const policyVaultAddress = addresses.policyVault;

  const vault = new ethers.Contract(policyVaultAddress, POLICY_VAULT_ABI, userSigner);
  const registry = new ethers.Contract(guardianRegistryAddress, GUARDIAN_REGISTRY_ABI, userSigner);
  const usdc = new ethers.Contract(mockUSDCAddress, ERC20_ABI, userSigner);

  // Initialize simulated payment intent
  const recipient = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'; // Example recipient (Hardhat signers[1])
  const amount = 50.0; // 50 USDC.e
  const urgencyText = 'Please transfer immediately to avoid fee penalties!';
  const context = 'User received a text alert claiming unpaid tax bills.';

  console.log(`\nNew Payment Intent:`);
  console.log(`- From: ${userSigner.address}`);
  console.log(`- To: ${recipient}`);
  console.log(`- Amount: ${amount} USDC.e`);
  console.log(`- Text: "${urgencyText}"`);

  // Step 1: Call FraudAgent Python service (running on port 5001)
  console.log('\n[1/4] Screening payment intent via FraudAgent...');
  let fraudResult;
  try {
    const res = await axios.post('http://localhost:5001/check-fraud', {
      user: userSigner.address,
      recipient,
      amount,
      urgency_text: urgencyText,
      context
    });
    fraudResult = res.data;
  } catch (error: any) {
    console.warn('FraudAgent check failed. Using secure fallback (FLAGGED).');
    fraudResult = {
      verdict: 'FLAGGED',
      risk_score: 50,
      explanation: 'Secure fallback active.',
      reasoning: 'Could not connect to FraudAgent: ' + error.message
    };
  }

  console.log(`- Verdict: ${fraudResult.verdict}`);
  console.log(`- Risk Score: ${fraudResult.risk_score}/100`);
  console.log(`- Explanation: ${fraudResult.explanation}`);

  // Step 2: Call AuditorAgent Python veritas layer (running on port 5003)
  console.log('\n[2/4] Verifying and signing verdict via AuditorAgent...');
  let auditResult;
  try {
    const res = await axios.post('http://localhost:5003/audit-payment', {
      user: userSigner.address,
      recipient,
      amount,
      urgency_text: urgencyText,
      context,
      fraud_verdict: fraudResult
    });
    auditResult = res.data;
  } catch (error: any) {
    console.error('AuditorAgent connection failed. Cannot proceed with signed flow.');
    return;
  }

  console.log(`- Final Verdict: ${auditResult.verdict}`);
  console.log(`- Verdict ID: ${auditResult.verdict_id}`);
  console.log(`- Signature: ${auditResult.signature.substring(0, 20)}...`);
  console.log(`- On-chain status: ${auditResult.on_chain_status}`);

  if (auditResult.verdict === 'BLOCKED') {
    console.log('\n❌ Transaction BLOCKED by Omamorai AI Guardian.');
    return;
  }

  // Check vault balance and deposit/mint if needed
  const rawAmount = ethers.parseUnits(amount.toString(), 6);
  const balance = await vault.balances(userSigner.address);
  console.log(`- User Vault Balance: ${ethers.formatUnits(balance, 6)} USDC.e`);

  if (balance < rawAmount) {
    console.log(`Vault balance is low. Depositing USDC.e...`);
    // Mint mock tokens first if balance is low
    const usdcBalance = await usdc.balanceOf(userSigner.address);
    if (usdcBalance < rawAmount) {
      console.log('Minting mock USDC.e tokens...');
      const mintTx = await usdc.mint(userSigner.address, rawAmount * 10n);
      await mintTx.wait();
    }
    // Approve and deposit
    const approveTx = await usdc.approve(policyVaultAddress, rawAmount * 10n);
    await approveTx.wait();
    const depositTx = await vault.deposit(rawAmount);
    await depositTx.wait();
    console.log(`Deposited ${amount} USDC.e to PolicyVault.`);
  }

  // Step 3: Enforce on-chain execution
  if (auditResult.verdict === 'CLEARED') {
    console.log('\n[3/4] Executing CLEARED payment on-chain via PolicyVault...');
    try {
      const tx = await vault.executePayment(
        userSigner.address,
        recipient,
        rawAmount,
        auditResult.verdict_id,
        auditResult.verdict,
        auditResult.signature
      );
      console.log(`- Vault transaction submitted! Hash: ${tx.hash}`);
      await tx.wait();
      console.log('- Vault transaction confirmed!');
    } catch (e: any) {
      console.error('Vault execution failed:', e.message);
      return;
    }
  } else if (auditResult.verdict === 'FLAGGED') {
    console.log('\n[3/4] FLAGGED payment requires Guardian/Family authorization.');
    console.log('Simulating family notification... Sent push alert to Guardian wallet.');

    // In this simulation, we will sign a guardian authorization message using the user's key
    // representing the Guardian's consent.
    // In production, the Guardian registry maps a different guardian address. For this test,
    // we can retrieve the registered guardian or set the user wallet itself as the guardian
    // to bypass the check.
    const policy = await registry.policies(userSigner.address);
    const guardianAddress = policy.guardian;
    console.log(`Registered Guardian Address: ${guardianAddress}`);

    if (guardianAddress.toLowerCase() !== userSigner.address.toLowerCase()) {
      console.log(`Warning: Guardian is not the user. To simulate, please register yourself as the guardian.`);
      console.log(`We will register the user as their own guardian for this test run.`);
      
      const updateTx = await registry.updatePolicy(
        userSigner.address,
        userSigner.address, // guardian is user
        rawAmount * 2n,     // max tx
        rawAmount * 10n,    // daily limit
        []                  // allowlist
      );
      await updateTx.wait();
      console.log('Updated Guardian registry to register user as guardian.');
    }

    console.log('Signing Guardian approval hash...');
    const messageHash = ethers.solidityPackedKeccak256(
      ['address', 'address', 'uint256', 'bytes32', 'string'],
      [userSigner.address, recipient, rawAmount, auditResult.verdict_id, 'GUARDIAN_APPROVED']
    );
    const messageBytes = ethers.getBytes(messageHash);
    const guardianSignature = await userSigner.signMessage(messageBytes);
    console.log(`Guardian Signature generated.`);

    console.log('Submitting flagged payment bypass with guardian signature...');
    try {
      const tx = await vault.executeFlaggedPayment(
        userSigner.address,
        recipient,
        rawAmount,
        auditResult.verdict_id,
        auditResult.signature,
        guardianSignature
      );
      console.log(`- Vault flagged execution tx: ${tx.hash}`);
      await tx.wait();
      console.log('- Flagged payment successfully bypassed with Guardian approval!');
    } catch (e: any) {
      console.error('Flagged execution failed:', e.message);
      return;
    }
  }

  // Step 4: HSP Settlement Layer Execution
  console.log('\n[4/4] Triggering HSP Settlement Layer...');
  try {
    // Resolve the chain and set override for our mock token
    const chain = resolveChain(HSP_CHAIN as any, {
      stablecoin: {
        address: '0x8FE3cB719Ee4410E236Cd6b72ab1fCDC06eF53c6',
        symbol: 'USDC.e',
        decimals: 6
      }
    });

    const hsp = new HSPClient({
      coordinatorUrl: HSP_COORDINATOR_URL,
      signer: { kind: 'privateKey', privateKey: (HSK_PRIVATE_KEY.startsWith('0x') ? HSK_PRIVATE_KEY : '0x' + HSK_PRIVATE_KEY) as any },
      chain,
      ...(HSP_API_KEY ? { apiKey: HSP_API_KEY } : {})
    });

    // Ensure user client wallet is funded with MockUSDC
    console.log('Submitting settlement pay mandate to HSP Coordinator...');
    const handle = await hsp.pay({
      to: recipient as any,
      amount: hsp.parseAmount(amount.toString())
    });

    console.log(`- HSP Payment ID: ${handle.paymentId}`);
    console.log(`- HSP Tx Hash: ${handle.txHash}`);
    console.log(`- HSP Status: ${handle.status}`);

    const finalSnap = await handle.awaitSettled();
    console.log(`- HSP Final Settlement Status: ${finalSnap.status}`);
  } catch (error: any) {
    console.warn(`HSP Settlement Layer call completed with warning (usually due to coordinator offline / sandbox limits): ${error.message}`);
  }

  console.log('\n=== Omamorai Payment Pipeline Finished! ===');
}

main().catch(console.error);
