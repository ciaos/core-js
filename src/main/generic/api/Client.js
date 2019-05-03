/**
 * @typedef {number} Handle
 */
class Client {
    /**
     * @param {Client.Configuration|object} config
     * @param {Promise.<BaseConsensus>} [consensus]
     */
    constructor(config, consensus) {
        /** @type {Promise.<BaseConsensus>} */
        this._consensus = consensus || Consensus.full();
        /** @type {Client.Configuration|object} */
        this._config = config;

        /** @type {HashMap.<Handle, function(consensusState: Client.ConsensusState):void>} */
        this._consensusChangedListeners = new HashMap();
        /** @type {HashMap.<Handle, function(blockHash: Hash):void>} */
        this._blockListeners = new HashMap();
        /** @type {HashMap.<Handle, function(blockHash: Hash, reason: string, revertedBlocks: Array.<Hash>, adoptedBlocks: Array.<Hash>):void>} */
        this._headChangedListeners = new HashMap();
        /** @type {HashMap.<Handle, {listener: function(transaction: TransactionDetails):void, addresses: HashSet.<Address>}>} */
        this._transactionListeners = new HashMap();
        /** @type {Handle} */
        this._listenerId = 0;

        /** @type {Client.ConsensusState} */
        this._consensusState = Client.ConsensusState.CONNECTING;
        /** @type {HashMap.<number, HashSet<TransactionDetails>>} */
        this._transactionConfirmWaiting = new HashMap();
        /** @type {HashMap.<number, HashSet<TransactionDetails>>} */
        this._transactionExpireWaiting = new HashMap();

        this._setupConsensus().catch(Log.w.tag(Client));
    }

    async _setupConsensus() {
        const consensus = await this._consensus;
        consensus.on('block', (blockHash) => this._onBlock(blockHash));
        consensus.on('established', () => this._onConsensusChanged(Client.ConsensusState.ESTABLISHED));
        consensus.on('waiting', () => this._onConsensusChanged(Client.ConsensusState.CONNECTING));
        consensus.on('syncing', () => this._onConsensusChanged(Client.ConsensusState.SYNCING));
        consensus.on('lost', () => this._onConsensusChanged(Client.ConsensusState.SYNCING));
        consensus.on('head-changed', (blockHash, reason, revertedBlocks, adoptedBlocks) => this._onHeadChanged(blockHash, reason, revertedBlocks, adoptedBlocks));
        consensus.on('transaction-added', (tx) => this._onPendingTransaction(tx));
        consensus.network.connect();
    }

    /**
     * @param {Hash} blockHash
     * @private
     */
    _onBlock(blockHash) {
        for (let listener of this._blockListeners.valueIterator()) {
            listener(blockHash);
        }
    }

    /**
     * @param {Client.ConsensusState} state
     * @private
     */
    _onConsensusChanged(state) {
        this._consensusState = state;
        for (let listener of this._consensusChangedListeners.valueIterator()) {
            listener(state);
        }
    }

    /**
     * @param {Hash} blockHash
     * @param {string} reason
     * @param {Array.<Block>} revertedBlocks
     * @param {Array.<Block>} adoptedBlocks
     * @private
     */
    _onHeadChanged(blockHash, reason, revertedBlocks, adoptedBlocks) {
        for (let listener of this._headChangedListeners.valueIterator()) {
            listener(blockHash, reason, revertedBlocks.map(b => b.hash()), adoptedBlocks.map(b => b.hash()));
        }
        if (this._transactionListeners.length > 0) {
            const revertedTxs = new HashSet();
            const adoptedTxs = new HashSet();
            for (let block of revertedBlocks) {
                revertedTxs.addAll(block.transactions);
                for (let tx of block.transactions) {
                    const confirmedAt = block.height + this._config.requiredBlockConfirmations;
                    this._transactionConfirmWaiting.remove(confirmedAt);
                }
            }
            for (let block of adoptedBlocks) {
                for (let tx of block.transactions) {
                    if (revertedTxs.contains(tx)) {
                        revertedTxs.remove(tx);
                    }
                    adoptedTxs.add({tx, block});
                }
            }
            for (let tx of revertedTxs.valueIterator()) {
                this._onPendingTransaction(tx, adoptedBlocks[adoptedBlocks.length - 1]);
            }
            for (let block of adoptedBlocks) {
                const set = this._transactionConfirmWaiting.get(block.height);
                if (set) {
                    for (let tx of set.valueIterator()) {
                        this._onConfirmedTransaction(block, tx, adoptedBlocks[adoptedBlocks.length - 1]);
                    }
                    this._transactionConfirmWaiting.remove(block.height);
                }
            }
            for (let {tx, block} of adoptedTxs.valueIterator()) {
                this._onMinedTransaction(block, tx, adoptedBlocks[adoptedBlocks.length - 1]);
            }
        }
    }

