require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
app.use(express.json({ limit: '50mb' }));

const cache = new NodeCache({ stdTTL: 86400 });
const heliusUrl = `https://api.helius.xyz/v0/webhooks?api-key=${process.env.HELIUS_API_KEY}`;

const MIN_SOL = 0.33;
const MAX_MC = 1_300_000;

const ROUTERS = {
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter',
  'photon3J...': 'Photon',
  'Axiom...': 'Axiom',
  'Trojan...': 'Trojan'
};

async function ensureWebhook() {
  try {
    await axios.post(heliusUrl, {
      webhookURL: process.env.WEBHOOK_URL,
      transactionTypes: ['ANY'],
      webhookType: 'enhanced'
    });
    console.log('SK1 Freshies webhook active');
  } catch {}
}
ensureWebhook();

async function isFreshWallet(addr) {
  try {
    const r = await axios.get(`https://api.helius.xyz/v0/addresses/${addr}/transactions?api-key=${process.env.HELIUS_API_KEY}&limit=10`);
    return r.data.length < 10;
  } catch { return false; }
}

async function getMarketCap(mint) {
  try {
    const r = await axios.get(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, { timeout: 3000 });
    return r.data.marketCap || 999_999_999;
  } catch {
    return 999_999_999;
  }
}

async function getWalletAge(addr) {
  try {
    const r = await axios.get(`https://api.helius.xyz/v0/addresses/${addr}/transactions?api-key=${process.env.HELIUS_API_KEY}&limit=1&before=earliest`);
    if (!r.data.length) return 'Just born';
    const mins = (Date.now() / 1000 - r.data[0].blockTime) / 60;
    return mins < 60 ? `${Math.floor(mins)}m` : mins < 1440 ? `${Math.floor(mins/60)}h` : `${Math.floor(mins/1440)}d`;
  } catch { return '?'; }
}

app.post('/webhook', async (req, res) => {
  for (const tx of req.body) {
    if (cache.has(tx.signature)) continue;
    cache.set(tx.signature, true);

    for (const t of tx.tokenTransfers || []) {
      const buyer = t.toUserAccount;
      if (!buyer || !await isFreshWallet(buyer)) continue;

      const solSpent = (tx.nativeTransfers?.find(nt => nt.toUserAccount === buyer)?.amount || 0) / 1e9;
      if (solSpent < MIN_SOL) continue;

      const mc = await getMarketCap(t.mint);
      if (mc > MAX_MC) continue;

      const symbol = t.tokenMetadata?.symbol || '???';
      const name = t.tokenMetadata?.name || t.mint.slice(0,8);
      const age = await getWalletAge(buyer);
      const router = ROUTERS[tx.instructions?.[0]?.programId] || 'Unknown';
      const source = tx.source || 'Unknown';

      const msg = 
`FRESH WALLET BUY by @sk1freshiesbot

SOL Spent: ${solSpent.toFixed(3)} SOL
Token: ${name} (${symbol})
MCap: $${mc.toLocaleString()}
Age: ${age}
Funded: ${source}
Router: ${router}

Buyer: \`${buyer.slice(0,8)}...${buyer.slice(-4)}\`
Tx: https://solscan.io/tx/${tx.signature}\``;

      bot.telegram.sendMessage('@your_test_channel_or_chat_id', msg, {parse_mode: 'Markdown'});
    }
  }
  res.sendStatus(200);
});

bot.start(ctx => ctx.reply('SK1 Freshies LIVE | ≥0.33 SOL | ≤$1.3M MC'));
bot.command('test', ctx => ctx.reply('Bot active – filters applied'));

app.listen(3000, () => {
  console.log('SK1 Freshies running with 0.33 SOL min + 1.3M MC max');

});
