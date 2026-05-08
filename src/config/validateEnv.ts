import { z } from "zod";

const HexPrivateKey = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]{64}$/, {
    message: "must be 0x + 64 hex chars (32 bytes)",
  });

const EthAddress = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]{40}$/, { message: "must be a 0x + 40 hex char address" });

const SignatureTypeName = z.enum(["EOA", "POLY_PROXY", "POLY_GNOSIS_SAFE", "POLY_1271"]);

const EnvSchema = z
  .object({
    POLYMARKET_PRIVATE_KEY: z.string().optional(),
    POLYMARKET_FUNDER_ADDRESS: z.string().optional(),
    PROXY_WALLET_ADDRESS: z.string().optional(),
    POLYMARKET_SIGNATURE_TYPE: z.string().optional(),
  })
  .superRefine((raw, ctx) => {
    const priv = (raw.POLYMARKET_PRIVATE_KEY ?? "").trim();
    if (!priv) {
      ctx.addIssue({
        code: "custom",
        path: ["POLYMARKET_PRIVATE_KEY"],
        message: "Please add required value: POLYMARKET_PRIVATE_KEY",
      });
    } else {
      const res = HexPrivateKey.safeParse(priv);
      if (!res.success) {
        ctx.addIssue({
          code: "custom",
          path: ["POLYMARKET_PRIVATE_KEY"],
          message: `POLYMARKET_PRIVATE_KEY ${res.error.issues[0]?.message ?? "is invalid"}`,
        });
      }
    }

    const funder =
      (raw.POLYMARKET_FUNDER_ADDRESS ?? "").trim() || (raw.PROXY_WALLET_ADDRESS ?? "").trim();
    if (!funder) {
      ctx.addIssue({
        code: "custom",
        path: ["POLYMARKET_FUNDER_ADDRESS"],
        message: "Please add required value: POLYMARKET_FUNDER_ADDRESS (or PROXY_WALLET_ADDRESS)",
      });
    } else {
      const res = EthAddress.safeParse(funder);
      if (!res.success) {
        ctx.addIssue({
          code: "custom",
          path: ["POLYMARKET_FUNDER_ADDRESS"],
          message: `POLYMARKET_FUNDER_ADDRESS/PROXY_WALLET_ADDRESS ${
            res.error.issues[0]?.message ?? "is invalid"
          }`,
        });
      }
    }

    const sigRaw = (raw.POLYMARKET_SIGNATURE_TYPE ?? "").trim();
    if (sigRaw) {
      const res = SignatureTypeName.safeParse(sigRaw);
      if (!res.success) {
        ctx.addIssue({
          code: "custom",
          path: ["POLYMARKET_SIGNATURE_TYPE"],
          message:
            `Invalid POLYMARKET_SIGNATURE_TYPE: ${sigRaw}. ` +
            `Valid values: ${SignatureTypeName.options.join(", ")}`,
        });
      }
    }
  });

export type ValidatedEnv = {
  POLYMARKET_PRIVATE_KEY: string;
  POLYMARKET_FUNDER_ADDRESS: string;
  POLYMARKET_SIGNATURE_TYPE?: z.infer<typeof SignatureTypeName>;
};

export function validateEnv(): { ok: true; env: ValidatedEnv } | { ok: false; messages: string[] } {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const messages = parsed.error.issues.map((issue) => issue.message);
    return { ok: false, messages };
  }

  const priv = (process.env.POLYMARKET_PRIVATE_KEY ?? "").trim();
  const funder =
    (process.env.POLYMARKET_FUNDER_ADDRESS ?? "").trim() ||
    (process.env.PROXY_WALLET_ADDRESS ?? "").trim();
  const sig = (process.env.POLYMARKET_SIGNATURE_TYPE ?? "").trim();

  return {
    ok: true,
    env: {
      POLYMARKET_PRIVATE_KEY: priv,
      POLYMARKET_FUNDER_ADDRESS: funder,
      ...(sig ? { POLYMARKET_SIGNATURE_TYPE: sig as z.infer<typeof SignatureTypeName> } : {}),
    },
  };
}

