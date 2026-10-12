// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Authorization lifecycle only. Resource/purpose/scope checks belong to the broker.
contract CapabilityRegistry {
    enum Status { ACTIVE, REVOKED, EXPIRED, COMPLETED }
    struct Capability {
        address principal;
        bytes32 agentId;
        bytes32 policyHash;
        bytes32 parentCapabilityId;
        uint64 expiresAt;
        Status status;
        uint8 depth;
    }
    struct Receipt {
        bytes32 capabilityId;
        bytes32 requestHash;
        bytes32 resultHash;
        uint8 decisionCode;
        bool exists;
    }
    uint8 public constant MAX_DEPTH = 8;
    /// @notice Broker operator: anchors receipts and may register delegated (child) capabilities
    /// under an active parent the principal already holds. It can never create a root grant,
    /// revoke, or complete, so the principal stays the only source of authority.
    address public immutable receiptWriter;
    mapping(bytes32 => Capability) private capabilities;
    // Public, opaque application identifiers only; never user data or task descriptions.
    mapping(bytes32 => string) public canonicalIds;
    mapping(bytes32 => bool) public delegationRegistered;
    mapping(bytes32 => Receipt) public receipts;

    error Unauthorized();
    error InvalidInput();
    error AlreadyExists();
    error UnknownCapability();
    error InactiveCapability();
    error InvalidDelegation();

    event CapabilityRegistered(bytes32 indexed capabilityId, address indexed principal, bytes32 indexed agentId, bytes32 policyHash, bytes32 parentCapabilityId, uint64 expiresAt);
    event CapabilityRevoked(bytes32 indexed capabilityId, address indexed principal);
    event CapabilityCompleted(bytes32 indexed capabilityId);
    event DelegationRegistered(bytes32 indexed parentCapabilityId, bytes32 indexed childCapabilityId, bytes32 indexed childAgentId);
    event DisclosureReceiptAnchored(bytes32 indexed capabilityId, bytes32 indexed receiptId, bytes32 requestHash, bytes32 resultHash, uint8 decisionCode);

    constructor(address writer) {
        if (writer == address(0)) revert InvalidInput();
        receiptWriter = writer;
    }

    /// @notice Roots: principal only. Children: principal or the broker operator; either way the
    /// parent must be active, owned by the same principal, and outlive the child.
    function registerCapability(string calldata canonicalId, address principal, bytes32 agentId, bytes32 policyHash, bytes32 parentId, uint64 expiresAt) external {
        if (msg.sender != principal && !(msg.sender == receiptWriter && parentId != bytes32(0))) revert Unauthorized();
        if (bytes(canonicalId).length == 0 || bytes(canonicalId).length > 128 || agentId == bytes32(0) || policyHash == bytes32(0) || expiresAt <= block.timestamp) revert InvalidInput();
        bytes32 id = keccak256(bytes(canonicalId));
        if (capabilities[id].principal != address(0)) revert AlreadyExists();
        uint8 depth;
        if (parentId != bytes32(0)) {
            Capability storage parent = capabilities[parentId];
            if (parent.principal != principal) revert InvalidDelegation();
            if (!isActive(parentId)) revert InactiveCapability();
            if (expiresAt > parent.expiresAt || parent.depth >= MAX_DEPTH) revert InvalidDelegation();
            depth = parent.depth + 1;
        }
        capabilities[id] = Capability(principal, agentId, policyHash, parentId, expiresAt, Status.ACTIVE, depth);
        canonicalIds[id] = canonicalId;
        emit CapabilityRegistered(id, principal, agentId, policyHash, parentId, expiresAt);
    }

    function getCapability(bytes32 id) external view returns (Capability memory) { return capabilities[id]; }

    /// @notice Effective state includes all ancestors. Unknown IDs revert, isActive returns false.
    function getCapabilityStatus(bytes32 id) public view returns (Status) {
        Capability storage cap = capabilities[id];
        if (cap.principal == address(0)) revert UnknownCapability();
        if (cap.status != Status.ACTIVE) return cap.status;
        if (block.timestamp >= cap.expiresAt) return Status.EXPIRED;
        if (cap.parentCapabilityId != bytes32(0)) return getCapabilityStatus(cap.parentCapabilityId);
        return Status.ACTIVE;
    }
    function isActive(bytes32 id) public view returns (bool) {
        return capabilities[id].principal != address(0) && getCapabilityStatus(id) == Status.ACTIVE;
    }
    function revokeCapability(bytes32 id) external {
        Capability storage cap = capabilities[id];
        if (cap.principal == address(0)) revert UnknownCapability();
        if (msg.sender != cap.principal) revert Unauthorized();
        if (cap.status == Status.REVOKED || cap.status == Status.COMPLETED) revert InactiveCapability();
        cap.status = Status.REVOKED;
        emit CapabilityRevoked(id, cap.principal);
    }
    function completeCapability(bytes32 id) external {
        Capability storage cap = capabilities[id];
        if (cap.principal == address(0)) revert UnknownCapability();
        if (msg.sender != cap.principal) revert Unauthorized();
        if (!isActive(id)) revert InactiveCapability();
        cap.status = Status.COMPLETED;
        emit CapabilityCompleted(id);
    }
    /// @notice Parent link is set immutably during registration; this confirms the broker handoff.
    function registerDelegation(bytes32 parentId, bytes32 childId, bytes32 childAgentId) external {
        Capability storage child = capabilities[childId];
        if (msg.sender != child.principal && msg.sender != receiptWriter) revert Unauthorized();
        if (parentId == bytes32(0) || child.parentCapabilityId != parentId || child.agentId != childAgentId) revert InvalidDelegation();
        if (!isActive(childId)) revert InactiveCapability();
        if (delegationRegistered[childId]) revert AlreadyExists();
        delegationRegistered[childId] = true;
        emit DelegationRegistered(parentId, childId, childAgentId);
    }
    /// @notice DENY receipts can still be anchored after revocation/expiry.
    function anchorDisclosureReceipt(bytes32 receiptId, bytes32 capabilityId, bytes32 requestHash, bytes32 resultHash, uint8 decisionCode) external {
        Capability storage cap = capabilities[capabilityId];
        if (cap.principal == address(0)) revert UnknownCapability();
        if (msg.sender != receiptWriter && msg.sender != cap.principal) revert Unauthorized();
        if (receiptId == bytes32(0) || requestHash == bytes32(0) || decisionCode > 3) revert InvalidInput();
        if (receipts[receiptId].exists) revert AlreadyExists();
        if (decisionCode != 0 && !isActive(capabilityId)) revert InactiveCapability();
        receipts[receiptId] = Receipt(capabilityId, requestHash, resultHash, decisionCode, true);
        emit DisclosureReceiptAnchored(capabilityId, receiptId, requestHash, resultHash, decisionCode);
    }
}
