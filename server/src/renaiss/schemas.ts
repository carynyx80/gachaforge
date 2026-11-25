/**
 * zod schemas for the Renaiss Builder API v2 responses we use.
 * Source: https://api.renaiss.xyz/v2/openapi.json (fetched 2026-11-25). Unknown keys are stripped,
 * nullable fields stay nullable; enums that the spec marks as "new values can appear" are plain strings.
 */
import { z } from 'zod';

const uint = z.string().regex(/^\d+$/, 'expected a decimal integer string');
const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'expected an address');

export const packSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  packType: z.string(),
  stage: z.string(),
  priceInUsdt: uint,
  expectedValueInUsd: uint.nullable().optional(),
  onChainPackId: z.string(),
  vendingMachineAddress: addr,
});
export type RenaissPack = z.infer<typeof packSchema>;

export const packListSchema = z.object({
  cardPacks: z.array(packSchema),
  pagination: z.object({ total: z.number(), limit: z.number(), offset: z.number(), hasMore: z.boolean() }),
});

export const buybackConfigSchema = z.object({ buybackPercentage: z.number(), buybackExpiredInSeconds: z.number().int() });

export const packDetailSchema = z.object({
  cardPack: packSchema.extend({
    activeSetExpectedValueInUsd: uint.optional(),
    buybackConfig: z.array(buybackConfigSchema).default([]),
  }),
});
export type RenaissPackDetail = z.infer<typeof packDetailSchema>['cardPack'];

export const buybackTierSchema = z.object({ buybackPercentage: z.number(), amountInUsdt: uint, expiresAt: z.string() });
export type BuybackTier = z.infer<typeof buybackTierSchema>;

export const drawSchema = z.object({
  settlementId: z.string(),
  tokenId: uint,
  releaseTxHash: z.string().nullable().optional(),
  buybackTxHash: z.string().nullable().optional(),
  buybackTiers: z.array(buybackTierSchema).default([]),
  tier: z.string().nullable().optional(),
  buybackBaseValueInUSD: uint.nullable().optional(),
  buybackBonus: z.object({ originalBuybackBaseValueInUSD: uint, bonusBps: z.number().int() }).nullable().optional(),
  type: z.string().optional(),
  name: z.string().optional(),
  frontImageUrl: z.string().optional(),
  attributes: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
});
export type RenaissDraw = z.infer<typeof drawSchema>;

export const drawResultSchema = z.object({
  permitFundTxHash: z.string(),
  buyerWalletAddress: z.string(),
  packId: z.string(),
  packName: z.string().optional(),
  status: z.enum(['PENDING_RESOLUTION', 'RESOLVED']),
  numOfTokens: z.number().int(),
  pulledAt: z.string().nullable().optional(),
  draws: z.array(drawSchema).default([]),
});
export type RenaissDrawResult = z.infer<typeof drawResultSchema>;

export const PULL_STATUSES = ['PENDING_PAYMENT', 'PENDING_RESOLUTION', 'RESOLVED', 'FAILED'] as const;
export type PullStatus = (typeof PULL_STATUSES)[number];

const apiErrorBody = z.object({ code: z.string(), message: z.string() });

export const pullStatusSchema = z.object({
  requestId: z.string().uuid(),
  status: z.enum(PULL_STATUSES),
  buyerWalletAddress: z.string(),
  packId: z.string(),
  nonce: z.string(),
  numOfTokens: z.number().int(),
  permitFundTxHash: z.string().nullable().optional(),
  error: apiErrorBody.nullable().optional(),
  result: drawResultSchema.nullable().optional(),
});
export type RenaissPullStatus = z.infer<typeof pullStatusSchema>;

export const PERMIT2_TYPES = {
  PermitWitnessTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions' },
    { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'witness', type: 'PermitFundWitness' },
  ],
  TokenPermissions: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  PermitFundWitness: [
    { name: 'packId', type: 'bytes32' },
    { name: 'builder', type: 'bytes32' },
    { name: 'numOfTokens', type: 'uint256' },
  ],
} as const;

/** From @renaiss-protocol/client@0.1.0-beta.5 (dist/index.js, EOA buyback signer). Not in the OpenAPI spec. */
export const BUYBACK_TYPES = {
  BuybackUserAuthorization: [
    { name: 'buybackIds', type: 'bytes32[]' },
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
} as const;
export const BUYBACK_DOMAIN_NAME = 'TokenVendingMachineV3';
export const BUYBACK_DOMAIN_VERSION = '1';

export const prepareSchema = z.object({
  chainId: z.number().int(),
  buyerWalletAddress: z.string(),
  pack: z.object({ id: z.string().uuid(), onChainPackId: z.string(), priceInUsdt: uint, vendingMachineAddress: addr }),
  permit2TypedData: z.object({
    domain: z.object({ name: z.literal('Permit2'), chainId: z.number().int(), verifyingContract: addr }),
    types: z.record(z.string(), z.array(z.object({ name: z.string(), type: z.string() }))),
    primaryType: z.literal('PermitWitnessTransferFrom'),
    message: z.object({
      permitted: z.object({ token: addr, amount: uint }),
      spender: addr,
      nonce: uint,
      deadline: uint,
      witness: z.object({ packId: z.string(), builder: z.string(), numOfTokens: uint }),
    }),
  }),
  unsignedPullPayload: z.object({
    packId: z.string().uuid(),
    builderCode: z.string(),
    numOfTokens: z.number().int().min(1).max(10),
    amountPerToken: uint,
    nonce: uint,
    deadline: z.number().int(),
  }),
  approval: z.object({ token: addr, spender: addr, requiredAmount: uint }),
});
export type RenaissPrepare = z.infer<typeof prepareSchema>;

export const buybackOffersSchema = z.object({
  offers: z.array(
    z.object({
      cardPackId: z.string(),
      settlementId: z.string(),
      tokenId: uint,
      vendingMachineAddress: addr,
      buybackTiers: z.array(buybackTierSchema),
    }),
  ),
});
export type RenaissBuybackOffer = z.infer<typeof buybackOffersSchema>['offers'][number];

export const BUYBACK_STATUSES = ['PENDING', 'COMPLETED', 'FAILED'] as const;
export const buybackStatusSchema = z.object({
  requestId: z.string().uuid(),
  status: z.enum(BUYBACK_STATUSES),
  buyerWalletAddress: z.string(),
  cardPackId: z.string(),
  settlementIds: z.array(z.string()),
  txHash: z.string().nullable().optional(),
  totalAmountInUsdt: uint.nullable().optional(),
  itemCount: z.number().int().nullable().optional(),
  error: apiErrorBody.nullable().optional(),
});
export type RenaissBuybackStatus = z.infer<typeof buybackStatusSchema>;

/** Error bodies come in two shapes: `{error, code}` (auth layer) and `{code, message}` (handlers). */
export const errorBodySchema = z.object({ code: z.string().optional(), error: z.string().optional(), message: z.string().optional() });

export interface PullRequestBody {
  packId: string;
  numOfTokens: number;
  amountPerToken: string;
  nonce: string;
  deadline: number;
  buyerWalletAddress: string;
  permitSignature: string;
}

export interface BuybackBody {
  buyerWalletAddress: string;
  cardPackId: string;
  buybackAuth: { buybackIds: string[]; token: string; amount: string };
  userSignature: string;
}