    /**
     * @param {Transaction} tx
     * @param {Block} [blockNow]
     * @private
     */
    _onPendingTransaction(tx, blockNow) {
        let details;
        for (let {listener, addresses} of this._transactionListeners.valueIterator()) {
            if (addresses.contains(tx.sender) || addresses.contains(tx.recipient)) {
                const expiresAt = tx.validityStartHeight + Policy.TRANSACTION_VALIDITY_WINDOW + this._config.requiredBlockConfirmations - 1;
                if (blockNow && blockNow.height >= expiresAt) {
                    details = details || new TransactionDetails(tx, TransactionDetails.State.EXPIRED);
                } else {
                    details = details || new TransactionDetails(tx, TransactionDetails.State.PENDING);
                }
                listener(details);
            }
        }
        if (details && details.state === TransactionDetails.State.PENDING) {
            const expiresAt = tx.validityStartHeight + Policy.TRANSACTION_VALIDITY_WINDOW + this._config.requiredBlockConfirmations - 1;
            const set = this._transactionExpireWaiting.get(expiresAt) || [];
            set.push(tx);
            this._transactionExpireWaiting.put(expiresAt, set);
        }
    }

    /**
     * @param {Block} block
     * @param {Transaction} tx
     * @param {Block} [blockNow]
     * @private
     */
    _onMinedTransaction(block, tx, blockNow) {
        let details;
        for (let {listener, addresses} of this._transactionListeners.valueIterator()) {
            if (addresses.contains(tx.sender) || addresses.contains(tx.recipient)) {
                let state = TransactionDetails.State.MINED, confirmations = 1;
                if (blockNow) {
                    confirmations = (blockNow.height - block.height) + 1;
                    state = confirmations >= this._config.requiredBlockConfirmations ? TransactionDetails.State.CONFIRMED : TransactionDetails.State.MINED;
                }
                details = details || new TransactionDetails(tx, state, block.hash(), block.height, confirmations);
                listener(details);
            }
        }
        if (details && details.state === TransactionDetails.State.MINED) {
            const expiresAt = tx.validityStartHeight + Policy.TRANSACTION_VALIDITY_WINDOW + this._config.requiredBlockConfirmations - 1;
            let set = this._transactionExpireWaiting.get(expiresAt) || [];
            set.remove(tx);
            if (set.length === 0) this._transactionExpireWaiting.remove(expiresAt);

            const confirmedAt = block.height + this._config.requiredBlockConfirmations - 1;
            set = this._transactionConfirmWaiting.get(confirmedAt) || [];
            set.push(tx);
            this._transactionConfirmWaiting.put(confirmedAt, set);
        }
    }

    /**
     * @param {Block} block
     * @param {Transaction} tx
     * @param {Block} blockNow
     * @private
     */
    _onConfirmedTransaction(block, tx, blockNow) {
        let details;
        for (let {listener, addresses} of this._transactionListeners.valueIterator()) {
            if (addresses.contains(tx.sender) || addresses.contains(tx.recipient)) {
                details = details || new TransactionDetails(tx, TransactionDetails.State.CONFIRMED, block.hash(), block.height, (blockNow.height - block.height) + 1);
                listener(details);
            }
        }
    }

