/**
 * Copy for the /docs page, English + Chinese. Every number is derived from lib/economics.ts.
 */
import {
  CLAIM_WINDOW_DAYS, CREATOR_PCT, CUSTODY_WINDOW_H, DEFAULT_COOLDOWN_S, FEED_MAX_AGE_H, FLAP_CUT_PCT,
  MAX_COOLDOWN_H, MIN_COOLDOWN_S, MIN_HOLD_PCT, MIN_HOLD_TOKENS, PACKS, PULL_BUFFER_PCT, SALT_LOCK_BNB,
  SELL_BACK, SPLIT, TAX_PCT, TIMELOCK_H, TOTAL_SUPPLY, money, volumePerPull, workedExample,
} from './economics';
import type { Lang } from './i18n';
import type { Strategy } from './types';

export const DOC_SECTIONS = [
  'overview', 'how', 'fees', 'packs', 'strategies', 'rewards', 'launch', 'forge', 'safety', 'contracts', 'faq', 'glossary',
] as const;
export type DocSection = (typeof DOC_SECTIONS)[number];

type Item = { t: string; d: string };
type QA = { q: string; a: string };

const EX = workedExample(10_000, 28);
const n = (x: number) => x.toLocaleString('en-US');
const NET = 100 - FLAP_CUT_PCT;
const p0 = PACKS[0];
const [, s24, s72] = SELL_BACK;
const minTok = n(MIN_HOLD_TOKENS);
const supply = n(TOTAL_SUPPLY);
const vpp0 = money(Math.round(volumePerPull(p0.usd)));

