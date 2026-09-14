import { z } from 'zod';

const encoded = z
  .string()
  .max(1_500_000)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/);
export const clientMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('move-nodes'),
    operationId: z.uuid(),
    positions: z
      .array(z.object({ nodeId: z.uuid(), x: z.number().finite(), y: z.number().finite() }))
      .min(1)
      .max(1000),
  }),
  z.object({ type: z.literal('open-text'), nodeId: z.uuid() }),
  z.object({
    type: z.literal('text-update'),
    nodeId: z.uuid(),
    operationId: z.uuid(),
    data: encoded,
  }),
  z.object({ type: z.literal('awareness'), nodeId: z.uuid(), data: encoded.max(16_384) }),
]);

export type MoveNodes = Extract<z.infer<typeof clientMessage>, { type: 'move-nodes' }>;

export function encodeBytes(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
export function decodeBytes(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
