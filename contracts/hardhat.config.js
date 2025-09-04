require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
  solidity: "0.8.20",
  networks: {
    // Use Polygon Amoy Testnet (or any testnet you prefer)
    polygonAmoy: {
      url: process.env.RPC_URL,          // e.g. https://rpc-amoy.polygon.technology
      accounts: [process.env.WALLET_KEY] // 64-char hex, NO 0x prefix
    }
  }
};