const en = {
  kicker: 'Documentation',
  title: 'How GachaForge works',
  lead: 'Everything about the launchpad in one place: where the tax goes, how a machine pulls cards, how holders get paid and what you have to trust.',
  preview: 'Until mainnet launch, the board, pulls and stats on this site show simulated preview data. Contract addresses are published at launch.',
  onThisPage: 'On this page',
  nav: {
    overview: 'Overview', how: 'How it works', fees: 'Fees & tax', packs: 'Packs & cards', strategies: 'Strategies',
    rewards: 'Earning rewards', launch: 'Launching a token', forge: '$FORGE buyback & burn', safety: 'Trust & safety',
    contracts: 'Contract addresses', faq: 'FAQ', glossary: 'Glossary',
  } as Record<DocSection, string>,

  overview: {
    p1: `GachaForge turns a meme token into a gacha machine. Each token is created on flap.sh (BNB Chain) with a fixed ${TAX_PCT}% tax on buys and on sells. A slice of that tax collects in the token's own pot, and whenever the pot can afford a pack, the machine opens a real graded trading-card pack through Renaiss. The token's strategy, chosen once at launch, decides whether the card goes to a holder or is turned back into BNB for holders, burns or liquidity.`,
    p2: 'There are three parties. None of them can change a machine\'s rules after it launches.',
    roles: [
      { t: 'Creator', d: `Launches the token and makes the one-time choices: name, art, pack and strategy. Earns ${CREATOR_PCT}% of the tax and has no special powers over the vault. A creator who holds the token qualifies for rewards like everyone else.` },
      { t: 'Holder', d: `Anyone holding at least ${MIN_HOLD_PCT}% of supply (${minTok} tokens) when a round is snapshotted. Holders win cards, receive BNB dividends or benefit from burns, depending on the strategy.` },
      { t: 'Platform', d: `GachaForge runs the contracts, the website and the backend that buys packs and settles results. It receives ${SPLIT.platform}% of the tax that reaches GachaForge, paid to the company treasury.` },
    ] as Item[],
  },

  how: {
    intro: 'A machine runs the same loop for its whole life.',
    steps: [
      { t: 'Launch', d: 'A creator picks a pack and a strategy on the Launch page. The token is deployed on flap.sh and its vault is created in the same transaction.' },
      { t: 'Trade', d: `Every buy and sell pays ${TAX_PCT}%. After flap.sh takes its share, the vault splits the rest ${SPLIT.platform} / ${SPLIT.pot} / ${SPLIT.buyback}.` },
      { t: 'Pull', d: 'Once the pot holds at least one pack price, the backend buys a pack from Renaiss and the card is revealed.' },
      { t: 'Reward', d: 'The strategy routes the card: raffled to a holder, or sold back and paid out as dividends, burns or LP.' },
    ] as Item[],
    taxLabel: 'Each trade',
    flapLabel: 'flap.sh',
    gfLabel: 'GachaForge vault',
    platformLabel: 'Platform',
    potLabel: 'Gacha pot',
    buybackLabel: '$FORGE burn',
    loopNote: 'The pot refills from trading volume, so the loop repeats for as long as people trade.',
  },

  fees: {
    intro: `Every GachaForge token pays the same tax: ${TAX_PCT}% on buys and ${TAX_PCT}% on sells. It is written into the token at launch and nobody, including the creator and the platform, can raise or lower it.`,
    flapNote: `flap.sh keeps about ${FLAP_CUT_PCT}% of the tax (measured on a BSC mainnet fork at the ${TAX_PCT}% rate). That share is set by flap.sh, not by GachaForge, and may change. The remaining ${NET}% reaches the token's GachaForge vault.`,
    barWhole: 'The whole tax',
    barVault: 'What reaches the vault',
    seg: { flap: 'flap.sh', platform: 'GachaForge platform', pot: 'Gacha pot', buyback: '$FORGE buyback & burn' },
    creator: `Creator: ${CREATOR_PCT}%.`,
    exTitle: 'Worked example',
    exRows: [
      ['Trading volume', money(EX.volumeUsd)],
      [`Tax at ${TAX_PCT}%`, money(EX.tax)],
      [`flap.sh share (~${FLAP_CUT_PCT}%)`, '−' + money(EX.flap)],
      ['Reaches the vault', money(EX.net)],
      [`GachaForge platform (${SPLIT.platform}%)`, money(EX.platform)],
      [`Gacha pot (${SPLIT.pot}%)`, money(EX.pot)],
      [`$FORGE buyback & burn (${SPLIT.buyback}%)`, money(EX.buyback)],
    ] as [string, string][],
    exNote: `That pot share is about ${EX.pulls.toFixed(2)} of a ${money(EX.packUsd)} pull.`,
    startTitle: 'When pulls start',
    startBody: 'A machine does not wait for graduation. The first pull happens as soon as the pot covers one pack, even while the token is still on the flap.sh bonding curve. After that it pulls again each time the pot refills, one pull at a time, with a cooldown in between.',
    freqTitle: 'How much volume funds one pull',
    freqIntro: `Only ${SPLIT.pot}% of the ${NET}% that reaches the vault goes to the pot, so the pot grows by about ${(TAX_PCT * NET * SPLIT.pot / 10_000).toFixed(3)}% of trading volume. Approximate volume needed per pull:`,
    freqCols: ['Pack', 'Volume per pull'],
    freqNote: `Figures exclude the up-to-${PULL_BUFFER_PCT}% price buffer and ignore BNB price moves; refunds of unused buffer go back to the pot.`,
  },

  packs: {
    renaissTitle: 'What Renaiss is',
    renaissBody: 'Renaiss is the card partner behind every pull. It sells the packs, holds the graded slabs in its vault, reports each card\'s value and runs the sell-back desk. GachaForge never touches the physical cards.',
    cols: ['Pack', 'Price per pull', 'Max win'],
    pricing: `A pull pays the pack's dollar price in BNB using the Chainlink BNB/USD feed. The contract allows up to ${PULL_BUFFER_PCT}% on top as a buffer for price movement, and anything unused is returned to the pot. If the feed is older than ${FEED_MAX_AGE_H} hour, pulls are refused.`,
    gradersTitle: 'Graders',
    gradersBody: 'Cards come already graded and sealed by one of the major grading houses: PSA, CGC or BGS. The grade and certificate are shown with every pull.',
    custodyTitle: 'Custody',
    custodyBody: `Renaiss keeps the card. When a holder wins one, there is a ${CUSTODY_WINDOW_H}-hour window during which the card stays in Renaiss custody (and can be sold back) before it is released to the winner.`,
    sellTitle: 'Sell-back schedule',
    sellCols: ['Sold back within', 'You receive'],
    sellRows: SELL_BACK.map((s) => [`${s.withinH} h`, `${s.pct}% of card value`]) as [string, string][],
    sellNote: 'Machines that sell cards (Dividend, Burn, Split, and Raffle or Hit Hunter when nobody wins) sell back inside the first window so the best rate applies.',
  },

  strategies: {
    intro: 'The creator picks one of five strategies at launch. It is stored in the vault as an immutable value and can never be switched.',
    gets: 'Holders get',
    best: 'Best for',
    items: {
      RAFFLE: { gets: 'Every card goes to one eligible holder, drawn with odds proportional to balance. If nobody qualifies, the card is sold back and the BNB refills the pot.', best: 'Communities that want the thrill of owning real slabs.' },
      HIT_HUNTER: { gets: 'Only hits are raffled: a card worth more than the pack price goes to a holder. Anything below that is sold back and the BNB buys and burns the token.', best: 'Holders who want big wins and steady burn pressure.' },
      DIVIDEND: { gets: 'Every card is sold back and the BNB is shared between eligible holders in proportion to balance. Claim on the machine page; large amounts are sent automatically.', best: 'Holders who prefer BNB income to cards.' },
      BURN: { gets: 'Every card is sold back and the BNB buys the token on the market and sends it to the dead address.', best: 'Deflation-minded tokens with no payouts to manage.' },
      SPLIT: { gets: 'Every card is sold back and the BNB is divided by the creator\'s fixed ratio between dividends, buy & burn, and LP locked forever. Before graduation the LP share is burned instead.', best: 'Creators who want a balanced mix.' },
    } as Record<Strategy, { gets: string; best: string }>,
  },

  rewards: {
    eligTitle: 'Who qualifies',
    eligBody: `Each round takes a snapshot of balances at a specific block. You qualify if you held at least ${MIN_HOLD_PCT}% of total supply at that block: ${minTok} tokens out of ${supply}. Odds and dividend shares are proportional to your balance among everyone who qualifies.`,
    exclTitle: 'Never counted',
    excl: ['Liquidity pools and pairs', 'The token contract and its vault', 'flap.sh launchpad contracts and the router', 'Other contracts', 'The zero and dead addresses'],
    raffleTitle: 'Raffle draws, step by step',
    raffle: [
      'A pull settles and the round\'s snapshot block is fixed.',
      'Eligible balances are listed in a canonical order and hashed. That snapshot hash is published.',
      'A seed is derived from a block hash and the pull id.',
      'The seed, taken modulo the total eligible balance, picks a ticket. The holder whose cumulative balance covers that ticket wins.',
      'Snapshot hash, seed and winner are recorded on-chain, so anyone can repeat the steps and get the same winner.',
    ],
    divTitle: 'Dividends, step by step',
    div: [
      'Card sell-back proceeds are added to the machine\'s dividend pool.',
      'Each round, the pool is split among eligible holders by balance.',
      'The allocation is published as a merkle root on the vault, so each holder\'s amount is fixed and provable.',
      'Large allocations are sent automatically. Smaller ones wait for you to claim.',
      `Unclaimed BNB stays claimable for ${CLAIM_WINDOW_DAYS} days, then rolls back into the dividend pool for later rounds.`,
    ],
    claimTitle: 'Claiming on the machine page',
    claim: [
      'Open the machine from the board and connect your wallet.',
      'The Your rewards panel shows eligibility, balance, raffle odds and claimable BNB.',
      'Press Claim. One transaction collects every open round, and the vault checks your merkle proof before paying.',
    ],
  },

  launch: {
    intro: 'Launching takes one transaction from the Launch page.',
    steps: [
      { t: 'Token info', d: 'Name, ticker, image, description and optional links.' },
      { t: 'Pick a pack', d: PACKS.map((p) => money(p.usd)).join(', ') + ' per pull. This sets how much pot each pull needs.' },
      { t: 'Strategy', d: 'Choose one of the five strategies. For Split, set the dividend / burn / LP ratio.' },
      { t: 'Initial buy (optional)', d: 'Buy in the same transaction so you are first on the curve.' },
      { t: 'Launch', d: 'Your browser mines a vanity salt, then you sign. The token and its vault are deployed together.' },
    ] as Item[],
    lockedTitle: 'Locked forever',
    locked: [`${TAX_PCT}% buy / ${TAX_PCT}% sell tax`, `${SPLIT.platform} / ${SPLIT.pot} / ${SPLIT.buyback} tax split`, 'Pack', 'Strategy and, for Split, its ratio', 'Treasury and burner addresses of the vault'],
    vanityTitle: 'Why the address ends in 7777',
    vanityBody: 'flap.sh requires tax tokens to live at an address ending in 7777. The Launch page searches for a matching CREATE2 salt in your browser before you sign (about 65,000 tries, usually a few seconds), and the launcher refuses any other address.',
    costTitle: 'What it costs',
    costBody: `Network gas plus whatever initial buy you choose. GachaForge charges no launch fee, and no flap.sh launch fee was observed in fork tests. An optional flap.sh salt lock costs ${SALT_LOCK_BNB} BNB.`,
  },

  forge: {
    p1: `${SPLIT.buyback}% of the tax that reaches every vault is sent to the BuybackBurner contract. Its only way to spend BNB is to buy $FORGE on the market and send it to the dead address.`,
    p2: '$FORGE has not launched yet. Until it does, the buyback BNB accumulates in the BuybackBurner. When $FORGE exists, the company wallet sets its address through the timelock, once; it cannot be changed afterwards.',
    p3: 'If $FORGE never launched, that BNB would stay locked in the contract. Running totals are on the Buyback & Burn page.',
    link: 'Open Buyback & Burn',
  },

  safety: {
    intro: 'This section is deliberately plain about what the code guarantees and what it does not.',
    onchainTitle: 'Enforced on-chain',
    onchain: [
      `The tax is ${TAX_PCT}%; the factory and launcher reject any other rate.`,
      `The vault splits ${SPLIT.platform} / ${SPLIT.pot} / ${SPLIT.buyback} using constants in its code.`,
      'Pack, strategy, split ratio, treasury and burner are immutable per vault.',
      'The creator has no admin rights over the vault.',
      `A pull can spend at most the pack price plus ${PULL_BUFFER_PCT}%. Only one pull can be open, with a cooldown (${DEFAULT_COOLDOWN_S} s by default, allowed range ${MIN_COOLDOWN_S} s to ${MAX_COOLDOWN_H} h).`,
      'Dividend claims require a valid merkle proof and can never exceed a round\'s total.',
      'Buyback BNB can only leave as a $FORGE buy-and-burn.',
    ],
    trustedTitle: 'Trusted to the operator and partners',
    trusted: [
      'The backend operator wallet opens and settles pulls, reports card values, records raffle winners and publishes dividend roots. Raffles can be re-checked, but the operator chooses when to act.',
      'Renaiss holds the cards, reports their value and pays sell-backs.',
      'Chainlink supplies the BNB/USD price.',
    ],
    adminTitle: 'Admin and pause',
    admin: `Admin rights sit with a single company wallet behind a ${TIMELOCK_H}-hour timelock. After the delay it can change the price feed, router, launcher, payment receiver and cooldown for the platform, and grant or revoke the operator role. Launches and pulls can be paused instantly; only the company wallet can unpause. Every queued change is visible during the ${TIMELOCK_H} hours.`,
    flapTitle: 'flap.sh',
    flap: 'flap.sh admins can redirect a token\'s tax to another recipient, and flap.sh contracts are upgradeable proxies. GachaForge cannot prevent either and monitors for re-routing events. flap.sh also sets its own share of the tax.',
    auditTitle: 'Audit status',
    audit: 'The GachaForge contracts have not been externally audited. They have unit and mainnet-fork tests only.',
    previewTitle: 'Preview data',
    previewBody: 'Until mainnet launch, the board, pulls and stats on this site are simulated. Do not treat them as real results.',
  },

  contracts: {
    intro: 'All contracts are on BNB Chain (chain id 56).',
    cols: ['Contract', 'Address'],
    unset: 'Published at mainnet launch',
    rows: {
      factory: 'GachaForgeFactory', buyback: 'BuybackBurner', timelock: 'Timelock', launcher: 'FlapLauncher', forge: '$FORGE token',
      treasury: 'Platform treasury (company wallet)', portal: 'flap.sh Portal', taxImpl: 'flap.sh Tax Token V3 implementation', feed: 'Chainlink BNB/USD feed',
    } as Record<string, string>,
  },

  faq: [
    { q: 'Are the cards real?', a: 'Yes. Every pull buys a real, graded card (PSA, CGC or BGS) from Renaiss, which keeps it in custody. The site currently shows simulated preview pulls until mainnet launch.' },
    { q: 'How do I win a card?', a: `Hold at least ${minTok} tokens (${MIN_HOLD_PCT}% of supply) of a Raffle or Hit Hunter machine at the round's snapshot block. Your chance equals your share of the total eligible balance.` },
    { q: 'How do dividends work?', a: 'On Dividend (and Split) machines, cards are sold back for BNB. Each round the BNB is divided among eligible holders by balance and published as a merkle root. Claim it on the machine page; big amounts are sent automatically.' },
    { q: 'Can the creator withdraw the pot?', a: 'No. The creator has no special rights over the vault. Pot BNB can only be spent on a pull, capped at the pack price plus the buffer, and any leftover returns to the pot.' },
    { q: 'Can the tax change?', a: `GachaForge cannot change it: the ${TAX_PCT}% rate and the split are fixed in the contracts. flap.sh, however, controls its own share and can technically redirect a token's tax (see Trust & safety).` },
    { q: `Where does the ${SPLIT.platform}% go?`, a: `To the company treasury that funds GachaForge: development, infrastructure, the backend that runs pulls, and operations. The creator gets ${CREATOR_PCT}%.` },
    { q: 'Why hasn\'t my machine pulled yet?', a: `The pot has to cover a full pack first. On a ${money(p0.usd)} machine that takes roughly ${vpp0} of trading volume. Pulls also wait for the previous one to settle and for the cooldown to pass, and stop while the platform is paused.` },
    { q: 'What if nobody qualifies?', a: 'On Raffle machines the card is sold back and the BNB goes back into the pot for the next pull. On dividend payouts, BNB stays in the dividend pool until a round has eligible holders.' },
    { q: 'Can I check a raffle myself?', a: 'Yes. Each raffle records the snapshot hash, seed and winner. Recompute the draw from the published eligible list and you should get the same address.' },
    { q: 'Do I need to stay holding after a snapshot?', a: 'Eligibility is decided only by your balance at the snapshot block. Selling afterwards does not cancel a reward for that round, but you will not count in later rounds unless you hold again.' },
    { q: 'What does it cost to launch?', a: 'Gas plus an optional initial buy. There is no GachaForge launch fee.' },
    { q: 'Is this financial advice?', a: 'No. Nothing on this site is financial advice. Meme tokens are highly volatile and can go to zero.' },
  ] as QA[],

  glossary: [
    { t: 'Machine', d: 'A GachaForge token together with its vault, pot and strategy.' },
    { t: 'Vault', d: 'The per-token contract that receives tax, holds the pot and pays out rewards.' },
    { t: 'Gacha pot', d: `The ${SPLIT.pot}% share of tax set aside to buy card packs.` },
    { t: 'Pull', d: 'One pack purchase from Renaiss, paid out of the pot.' },
    { t: 'Round', d: 'One reward cycle tied to a pull, with its own snapshot block.' },
    { t: 'Snapshot block', d: 'The block at which balances are read to decide eligibility.' },
    { t: 'Bonding curve', d: 'flap.sh\'s initial pricing phase, before liquidity moves to PancakeSwap.' },
    { t: 'Graduation', d: 'The moment a token leaves the bonding curve for a PancakeSwap pool.' },
    { t: 'Sell-back', d: 'Selling a pulled card back to Renaiss for BNB at the scheduled rate.' },
    { t: 'Merkle root', d: 'A single hash that commits to every holder\'s dividend amount, used to verify claims.' },
    { t: 'Timelock', d: `A contract that delays admin actions by ${TIMELOCK_H} hours so they can be seen before they apply.` },
    { t: 'Operator', d: 'The backend wallet allowed to open and settle pulls and publish results.' },
    { t: 'Dead address', d: '0x…dEaD, where burned tokens are sent. Nobody controls it.' },
    { t: '$FORGE', d: 'The planned GachaForge platform token, bought back and burned with tax.' },
  ] as Item[],

  disclaimer: {
    title: 'Not financial advice',
    body: `GachaForge is experimental software. Meme tokens are extremely volatile, card values move, the contracts are unaudited, and the system depends on flap.sh, Renaiss, Chainlink and the GachaForge operator. Sell-back rates fall to ${s72.pct}% after ${s24.withinH} hours. Only use money you can afford to lose, and check the rules in your region before taking part.`,
  },
};

