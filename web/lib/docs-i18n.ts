/**
 * Copy for the /docs page, English + Chinese. Every number is derived from lib/economics.ts.
 * Describes the OFF-CHAIN (custodial) launch mode — see SPEC.md "OFF-CHAIN MODE".
 */
import {
  CREATOR_PCT, CUSTODY_WINDOW_H, DEFAULT_COOLDOWN_S, FLAP_CUT_PCT, MIN_HOLD_PCT, MIN_HOLD_TOKENS, PACKS,
  PULL_BUFFER_PCT, SELL_BACK, SPLIT, TAX_PCT, TOTAL_SUPPLY, money, volumePerPull, workedExample,
} from './economics';
import type { Lang } from './i18n';
import type { Strategy } from './types';

export const DOC_SECTIONS = [
  'overview', 'how', 'fees', 'packs', 'strategies', 'rewards', 'launch', 'forge', 'safety', 'contracts', 'faq', 'glossary',
] as const;
export type DocSection = (typeof DOC_SECTIONS)[number];

type Item = { t: string; d: string };
type QA = { q: string; a: string };

/** GachaForge treasury wallet: tax recipient of every machine token. */
export const TREASURY_ADDRESS = '0x49060cd4C7679e7F6dB1075027F121a7c9F97a7c';

const EX = workedExample(10_000, 28);
const n = (x: number) => x.toLocaleString('en-US');
const NET = 100 - FLAP_CUT_PCT;
const p0 = PACKS[0];
const [, s24, s72] = SELL_BACK;
const minTok = n(MIN_HOLD_TOKENS);
const supply = n(TOTAL_SUPPLY);
const vpp0 = money(Math.round(volumePerPull(p0.usd)));
const T_SHORT = '0x4906…7a7c';

