const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Registering user policy with account:", deployer.address);

  // Load deployed addresses
  const addressesPath = path.join(__dirname, "../deployed_addresses.json");
  if (!fs.existsSync(addressesPath)) {
    throw new Error("deployed_addresses.json not found");
  }
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));

  const GuardianRegistry = await hre.ethers.getContractFactory("GuardianRegistry");
  const registry = GuardianRegistry.attach(addresses.guardianRegistry);

  // Define policy
  const guardian = deployer.address; // Guardian is user itself for easy prototype testing
  const maxPerTx = hre.ethers.parseUnits("100", 6); // 100 USDC.e max per tx
  const dailyLimit = hre.ethers.parseUnits("1000", 6); // 1000 USDC.e daily limit
  const allowedRecipients = []; // Empty = any recipient is allowed but checked by limits

  // Check if registered
  const policy = await registry.policies(deployer.address);
  if (policy.isRegistered) {
    console.log("User already registered. Updating policy...");
    const tx = await registry.updatePolicy(
      deployer.address,
      guardian,
      maxPerTx,
      dailyLimit,
      allowedRecipients
    );
    await tx.wait();
    console.log("Policy updated successfully.");
  } else {
    console.log("Registering new user policy...");
    const tx = await registry.registerUser(
      guardian,
      maxPerTx,
      dailyLimit,
      allowedRecipients
    );
    await tx.wait();
    console.log("User policy registered successfully.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
