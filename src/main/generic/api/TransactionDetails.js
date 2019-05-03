class TransactionDetails {
    /**
     * @param {Transaction} transaction
     * @param {TransactionDetails.State} state
     * @param {Hash} [blockHash]
     * @param {number} [blockHeight]
     * @param {number} [confirmations]
     */
    constructor(transaction, state, blockHash, blockHeight, confirmations) {
        this._transaction = transaction;
        this._state = state;
        this._blockHash = blockHash;
        this._blockHeight = blockHeight;
        this._confirmations = confirmations;
    }

    /**
     * @return {Hash}
     */
    get transactionHash() {
        return this._transaction.hash();
    }

    get sender() {
        return this._transaction.sender;
    }

    get senderType() {
        return this._transaction.senderType;
    }

    get recipient() {
        return this._transaction.recipient;
    }

    get recipientType() {
        return this._transaction.recipientType;
    }

    get value() {
        return this._transaction.value;
    }

    get fee() {
        return this._transaction.fee;
    }

    get feePerByte() {
        return this._transaction.feePerByte;
    }

    get validityStartHeight() {
        return this._transaction.validityStartHeight;
    }

    get network() {
        return this._transaction.networkId;
    }

    get flags() {
        return this._transaction.flags;
    }

    get data() {
        const o = Account.TYPE_MAP.get(this.recipientType).dataToPlain(this._transaction.data);
        o.raw = this._transaction.data;
    }

    get proof() {
        const o = Account.TYPE_MAP.get(this.recipientType).proofToPlain(this._transaction.proof);
        o.raw =  this._transaction.proof;
    }

    get size() {
        return this._transaction.serializedSize;
    }

    get valid() {
        return this._transaction.verify();
    }

    get transaction() {
        return this._transaction;
    }

    get state() {
        return this._state;
    }

    get blockHash() {
        return this._blockHash;
    }

    get blockHeight() {
        return this._blockHeight;
    }

    get confirmations() {
        return this._confirmations;
    }

    /**
     * @returns {object}
     */
    toPlain() {
        const o = this._transaction.toPlain();
        o.state = this._state;
        o.blockHash = this._blockHash.toPlain();
        o.blockHeight = this._blockHeight;
        o.confirmations = this._confirmations;
        return o;
    }

    fromPlain(o) {
        return new TransactionDetails(Transaction.fromPlain(o), o.state, o.blockHash ? Hash.fromAny(o.blockHash) : null, o.blockHeight, o.confirmations);
    }
}

TransactionDetails.State = {
    NEW: 'new',
    PENDING: 'pending',
    MINED: 'mined',
    INVALIDATED: 'invalidated',
    EXPIRED: 'expired',
    CONFIRMED: 'confirmed',
};
Class.register(TransactionDetails);
