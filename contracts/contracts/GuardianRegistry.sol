// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract GuardianRegistry {
    struct SpendingPolicy {
        address guardian;
        uint256 maxPerTx;
        uint256 dailyLimit;
        address[] allowedRecipients;
        bool isRegistered;
    }

    // Mapping from user wallet address to their spending policy
    mapping(address => SpendingPolicy) public policies;

    // Track daily spending: user => dayTimestamp => amount
    mapping(address => mapping(uint256 => uint256)) public dailySpending;

    event UserRegistered(address indexed user, address indexed guardian, uint256 maxPerTx, uint256 dailyLimit);
    event PolicyUpdated(address indexed user, address indexed guardian, uint256 maxPerTx, uint256 dailyLimit);
    event SpendingRecorded(address indexed user, uint256 amount, uint256 dailyTotal);

    error NotRegistered();
    error AlreadyRegistered();
    error Unauthorized();

    modifier onlyRegistered(address user) {
        if (!policies[user].isRegistered) revert NotRegistered();
        _;
    }

    /**
     * @notice Registers a new user with their guardian and initial spending policy.
     */
    function registerUser(
        address _guardian,
        uint256 _maxPerTx,
        uint256 _dailyLimit,
        address[] calldata _allowedRecipients
    ) external {
        if (policies[msg.sender].isRegistered) revert AlreadyRegistered();
        
        policies[msg.sender] = SpendingPolicy({
            guardian: _guardian,
            maxPerTx: _maxPerTx,
            dailyLimit: _dailyLimit,
            allowedRecipients: _allowedRecipients,
            isRegistered: true
        });

        emit UserRegistered(msg.sender, _guardian, _maxPerTx, _dailyLimit);
    }

    /**
     * @notice Updates the spending policy. Can be called by the user or their registered guardian.
     */
    function updatePolicy(
        address user,
        address _guardian,
        uint256 _maxPerTx,
        uint256 _dailyLimit,
        address[] calldata _allowedRecipients
    ) external onlyRegistered(user) {
        SpendingPolicy storage policy = policies[user];
        if (msg.sender != user && msg.sender != policy.guardian) {
            revert Unauthorized();
        }

        policy.guardian = _guardian;
        policy.maxPerTx = _maxPerTx;
        policy.dailyLimit = _dailyLimit;
        policy.allowedRecipients = _allowedRecipients;

        emit PolicyUpdated(user, _guardian, _maxPerTx, _dailyLimit);
    }

    /**
     * @notice Checks if a proposed transaction is within spending policy limits.
     * @return isValid True if the transaction complies, false otherwise.
     * @return reason Error explanation if invalid.
     */
    function checkPolicy(
        address user,
        address recipient,
        uint256 amount
    ) external view onlyRegistered(user) returns (bool isValid, string memory reason) {
        SpendingPolicy memory policy = policies[user];

        // 1. Check max per transaction
        if (amount > policy.maxPerTx) {
            return (false, "EXCEEDS_MAX_TX_LIMIT");
        }

        // 2. Check daily limit
        uint256 todayKey = block.timestamp / 1 days;
        uint256 spentToday = dailySpending[user][todayKey];
        if (spentToday + amount > policy.dailyLimit) {
            return (false, "EXCEEDS_DAILY_LIMIT");
        }

        // 3. Check allowed recipient list (if list is not empty, recipient must be in it)
        if (policy.allowedRecipients.length > 0) {
            bool isAllowed = false;
            for (uint256 i = 0; i < policy.allowedRecipients.length; i++) {
                if (policy.allowedRecipients[i] == recipient) {
                    isAllowed = true;
                    break;
                }
            }
            if (!isAllowed) {
                return (false, "RECIPIENT_NOT_IN_ALLOWLIST");
            }
        }

        return (true, "");
    }

    /**
     * @notice Records a transaction amount to update daily spending limits.
     * @dev Should be called by the approved vault contract.
     */
    function recordSpending(address user, uint256 amount) external onlyRegistered(user) {
        // Any registered user or vault can record spending. In production, restrict to PolicyVault.
        uint256 todayKey = block.timestamp / 1 days;
        dailySpending[user][todayKey] += amount;

        emit SpendingRecorded(user, amount, dailySpending[user][todayKey]);
    }

    /**
     * @notice Returns the list of allowed recipients for a user.
     */
    function getAllowedRecipients(address user) external view returns (address[] memory) {
        return policies[user].allowedRecipients;
    }
}