type DocsCopy = typeof en;

const zh: DocsCopy = {
  kicker: '文档',
  title: 'GachaForge 运作方式',
  lead: '一页了解整个发射台：税去了哪里、机器如何抽卡、持有人如何获得奖励，以及哪些环节需要信任。',
  preview: '主网上线前，本站的看板、抽卡记录和数据均为模拟预览。合约地址将在上线时公布。',
  onThisPage: '本页目录',
  nav: {
    overview: '概览', how: '运作流程', fees: '费用与税', packs: '卡包与卡牌', strategies: '策略',
    rewards: '获取奖励', launch: '发行代币', forge: '$FORGE 回购销毁', safety: '信任与安全',
    contracts: '合约地址', faq: '常见问题', glossary: '术语表',
  },

  overview: {
    p1: `GachaForge 把每个 Meme 代币变成一台扭蛋机。代币在 flap.sh（BNB Chain）上创建，买入和卖出都固定收取 ${TAX_PCT}% 的税。其中一部分税会积累到该代币自己的奖池，奖池够买一包卡时，机器就会通过 Renaiss 开一包真实的评级卡。发行时一次性选定的策略决定卡牌归某位持有人，还是换成 BNB 用于分红、销毁或流动性。`,
    p2: '平台涉及三方。机器发行后，任何一方都无法修改规则。',
    roles: [
      { t: '创建者', d: `发行代币并做一次性选择：名称、图片、卡包和策略。创建者获得 ${CREATOR_PCT}% 的税，对金库没有任何特权。若持有代币，按与其他人相同的规则参与奖励。` },
      { t: '持有人', d: `在每轮快照时持有至少 ${MIN_HOLD_PCT}% 供应量（${minTok} 枚）的任何地址。根据策略不同，持有人可以赢得卡牌、获得 BNB 分红或受益于销毁。` },
      { t: '平台', d: `GachaForge 运营合约、网站以及负责买卡包和结算结果的后端，获得到达 GachaForge 部分税收中的 ${SPLIT.platform}%，进入公司金库。` },
    ],
  },

  how: {
    intro: '每台机器在整个生命周期内重复同一个循环。',
    steps: [
      { t: '发行', d: '创建者在发币页面选择卡包和策略。代币部署在 flap.sh 上，金库在同一笔交易中创建。' },
      { t: '交易', d: `每笔买卖收取 ${TAX_PCT}%。flap.sh 拿走其份额后，金库把剩余部分按 ${SPLIT.platform} / ${SPLIT.pot} / ${SPLIT.buyback} 分配。` },
      { t: '抽卡', d: '奖池至少够一个卡包价格时，后端向 Renaiss 购买一包卡并揭晓卡牌。' },
      { t: '奖励', d: '策略决定卡牌去向：抽奖给持有人，或卖回后用于分红、销毁或 LP。' },
    ],
    taxLabel: '每笔交易',
    flapLabel: 'flap.sh',
    gfLabel: 'GachaForge 金库',
    platformLabel: '平台',
    potLabel: '扭蛋奖池',
    buybackLabel: '$FORGE 销毁',
    loopNote: '奖池随交易量不断补充，只要有人交易，循环就会继续。',
  },

  fees: {
    intro: `所有 GachaForge 代币的税率相同：买入 ${TAX_PCT}%、卖出 ${TAX_PCT}%。税率在发行时写入代币，包括创建者和平台在内，任何人都无法调高或调低。`,
    flapNote: `flap.sh 保留约 ${FLAP_CUT_PCT}% 的税（在 ${TAX_PCT}% 税率下于 BSC 主网分叉上实测）。该比例由 flap.sh 决定，并非 GachaForge，未来可能变化。其余 ${NET}% 进入该代币的 GachaForge 金库。`,
    barWhole: '全部税收',
    barVault: '到达金库的部分',
    seg: { flap: 'flap.sh', platform: 'GachaForge 平台', pot: '扭蛋奖池', buyback: '$FORGE 回购销毁' },
    creator: `创建者：${CREATOR_PCT}%。`,
    exTitle: '计算示例',
    exRows: [
      ['交易量', money(EX.volumeUsd)],
      [`${TAX_PCT}% 税`, money(EX.tax)],
      [`flap.sh 份额（约 ${FLAP_CUT_PCT}%）`, '−' + money(EX.flap)],
      ['到达金库', money(EX.net)],
      [`GachaForge 平台（${SPLIT.platform}%）`, money(EX.platform)],
      [`扭蛋奖池（${SPLIT.pot}%）`, money(EX.pot)],
      [`$FORGE 回购销毁（${SPLIT.buyback}%）`, money(EX.buyback)],
    ],
    exNote: `这部分奖池约等于一次 ${money(EX.packUsd)} 抽卡的 ${EX.pulls.toFixed(2)} 倍。`,
    startTitle: '何时开始抽卡',
    startBody: '机器不必等到毕业。只要奖池够一包卡，即使代币仍在 flap.sh 联合曲线上，也会进行第一次抽卡。之后每次奖池补满都会再抽，一次只进行一抽，中间有冷却时间。',
    freqTitle: '一次抽卡需要多少交易量',
    freqIntro: `到达金库的 ${NET}% 中只有 ${SPLIT.pot}% 进入奖池，因此奖池约按交易量的 ${(TAX_PCT * NET * SPLIT.pot / 10_000).toFixed(3)}% 增长。每次抽卡所需交易量约为：`,
    freqCols: ['卡包', '每抽所需交易量'],
    freqNote: `数字未计入最多 ${PULL_BUFFER_PCT}% 的价格缓冲，也未考虑 BNB 价格波动；未用完的缓冲会退回奖池。`,
  },

  packs: {
    renaissTitle: 'Renaiss 是什么',
    renaissBody: 'Renaiss 是每次抽卡背后的卡牌合作方：出售卡包、在金库中保管评级卡、报告每张卡的价值，并提供卖回服务。GachaForge 从不经手实体卡牌。',
    cols: ['卡包', '每抽价格', '最高收益'],
    pricing: `抽卡按 Chainlink BNB/USD 价格以 BNB 支付卡包的美元价格。合约允许最多额外 ${PULL_BUFFER_PCT}% 作为价格波动缓冲，未用完部分退回奖池。如果价格源超过 ${FEED_MAX_AGE_H} 小时未更新，抽卡会被拒绝。`,
    gradersTitle: '评级机构',
    gradersBody: '卡牌在发出前已由主流评级机构 PSA、CGC 或 BGS 评级并封装，每次抽卡都会显示评级和证书。',
    custodyTitle: '托管',
    custodyBody: `卡牌由 Renaiss 保管。持有人赢得卡牌后，有 ${CUSTODY_WINDOW_H} 小时的窗口期，卡牌仍在 Renaiss 托管中（期间可卖回），之后才交付给获得者。`,
    sellTitle: '卖回比例',
    sellCols: ['卖回时间', '可获得'],
    sellRows: SELL_BACK.map((s) => [`${s.withinH} 小时内`, `卡牌价值的 ${s.pct}%`]),
    sellNote: '需要卖卡的机器（分红、销毁、组合分配，以及无人中奖时的抽奖或猎大奖）会在第一个窗口内卖回，以获得最高比例。',
  },

  strategies: {
    intro: '创建者在发行时从五种策略中选择一种。策略以不可变值存储在金库中，永远无法更换。',
    gets: '持有人获得',
    best: '适合',
    items: {
      RAFFLE: { gets: '每张卡都抽给一位符合条件的持有人，中奖概率与持仓成正比。若无人符合条件，卡牌卖回，BNB 回到奖池。', best: '想拥有真实评级卡的社区。' },
      HIT_HUNTER: { gets: '只抽大奖：价值高于卡包价格的卡归一位持有人，低于此价值的卡卖回，BNB 用于买入并销毁代币。', best: '既想要大奖又想要持续销毁的持有人。' },
      DIVIDEND: { gets: '每张卡都卖回，BNB 按持仓比例分给符合条件的持有人。在机器页面领取，大额会自动发放。', best: '更喜欢 BNB 收益而不是卡牌的持有人。' },
      BURN: { gets: '每张卡都卖回，BNB 在市场上买入代币并发送到销毁地址。', best: '注重通缩、不想管理分红的代币。' },
      SPLIT: { gets: '每张卡都卖回，BNB 按创建者设定的固定比例分为分红、买入销毁和永久锁定的 LP。毕业前 LP 部分改为销毁。', best: '想要均衡组合的创建者。' },
    },
  },

  rewards: {
    eligTitle: '参与条件',
    eligBody: `每一轮都会在某个区块对余额拍快照。若你在该区块持有至少 ${MIN_HOLD_PCT}% 的总供应量（${supply} 中的 ${minTok} 枚），即可参与。中奖概率和分红份额与你在所有合格持有人中的持仓占比成正比。`,
    exclTitle: '不计入',
    excl: ['流动性池和交易对', '代币合约及其金库', 'flap.sh 发射台合约和路由', '其他合约', '零地址和销毁地址'],
    raffleTitle: '抽奖流程',
    raffle: [
      '一次抽卡结算后，确定该轮的快照区块。',
      '合格余额按固定顺序排列并计算哈希，公布该快照哈希。',
      '由区块哈希和抽卡编号推导出随机种子。',
      '种子对合格总余额取模得到一个号码，累计余额覆盖该号码的持有人中奖。',
      '快照哈希、种子和获奖者都记录在链上，任何人都能重复这些步骤得到同一结果。',
    ],
    divTitle: '分红流程',
    div: [
      '卡牌卖回所得进入机器的分红池。',
      '每一轮，分红池按持仓比例分给合格持有人。',
      '分配结果以 Merkle 根发布到金库，每位持有人的金额固定且可验证。',
      '大额分配自动发放，小额等待你自行领取。',
      `未领取的 BNB 可在 ${CLAIM_WINDOW_DAYS} 天内领取，之后回到分红池用于后续轮次。`,
    ],
    claimTitle: '在机器页面领取',
    claim: [
      '在看板中打开机器并连接钱包。',
      '「你的奖励」面板显示参与资格、余额、中奖概率和可领取的 BNB。',
      '点击领取。一笔交易领取所有未领轮次，金库会先验证你的 Merkle 证明再付款。',
    ],
  },

  launch: {
    intro: '在发币页面只需一笔交易即可发行。',
    steps: [
      { t: '代币信息', d: '名称、代码、图片、简介和可选链接。' },
      { t: '选择卡包', d: '每抽 ' + PACKS.map((p) => money(p.usd)).join('、') + '，决定每次抽卡需要多少奖池。' },
      { t: '策略', d: '从五种策略中选一种。选择组合分配时，设定分红 / 销毁 / LP 比例。' },
      { t: '首次买入（可选）', d: '在同一笔交易中买入，成为曲线上的第一位买家。' },
      { t: '发行', d: '浏览器先计算靓号盐值，然后你签名。代币和金库一起部署。' },
    ],
    lockedTitle: '永久锁定',
    locked: [`买入 ${TAX_PCT}% / 卖出 ${TAX_PCT}% 税`, `${SPLIT.platform} / ${SPLIT.pot} / ${SPLIT.buyback} 税收分配`, '卡包', '策略（组合分配含比例）', '金库绑定的平台金库与销毁合约地址'],
    vanityTitle: '为什么地址以 7777 结尾',
    vanityBody: 'flap.sh 要求带税代币的地址以 7777 结尾。发币页面会在你签名前于浏览器内搜索匹配的 CREATE2 盐值（平均约 65,000 次尝试，通常几秒钟），发射合约会拒绝其他地址。',
    costTitle: '费用',
    costBody: `网络 Gas 加上你选择的首次买入金额。GachaForge 不收发行费，分叉测试中也未发现 flap.sh 发行费。可选的 flap.sh 盐值锁定费用为 ${SALT_LOCK_BNB} BNB。`,
  },

  forge: {
    p1: `每个金库所收税中的 ${SPLIT.buyback}% 会发送到 BuybackBurner 合约。该合约花费 BNB 的唯一方式是在市场上买入 $FORGE 并发送到销毁地址。`,
    p2: '$FORGE 尚未发行。在此之前，回购 BNB 会积存在 BuybackBurner 中。$FORGE 发行后，公司钱包通过时间锁设置其地址，仅能设置一次，之后不可更改。',
    p3: '如果 $FORGE 从未发行，这部分 BNB 将一直锁在合约中。累计数据见回购销毁页面。',
    link: '打开回购销毁',
  },

  safety: {
    intro: '本节如实说明代码能保证什么、不能保证什么。',
    onchainTitle: '链上强制执行',
    onchain: [
      `税率为 ${TAX_PCT}%，工厂和发射合约拒绝任何其他税率。`,
      `金库使用代码中的常量按 ${SPLIT.platform} / ${SPLIT.pot} / ${SPLIT.buyback} 分配。`,
      '卡包、策略、分配比例、金库地址和销毁合约对每个金库不可变。',
      '创建者对金库没有管理权限。',
      `每次抽卡最多花费卡包价格加 ${PULL_BUFFER_PCT}%。同一时间只能有一次抽卡，之间有冷却（默认 ${DEFAULT_COOLDOWN_S} 秒，可设范围 ${MIN_COOLDOWN_S} 秒至 ${MAX_COOLDOWN_H} 小时）。`,
      '领取分红需要有效的 Merkle 证明，且永远不会超过该轮总额。',
      '回购 BNB 只能以买入并销毁 $FORGE 的方式流出。',
    ],
    trustedTitle: '需信任运营方和合作方',
    trusted: [
      '后端运营钱包负责开启和结算抽卡、报告卡牌价值、记录抽奖获奖者并发布分红 Merkle 根。抽奖可以复核，但何时执行由运营方决定。',
      'Renaiss 保管卡牌、报告价值并支付卖回款。',
      'Chainlink 提供 BNB/USD 价格。',
    ],
    adminTitle: '管理权限与暂停',
    admin: `管理权限由单一公司钱包持有，并受 ${TIMELOCK_H} 小时时间锁约束。延迟结束后，它可以修改平台的价格源、路由、发射合约、收款地址和冷却时间，并授予或撤销运营角色。发行和抽卡可以立即暂停，只有公司钱包能解除暂停。所有排队中的变更在 ${TIMELOCK_H} 小时内公开可见。`,
    flapTitle: 'flap.sh',
    flap: 'flap.sh 管理员可以把某个代币的税转给其他接收方，且 flap.sh 合约是可升级代理。GachaForge 无法阻止这两点，会持续监控改道事件。flap.sh 也自行决定其税收份额。',
    auditTitle: '审计状态',
    audit: 'GachaForge 合约尚未经过外部审计，目前只有单元测试和主网分叉测试。',
    previewTitle: '预览数据',
    previewBody: '主网上线前，本站看板、抽卡记录和数据均为模拟，请勿当作真实结果。',
  },

  contracts: {
    intro: '所有合约部署在 BNB Chain（链 ID 56）。',
    cols: ['合约', '地址'],
    unset: '主网上线时公布',
    rows: {
      factory: 'GachaForgeFactory', buyback: 'BuybackBurner', timelock: '时间锁', launcher: 'FlapLauncher', forge: '$FORGE 代币',
      treasury: '平台金库（公司钱包）', portal: 'flap.sh Portal', taxImpl: 'flap.sh 带税代币 V3 实现', feed: 'Chainlink BNB/USD 价格源',
    },
  },

  faq: [
    { q: '卡牌是真的吗？', a: '是的。每次抽卡都从 Renaiss 购买一张真实的评级卡（PSA、CGC 或 BGS），并由其托管。主网上线前，本站显示的是模拟预览抽卡。' },
    { q: '怎样赢得卡牌？', a: `在抽奖或猎大奖机器的快照区块持有至少 ${minTok} 枚（供应量的 ${MIN_HOLD_PCT}%）。中奖概率等于你在合格总余额中的占比。` },
    { q: '分红如何运作？', a: '在分红（及组合分配）机器上，卡牌卖回换成 BNB。每轮 BNB 按持仓分给合格持有人，并以 Merkle 根发布。在机器页面领取，大额会自动发放。' },
    { q: '创建者能提走奖池吗？', a: '不能。创建者对金库没有特权。奖池 BNB 只能用于抽卡，上限为卡包价格加缓冲，剩余部分退回奖池。' },
    { q: '税率会变吗？', a: `GachaForge 无法更改：${TAX_PCT}% 税率和分配比例写死在合约中。但 flap.sh 控制自己的份额，并在技术上可以改变代币税收的去向（见信任与安全）。` },
    { q: `${SPLIT.platform}% 去了哪里？`, a: `进入为 GachaForge 提供资金的公司金库，用于开发、基础设施、运行抽卡的后端和日常运营。创建者获得 ${CREATOR_PCT}%。` },
    { q: '为什么我的机器还没抽卡？', a: `奖池需要先够一整包。${money(p0.usd)} 的机器大约需要 ${vpp0} 的交易量。抽卡还要等上一抽结算、冷却结束，且平台暂停期间不会抽卡。` },
    { q: '如果没有人符合条件怎么办？', a: '抽奖机器会把卡牌卖回，BNB 回到奖池用于下一抽。分红则留在分红池中，直到某一轮有合格持有人。' },
    { q: '我能自己验证抽奖吗？', a: '可以。每次抽奖都会记录快照哈希、种子和获奖者。用公布的合格名单重新计算，应得到同一个地址。' },
    { q: '快照后还需要继续持有吗？', a: '资格只看你在快照区块的余额。之后卖出不会取消该轮奖励，但除非重新持有，否则不会计入之后的轮次。' },
    { q: '发行需要多少钱？', a: 'Gas 加上可选的首次买入。GachaForge 不收发行费。' },
    { q: '这是投资建议吗？', a: '不是。本站任何内容都不构成投资建议。Meme 代币波动极大，可能归零。' },
  ],

  glossary: [
    { t: '机器', d: '一个 GachaForge 代币及其金库、奖池和策略。' },
    { t: '金库', d: '每个代币独有的合约，接收税收、保存奖池并发放奖励。' },
    { t: '扭蛋奖池', d: `税收中留作购买卡包的 ${SPLIT.pot}% 部分。` },
    { t: '抽卡', d: '用奖池资金向 Renaiss 购买一包卡。' },
    { t: '轮次', d: '与一次抽卡对应的奖励周期，有独立的快照区块。' },
    { t: '快照区块', d: '读取余额以确定资格的区块。' },
    { t: '联合曲线', d: 'flap.sh 的初始定价阶段，之后流动性迁移到 PancakeSwap。' },
    { t: '毕业', d: '代币离开联合曲线、进入 PancakeSwap 池子的时刻。' },
    { t: '卖回', d: '按规定比例把抽到的卡牌卖回给 Renaiss 换取 BNB。' },
    { t: 'Merkle 根', d: '承诺所有持有人分红金额的单个哈希，用于验证领取。' },
    { t: '时间锁', d: `把管理操作延迟 ${TIMELOCK_H} 小时执行的合约，便于在生效前被看到。` },
    { t: '运营方', d: '获准开启、结算抽卡并发布结果的后端钱包。' },
    { t: '销毁地址', d: '0x…dEaD，被销毁代币的去处，无人控制。' },
    { t: '$FORGE', d: '计划中的 GachaForge 平台代币，用税收回购并销毁。' },
  ],

  disclaimer: {
    title: '不构成投资建议',
    body: `GachaForge 是实验性软件。Meme 代币波动剧烈，卡牌价值会变化，合约未经审计，系统依赖 flap.sh、Renaiss、Chainlink 和 GachaForge 运营方。${s24.withinH} 小时后卖回比例降至 ${s72.pct}%。请只使用你能承受损失的资金，并在参与前了解所在地区的规定。`,
  },
};

export const docsDict: Record<Lang, DocsCopy> = { en, zh };
export type { DocsCopy };
