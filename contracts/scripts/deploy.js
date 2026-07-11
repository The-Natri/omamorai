const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // 1. Deploy MockUSDC
  const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
  const mockUSDC = await MockUSDC.deploy();
  await mockUSDC.waitForDeployment();
  const mockUSDCAddress = await mockUSDC.getAddress();
  console.log("MockUSDC deployed to:", mockUSDCAddress);

  // 2. Deploy GuardianRegistry
  const GuardianRegistry = await hre.ethers.getContractFactory("GuardianRegistry");
  const guardianRegistry = await GuardianRegistry.deploy();
  await guardianRegistry.waitForDeployment();
  const guardianRegistryAddress = await guardianRegistry.getAddress();
  console.log("GuardianRegistry deployed to:", guardianRegistryAddress);

  // 3. Deploy VerdictLog
  const VerdictLog = await hre.ethers.getContractFactory("VerdictLog");
  const verdictLog = await VerdictLog.deploy();
  await verdictLog.waitForDeployment();
  const verdictLogAddress = await verdictLog.getAddress();
  console.log("VerdictLog deployed to:", verdictLogAddress);

  // 4. Deploy PolicyVault
  // The agent signer is the deployer account for now
  const agentSigner = deployer.address;
  const PolicyVault = await hre.ethers.getContractFactory("PolicyVault");
  const policyVault = await PolicyVault.deploy(
    mockUSDCAddress,
    guardianRegistryAddress,
    agentSigner
  );
  await policyVault.waitForDeployment();
  const policyVaultAddress = await policyVault.getAddress();
  console.log("PolicyVault deployed to:", policyVaultAddress);

  // Authorize PolicyVault in GuardianRegistry or set logger (in VerdictLog)
  // Let's authorize the deployer/agent and PolicyVault to log verdicts
  console.log("Authorizing loggers...");
  const tx1 = await verdictLog.setLogger(agentSigner, true);
  await tx1.wait();
  const tx2 = await verdictLog.setLogger(policyVaultAddress, true);
  await tx2.wait();
  console.log("VerdictLog loggers authorized.");

  // Save the addresses
  const addresses = {
    network: hre.network.name,
    chainId: hre.network.config.chainId,
    mockUSDC: mockUSDCAddress,
    guardianRegistry: guardianRegistryAddress,
    verdictLog: verdictLogAddress,
    policyVault: policyVaultAddress,
    agentSigner: agentSigner
  };

  const outputPath = path.join(__dirname, "../deployed_addresses.json");
  fs.writeFileSync(outputPath, JSON.stringify(addresses, null, 2));
  console.log("Saved deployed addresses to:", outputPath);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
