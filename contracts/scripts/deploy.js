require("dotenv").config();
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const Factory = await hre.ethers.getContractFactory("QueueLogger");
  const contract = await Factory.deploy(deployer.address);
  await contract.waitForDeployment();

  console.log("QueueLogger deployed:", await contract.getAddress());
}

main().catch((e) => { console.error(e); process.exit(1); });
