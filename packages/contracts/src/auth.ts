import * as z from 'zod';

export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[\p{L}\p{N}_.-]+$/u, '用户名只能包含字母、数字、点、下划线和连字符');

export const passwordSchema = z.string().min(12).max(128);

export const credentialsSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

export const ownerSchema = z.object({
  id: z.uuid(),
  username: usernameSchema,
});

export const setupStatusResponseSchema = z.object({
  data: z.object({
    needsSetup: z.boolean(),
  }),
});

export const sessionResponseSchema = z.object({
  data: z.discriminatedUnion('authenticated', [
    z
      .object({
        authenticated: z.literal(true),
        owner: ownerSchema,
      })
      .strict(),
    z
      .object({
        authenticated: z.literal(false),
      })
      .strict(),
  ]),
});

export const logoutResponseSchema = z.object({
  data: z.object({
    success: z.literal(true),
  }),
});

export type Credentials = z.infer<typeof credentialsSchema>;
export type Owner = z.infer<typeof ownerSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