const en = {
  kicker: 'Documentation',
  title: 'How GachaForge works',
  lead: 'Everything about the launchpad in one place: where the tax goes, who holds the money, how a machine pulls cards, how holders get paid and what you have to trust.',
  preview: 'GachaForge runs in custodial (off-chain) mode: there are no GachaForge smart contracts. Tax is paid to the GachaForge treasury wallet, pots are tracked in GachaForge\'s ledger, and GachaForge\'s operations wallet carries out every pull and payout. Until launch, the board, pulls and stats show simulated preview data.',
  onThisPage: 'On this page',
  nav: {
    overview: 'Overview', how: 'How it works', fees: 'Fees & tax', packs: 'Packs & cards', strategies: 'Strategies',
    rewards: 'Earning rewards', launch: 'Launching a token', forge: '$FORGE buyback & burn', safety: 'Trust & safety',
    contracts: 'Wallets & contracts', faq: 'FAQ', glossary: 'Glossary',
  } as Record<DocSection, string>,

  overview: {
    p1: `GachaForge turns a meme token into a gacha machine. Each token is launched on flap.sh (BNB Chain) with a fixed ${TAX_PCT}% tax on buys and on sells, paid to the GachaForge treasury wallet. GachaForge's backend records a slice of every trade's tax as that token's gacha pot. Whenever the pot can afford a pack, GachaForge buys a real graded trading-card pack through Renaiss. The strategy chosen at launch decides whether the card goes to a holder or is turned back into BNB for holders or burns.`,
    p2: 'This is a custodial service. The money sits in GachaForge wallets and GachaForge carries out the rules; there is no smart contract forcing it to. What you get instead is a public record of every balance and transaction, so you can check that it does.',
    roles: [
      { t: 'Creator', d: `Launches the token on flap.sh from the Launch page and makes the one-time choices: name, art, pack and strategy. Earns ${CREATOR_PCT}% of the tax and has no control over the pot. A creator who holds the token qualifies for rewards like everyone else.` },
      { t: 'Holder', d: `Anyone holding at least ${MIN_HOLD_PCT}% of supply (${minTok} tokens) when a round is snapshotted. Holders win cards, receive BNB dividends sent straight to their wallet, or benefit from burns, depending on the strategy.` },
      { t: 'GachaForge', d: `Receives the tax, keeps the ledger, holds the pots and runs every pull, raffle, payout and burn from its operations wallet. Keeps ${SPLIT.platform}% of the tax that reaches it as the platform share.` },
    ] as Item[],
  },

  how: {
    intro: 'A machine runs the same loop for its whole life.',
    steps: [
      { t: 'Launch', d: 'A creator launches the token directly on flap.sh from the Launch page, with the GachaForge treasury as tax recipient. GachaForge registers the pack and strategy.' },
      { t: 'Trade', d: `Every buy and sell pays ${TAX_PCT}% to the treasury. After flap.sh's share, GachaForge's ledger splits the rest ${SPLIT.platform} / ${SPLIT.pot} / ${SPLIT.buyback}.` },
      { t: 'Pull', d: 'Once the pot balance covers one pack, the operations wallet buys a pack from Renaiss and the card is revealed.' },
      { t: 'Reward', d: 'The strategy routes the card: raffled to a holder, or sold back and paid out as dividends or burns.' },
    ] as Item[],
    taxLabel: 'Each trade',
    flapLabel: 'flap.sh',
    gfLabel: 'GachaForge treasury',
    platformLabel: 'Platform',
    potLabel: 'Gacha pot',
    buybackLabel: '$FORGE burn',
    loopNote: 'The pot refills from trading volume, so the loop repeats for as long as people trade. The pot is an accounting balance in GachaForge\'s ledger; the BNB behind it sits in GachaForge wallets.',
  },

  fees: {
    intro: `Every GachaForge token pays the same tax: ${TAX_PCT}% on buys and ${TAX_PCT}% on sells. It is set in the flap.sh token at launch, and its recipient is the GachaForge treasury wallet (${T_SHORT}).`,
    flapNote: `flap.sh keeps about ${FLAP_CUT_PCT}% of the tax (measured on a BSC mainnet fork at the ${TAX_PCT}% rate). That share is set by flap.sh, not by GachaForge, and may change. The remaining ${NET}% reaches the treasury, where GachaForge's backend ledger divides it into the three shares below. The shares are bookkeeping entries; the BNB itself stays in GachaForge wallets until it is spent.`,
    barWhole: 'The whole tax',
    barVault: 'What reaches GachaForge',
    seg: { flap: 'flap.sh', platform: 'GachaForge platform', pot: 'Gacha pot', buyback: '$FORGE buyback & burn' },
    creator: `Creator: ${CREATOR_PCT}%.`,
    exTitle: 'Worked example',
    exRows: [
      ['Trading volume', money(EX.volumeUsd)],
      [`Tax at ${TAX_PCT}%`, money(EX.tax)],
      [`flap.sh share (~${FLAP_CUT_PCT}%)`, '−' + money(EX.flap)],
      ['Reaches GachaForge', money(EX.net)],
      [`GachaForge platform (${SPLIT.platform}%)`, money(EX.platform)],
      [`Gacha pot (${SPLIT.pot}%)`, money(EX.pot)],
      [`$FORGE buyback & burn (${SPLIT.buyback}%)`, money(EX.buyback)],
    ] as [string, string][],
    exNote: `That pot share is about ${EX.pulls.toFixed(2)} of a ${money(EX.packUsd)} pull.`,
    startTitle: 'When pulls start',
    startBody: 'A machine does not wait for graduation. The first pull happens as soon as the pot covers one pack, even while the token is still on the flap.sh bonding curve. After that it pulls again each time the pot refills, one pull at a time, with a cooldown in between.',
    freqTitle: 'How much volume funds one pull',
    freqIntro: `Only ${SPLIT.pot}% of the ${NET}% that reaches GachaForge goes to the pot, so the pot grows by about ${(TAX_PCT * NET * SPLIT.pot / 10_000).toFixed(3)}% of trading volume. Approximate volume needed per pull:`,
    freqCols: ['Pack', 'Volume per pull'],
    freqNote: `Figures exclude the up-to-${PULL_BUFFER_PCT}% price buffer and ignore BNB price moves. Only the BNB actually spent on a pull is taken off the pot.`,
  },

  packs: {
    renaissTitle: 'What Renaiss is',
    renaissBody: 'Renaiss is the card partner behind every pull. It sells the packs, holds the graded slabs in its vault, reports each card\'s value and runs the sell-back desk. GachaForge never touches the physical cards.',
    cols: ['Pack', 'Price per pull', 'Max win'],
    pricing: `A pull pays the pack's dollar price in BNB at the Chainlink BNB/USD price. The operations wallet swaps BNB for USDT on PancakeSwap and buys the pack from Renaiss, spending at most the pack price plus ${PULL_BUFFER_PCT}%. The pot is reduced by the BNB actually spent.`,
    gradersTitle: 'Graders',
    gradersBody: 'Cards come already graded and sealed by one of the major grading houses: PSA, CGC or BGS. The grade and certificate are shown with every pull.',
    custodyTitle: 'Custody',
    custodyBody: `Renaiss keeps the card. When a holder wins one, there is a ${CUSTODY_WINDOW_H}-hour window during which the card stays in Renaiss custody (and can be sold back). After Renaiss releases it, GachaForge's operations wallet transfers the card NFT to the winner.`,
    sellTitle: 'Sell-back schedule',
    sellCols: ['Sold back within', 'You receive'],
    sellRows: SELL_BACK.map((s) => [`${s.withinH} h`, `${s.pct}% of card value`]) as [string, string][],
    sellNote: 'Machines that sell cards (Dividend, Burn, Split, and Raffle or Hit Hunter when nobody wins) sell back inside the first window so the best rate applies.',
  },

  strategies: {
    intro: 'The creator picks one of five strategies at launch. GachaForge records it with the machine and does not change it afterwards.',
    gets: 'Holders get',
    best: 'Best for',
    items: {
      RAFFLE: { gets: 'Every card goes to one eligible holder, drawn with odds proportional to balance. If nobody qualifies, the card is sold back and the BNB goes back into the pot.', best: 'Communities that want the thrill of owning real slabs.' },
      HIT_HUNTER: { gets: 'Only hits are raffled: a card worth more than the pack price goes to a holder. Anything below that is sold back and the BNB buys and burns the token.', best: 'Holders who want big wins and steady burn pressure.' },
      DIVIDEND: { gets: 'Every card is sold back and the BNB is sent straight to eligible holders\' wallets in proportion to balance. Nothing to claim.', best: 'Holders who prefer BNB income to cards.' },
      BURN: { gets: 'Every card is sold back and the BNB buys the token on the market and sends it to the dead address.', best: 'Deflation-minded tokens with no payouts to manage.' },
      SPLIT: { gets: 'Every card is sold back and the BNB is divided by the creator\'s fixed ratio between dividends and buy & burn. Any LP share is burned as well.', best: 'Creators who want a balanced mix.' },
    } as Record<Strategy, { gets: string; best: string }>,
  },

  rewards: {
    eligTitle: 'Who qualifies',
    eligBody: `Each round takes a snapshot of balances at the pull's block. You qualify if you held at least ${MIN_HOLD_PCT}% of total supply at that block: ${minTok} tokens out of ${supply}. Odds and dividend shares are proportional to your balance among everyone who qualifies.`,
    exclTitle: 'Never counted',
    excl: ['Liquidity pools and pairs', 'The token contract', 'flap.sh launchpad contracts and the router', 'GachaForge wallets and other contracts', 'The zero and dead addresses'],
    raffleTitle: 'Raffle draws, step by step',
    raffle: [
      'A pull settles and the round\'s snapshot block is fixed.',
      'GachaForge reads eligible balances at that block, lists them in a fixed order and publishes the list with its hash.',
      'A seed is derived from that block\'s hash and the pull id.',
      'The seed, taken modulo the total eligible balance, picks a ticket. The holder whose cumulative balance covers that ticket wins.',
      'The proof (snapshot, seed, winner) is published on the pull, so anyone can repeat the steps and get the same winner.',
    ],
    divTitle: 'Dividends, step by step',
    div: [
      'Card sell-back proceeds are set aside for the round.',
      'The BNB is split among eligible holders by balance.',
      'The operations wallet sends each share directly to the holder\'s wallet. You do not need to claim anything.',
      'Every payout transaction is listed on the Transparency page with a BscScan link.',
      'Amounts too small to be worth the gas carry over and are added to your next payout.',
    ],
    claimTitle: 'Checking on the machine page',
    claim: [
      'Open the machine from the board and connect your wallet.',
      'The Your rewards panel shows eligibility, balance, raffle odds and what you have received.',
      'Dividends and cards arrive in your wallet automatically; there is no claim button.',
    ],
  },

  launch: {
    intro: 'Tokens are launched directly through flap.sh from the Launch page, signed by your own wallet. GachaForge deploys no contract for it.',
    steps: [
      { t: 'Token info', d: 'Name, ticker, image, description and optional links.' },
      { t: 'Pick a pack', d: PACKS.map((p) => money(p.usd)).join(', ') + ' per pull. This sets how much pot each pull needs.' },
      { t: 'Strategy', d: 'Choose one of the five strategies. For Split, set the dividend / burn ratio.' },
      { t: 'Initial buy (optional)', d: 'Buy in the same transaction so you are first on the curve.' },
      { t: 'Launch', d: `Your browser mines a vanity salt, you sign the flap.sh launch with a ${TAX_PCT}% / ${TAX_PCT}% tax paid to the GachaForge treasury, and GachaForge registers your pack and strategy.` },
    ] as Item[],
    lockedTitle: 'Fixed at launch',
    locked: [`${TAX_PCT}% buy / ${TAX_PCT}% sell tax (set in the flap.sh token)`, 'Tax recipient: GachaForge treasury', `${SPLIT.platform} / ${SPLIT.pot} / ${SPLIT.buyback} split (GachaForge ledger)`, 'Pack (recorded by GachaForge, not changed)', 'Strategy and, for Split, its ratio (recorded by GachaForge, not changed)'],
    vanityTitle: 'Why the address ends in 7777',
    vanityBody: 'flap.sh requires tax tokens to live at an address ending in 7777. The Launch page searches for a matching salt in your browser before you sign (about 65,000 tries, usually a few seconds).',
    costTitle: 'What it costs',
    costBody: `flap.sh's own launch fees (if any), network gas, and whatever initial buy you choose. GachaForge charges no launch fee. The creator earns ${CREATOR_PCT}% of the tax.`,
  },

  forge: {
    p1: `${SPLIT.buyback}% of the tax that reaches GachaForge is recorded in the ledger as the $FORGE buyback balance. When that balance is large enough, GachaForge's operations wallet buys $FORGE through flap.sh and sends it to the dead address.`,
    p2: '$FORGE has not launched yet. Until it does, the buyback balance keeps growing in the ledger (the BNB sits in GachaForge wallets). Buybacks start once $FORGE is live.',
    p3: 'Every buyback and burn transaction is listed on the Transparency page, and running totals are on the Buyback & Burn page.',
    link: 'Open Buyback & Burn',
  },

  safety: {
    intro: 'This section is deliberately plain about how the system works and what you have to trust.',
    custodialTitle: 'This is custodial and off-chain',
    custodialBody: 'There are no GachaForge smart contracts. Tax lands in the GachaForge treasury wallet, pots and buyback balances are entries in GachaForge\'s database, and GachaForge\'s operations wallet makes every pull, raffle transfer, dividend payment, burn and buyback. Nothing on-chain forces GachaForge to do this: you are trusting GachaForge to honour the pots and payouts.',
    trustTitle: 'What you are trusting',
    trust: [
      'GachaForge to keep enough BNB in its wallets to cover every pot and buyback balance it owes.',
      'GachaForge\'s backend to record tax correctly, run pulls when pots are full and pay winners and holders.',
      'GachaForge not to change a machine\'s pack or strategy after launch.',
      'Renaiss to hold the cards, report their value and pay sell-backs.',
      'Chainlink for the BNB/USD price, and PancakeSwap for swaps.',
    ],
    guardTitle: 'Safeguards',
    guards: [
      'A public Transparency page shows the treasury balance next to the total owed to pots, buyback and pending dividends.',
      'Every operations-wallet transaction is listed there with a BscScan link.',
      'Raffle proofs (snapshot, seed, winner) are published and can be re-checked by anyone.',
      `A daily spending cap on the operations wallet, and a per-pull cap of pack price plus ${PULL_BUFFER_PCT}%.`,
      'A pause switch that stops all outgoing operations instantly.',
    ],
    transparencyLink: 'Open Transparency',
    flapTitle: 'flap.sh',
    flap: 'flap.sh admins can redirect a token\'s tax to another recipient, and flap.sh contracts are upgradeable proxies. GachaForge cannot prevent either. flap.sh also sets its own share of the tax.',
    renaissTitle: 'Renaiss custody',
    renaiss: 'Physical cards are held by Renaiss, not by GachaForge or by you, until they are released. If Renaiss fails to deliver or pay a sell-back, GachaForge cannot force it to.',
    auditTitle: 'Audit status',
    audit: 'GachaForge\'s backend and wallet operations have not been externally audited. Nothing on this site is financial advice.',
    previewTitle: 'Preview data',
    previewBody: 'Until launch, the board, pulls and stats on this site are simulated. Do not treat them as real results.',
  },

  contracts: {
    intro: 'Everything is on BNB Chain (chain id 56). GachaForge itself has no contracts, only the two wallets below; the rest are third-party contracts it uses.',
    cols: ['Wallet / contract', 'Address'],
    unset: 'Published at launch',
    unsetForge: 'Added once $FORGE is live',
    rows: {
      treasury: 'GachaForge treasury wallet (tax recipient)', ops: 'GachaForge operations wallet (pulls, payouts, burns)', portal: 'flap.sh Portal', taxImpl: 'flap.sh Tax Token V3 implementation',
      feed: 'Chainlink BNB/USD feed', router: 'PancakeSwap router', forge: '$FORGE token',
    } as Record<string, string>,
  },

  faq: [
    { q: 'Where is the pot money held?', a: 'In GachaForge wallets. Tax is paid to the treasury wallet, and each machine\'s pot is an accounting balance in GachaForge\'s ledger, not a separate contract. The Transparency page shows the treasury balance against everything owed to pots and buybacks.' },
    { q: 'Are the cards real?', a: 'Yes. Every pull buys a real, graded card (PSA, CGC or BGS) from Renaiss, which keeps it in custody. The site currently shows simulated preview pulls until launch.' },
    { q: 'How do I win a card?', a: `Hold at least ${minTok} tokens (${MIN_HOLD_PCT}% of supply) of a Raffle or Hit Hunter machine at the round's snapshot block. Your chance equals your share of the total eligible balance. The card is transferred to your wallet after Renaiss releases it.` },
    { q: 'How do I get dividends?', a: 'Automatically. On Dividend (and Split) machines, cards are sold back for BNB and GachaForge\'s operations wallet sends each eligible holder their share directly. There is nothing to claim; very small amounts roll over to your next payout.' },
    { q: 'What if GachaForge stops?', a: 'Then pulls and payouts stop. Because the system is custodial, there is no contract that keeps running without GachaForge, and pot balances depend on GachaForge paying them out. Your tokens stay tradable on flap.sh / PancakeSwap, and the tax keeps going to the treasury unless flap.sh redirects it.' },
    { q: 'How can I verify?', a: 'Open the Transparency page: it lists the treasury balance, the total owed to pots, buyback and dividends, and every operations-wallet transaction with a BscScan link. Each raffle publishes its snapshot, seed and winner so you can recompute the draw yourself.' },
    { q: 'Can the creator withdraw the pot?', a: 'No. The creator has no access to the pot. Only GachaForge\'s operations wallet spends it, on pulls capped at the pack price plus the buffer.' },
    { q: 'Can the tax change?', a: `The ${TAX_PCT}% rate is set in the flap.sh token at launch. The ${SPLIT.platform} / ${SPLIT.pot} / ${SPLIT.buyback} split is applied by GachaForge's ledger. flap.sh controls its own share and can technically redirect a token's tax (see Trust & safety).` },
    { q: `Where does the ${SPLIT.platform}% go?`, a: `It stays with GachaForge as the platform share: development, infrastructure, the backend that runs pulls, and operations. The creator gets ${CREATOR_PCT}%.` },
    { q: 'Why hasn\'t my machine pulled yet?', a: `The pot has to cover a full pack first. On a ${money(p0.usd)} machine that takes roughly ${vpp0} of trading volume. Pulls also wait for the previous one to settle and for the cooldown (${DEFAULT_COOLDOWN_S} s by default), and stop while operations are paused or the daily cap is reached. "Pull queued" means card buying has not started yet.` },
    { q: 'What if nobody qualifies?', a: 'On Raffle machines the card is sold back and the BNB goes back into the pot for the next pull. On dividend payouts, the BNB is kept for a round that has eligible holders.' },
    { q: 'Do I need to stay holding after a snapshot?', a: 'Eligibility is decided only by your balance at the snapshot block. Selling afterwards does not cancel a reward for that round, but you will not count in later rounds unless you hold again.' },
    { q: 'What does it cost to launch?', a: 'flap.sh\'s own fees, gas, and an optional initial buy. There is no GachaForge launch fee.' },
    { q: 'Is this financial advice?', a: 'No. Nothing on this site is financial advice. Meme tokens are highly volatile and can go to zero.' },
  ] as QA[],

  glossary: [
    { t: 'Machine', d: 'A GachaForge token together with its pot, pack and strategy.' },
    { t: 'Treasury wallet', d: 'The GachaForge wallet every machine token pays its tax to.' },
    { t: 'Operations wallet', d: 'The GachaForge wallet that buys packs, transfers cards, pays dividends and runs burns and buybacks.' },
    { t: 'Ledger', d: 'GachaForge\'s append-only record of how every trade\'s tax is split and spent.' },
    { t: 'Gacha pot', d: `The ${SPLIT.pot}% share of tax set aside to buy card packs. An accounting balance; the BNB sits in GachaForge wallets.` },
    { t: 'Pull', d: 'One pack purchase from Renaiss, paid out of the pot.' },
    { t: 'Round', d: 'One reward cycle tied to a pull, with its own snapshot block.' },
    { t: 'Snapshot block', d: 'The block at which balances are read to decide eligibility.' },
    { t: 'Raffle proof', d: 'The published snapshot, seed and winner of a raffle, enough to recompute the draw.' },
    { t: 'Bonding curve', d: 'flap.sh\'s initial pricing phase, before liquidity moves to PancakeSwap.' },
    { t: 'Graduation', d: 'The moment a token leaves the bonding curve for a PancakeSwap pool.' },
    { t: 'Sell-back', d: 'Selling a pulled card back to Renaiss for BNB at the scheduled rate.' },
    { t: 'Dead address', d: '0x…dEaD, where burned tokens are sent. Nobody controls it.' },
    { t: '$FORGE', d: 'The planned GachaForge platform token, bought back and burned with tax.' },
  ] as Item[],

  disclaimer: {
    title: 'Not financial advice',
    body: `GachaForge is experimental and custodial: you are trusting GachaForge to hold and pay out the pots. Meme tokens are extremely volatile, card values move, nothing is audited, and the system depends on flap.sh, Renaiss, Chainlink and GachaForge's operations. Sell-back rates fall to ${s72.pct}% after ${s24.withinH} hours. Only use money you can afford to lose, and check the rules in your region before taking part.`,
  },
};