    /**
     * @returns {Promise.<Hash>}
     */
    async getHeadHash() {
        const consensus = await this._consensus;
        return consensus.getHeadHash();
    }

    /**
     * @returns {Promise.<number>}
     */
    async getHeadHeight() {
        const consensus = await this._consensus;
        return consensus.getHeadHeight();
    }

    /**
     * @param {boolean} [includeBody = true]
     * @returns {Promise.<Block>}
     */
    async getHeadBlock(includeBody = true) {
        const consensus = await this._consensus;
        let hash = await consensus.getHeadHash();
        return consensus.getBlock(hash, includeBody);
    }

    /**
     * @param {Hash|string} hash
     * @param {boolean} [includeBody = true]
     * @returns {Promise.<Block>}
     */
    async getBlock(hash, includeBody = true) {
        hash = Hash.fromAny(hash);

        const consensus = await this._consensus;
        return consensus.getBlock(hash, includeBody);
    }

    /**
     * @param {number} height
     * @param {boolean} includeBody
     * @returns {Promise.<Block>}
     */
    async getBlockAt(height, includeBody) {
        const consensus = await this._consensus;
        return consensus.getBlockAt(height, includeBody);
    }

    /**
     * @param {Address|string} minerAddress
     * @param {Uint8Array|string} [extraData]
     * @returns {Promise.<Block>}
     */
    async getBlockTemplate(minerAddress, extraData) {
        minerAddress = Address.fromAny(minerAddress);

        if (typeof extraData === 'string') {
            extraData = BufferUtils.fromHex(extraData);
        } else if (extraData && !(extraData instanceof Uint8Array)) {
            throw new Error('Invalid extra data');
        }

        const consensus = await this._consensus;
        return consensus.getBlockTemplate(minerAddress, extraData);
    }

    /**
     * @param {Block|string} block
     * @returns {Promise.<number>}
     */
    async submitBlock(block) {
        block = Block.fromAny(block);

        const consensus = await this._consensus;
        return consensus.submitBlock(block);
    }

    /**
     * @param {Address|string} address
     * @returns {Promise.<Account>}
     */
    async getAccount(address) {
        return (await this.getAccounts([address]))[0];
    }

    /**
     * @param {Array.<Address|string>} addresses
     * @returns {Promise.<Array.<Account>>}
     */
    async getAccounts(addresses) {
        addresses = addresses.map(a => Address.fromAny(a));

        const consensus = await this._consensus;
        return consensus.getAccounts(addresses);
    }

    /**
     * @param {Hash|string} hash
     * @param {Hash|string} [blockHash]
     * @param {number} [blockHeight]
     * @returns {Promise.<TransactionDetails>}
     */
    async getTransaction(hash, blockHash, blockHeight) {
        hash = Hash.fromAny(hash);
        if (blockHash) blockHash = Hash.fromAny(blockHash);

        const consensus = await this._consensus;

        if (!blockHash) {
            const receipts = await consensus.getTransactionReceiptsByHashes([hash]);
            if (receipts.length === 1 && receipts[0]) {
                blockHash = receipts[0].blockHash;
                blockHeight = receipts[0].blockHeight;
            }
        }

        if (blockHash) {
            const tx = await consensus.getTransactionsFromBlock([hash], blockHash, blockHeight);
            if (tx) {
                const height = await consensus.getHeadHeight();
                const confirmations = (height - blockHeight) + 1;
                const confirmed = confirmations >= this._config.requiredBlockConfirmations;
                // TODO: Add transaction to listener for confirmed
                return new TransactionDetails(tx[0], confirmed ? TransactionDetails.State.CONFIRMED : TransactionDetails.State.MINED, blockHash, blockHeight, confirmations);
            }
        }

        const pending = await consensus.getPendingTransactions([hash]);
        if (pending.length === 1 && pending[0]) {
            // TODO: Add transaction to listener for expired
            return new TransactionDetails(pending[0], TransactionDetails.State.PENDING);
        }
        return null;
    }

