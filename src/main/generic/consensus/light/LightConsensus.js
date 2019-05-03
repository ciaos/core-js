class LightConsensus extends BaseConsensus {
    /**
     * @param {LightChain} blockchain
     * @param {Mempool} mempool
     * @param {Network} network
     */
    constructor(blockchain, mempool, network) {
        super(blockchain, mempool, network);
        /** @type {LightChain} */
        this._blockchain = blockchain;
        this.bubble(this._blockchain, 'block');
        /** @type {Mempool} */
        this._mempool = mempool;
    }

    // 
    // Public consensus interface
    //

    /**
     * @param {Array.<Address>} addresses
     * @returns {Promise.<Array.<Account>>}
     */
    async getAccounts(addresses) {
        return Promise.all(addresses.map(addr => this._blockchain.accounts.get(addr)));
    }

    /**
     * @param {Array.<Hash>} hashes
     * @returns {Promise.<Array.<Transaction>>}
     */
    async getPendingTransactions(hashes) {
        return /** @type {Array.<Transaction>} */ hashes.map(hash => this._mempool.getTransaction(hash)).filter(tx => tx != null);
    }

    /**
     * @param {Address} address
     * @returns {Promise.<Array.<Transaction>>}
     */
    async getPendingTransactionsByAddress(address) {
        return this._mempool.getTransactionsByAddresses([address]);
    }

    /**
     * @param {Transaction} tx
     * @returns {Promise.<void>} TODO
     */
    async sendTransaction(tx) {
        await this._mempool.pushTransaction(tx);
        // TODO: return value
    }

    //
    //

    /**
     * @param {number} minFeePerByte
     */
    subscribeMinFeePerByte(minFeePerByte) {
        this.subscribe(Subscription.fromMinFeePerByte(minFeePerByte));
        this.mempool.evictBelowMinFeePerByte(minFeePerByte);
    }

    /**
     * @type {number} minFeePerByte
     */
    get minFeePerByte() {
        return this._subscription.type === Subscription.Type.MIN_FEE ? this._subscription.minFeePerByte : 0;
    }

    /**
     * @param {Peer} peer
     * @returns {BaseConsensusAgent}
     * @override
     */
    _newConsensusAgent(peer) {
        return new LightConsensusAgent(this._blockchain, this._mempool, this._network.time, peer, this._invRequestManager, this._subscription);
    }

    /**
     * @param {Peer} peer
     * @override
     */
    _onPeerJoined(peer) {
        const agent = super._onPeerJoined(peer);

        // Forward sync events.
        this.bubble(agent, 'sync-chain-proof', 'verify-chain-proof', 'sync-accounts-tree', 'verify-accounts-tree', 'sync-finalize');

        return agent;
    }

    /** @type {LightChain} */
    get blockchain() {
        return this._blockchain;
    }

    /** @type {Mempool} */
    get mempool() {
        return this._mempool;
    }
}
Class.register(LightConsensus);
