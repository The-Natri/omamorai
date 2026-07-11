// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract VerdictLog is Ownable {
    struct Verdict {
        uint256 timestamp;
        address user;
        address recipient;
        uint256 amount;
        uint8 riskScore;
        string verdict; // "CLEARED", "FLAGGED", "BLOCKED"
        string reasoningHash; // IPFS hash or IPFS CID containing details
    }

    // Mapping from user address to their verdict logs
    mapping(address => Verdict[]) private userVerdicts;

    // All verdicts list
    Verdict[] private allVerdicts;

    // Authorized loggers (e.g. AuditorAgent address)
    mapping(address => bool) public authorizedLoggers;

    event VerdictLogged(
        address indexed user,
        address indexed recipient,
        uint256 amount,
        uint8 riskScore,
        string verdict,
        string reasoningHash
    );
    event LoggerAuthorized(address indexed logger, bool authorized);

    error NotAuthorizedLogger();

    modifier onlyLogger() {
        if (!authorizedLoggers[msg.sender] && msg.sender != owner()) {
            revert NotAuthorizedLogger();
        }
        _;
    }

    constructor() Ownable(msg.sender) {
        authorizedLoggers[msg.sender] = true;
    }

    /**
     * @notice Authorizes or deauthorizes a logger address.
     */
    function setLogger(address logger, bool authorized) external onlyOwner {
        authorizedLoggers[logger] = authorized;
        emit LoggerAuthorized(logger, authorized);
    }

    /**
     * @notice Logs a new verdict on-chain.
     */
    function logVerdict(
        address user,
        address recipient,
        uint256 amount,
        uint8 riskScore,
        string calldata verdict,
        string calldata reasoningHash
    ) external onlyLogger {
        Verdict memory newVerdict = Verdict({
            timestamp: block.timestamp,
            user: user,
            recipient: recipient,
            amount: amount,
            riskScore: riskScore,
            verdict: verdict,
            reasoningHash: reasoningHash
        });

        userVerdicts[user].push(newVerdict);
        allVerdicts.push(newVerdict);

        emit VerdictLogged(user, recipient, amount, riskScore, verdict, reasoningHash);
    }

    /**
     * @notice Get all verdicts logged for a specific user.
     */
    function getUserVerdicts(address user) external view returns (Verdict[] memory) {
        return userVerdicts[user];
    }

    /**
     * @notice Get total verdicts count.
     */
    function getVerdictsCount() external view returns (uint256) {
        return allVerdicts.length;
    }

    /**
     * @notice Get all verdicts in a range (for pagination).
     */
    function getVerdicts(uint256 offset, uint256 limit) external view returns (Verdict[] memory) {
        uint256 total = allVerdicts.length;
        if (offset >= total) {
            return new Verdict[](0);
        }

        uint256 size = limit;
        if (offset + limit > total) {
            size = total - offset;
        }

        Verdict[] memory range = new Verdict[](size);
        for (uint256 i = 0; i < size; i++) {
            range[i] = allVerdicts[offset + i];
        }
        return range;
    }
}
