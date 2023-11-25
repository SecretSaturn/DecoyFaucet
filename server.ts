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

dotenv.config();

const app = express();

const PORT = process.env.PORT || 3001;

const SECRET_CHAIN_ID = process.env.CHAIN_ID || "secret-4";
const SECRET_LCD = process.env.LCD || "https://lcd.mainnet.secretsaturn.net";

const faucetAmount = process.env.FAUCET_AMOUNT || "10000";
const faucetDenom = process.env.FAUCET_DENOM || "uscrt";

const faucetReload = process.env.FAUCET_RELOAD_TIME || "24";
const faucetReloadHours = Number(faucetReload)
const faucetReloadSeconds = Math.ceil(faucetReloadHours * 3600);

const gasDenom = process.env.GAS_DENOM || "uscrt";
const gasFee = process.env.GAS_FEE || "0.5";
const gasLimit = process.env.GAS_LIMIT || "17500";

const memo = process.env.MEMO || "";

const mnemonic = process.env.FAUCET_MNEMOMIC || "";

const wallet = new Wallet(mnemonic);

const faucetAddress = wallet.address;

const secretjs = new SecretNetworkClient({
  url: SECRET_LCD,
  chainId: SECRET_CHAIN_ID,
  wallet: wallet,
  walletAddress: faucetAddress,
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});

app.use(express.static('public'));

app.get("/claim/:address", async (req, res) => {
  const { address } = req.params;

  if (!address) {
    return res.status(400).json({error: "Address is required"});
  }
  if (!validateAddress(address).isValid) {
    return res.status(400).json({error: "Address is invalid"});
  }

  try {
    const { balance } = await secretjs.query.bank.balance({
      address,
      denom: "uscrt",
    });

    if (Number(balance?.amount) != 0) {
      console.log("Account has funds")
    }

    secretjs.query.feegrant
      .allowance({ grantee: address, granter: faucetAddress })
      .then(async (result: any) => {
        console.log("result:",result);
        if (result?.allowance) {
          if (isFeeGrantExpired(result.allowance.allowance.expiration,faucetReloadSeconds)) {
            console.log("Fee Grant expired");

            await giveFeeGrant(secretjs, address, true);

            await sleep(5000)

            const newFeeGrant: QueryAllowanceResponse = await secretjs.query.feegrant.allowance({ grantee: address, granter: faucetAddress })

            const results = [{ feegrant: newFeeGrant?.allowance?.allowance }, { address: address }];
            return res.json(results);
          }
          else {
            console.log("Existing Fee Grant");

            const results = [{ feegrant: result.allowance.allowance }, { address: address }];
            return res.json(results);
          }
        } else {
          console.log("new feegrant");

          await giveFeeGrant(secretjs, address, false);
          
          await sleep(5000)

          const newFeeGrant = await secretjs.query.feegrant.allowance({ grantee: address, granter: faucetAddress })
          console.log(newFeeGrant)

          const results = [{ feegrant: newFeeGrant?.allowance?.allowance  }, { address: address }];
          return res.json(results);
        }
      }).catch((e) => {
        console.error(JSON.stringify(e));
        return res.status(400).json({ error: e });
      })
  } catch (error) {
    console.error("Error querying data:", error);
    return res.status(500).send("Internal Server Error");
  }
});

app.get("/", async (req, res) => {
  const htmlContent = ``;

  return res.send(htmlContent);
});

function isFeeGrantExpired(expirationTime: string, extraSeconds: number) {
    // Parse the expiration time into a Date object
    const expirationDate = new Date(expirationTime);
  
    // Get the current time as a Date object
    const currentDate = new Date();
  
    // Add the extra number of seconds to the current time
    const adjustedCurrentDate = new Date(currentDate.getTime() + extraSeconds); 
    return adjustedCurrentDate > expirationDate
}

async function giveFeeGrant(
  secretjs: SecretNetworkClient,
  address: string,
  revokeOldFeeGrant: boolean,
) {

  const nowInSeconds = Math.floor(Date.now() / 1000);
  const expirationTimeInSeconds = nowInSeconds + faucetReloadSeconds;

  let msgs;

  const revokeMsg = new MsgRevokeAllowance({
    grantee: address,
    granter: faucetAddress,
  })

  const grantMsg = new MsgGrantAllowance({
    grantee: address,
    granter: faucetAddress,
    allowance: {
      expiration: Timestamp.fromPartial({
        seconds: expirationTimeInSeconds.toString(),
      }),
      spend_limit: [
        {
          amount: faucetAmount,
          denom: faucetDenom,
        },
      ],
    },
  })

  if (revokeOldFeeGrant) {
    msgs = [revokeMsg, grantMsg]
  }
  else {
    msgs = [grantMsg]
  }

  try {
  const tx = await secretjs.tx.broadcast(
        msgs,
        {
          memo: memo,
          broadcastCheckIntervalMs: 100,
          feeDenom: gasDenom,
          gasPriceInFeeDenom: Number(gasFee),
          gasLimit: Number(gasLimit),
          broadcastMode: BroadcastMode.Block,
        },
    )
    console.log('Result', tx)
    if (tx) {
      if (tx.code === 0) {
        return "success";
      } else {
        console.error(tx.rawLog);
        throw tx.rawLog
      }
    }
  }
    catch (e) {
      console.error('Error',e)
      throw e
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