    /**
     * @param {Address|string} address
     * @param {number} [sinceBlockHeight]
     * @return {Promise.<Array.<TransactionDetails>>}
     */
    async getTransactionsByAddress(address, sinceBlockHeight = 0) {
        address = Address.fromAny(address);

        const consensus = await this._consensus;
        let txs = new HashSet((details) => details.transaction.hash());
        try {
            const pending = await consensus.getPendingTransactionsByAddress(address);
            for (const tx of pending) {
                // TODO: Add transaction to listener for expired
                txs.add(new TransactionDetails(tx, TransactionDetails.State.PENDING));
            }
        } catch (e) {
            // Ignore
        }
        const receipts = await consensus.getTransactionReceiptsByAddress(address);
        const requestProofs = new HashMap();
        const blockHeights = new HashMap();
        for (const receipt of receipts) {
            if (receipt.blockHeight >= sinceBlockHeight) {
                const pendingProofAtBlock = requestProofs.get(receipt.blockHash) || new HashSet();
                pendingProofAtBlock.add(receipt.transactionHash);
                requestProofs.put(receipt.blockHash, pendingProofAtBlock);
                blockHeights.put(receipt.blockHash, receipt.blockHeight);
            }
        }
        const height = await consensus.getHeadHeight();
        for (const blockHash of requestProofs.keyIterator()) {
            const blockHeight = blockHeights.get(blockHash);
            const moreTx = await consensus.getTransactionsFromBlock(requestProofs.get(blockHash).values(), blockHash, blockHeight);
            const confirmations = (height - blockHeights.get(blockHash)) + 1;
            const confirmed = confirmations >= this._config.requiredBlockConfirmations;
            for (const tx of moreTx) {
                // TODO: Add transaction to listener for confirmed
                txs.add(new TransactionDetails(tx[0], confirmed ? TransactionDetails.State.CONFIRMED : TransactionDetails.State.MINED, blockHash, blockHeight, confirmations));
            }
        }
        return txs.values();
    }

    /**
     * @param {Hash|string} hash
     * @returns {Promise.<?TransactionReceipt>}
     */
    async getTransactionReceipt(hash) {
        hash = Hash.fromAny(hash);

        return (await this.getTransactionReceiptsByHashes([hash]))[0];
    }

    /**
     * @param {Address|string} address
     * @returns {Promise.<Array.<TransactionReceipt>>}
     */
    async getTransactionReceiptsByAddress(address) {
        address = Address.fromAny(address);

        const consensus = await this._consensus;
        return consensus.getTransactionReceiptsByAddress(address);
    }

    /**
     * @param {Array.<Hash|string>} hashes
     * @returns {Promise.<Array.<?TransactionReceipt>>}
     */
    async getTransactionReceiptsByHashes(hashes) {
        hashes = hashes.map(hash => Hash.fromAny(hash));

        const consensus = await this._consensus;
        return consensus.getTransactionReceiptsByHashes(hashes);
    }