type DocsCopy = typeof en;

const zh: DocsCopy = {
  kicker: '文档',
  title: 'GachaForge 运作方式',
  lead: '一页了解整个发射台：税去了哪里、资金由谁保管、机器如何抽卡、持有人如何获得奖励，以及哪些环节需要信任。',
  preview: 'GachaForge 以托管（链下）模式运行：没有任何 GachaForge 智能合约。税收付给 GachaForge 金库钱包，奖池记录在 GachaForge 的账本中，所有抽卡和发放都由 GachaForge 运营钱包执行。上线前，看板、抽卡记录和数据均为模拟预览。',
  onThisPage: '本页目录',
  nav: {
    overview: '概览', how: '运作流程', fees: '费用与税', packs: '卡包与卡牌', strategies: '策略',
    rewards: '获取奖励', launch: '发行代币', forge: '$FORGE 回购销毁', safety: '信任与安全',
    contracts: '钱包与合约', faq: '常见问题', glossary: '术语表',
  },

  overview: {
    p1: `GachaForge 把每个 Meme 代币变成一台扭蛋机。代币在 flap.sh（BNB Chain）上发行，买入和卖出都固定收取 ${TAX_PCT}% 的税，税款付给 GachaForge 金库钱包。GachaForge 后端把每笔交易税收的一部分记为该代币的扭蛋奖池。奖池够买一包卡时，GachaForge 就通过 Renaiss 购买一包真实的评级卡。发行时选定的策略决定卡牌归某位持有人，还是换成 BNB 用于分红或销毁。`,
    p2: '这是一项托管服务。资金存放在 GachaForge 钱包中，规则由 GachaForge 执行，没有智能合约强制它这样做。作为替代，所有余额和交易都公开记录，你可以自行核对。',
    roles: [
      { t: '创建者', d: `在发币页面直接通过 flap.sh 发行代币，并做一次性选择：名称、图片、卡包和策略。创建者获得 ${CREATOR_PCT}% 的税，无法动用奖池。若持有代币，按与其他人相同的规则参与奖励。` },
      { t: '持有人', d: `在每轮快照时持有至少 ${MIN_HOLD_PCT}% 供应量（${minTok} 枚）的任何地址。根据策略不同，持有人可以赢得卡牌、直接收到 BNB 分红或受益于销毁。` },
      { t: 'GachaForge', d: `接收税收、维护账本、保管奖池，并用运营钱包执行每次抽卡、抽奖、发放和销毁。到达 GachaForge 的税收中，${SPLIT.platform}% 作为平台份额。` },
    ],
  },

  how: {
    intro: '每台机器在整个生命周期内重复同一个循环。',
    steps: [
      { t: '发行', d: '创建者在发币页面直接通过 flap.sh 发行代币，税收接收方为 GachaForge 金库。GachaForge 登记卡包和策略。' },
      { t: '交易', d: `每笔买卖向金库支付 ${TAX_PCT}% 的税。扣除 flap.sh 的份额后，GachaForge 账本把剩余部分按 ${SPLIT.platform} / ${SPLIT.pot} / ${SPLIT.buyback} 分配。` },
      { t: '抽卡', d: '奖池余额够一个卡包价格时，运营钱包向 Renaiss 购买一包卡并揭晓卡牌。' },
      { t: '奖励', d: '策略决定卡牌去向：抽奖给持有人，或卖回后用于分红或销毁。' },
    ],
    taxLabel: '每笔交易',
    flapLabel: 'flap.sh',
    gfLabel: 'GachaForge 金库',
    platformLabel: '平台',
    potLabel: '扭蛋奖池',
    buybackLabel: '$FORGE 销毁',
    loopNote: '奖池随交易量不断补充，只要有人交易，循环就会继续。奖池是 GachaForge 账本中的记账余额，对应的 BNB 存放在 GachaForge 钱包中。',
  },

  fees: {
    intro: `所有 GachaForge 代币的税率相同：买入 ${TAX_PCT}%、卖出 ${TAX_PCT}%。税率在发行时写入 flap.sh 代币，接收方为 GachaForge 金库钱包（${T_SHORT}）。`,
    flapNote: `flap.sh 保留约 ${FLAP_CUT_PCT}% 的税（在 ${TAX_PCT}% 税率下于 BSC 主网分叉上实测）。该比例由 flap.sh 决定，并非 GachaForge，未来可能变化。其余 ${NET}% 进入金库，由 GachaForge 后端账本分成下面三部分。这些份额是记账条目，BNB 本身在花出前一直存放在 GachaForge 钱包中。`,
    barWhole: '全部税收',
    barVault: '到达 GachaForge 的部分',
    seg: { flap: 'flap.sh', platform: 'GachaForge 平台', pot: '扭蛋奖池', buyback: '$FORGE 回购销毁' },
    creator: `创建者：${CREATOR_PCT}%。`,
    exTitle: '计算示例',
    exRows: [
      ['交易量', money(EX.volumeUsd)],
      [`${TAX_PCT}% 税`, money(EX.tax)],
      [`flap.sh 份额（约 ${FLAP_CUT_PCT}%）`, '−' + money(EX.flap)],
      ['到达 GachaForge', money(EX.net)],
      [`GachaForge 平台（${SPLIT.platform}%）`, money(EX.platform)],
      [`扭蛋奖池（${SPLIT.pot}%）`, money(EX.pot)],
      [`$FORGE 回购销毁（${SPLIT.buyback}%）`, money(EX.buyback)],
    ],
    exNote: `这部分奖池约等于一次 ${money(EX.packUsd)} 抽卡的 ${EX.pulls.toFixed(2)} 倍。`,
    startTitle: '何时开始抽卡',
    startBody: '机器不必等到毕业。只要奖池够一包卡，即使代币仍在 flap.sh 联合曲线上，也会进行第一次抽卡。之后每次奖池补满都会再抽，一次只进行一抽，中间有冷却时间。',
    freqTitle: '一次抽卡需要多少交易量',
    freqIntro: `到达 GachaForge 的 ${NET}% 中只有 ${SPLIT.pot}% 进入奖池，因此奖池约按交易量的 ${(TAX_PCT * NET * SPLIT.pot / 10_000).toFixed(3)}% 增长。每次抽卡所需交易量约为：`,
    freqCols: ['卡包', '每抽所需交易量'],
    freqNote: `数字未计入最多 ${PULL_BUFFER_PCT}% 的价格缓冲，也未考虑 BNB 价格波动。奖池只扣除抽卡实际花费的 BNB。`,
  },

  packs: {
    renaissTitle: 'Renaiss 是什么',
    renaissBody: 'Renaiss 是每次抽卡背后的卡牌合作方：出售卡包、在金库中保管评级卡、报告每张卡的价值，并提供卖回服务。GachaForge 从不经手实体卡牌。',
    cols: ['卡包', '每抽价格', '最高收益'],
    pricing: `抽卡按 Chainlink BNB/USD 价格以 BNB 支付卡包的美元价格。运营钱包在 PancakeSwap 上把 BNB 换成 USDT 并向 Renaiss 购买卡包，最多花费卡包价格加 ${PULL_BUFFER_PCT}%。奖池按实际花费的 BNB 扣减。`,
    gradersTitle: '评级机构',
    gradersBody: '卡牌在发出前已由主流评级机构 PSA、CGC 或 BGS 评级并封装，每次抽卡都会显示评级和证书。',
    custodyTitle: '托管',
    custodyBody: `卡牌由 Renaiss 保管。持有人赢得卡牌后，有 ${CUSTODY_WINDOW_H} 小时的窗口期，卡牌仍在 Renaiss 托管中（期间可卖回）。Renaiss 释放后，GachaForge 运营钱包把卡牌 NFT 转给获得者。`,
    sellTitle: '卖回比例',
    sellCols: ['卖回时间', '可获得'],
    sellRows: SELL_BACK.map((s) => [`${s.withinH} 小时内`, `卡牌价值的 ${s.pct}%`]),
    sellNote: '需要卖卡的机器（分红、销毁、组合分配，以及无人中奖时的抽奖或猎大奖）会在第一个窗口内卖回，以获得最高比例。',
  },

  strategies: {
    intro: '创建者在发行时从五种策略中选择一种。GachaForge 将其与机器一起记录，之后不会更改。',
    gets: '持有人获得',
    best: '适合',
    items: {
      RAFFLE: { gets: '每张卡都抽给一位符合条件的持有人，中奖概率与持仓成正比。若无人符合条件，卡牌卖回，BNB 回到奖池。', best: '想拥有真实评级卡的社区。' },
      HIT_HUNTER: { gets: '只抽大奖：价值高于卡包价格的卡归一位持有人，低于此价值的卡卖回，BNB 用于买入并销毁代币。', best: '既想要大奖又想要持续销毁的持有人。' },
      DIVIDEND: { gets: '每张卡都卖回，BNB 按持仓比例直接发送到合格持有人的钱包，无需领取。', best: '更喜欢 BNB 收益而不是卡牌的持有人。' },
      BURN: { gets: '每张卡都卖回，BNB 在市场上买入代币并发送到销毁地址。', best: '注重通缩、不想管理分红的代币。' },
      SPLIT: { gets: '每张卡都卖回，BNB 按创建者设定的固定比例分为分红和买入销毁。LP 部分同样改为销毁。', best: '想要均衡组合的创建者。' },
    },
  },

  rewards: {
    eligTitle: '参与条件',
    eligBody: `每一轮都会在抽卡所在区块对余额拍快照。若你在该区块持有至少 ${MIN_HOLD_PCT}% 的总供应量（${supply} 中的 ${minTok} 枚），即可参与。中奖概率和分红份额与你在所有合格持有人中的持仓占比成正比。`,
    exclTitle: '不计入',
    excl: ['流动性池和交易对', '代币合约', 'flap.sh 发射台合约和路由', 'GachaForge 钱包及其他合约', '零地址和销毁地址'],
    raffleTitle: '抽奖流程',
    raffle: [
      '一次抽卡结算后，确定该轮的快照区块。',
      'GachaForge 读取该区块的合格余额，按固定顺序排列，并公布名单及其哈希。',
      '由该区块的区块哈希和抽卡编号推导出随机种子。',
      '种子对合格总余额取模得到一个号码，累计余额覆盖该号码的持有人中奖。',
      '证明（快照、种子、获奖者）公布在该次抽卡上，任何人都能重复这些步骤得到同一结果。',
    ],
    divTitle: '分红流程',
    div: [
      '卡牌卖回所得留作该轮分红。',
      'BNB 按持仓比例分给合格持有人。',
      '运营钱包把每份直接发送到持有人钱包，你无需领取。',
      '每笔发放交易都列在透明度页面，并附 BscScan 链接。',
      '金额太小、不值 Gas 的部分会累积到你的下一次发放。',
    ],
    claimTitle: '在机器页面查看',
    claim: [
      '在看板中打开机器并连接钱包。',
      '「你的奖励」面板显示参与资格、余额、中奖概率以及已收到的奖励。',
      '分红和卡牌会自动到达你的钱包，没有领取按钮。',
    ],
  },

  launch: {
    intro: '代币在发币页面直接通过 flap.sh 发行，由你自己的钱包签名。GachaForge 不为此部署任何合约。',
    steps: [
      { t: '代币信息', d: '名称、代码、图片、简介和可选链接。' },
      { t: '选择卡包', d: '每抽 ' + PACKS.map((p) => money(p.usd)).join('、') + '，决定每次抽卡需要多少奖池。' },
      { t: '策略', d: '从五种策略中选一种。选择组合分配时，设定分红 / 销毁比例。' },
      { t: '首次买入（可选）', d: '在同一笔交易中买入，成为曲线上的第一位买家。' },
      { t: '发行', d: `浏览器先计算靓号盐值，你签名 flap.sh 发行交易（${TAX_PCT}% / ${TAX_PCT}% 税，付给 GachaForge 金库），随后 GachaForge 登记你的卡包和策略。` },
    ],
    lockedTitle: '发行时确定',
    locked: [`买入 ${TAX_PCT}% / 卖出 ${TAX_PCT}% 税（写入 flap.sh 代币）`, '税收接收方：GachaForge 金库', `${SPLIT.platform} / ${SPLIT.pot} / ${SPLIT.buyback} 分配（GachaForge 账本）`, '卡包（由 GachaForge 记录，不会更改）', '策略（组合分配含比例，由 GachaForge 记录，不会更改）'],
    vanityTitle: '为什么地址以 7777 结尾',
    vanityBody: 'flap.sh 要求带税代币的地址以 7777 结尾。发币页面会在你签名前于浏览器内搜索匹配的盐值（平均约 65,000 次尝试，通常几秒钟）。',
    costTitle: '费用',
    costBody: `flap.sh 自身的发行费用（如有）、网络 Gas，以及你选择的首次买入金额。GachaForge 不收发行费。创建者获得 ${CREATOR_PCT}% 的税。`,
  },

  forge: {
    p1: `到达 GachaForge 的税收中，${SPLIT.buyback}% 在账本中记为 $FORGE 回购余额。余额足够时，GachaForge 运营钱包通过 flap.sh 买入 $FORGE 并发送到销毁地址。`,
    p2: '$FORGE 尚未发行。在此之前，回购余额会在账本中持续累积（BNB 存放在 GachaForge 钱包中）。$FORGE 上线后开始回购。',
    p3: '每笔回购和销毁交易都列在透明度页面，累计数据见回购销毁页面。',
    link: '打开回购销毁',
  },

  safety: {
    intro: '本节如实说明系统如何运作，以及你需要信任什么。',
    custodialTitle: '这是托管、链下的模式',
    custodialBody: '没有任何 GachaForge 智能合约。税收进入 GachaForge 金库钱包，奖池和回购余额是 GachaForge 数据库中的记录，每次抽卡、抽奖转账、分红发放、销毁和回购都由 GachaForge 运营钱包执行。链上没有任何机制强制 GachaForge 这样做：你是在信任 GachaForge 会兑现奖池和发放。',
    trustTitle: '你需要信任的',
    trust: [
      'GachaForge 在钱包中保留足够的 BNB，覆盖其欠下的所有奖池和回购余额。',
      'GachaForge 后端正确记录税收，在奖池满时抽卡，并向获奖者和持有人付款。',
      'GachaForge 在发行后不更改机器的卡包或策略。',
      'Renaiss 保管卡牌、报告价值并支付卖回款。',
      'Chainlink 提供 BNB/USD 价格，PancakeSwap 提供兑换。',
    ],
    guardTitle: '保障措施',
    guards: [
      '公开的透明度页面并列显示金库余额与欠奖池、回购和待发分红的总额。',
      '运营钱包的每笔交易都列在该页面，并附 BscScan 链接。',
      '抽奖证明（快照、种子、获奖者）公开发布，任何人都能复核。',
      `运营钱包设有每日支出上限，每次抽卡上限为卡包价格加 ${PULL_BUFFER_PCT}%。`,
      '暂停开关可立即停止所有对外操作。',
    ],
    transparencyLink: '打开透明度页面',
    flapTitle: 'flap.sh',
    flap: 'flap.sh 管理员可以把某个代币的税转给其他接收方，且 flap.sh 合约是可升级代理。GachaForge 无法阻止这两点。flap.sh 也自行决定其税收份额。',
    renaissTitle: 'Renaiss 托管',
    renaiss: '实体卡牌在释放前由 Renaiss 保管，而不是 GachaForge 或你。如果 Renaiss 未能交付或支付卖回款，GachaForge 无法强制它。',
    auditTitle: '审计状态',
    audit: 'GachaForge 的后端和钱包操作尚未经过外部审计。本站任何内容都不构成投资建议。',
    previewTitle: '预览数据',
    previewBody: '上线前，本站看板、抽卡记录和数据均为模拟，请勿当作真实结果。',
  },

  contracts: {
    intro: '全部位于 BNB Chain（链 ID 56）。GachaForge 自身没有合约，只有下面两个钱包；其余是它使用的第三方合约。',
    cols: ['钱包 / 合约', '地址'],
    unset: '上线时公布',
    unsetForge: '$FORGE 上线后添加',
    rows: {
      treasury: 'GachaForge 金库钱包（税收接收方）', ops: 'GachaForge 运营钱包（抽卡、发放、销毁）', portal: 'flap.sh Portal', taxImpl: 'flap.sh 带税代币 V3 实现',
      feed: 'Chainlink BNB/USD 价格源', router: 'PancakeSwap 路由', forge: '$FORGE 代币',
    },
  },

  faq: [
    { q: '奖池的钱存放在哪里？', a: '存放在 GachaForge 钱包中。税收付给金库钱包，每台机器的奖池是 GachaForge 账本中的记账余额，而不是单独的合约。透明度页面会把金库余额与欠奖池和回购的总额并列显示。' },
    { q: '卡牌是真的吗？', a: '是的。每次抽卡都从 Renaiss 购买一张真实的评级卡（PSA、CGC 或 BGS），并由其托管。上线前，本站显示的是模拟预览抽卡。' },
    { q: '怎样赢得卡牌？', a: `在抽奖或猎大奖机器的快照区块持有至少 ${minTok} 枚（供应量的 ${MIN_HOLD_PCT}%）。中奖概率等于你在合格总余额中的占比。Renaiss 释放后，卡牌会转到你的钱包。` },
    { q: '我如何获得分红？', a: '自动获得。在分红（及组合分配）机器上，卡牌卖回换成 BNB，GachaForge 运营钱包把每位合格持有人的份额直接发给他们。无需领取；金额很小的部分会累积到下一次发放。' },
    { q: '如果 GachaForge 停止运营怎么办？', a: '那么抽卡和发放都会停止。由于是托管模式，没有可以脱离 GachaForge 继续运行的合约，奖池余额取决于 GachaForge 是否发放。你的代币仍可在 flap.sh / PancakeSwap 上交易，税收会继续进入金库，除非 flap.sh 改变去向。' },
    { q: '我如何核实？', a: '打开透明度页面：上面列出金库余额、欠奖池、回购和分红的总额，以及运营钱包的每笔交易和 BscScan 链接。每次抽奖都会公布快照、种子和获奖者，你可以自己重新计算。' },
    { q: '创建者能提走奖池吗？', a: '不能。创建者无法动用奖池。只有 GachaForge 运营钱包会花费它，用于抽卡，上限为卡包价格加缓冲。' },
    { q: '税率会变吗？', a: `${TAX_PCT}% 税率在发行时写入 flap.sh 代币。${SPLIT.platform} / ${SPLIT.pot} / ${SPLIT.buyback} 分配由 GachaForge 账本执行。flap.sh 控制自己的份额，并在技术上可以改变代币税收的去向（见信任与安全）。` },
    { q: `${SPLIT.platform}% 去了哪里？`, a: `留在 GachaForge 作为平台份额，用于开发、基础设施、运行抽卡的后端和日常运营。创建者获得 ${CREATOR_PCT}%。` },
    { q: '为什么我的机器还没抽卡？', a: `奖池需要先够一整包。${money(p0.usd)} 的机器大约需要 ${vpp0} 的交易量。抽卡还要等上一抽结算、冷却结束（默认 ${DEFAULT_COOLDOWN_S} 秒），且在操作暂停或达到每日上限时不会抽卡。「抽卡排队中」表示购卡尚未开始。` },
    { q: '如果没有人符合条件怎么办？', a: '抽奖机器会把卡牌卖回，BNB 回到奖池用于下一抽。分红则保留到某一轮有合格持有人时发放。' },
    { q: '快照后还需要继续持有吗？', a: '资格只看你在快照区块的余额。之后卖出不会取消该轮奖励，但除非重新持有，否则不会计入之后的轮次。' },
    { q: '发行需要多少钱？', a: 'flap.sh 自身费用、Gas 加上可选的首次买入。GachaForge 不收发行费。' },
    { q: '这是投资建议吗？', a: '不是。本站任何内容都不构成投资建议。Meme 代币波动极大，可能归零。' },
  ],

  glossary: [
    { t: '机器', d: '一个 GachaForge 代币及其奖池、卡包和策略。' },
    { t: '金库钱包', d: '每个机器代币支付税收的 GachaForge 钱包。' },
    { t: '运营钱包', d: '负责购买卡包、转移卡牌、发放分红以及执行销毁和回购的 GachaForge 钱包。' },
    { t: '账本', d: 'GachaForge 只追加的记录，记载每笔交易税收的分配和花费。' },
    { t: '扭蛋奖池', d: `税收中留作购买卡包的 ${SPLIT.pot}% 部分。是记账余额，BNB 存放在 GachaForge 钱包中。` },
    { t: '抽卡', d: '用奖池资金向 Renaiss 购买一包卡。' },
    { t: '轮次', d: '与一次抽卡对应的奖励周期，有独立的快照区块。' },
    { t: '快照区块', d: '读取余额以确定资格的区块。' },
    { t: '抽奖证明', d: '公布的抽奖快照、种子和获奖者，足以重新计算抽奖结果。' },
    { t: '联合曲线', d: 'flap.sh 的初始定价阶段，之后流动性迁移到 PancakeSwap。' },
    { t: '毕业', d: '代币离开联合曲线、进入 PancakeSwap 池子的时刻。' },
    { t: '卖回', d: '按规定比例把抽到的卡牌卖回给 Renaiss 换取 BNB。' },
    { t: '销毁地址', d: '0x…dEaD，被销毁代币的去处，无人控制。' },
    { t: '$FORGE', d: '计划中的 GachaForge 平台代币，用税收回购并销毁。' },
  ],

  disclaimer: {
    title: '不构成投资建议',
    body: `GachaForge 是实验性的托管服务：你是在信任 GachaForge 保管并发放奖池。Meme 代币波动剧烈，卡牌价值会变化，系统未经审计，并依赖 flap.sh、Renaiss、Chainlink 和 GachaForge 的运营。${s24.withinH} 小时后卖回比例降至 ${s72.pct}%。请只使用你能承受损失的资金，并在参与前了解所在地区的规定。`,
  },
};

export const docsDict: Record<Lang, DocsCopy> = { en, zh };
export type { DocsCopy };
