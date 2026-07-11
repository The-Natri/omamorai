require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: "../.env" });

// Fallback private key from user inputs
const HSK_PRIVATE_KEY = process.env.HSK_PRIVATE_KEY || "f825a569604559a1384b7afd7ace6c48a1d5714dfccbbac6f4f8b8d98fc0b970";

module.exports = {
  solidity: {
    version: "0.8.25",
    settings: {
      evmVersion: "cancun",
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {},
    hskTestnet: {
      url: "https://testnet.hsk.xyz",
      chainId: 133,
      accounts: [HSK_PRIVATE_KEY],
    },
  },
};
