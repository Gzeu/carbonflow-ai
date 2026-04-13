# CarbonFlow Smart Contracts

Solidity contracts for on-chain carbon credit management.

## Contracts

### `CarbonCredit.sol` — ERC-20 Token (CCR)
- Symbol: `CCR` | Decimals: 18 | Cap: 1B CCR
- **Mint**: Owner only, one mint per commit SHA (prevents double-minting)
- **Burn**: Any holder can burn to register a carbon offset
- Events: `CreditMinted`, `CarbonOffset`

### `CarbonRegistry.sol` — On-chain Score Registry
- Stores latest carbon score per GitHub repo
- Fully public read — transparent on-chain history
- Paginated `listRepos()` for gas-efficient enumeration
- Events: `ScoreUpdated`

## Setup

```bash
npm install --save-dev hardhat @openzeppelin/contracts
npx hardhat compile
npx hardhat run scripts/deploy-contracts.js --network sepolia
```

## Environment Variables

```env
CARBON_CREDIT_ADDRESS=0x...
CARBON_REGISTRY_ADDRESS=0x...
DEPLOYER_PRIVATE_KEY=0x...
ETH_RPC_URL=https://sepolia.infura.io/v3/<key>
```

## Hardhat Config (`hardhat.config.js`)

```js
import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';

const config: HardhatUserConfig = {
  solidity: '0.8.24',
  networks: {
    sepolia: {
      url: process.env.ETH_RPC_URL,
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
    },
  },
};
export default config;
```

## Integration cu Webhook

În `api/webhooks.js`, după `persistScore()`, adaugă:

```js
if (label === 'green' && process.env.CARBON_CREDIT_ADDRESS) {
  await mintCarbonCredit({
    recipient: repoOwnerWallet,
    amount: ethers.parseUnits('0.1', 18), // 0.1 CCR per green commit
    repoFullName,
    commitSha,
    energySavedMicroKwh: Math.round(energySaved * 1e6),
  });
}
```
