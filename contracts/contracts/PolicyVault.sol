// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IGuardianRegistry {
    function checkPolicy(
        address user,
        address recipient,
        uint256 amount
    ) external view returns (bool isValid, string memory reason);

    function recordSpending(address user, uint256 amount) external;

    function policies(address user) external view returns (
        address guardian,
        uint256 maxPerTx,
        uint256 dailyLimit,
        bool isRegistered
    );
}

contract PolicyVault is Ownable {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    IERC20 public immutable token;
    IGuardianRegistry public immutable registry;

    // Authorized agent address (AuditorAgent / FraudAgent)
    address public agentSigner;

    // Track user balances: userAddress => balance
    mapping(address => uint256) public balances;

    // Track processed verdict IDs to prevent replay attacks
    mapping(bytes32 => bool) public processedVerdicts;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event PaymentExecuted(
        address indexed user,
        address indexed recipient,
        uint256 amount,
        bytes32 indexed verdictId,
        string verdict
    );
    event AgentSignerUpdated(address indexed newSigner);

    error InvalidSignature();
    error VerdictAlreadyProcessed();
    error PolicyViolation(string reason);
    error InsufficientBalance();
    error NotGuardian();
    error NotCleared();

    constructor(
        address _token,
        address _registry,
        address _agentSigner
    ) Ownable(msg.sender) {
        token = IERC20(_token);
        registry = IGuardianRegistry(_registry);
        agentSigner = _agentSigner;
    }

    /**
     * @notice Set the authorized agent signer address.
     */
    function setAgentSigner(address _agentSigner) external onlyOwner {
        agentSigner = _agentSigner;
        emit AgentSignerUpdated(_agentSigner);
    }

    /**
     * @notice Deposit tokens into the vault.
     */
    function deposit(uint256 amount) external {
        token.safeTransferFrom(msg.sender, address(this), amount);
        balances[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    /**
     * @notice Withdraw tokens directly from the vault (re-enforces policy checks or is simple for user withdrawal).
     * In this prototype, direct withdrawals are allowed by the user if registry policy check passes or if it is approved.
     */
    function withdraw(uint256 amount) external {
        if (balances[msg.sender] < amount) revert InsufficientBalance();

        // Standard withdrawal checks registry policy
        (bool isValid, string memory reason) = registry.checkPolicy(msg.sender, msg.sender, amount);
        if (!isValid) revert PolicyViolation(reason);

        balances[msg.sender] -= amount;
        registry.recordSpending(msg.sender, amount);
        token.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @notice Executes a cleared payment. Requires a valid signature from the AI agent.
     */
    function executePayment(
        address user,
        address recipient,
        uint256 amount,
        bytes32 verdictId,
        string calldata verdict,
        bytes calldata agentSignature
    ) external {
        if (processedVerdicts[verdictId]) revert VerdictAlreadyProcessed();
        if (balances[user] < amount) revert InsufficientBalance();

        // 1. Verify verdict is CLEARED
        if (keccak256(bytes(verdict)) != keccak256(bytes("CLEARED"))) {
            revert NotCleared();
        }

        // 2. Verify AI agent signature
        bytes32 messageHash = keccak256(abi.encodePacked(user, recipient, amount, verdictId, verdict));
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        if (ethSignedMessageHash.recover(agentSignature) != agentSigner) {
            revert InvalidSignature();
        }

        // 3. Verify on-chain spending registry policy
        (bool isValid, string memory reason) = registry.checkPolicy(user, recipient, amount);
        if (!isValid) revert PolicyViolation(reason);

        // 4. Update balances and record spending
        processedVerdicts[verdictId] = true;
        balances[user] -= amount;
        registry.recordSpending(user, amount);

        // 5. Transfer tokens
        token.safeTransfer(recipient, amount);

        emit PaymentExecuted(user, recipient, amount, verdictId, verdict);
    }

    /**
     * @notice Executes a flagged payment that requires override/approval by the family guardian.
     */
    function executeFlaggedPayment(
        address user,
        address recipient,
        uint256 amount,
        bytes32 verdictId,
        bytes calldata agentSignature,
        bytes calldata guardianSignature
    ) external {
        if (processedVerdicts[verdictId]) revert VerdictAlreadyProcessed();
        if (balances[user] < amount) revert InsufficientBalance();

        // 1. Verify agent signature confirming the verdict was FLAGGED
        bytes32 agentMessageHash = keccak256(abi.encodePacked(user, recipient, amount, verdictId, "FLAGGED"));
        bytes32 agentEthHash = MessageHashUtils.toEthSignedMessageHash(agentMessageHash);
        if (agentEthHash.recover(agentSignature) != agentSigner) {
            revert InvalidSignature();
        }

        // 2. Fetch user's registered guardian
        (address guardian, , , bool isRegistered) = registry.policies(user);
        if (!isRegistered) revert NotGuardian();

        // 3. Verify guardian's signature authorizing this specific flagged payment
        bytes32 guardianMessageHash = keccak256(abi.encodePacked(user, recipient, amount, verdictId, "GUARDIAN_APPROVED"));
        bytes32 guardianEthHash = MessageHashUtils.toEthSignedMessageHash(guardianMessageHash);
        if (guardianEthHash.recover(guardianSignature) != guardian) {
            revert InvalidSignature();
        }

        // 4. Update balances (bypasses regular policy check since guardian approved)
        processedVerdicts[verdictId] = true;
        balances[user] -= amount;
        registry.recordSpending(user, amount); // Record it anyway to update limits

        // 5. Transfer tokens
        token.safeTransfer(recipient, amount);

        emit PaymentExecuted(user, recipient, amount, verdictId, "FLAGGED_APPROVED");
    }
}