    /**
     * @param {Address} address
     * @param {Array.<TransactionReceipt|object|string>} transactions
     * @return {Promise.<Array.<TransactionDetails>>}
     */
    async syncTransactionsByAddress(address, transactions) {
        address = Address.fromAny(address);
        transactions = transactions.map(tx => TransactionReceipt.fromAny(tx));
        let knownTxs = new HashMap();
        for (const receipt of transactions) {
            knownTxs.put(receipt.transactionHash, receipt);
        }

        const consensus = await this._consensus;
        let txs = new HashSet((details) => details.transaction.hash());
        try {
            const pending = await consensus.getPendingTransactionsByAddress(address);
            for (const tx of pending) {
                // TODO: Add transaction to listener for expired
                txs.add(new TransactionDetails(tx, TransactionDetails.State.PENDING));
            }
        } catch (e) {
            // Ignore
        }
        const receipts = await consensus.getTransactionReceiptsByAddress(address);
        const requestProofs = new HashMap();
        const blockHeights = new HashMap();
        for (const receipt of receipts) {
            if (knownTxs.contains(receipt.transactionHash) && knownTxs.get(receipt.transactionHash).equals(receipt)) {
                continue;
            }
            const pendingProofAtBlock = requestProofs.get(receipt.blockHash) || new HashSet();
            pendingProofAtBlock.add(receipt.transactionHash);
            requestProofs.put(receipt.blockHash, pendingProofAtBlock);
            blockHeights.put(receipt.blockHash, receipt.blockHeight);
        }
        const height = await consensus.getHeadHeight();
        for (const blockHash of requestProofs.keyIterator()) {
            const blockHeight = blockHeights.get(blockHash);
            const moreTx = await consensus.getTransactionsFromBlock(requestProofs.get(blockHash).values(), blockHash, blockHeight);
            const confirmations = (height - blockHeights.get(blockHash)) + 1;
            const confirmed = confirmations >= this._config.requiredBlockConfirmations;
            for (const tx of moreTx) {
                // TODO: Add transaction to listener for confirmed
                txs.add(new TransactionDetails(tx[0], confirmed ? TransactionDetails.State.CONFIRMED : TransactionDetails.State.MINED, blockHash, blockHeight, confirmations));
            }
        }
        // TODO: Unknown pending + expired txs
        return txs.values();
    }

    /**
     * @param {Transaction|object|string} tx
     * @returns {Promise.<void>} TODO
     */
    async sendTransaction(tx) {
        tx = Transaction.fromAny(tx);

        const consensus = await this._consensus;
        return consensus.sendTransaction(tx);
    }

    /**
     * @param {function(blockHash: Hash):void}listener
     * @return {Promise.<Handle>}
     */
    async addBlockListener(listener) {
        const listenerId = this._listenerId++;
        this._blockListeners.put(listenerId, listener);
        return listenerId;
    }

    /**
     * @param {function(consensusState: Client.ConsensusState):void} listener
     * @return {Promise.<Handle>}
     */
    async addConsensusChangedListener(listener) {
        const listenerId = this._listenerId++;
        this._consensusChangedListeners.put(listenerId, listener);
        listener(this._consensusState);
        return listenerId;
    }

    /**
     * @param {function(blockHash: Hash, reason: string, revertedBlocks: Array.<Hash>, adoptedBlocks: Array.<Hash>):void} listener
     * @return {Promise.<Handle>}
     */
    async addHeadChangedListener(listener) {
        const listenerId = this._listenerId++;
        this._headChangedListeners.put(listenerId, listener);
        return listenerId;
    }

    /**
     * @param {function} listener
     * @param {Array.<Address|string>} addresses
     * @return {Promise.<Handle>}
     */
    async addTransactionListener(listener, addresses) {
        addresses = addresses.map(addr => Address.fromAny(addr));
        const set = new HashSet();
        set.addAll(addresses);

        const consensus = await this._consensus;
        if (consensus.getSubscription().type === Subscription.Type.ADDRESSES) {
            const newSet = new HashSet();
            newSet.addAll(set);
            newSet.addAll(consensus.getSubscription().addresses);
            consensus.subscribe(Subscription.fromAddresses(newSet.values()));
        }
        const listenerId = this._listenerId++;
        this._transactionListeners.put(listenerId, {listener, addresses: set});
        return listenerId;
    }

    /**
     * @param {Handle} handle
     */
    removeListener(handle) {
        this._blockListeners.remove(handle);
        this._consensusChangedListeners.remove(handle);
        this._headChangedListeners.remove(handle);
        this._transactionListeners.remove(handle);
        if (this._transactionListeners.length === 0) {
            this._transactionConfirmWaiting.clear();
            this._transactionExpireWaiting.clear();
        }
    }
}

Client.Configuration = class {
    constructor(requiredBlockConfirmations = 10) {
        this._requiredBlockConfirmations = requiredBlockConfirmations;
    }

    get requiredBlockConfirmations() {
        return this._requiredBlockConfirmations;
    }
};
Client.ConsensusState = {
    CONNECTING: 'connecting',
    SYNCING: 'syncing',
    ESTABLISHED: 'established'
};

Class.register(Client);
