// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CarbonRegistry
 * @notice On-chain registry mapping GitHub repos to their latest carbon scores.
 *         Updated by the CarbonFlow backend after each webhook analysis.
 *         Read by anyone — fully public for transparency.
 */
contract CarbonRegistry is Ownable {

    // ── Types ────────────────────────────────────────────────────────────────
    enum ScoreLabel { GREEN, YELLOW, RED }

    struct RepoScore {
        uint256 energyMicroKwh;   // energy_kwh * 1e6 (avoids floats)
        uint256 carbonNanoKg;     // carbon_kg  * 1e9
        ScoreLabel label;
        uint32  analysisCount;
        uint32  greenCount;
        uint32  yellowCount;
        uint32  redCount;
        uint64  lastUpdatedAt;    // Unix timestamp
        string  lastCommitSha;
    }

    // ── State ────────────────────────────────────────────────────────────────
    /// @dev repoKey = keccak256(repoFullName)
    mapping(bytes32 => RepoScore) private _scores;
    mapping(bytes32 => string)    private _repoNames; // for reverse lookup
    bytes32[]                     private _repoKeys;

    // ── Events ───────────────────────────────────────────────────────────────
    event ScoreUpdated(
        bytes32 indexed repoKey,
        string  repoFullName,
        ScoreLabel label,
        uint256 energyMicroKwh,
        uint64  timestamp
    );

    // ── Constructor ──────────────────────────────────────────────────────────
    constructor(address initialOwner) Ownable(initialOwner) {}

    // ── Write ─────────────────────────────────────────────────────────────────
    /**
     * @notice Record a new carbon score analysis for a repository.
     * @param repoFullName   e.g. "org/repo"
     * @param energyMicroKwh energy_kwh * 1e6
     * @param carbonNanoKg   carbon_kg  * 1e9
     * @param label          0=GREEN, 1=YELLOW, 2=RED
     * @param commitSha      latest analyzed commit
     */
    function recordScore(
        string calldata repoFullName,
        uint256 energyMicroKwh,
        uint256 carbonNanoKg,
        ScoreLabel label,
        string calldata commitSha
    ) external onlyOwner {
        bytes32 key = keccak256(abi.encodePacked(repoFullName));

        if (_scores[key].analysisCount == 0) {
            _repoKeys.push(key);
            _repoNames[key] = repoFullName;
        }

        RepoScore storage s = _scores[key];
        s.energyMicroKwh  = energyMicroKwh;
        s.carbonNanoKg    = carbonNanoKg;
        s.label           = label;
        s.analysisCount  += 1;
        s.lastUpdatedAt   = uint64(block.timestamp);
        s.lastCommitSha   = commitSha;

        if (label == ScoreLabel.GREEN)  s.greenCount  += 1;
        else if (label == ScoreLabel.YELLOW) s.yellowCount += 1;
        else s.redCount += 1;

        emit ScoreUpdated(key, repoFullName, label, energyMicroKwh, uint64(block.timestamp));
    }

    // ── Read ──────────────────────────────────────────────────────────────────
    function getScore(string calldata repoFullName) external view returns (RepoScore memory) {
        return _scores[keccak256(abi.encodePacked(repoFullName))];
    }

    function getScoreByKey(bytes32 key) external view returns (RepoScore memory) {
        return _scores[key];
    }

    function totalRepos() external view returns (uint256) {
        return _repoKeys.length;
    }

    /// @notice Paginated list of all repos (gas-efficient)
    function listRepos(uint256 offset, uint256 limit)
        external view
        returns (string[] memory names, bytes32[] memory keys)
    {
        uint256 end = offset + limit;
        if (end > _repoKeys.length) end = _repoKeys.length;
        uint256 len = end > offset ? end - offset : 0;
        names = new string[](len);
        keys  = new bytes32[](len);
        for (uint256 i = 0; i < len; i++) {
            bytes32 k = _repoKeys[offset + i];
            names[i]  = _repoNames[k];
            keys[i]   = k;
        }
    }
}
