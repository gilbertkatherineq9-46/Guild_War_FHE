pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract GuildWarFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchClosed();
    error InvalidBatchId();
    error InvalidCooldown();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidProof();
    error NotInitialized();
    error InvalidCoordinates();
    error InvalidCommand();
    error MaxMarkersReached();

    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address account);
    event Unpaused(address account);
    event CooldownSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event MaxMarkersSet(uint256 oldMaxMarkers, uint256 newMaxMarkers);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event MarkerSubmitted(address indexed provider, uint256 indexed batchId, uint256 markerId);
    event CommandSubmitted(address indexed provider, uint256 indexed batchId, uint256 commandId);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId);

    struct Marker {
        euint32 x;
        euint32 y;
        euint32 unitType; // Encrypted unit type identifier
        euint32 count;    // Encrypted unit count
    }

    struct Command {
        euint32 targetX;
        euint32 targetY;
        euint32 commandType; // Encrypted command type identifier
        euint32 unitId;      // Encrypted unit identifier for the command
    }

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;
    uint256 public currentBatchId;
    bool public batchOpen;
    uint256 public maxMarkersPerBatch;
    uint256 public maxCommandsPerBatch;
    mapping(uint256 => Marker[]) public batchMarkers;
    mapping(uint256 => Command[]) public batchCommands;
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier checkSubmissionCooldown(address submitter) {
        if (block.timestamp < lastSubmissionTime[submitter] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier checkDecryptionCooldown(address requester) {
        if (block.timestamp < lastDecryptionRequestTime[requester] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        emit ProviderAdded(owner);
        cooldownSeconds = 60; // Default 1 minute cooldown
        maxMarkersPerBatch = 20;
        maxCommandsPerBatch = 10;
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        if (newCooldownSeconds == 0) revert InvalidCooldown();
        emit CooldownSet(cooldownSeconds, newCooldownSeconds);
        cooldownSeconds = newCooldownSeconds;
    }

    function setMaxMarkersPerBatch(uint256 newMaxMarkers) external onlyOwner {
        if (newMaxMarkers == 0) revert InvalidCooldown(); // Reusing error for simplicity, could create new one
        emit MaxMarkersSet(maxMarkersPerBatch, newMaxMarkers);
        maxMarkersPerBatch = newMaxMarkers;
    }

    function setMaxCommandsPerBatch(uint256 newMaxCommands) external onlyOwner {
        if (newMaxCommands == 0) revert InvalidCooldown(); // Reusing error for simplicity
        // No specific event for this, could add one
        maxCommandsPerBatch = newMaxCommands;
    }

    function openBatch() external onlyOwner whenNotPaused {
        currentBatchId++;
        batchOpen = true;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        batchOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function submitMarker(
        euint32 x,
        euint32 y,
        euint32 unitType,
        euint32 count
    ) external onlyProvider whenNotPaused checkSubmissionCooldown(msg.sender) {
        if (!batchOpen) revert BatchClosed();
        if (batchMarkers[currentBatchId].length >= maxMarkersPerBatch) {
            revert MaxMarkersReached();
        }
        // Basic validation for coordinates (example, could be more complex)
        if (!x.isInitialized() || !y.isInitialized() || !unitType.isInitialized() || !count.isInitialized()) {
            revert NotInitialized();
        }
        // Example: Max map size 1000x1000. These checks are on ciphertexts.
        // A real game might have more complex validation logic.
        ebool xValid = x.le(FHE.asEuint32(1000));
        ebool yValid = y.le(FHE.asEuint32(1000));
        if (!xValid.isInitialized() || !yValid.isInitialized() || !xValid.toBoolean() || !yValid.toBoolean()) {
            revert InvalidCoordinates();
        }


        batchMarkers[currentBatchId].push(Marker(x, y, unitType, count));
        lastSubmissionTime[msg.sender] = block.timestamp;
        emit MarkerSubmitted(msg.sender, currentBatchId, batchMarkers[currentBatchId].length - 1);
    }

    function submitCommand(
        euint32 targetX,
        euint32 targetY,
        euint32 commandType,
        euint32 unitId
    ) external onlyProvider whenNotPaused checkSubmissionCooldown(msg.sender) {
        if (!batchOpen) revert BatchClosed();
        if (batchCommands[currentBatchId].length >= maxCommandsPerBatch) {
            revert MaxMarkersReached(); // Reusing error, could create new one
        }
        if (!targetX.isInitialized() || !targetY.isInitialized() || !commandType.isInitialized() || !unitId.isInitialized()) {
            revert NotInitialized();
        }
        // Example: Max map size 1000x1000
        ebool txValid = targetX.le(FHE.asEuint32(1000));
        ebool tyValid = targetY.le(FHE.asEuint32(1000));
        if (!txValid.isInitialized() || !tyValid.isInitialized() || !txValid.toBoolean() || !tyValid.toBoolean()) {
            revert InvalidCoordinates();
        }
        // Example: commandType must be between 1 and 5
        ebool ctValid = commandType.ge(FHE.asEuint32(1));
        ctValid = ctValid.and(commandType.le(FHE.asEuint32(5)));
        if (!ctValid.isInitialized() || !ctValid.toBoolean()) {
            revert InvalidCommand();
        }


        batchCommands[currentBatchId].push(Command(targetX, targetY, commandType, unitId));
        lastSubmissionTime[msg.sender] = block.timestamp;
        emit CommandSubmitted(msg.sender, currentBatchId, batchCommands[currentBatchId].length - 1);
    }

    function requestBatchDecryption() external onlyProvider whenNotPaused checkDecryptionCooldown(msg.sender) {
        if (batchMarkers[currentBatchId].length == 0 && batchCommands[currentBatchId].length == 0) {
            revert InvalidBatchId(); // Or a more specific "EmptyBatch" error
        }

        bytes32 stateHash = _hashCiphertextsForBatch(currentBatchId);
        uint256 requestId = FHE.requestDecryption(new bytes32[](0), this.myCallback.selector); // No direct ciphertexts to decrypt here

        decryptionContexts[requestId] = DecryptionContext({
            batchId: currentBatchId,
            stateHash: stateHash,
            processed: false
        });
        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        emit DecryptionRequested(requestId, currentBatchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();
        DecryptionContext memory ctx = decryptionContexts[requestId];

        // State Verification
        bytes32 currentHash = _hashCiphertextsForBatch(ctx.batchId);
        if (currentHash != ctx.stateHash) {
            revert StateMismatch();
        }

        // Proof Verification
        // This check is crucial for ensuring the decryption was performed correctly
        // by the FHEVM network and that the cleartexts correspond to the original ciphertexts.
        FHE.checkSignatures(requestId, cleartexts, proof);

        // For this contract, cleartexts is empty as we are not decrypting specific values
        // but rather requesting a "decryption" of the batch state for processing.
        // If we were decrypting specific values, we would decode them here.
        // Example: (uint256 val1, uint256 val2) = abi.decode(cleartexts, (uint256, uint256));

        ctx.processed = true;
        decryptionContexts[requestId] = ctx; // Update storage

        emit DecryptionCompleted(requestId, ctx.batchId);
        // Further game logic could be triggered here, e.g., finalizing the war plan.
    }

    function _hashCiphertextsForBatch(uint256 batchId) internal view returns (bytes32) {
        // This hash serves as a commitment to the state of the batch at the time of decryption request.
        // It ensures that if the batch data changes before the callback is processed, the decryption
        // is invalidated, preventing inconsistencies.
        Marker[] memory markers = batchMarkers[batchId];
        Command[] memory commands = batchCommands[batchId];

        bytes32[] memory cts = new bytes32[](markers.length * 4 + commands.length * 4);
        uint256 idx = 0;
        for (uint256 i = 0; i < markers.length; i++) {
            Marker memory m = markers[i];
            cts[idx++] = m.x.toBytes32();
            cts[idx++] = m.y.toBytes32();
            cts[idx++] = m.unitType.toBytes32();
            cts[idx++] = m.count.toBytes32();
        }
        for (uint256 i = 0; i < commands.length; i++) {
            Command memory c = commands[i];
            cts[idx++] = c.targetX.toBytes32();
            cts[idx++] = c.targetY.toBytes32();
            cts[idx++] = c.commandType.toBytes32();
            cts[idx++] = c.unitId.toBytes32();
        }
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 val) internal pure returns (euint32) {
        if (!val.isInitialized()) {
            return FHE.asEuint32(0);
        }
        return val;
    }

    function _requireInitialized(euint32 val) internal view {
        if (!val.isInitialized()) {
            revert NotInitialized();
        }
    }

    function _requireInitialized(ebool val) internal view {
        if (!val.isInitialized()) {
            revert NotInitialized();
        }
    }
}