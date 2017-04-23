describe('AccountsTree', () => {

    it('has a 32 bytes root hash', (done) => {
        const balance1 = new Balance(80000, 8);
        const balance2 = new Balance(8000000, 8);
        const address = new Address(Dummy.address1);

        const tree = new AccountsTree();

        async function test(){
            await tree.put(address, balance1);

            expect(tree.root.byteLength).toEqual(32);
            done();
        }

        test();
    });

    it('can put and get a Balance', (done) => {
        const value = 20;
        const nonce = 2;
        const balance1 = new Balance(value, nonce);
        const address = new Address(Dummy.address1);

        const tree = new AccountsTree();

        async function test(){
            await tree.put(address, balance1);

            const balance2 = await tree.get(address);

            expect(balance2.value).toEqual(value);
            expect(balance2.nonce).toEqual(nonce);
            done();
        }

        test();
    });

     it('can put and get multiple Balances', (done) => {
        const value1 = 8;
        const nonce1 = 8;
        const balance1 = new Balance(value1, nonce1);
        const address1 = new Address(Dummy.address1);

        const value2 = 88;
        const nonce2 = 88;
        const balance2 = new Balance(value2, nonce2);
        const address2 = new Address(Dummy.address2);

        const value3 = 88888888;
        const nonce3 = 88888888;
        const balance3 = new Balance(value3, nonce3);
        const address3 = new Address(Dummy.address3);

        const tree = new AccountsTree();

        async function test(){
            await tree.put(address1, balance1);
            await tree.put(address2, balance2);
            await tree.put(address3, balance3);

            const balanceTest1 = await tree.get(address1);
            expect(balanceTest1.value).toEqual(value1);
            expect(balanceTest1.nonce).toEqual(nonce1);

            const balanceTest2 = await tree.get(address2);
            expect(balanceTest2.value).toEqual(value2);
            expect(balanceTest2.nonce).toEqual(nonce2);

            const balanceTest3 = await tree.get(address3);
            expect(balanceTest3.value).toEqual(value3);
            expect(balanceTest3.nonce).toEqual(nonce3);

            done();
        }

        test();
    });

    it('root hash is invariant to history', (done) => {
        const balance1 = new Balance(80000, 8);
        const balance2 = new Balance(8000000, 8);
        const address = new Address(Dummy.address1);

        const tree = new AccountsTree();

        async function test(){
            await tree.put(address, balance1);
            const state1 = tree.root.toBase64();

            await tree.put(address, balance2);
            const state2 = tree.root.toBase64();
            expect(state2).not.toBe(state1);

            await tree.put(address, balance1);
            const state3 = tree.root.toBase64();
            expect(state3).toBe(state1);

            done();
        }

        test();
    });

    it('root hash is invariant to insertion order', (done) => {
        const value1 = 8;
        const nonce1 = 8;
        const balance1 = new Balance(value1, nonce1);
        const address1 = new Address(Dummy.address1);

        const value2 = 88;
        const nonce2 = 88;
        const balance2 = new Balance(value2, nonce2);
        const address2 = new Address(Dummy.address2);

        const value3 = 88888888;
        const nonce3 = 88888888;
        const balance3 = new Balance(value3, nonce3);
        const address3 = new Address(Dummy.address3);

        const tree = new AccountsTree();

        async function test(){

            // order1
            await tree.put(address1, balance1);
            await tree.put(address2, balance1);
            await tree.put(address3, balance1);
            const state1 = tree.root.toBase64();


            // "reset"
            await tree.put(address1, balance2);
            await tree.put(address3, balance2);
            await tree.put(address2, balance2);
            // order2
            await tree.put(address1, balance1);
            await tree.put(address3, balance1);
            await tree.put(address2, balance1);
            const state2 = tree.root.toBase64();

            
            // "reset"
            await tree.put(address1, balance2);
            await tree.put(address3, balance2);
            await tree.put(address2, balance2);
            // order3
            await tree.put(address2, balance1);
            await tree.put(address1, balance1);
            await tree.put(address3, balance1);
            const state3 = tree.root.toBase64();


            // "reset"
            await tree.put(address1, balance2);
            await tree.put(address3, balance2);
            await tree.put(address2, balance2);
            // order4
            await tree.put(address2, balance1);
            await tree.put(address3, balance1);
            await tree.put(address1, balance1);
            const state4 = tree.root.toBase64();

            expect(state2).toBe(state1);
            expect(state3).toBe(state1);
            expect(state4).toBe(state1);

            done();
        }

        test();
    });


    it('can handle concurrency', (done) => {
        const value1 = 8;
        const nonce1 = 8;
        const balance1 = new Balance(value1, nonce1);
        const address1 = new Address(Dummy.address1);

        const value2 = 88;
        const nonce2 = 88;
        const balance2 = new Balance(value2, nonce2);
        const address2 = new Address(Dummy.address2);

        const value3 = 88888888;
        const nonce3 = 88888888;
        const balance3 = new Balance(value3, nonce3);
        const address3 = new Address(Dummy.address3);

        const tree = new AccountsTree();

        async function test(){
            await Promise.all([
                    tree.put(address1, balance1),
                    tree.put(address2, balance2),
                    tree.put(address3, balance3)
                ]);

            const balanceTest1 = await tree.get(address1);
            expect(balanceTest1.value).toEqual(value1);
            expect(balanceTest1.nonce).toEqual(nonce1);

            const balanceTest2 = await tree.get(address2);
            expect(balanceTest2.value).toEqual(value2);
            expect(balanceTest2.nonce).toEqual(nonce2);

            const balanceTest3 = await tree.get(address3);
            expect(balanceTest3.value).toEqual(value3);
            expect(balanceTest3.nonce).toEqual(nonce3);

            done();

            //TODO: remove await from tree.get call 
        }

        test();
    });


});
