import {
    ActionPostResponse,
    ACTIONS_CORS_HEADERS,
    createPostResponse,
    ActionGetResponse,
    ActionPostRequest,
    createActionHeaders
} from "@solana/actions";
import {
    clusterApiUrl,
    Connection,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
} from '@solana/web3.js';
import * as splToken from '@solana/spl-token';
import axios from "axios";

const splPubkeyMap: Record<string, [string, number]> = {
  ["USDC"]: ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", 6],
  ["BONK"]: ["DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", 5]
}

const pubkeyToDonateTo = '4ypD7kxRj9DLF3PMxsY3qvp8YdNhAHZRnN3fyVDh5CFX'
const title = 'Donate to Market Spy'
const icon = 'https://assets.marketspy.au/imgs/marketspy-logo-black.svg'
const desc = "Visit marketspy.au | Price data powered by Market Spy"
const successMsg = "Thank you for your support!"

export const GET = async (req: Request) => {
    try {
      const requestUrl = new URL(req.url);
      const { toPubkey } = validatedQueryParams(requestUrl);
      let assetPrices = {"SOL": "0", "BONK": "0", "USDC": "1"}

     const tokenPriceData = await axios.get("https://api.marketspy.au:8443/asset-price?asset=SOL&asset=BONK&quote=USDC")
  
      const baseHref = new URL(
        `/api/actions/donate-sol?to=${toPubkey.toBase58()}`,
        requestUrl.origin,
      ).toString();

      if (tokenPriceData.data){
        tokenPriceData.data.map((tokenDeets: { asset: string; price: string; }) => {
          if (tokenDeets.asset == "SOL"){
            assetPrices["SOL"] = parseFloat(tokenDeets.price).toFixed(2)
          }
          if (tokenDeets.asset == "BONK") {
            assetPrices["BONK"] = parseFloat(tokenDeets.price).toFixed(8)
          }
        })
      }

      let options : Array<any> = [{
        selected: true,
        label: `SOL (~$${assetPrices["SOL"]} USD)`,
        value: "SOL",
      }]
      Object.keys(splPubkeyMap).map(assetID => {
        const price = assetPrices[assetID as keyof typeof assetPrices];
        options.push({
          label: `${assetID} (~$${price ? price : "N/A"} USD)`,
          value: assetID,
        })
      })
  
      const payload: ActionGetResponse = {
        title,
        icon,
        description:
          desc,
        label: 'Transfer', // this value will be ignored since `links.actions` exists
        links: {
          actions: [
            {
              label: 'Donate', // button text
              href: `${baseHref}&token={token}&amount={amount}`, // this href will have a text input
              parameters: [
                {
                  type: "select",
                  name: "token",
                  options,
                },
                {
                  type: "text",
                  required: true,
                  name: "amount",
                  label: "Amount to send",
                },
              ],
            },
          ],
        },
      };
  
      return Response.json(payload, {
        headers: ACTIONS_CORS_HEADERS,
      });
    } catch (err) {
      console.log(err);
      let message = 'An unknown error occurred';
      if (typeof err == 'string') message = err;
      
      return new Response(message, {
        status: 400,
        headers: ACTIONS_CORS_HEADERS,
      });
    }
};
  

 export const OPTIONS = GET;

 export const POST = async (req: Request) => {
    const requestUrl = new URL(req.url);
    const { token, amount, toPubkey } = validatedQueryParams(requestUrl);

    const body: ActionPostRequest = await req.json();

    // validate the client provided input
    let account: PublicKey;
    try {
      account = new PublicKey(body.account);
    } catch (err) {
      return new Response('Invalid "account" provided', {
        status: 400,
        headers: ACTIONS_CORS_HEADERS,
      });
    }

    const connection = new Connection(
      process.env.SOLANA_RPC! || clusterApiUrl('mainnet-beta'),
      //clusterApiUrl("devnet"),
    );

    // ensure the receiving account will be rent exempt
    const minimumBalance = await connection.getMinimumBalanceForRentExemption(
      0, // note: simple accounts that just store native SOL have `0` bytes of data
    );
    if (amount * LAMPORTS_PER_SOL < minimumBalance) {
      throw `account may not be rent exempt: ${toPubkey.toBase58()}`;
    }

    let instructions = [];
  
    if (token == "SOL"){
      // create an instruction to transfer native SOL from one wallet to another
      const transferSolInstruction = SystemProgram.transfer({
        fromPubkey: account,
        toPubkey: toPubkey,
        lamports: amount * LAMPORTS_PER_SOL,
      });

      instructions.push(transferSolInstruction)
    } else {
      const decimals = splPubkeyMap[token][1]; // In the example, we use 6 decimals for USDC, but you can use any SPL token
      const mintAddress = new PublicKey(`${splPubkeyMap[token][0]}`); // replace this with any SPL token mint address

      // converting value to fractional units

      let transferAmount: any = parseFloat(amount.toString());
      transferAmount = transferAmount.toFixed(decimals);
      transferAmount = transferAmount * Math.pow(10, decimals);

      const fromTokenAccount = await splToken.getAssociatedTokenAddress(
        mintAddress,
        account,
        false,
        splToken.TOKEN_PROGRAM_ID,
        splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
      );

      let toTokenAccount = await splToken.getAssociatedTokenAddress(
        mintAddress,
        toPubkey,
        true,
        splToken.TOKEN_PROGRAM_ID,
        splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
      );

      const ifexists = await connection.getAccountInfo(toTokenAccount);

      if (!ifexists || !ifexists.data) {
        let createATAiX = splToken.createAssociatedTokenAccountInstruction(
          account,
          toTokenAccount,
          toPubkey,
          mintAddress,
          splToken.TOKEN_PROGRAM_ID,
          splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
        );
        instructions.push(createATAiX);
      }

      let transferInstruction = splToken.createTransferInstruction(
        fromTokenAccount,
        toTokenAccount,
        account,
        transferAmount,
      );
      instructions.push(transferInstruction);
    }

    // get the latest blockhash amd block height
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();

    // create a legacy transaction
    const transaction = new Transaction({
      feePayer: account,
      blockhash,
      lastValidBlockHeight,
    }).add(...instructions);
        
    const payload: ActionPostResponse = await createPostResponse({
      fields: {
        transaction,
        message: successMsg,
      },
    });
    
    return Response.json(payload, {
      headers: ACTIONS_CORS_HEADERS,
    });
};

  function validatedQueryParams(requestUrl: URL) {
    let toPubkey: PublicKey = new PublicKey(
      pubkeyToDonateTo,
    );
    let amount: number = 0.1;
    let token: string = "SOL"
  
    try {
      if (requestUrl.searchParams.get('to')) {
        toPubkey = new PublicKey(requestUrl.searchParams.get('to')!);
      }
    } catch (err) {
      throw 'Invalid input query parameter: to';
    }
  
    try {
      if (requestUrl.searchParams.get('amount')) {
        amount = parseFloat(requestUrl.searchParams.get('amount')!);
      }
  
      if (amount <= 0) throw 'amount is too small';
    } catch (err) {
      throw 'Invalid input query parameter: amount';
    }

    try {
      if (requestUrl.searchParams.get('token')) {
        token = requestUrl.searchParams.get('token')!;
      }
  
      //if (pubkeyMap[token] == null) throw 'not valid token';
    } catch (err) {
      throw 'Invalid input query parameter: token';
    }
  
    return {
      token,
      amount,
      toPubkey,
    };
  }