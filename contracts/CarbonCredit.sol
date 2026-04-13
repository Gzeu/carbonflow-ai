// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title CarbonCredit
 * @notice ERC-20 token representing verified carbon credits earned by green commits.
 *         1 CCR = 1 kg CO2 offset (fractional credits supported, 18 decimals).
 *
 * Mint policy:
 *   - Only the owner (CarbonFlow backend wallet) can mint.
 *   - Mint is triggered off-chain when a green commit is detected by the GitHub App.
 *   - Each mint records the GitHub repo + commit SHA for auditability.
 *
 * Burn (offset):
 *   - Any holder can burn their own tokens to register a carbon offset.
 *   - Emits CarbonOffset event for on-chain transparency.
 */
contract CarbonCredit is ERC20, Ownable, Pausable {

    // ── Events ──────────────────────────────────────────────────────────────
    event CreditMinted(
        address indexed recipient,
        uint256 amount,
        string  repoFullName,
        string  commitSha,
        uint256 energySaved  // in micro-kWh (energy_kwh * 1e6)
    );

    event CarbonOffset(
        address indexed account,
        uint256 amount,
        string  reason
    );

    // ── State ────────────────────────────────────────────────────────────────
    /// @notice Maximum supply cap: 1 billion CCR (1e9 * 1e18)
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 1e18;

    /// @dev Tracks mint metadata per commit SHA to prevent double-minting
    mapping(bytes32 => bool) public mintedCommits;

    // ── Constructor ──────────────────────────────────────────────────────────
    constructor(address initialOwner)
        ERC20("CarbonCredit", "CCR")
        Ownable(initialOwner)
    {}

    // ── Mint ─────────────────────────────────────────────────────────────────
    /**
     * @notice Mint carbon credits for a verified green commit.
     * @param recipient     Wallet address to receive credits (repo owner/contributor).
     * @param amount        Amount in wei (1e18 = 1 CCR = 1 kg CO2 offset).
     * @param repoFullName  GitHub repo, e.g. "org/repo".
     * @param commitSha     Full 40-char commit SHA.
     * @param energySavedMicroKwh  Energy saved, expressed as energy_kwh * 1e6.
     */
    function mintCredit(
        address recipient,
        uint256 amount,
        string calldata repoFullName,
        string calldata commitSha,
        uint256 energySavedMicroKwh
    ) external onlyOwner whenNotPaused {
        require(recipient != address(0), "CCR: zero address");
        require(amount > 0, "CCR: zero amount");
        require(totalSupply() + amount <= MAX_SUPPLY, "CCR: supply cap exceeded");

        bytes32 commitKey = keccak256(abi.encodePacked(repoFullName, commitSha));
        require(!mintedCommits[commitKey], "CCR: commit already minted");
        mintedCommits[commitKey] = true;

        _mint(recipient, amount);
        emit CreditMinted(recipient, amount, repoFullName, commitSha, energySavedMicroKwh);
    }

    // ── Burn / Offset ─────────────────────────────────────────────────────────
    /**
     * @notice Burn your own credits to register a carbon offset.
     * @param amount  Amount to burn (in wei).
     * @param reason  Human-readable offset reason (e.g. "Q1 2026 CI operations").
     */
    function offsetCarbon(uint256 amount, string calldata reason) external whenNotPaused {
        require(amount > 0, "CCR: zero amount");
        _burn(msg.sender, amount);
        emit CarbonOffset(msg.sender, amount, reason);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────
    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
