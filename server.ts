import express from "express";
import dotenv from "dotenv";
import {
  BroadcastMode,
  MsgGrantAllowance,
  MsgRevokeAllowance,
  SecretNetworkClient,
  validateAddress,
  Wallet,
} from "secretjs";
import { Timestamp } from "secretjs/dist/protobuf/google/protobuf/timestamp";
import { QueryAllowanceResponse } from "secretjs/dist/grpc_gateway/cosmos/feegrant/v1beta1/query.pb";
import { BasicAllowance } from "secretjs/dist/protobuf/cosmos/feegrant/v1beta1/feegrant";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 3000;

const SECRET_CHAIN_ID = process.env.CHAIN_ID || "secret-4";
const SECRET_LCD = process.env.LCD_NODE || "https://lcd.mainnet.secretsaturn.net";

const faucetReload = process.env.DECOY_REFRESH_TIME || "60";
const faucetFetch = process.env.FETCH_LIMIT || "25000";

let decoyAccounts = <any>[]; // Array to hold the prefetched decoys

// Function to fetch all decoy addresses
async function fetchAllDecoys(secretjsquery: any, nextKey = null) {
    const response = await secretjsquery.query.auth.accounts({
        pagination: { 
            key: nextKey,
            limit: Number(faucetFetch),
        },
    });

    let accounts = response.accounts
    console.log('Fetched accounts:',response.accounts.length)

    if (response.pagination && response.pagination.next_key != null) {
        accounts = accounts.concat(await fetchAllDecoys(secretjsquery, response.pagination.next_key));
    }

    return accounts;
}

// Function to prefetch decoys
async function prefetchDecoys() {
    try {
      console.log('Fetching Decoys');
        const secretjsquery = new SecretNetworkClient({
            url: SECRET_LCD,
            chainId: SECRET_CHAIN_ID,
        });

        decoyAccounts = await fetchAllDecoys(secretjsquery);
        console.log('Decoys prefetched:', decoyAccounts.length);
    } catch (error) {
        console.error('Error prefetching decoys:', error);
    }
}

// Prefetch decoys immediately and then every 'faucetReload' seconds
prefetchDecoys();
setInterval(prefetchDecoys, Number(faucetReload)*1000);

// Endpoint to get random decoys
app.get('/decoys', (req, res) => {
    let count = Number(req.query.count) || 500;
    if (count > 20000 || count < 0) {
      count = 20000
    }
    const filterSequence = req.query.filterSequence || false;

    let filteredDecoys = decoyAccounts.reduce((result:any, account: any) => {
        // add extra filtering options if needed here
        if (Number(account?.sequence) > 0 || !filterSequence) {
            result.push(account.address);
        }
        return result;
    }, []);

    const randomDecoys = Array.from({ length: Math.min(Number(count), filteredDecoys.length) }, () => filteredDecoys[Math.floor(Math.random() * filteredDecoys.length)]);

    res.json(JSON.stringify({'decoys':randomDecoys}));
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});

