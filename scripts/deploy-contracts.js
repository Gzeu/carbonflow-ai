// Hardhat deploy script for CarbonCredit (ERC-20) + CarbonRegistry
// Usage: npx hardhat run scripts/deploy-contracts.js --network <sepolia|mainnet|localhost>

import { ethers } from 'hardhat';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying contracts with account:', deployer.address);
  console.log('Balance:', ethers.formatEther(await deployer.provider.getBalance(deployer.address)), 'ETH');

  // Deploy CarbonCredit ERC-20
  const CarbonCreditFactory = await ethers.getContractFactory('CarbonCredit');
  const carbonCredit = await CarbonCreditFactory.deploy(deployer.address);
  await carbonCredit.waitForDeployment();
  const creditAddress = await carbonCredit.getAddress();
  console.log('CarbonCredit (CCR) deployed to:', creditAddress);

  // Deploy CarbonRegistry
  const CarbonRegistryFactory = await ethers.getContractFactory('CarbonRegistry');
  const carbonRegistry = await CarbonRegistryFactory.deploy(deployer.address);
  await carbonRegistry.waitForDeployment();
  const registryAddress = await carbonRegistry.getAddress();
  console.log('CarbonRegistry deployed to:', registryAddress);

  // Print env vars to add
  console.log('\n── Add to .env ──');
  console.log(`CARBON_CREDIT_ADDRESS=${creditAddress}`);
  console.log(`CARBON_REGISTRY_ADDRESS=${registryAddress}`);
  console.log(`DEPLOYER_PRIVATE_KEY=<your-key>`);

  // Verify instructions
  console.log('\n── Verify on Etherscan ──');
  console.log(`npx hardhat verify --network sepolia ${creditAddress} "${deployer.address}"`);
  console.log(`npx hardhat verify --network sepolia ${registryAddress} "${deployer.address}"`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
