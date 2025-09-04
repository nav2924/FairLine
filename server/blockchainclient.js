// Non-blocking on-chain logger (Option B). If env is missing, it becomes a no-op.
import { ethers } from "ethers";
import dotenv from "dotenv";
dotenv.config();

const RPC_URL = process.env.RPC_URL || "";
const WALLET_KEY = process.env.WALLET_KEY || "";
const QUEUE_LOGGER_ADDR = process.env.QUEUE_LOGGER_ADDR || "";

const ABI = [
  "function owner() view returns (address)",
  "function log(bytes32 userHash, uint8 evType, uint64 position) external",
  "event QueueEvent(bytes32 indexed userHash, uint8 indexed evType, uint64 position, uint256 timestamp)"
];

let contract = null;

(function init() {
  try {
    if (!RPC_URL || !WALLET_KEY || !QUEUE_LOGGER_ADDR) {
      console.log("[chain] disabled (missing RPC_URL / WALLET_KEY / QUEUE_LOGGER_ADDR)");
      return;
    }
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(WALLET_KEY, provider);
    contract = new ethers.Contract(QUEUE_LOGGER_ADDR, ABI, wallet);
    console.log("[chain] connected to", QUEUE_LOGGER_ADDR, "as", wallet.address);
  } catch (e) {
    console.log("[chain] init error:", e.message);
    contract = null;
  }
})();

// Privacy-safe, deterministic hash for a user/session (no PII).
function userHashFrom(qid, joinedAt) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["string", "uint64"], [qid, BigInt(joinedAt)])
  );
}

// Fire-and-forget (never blocks the hot path).
async function logOnChain(userHashHex, evType, position) {
  if (!contract) return;
  try {
    const tx = await contract.log(userHashHex, evType, BigInt(position));
    console.log("[chain] log tx:", tx.hash);
  } catch (e) {
    console.log("[chain] log error:", e.message);
  }
}

export const chainLogger = {
  // evType: 1=join, 2=admit
  async logJoin({ qid, joinedAt, position }) {
    const userHash = userHashFrom(qid, joinedAt);
    await logOnChain(userHash, 1, position);
  },
  async logAdmit({ qid, joinedAt, position }) {
    const userHash = userHashFrom(qid, joinedAt);
    await logOnChain(userHash, 2, position);
  },
  status() {
    return { enabled: !!contract, addr: QUEUE_LOGGER_ADDR };
  }
};
