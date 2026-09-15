import { z } from 'zod';

const encoded = z
  .string()
  .max(1_500_000)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/);
export const graphFragment = z.object({
  projectId: z.uuid(),
  nodes: z
    .array(
      z.object({
        id: z.uuid(),
        kind: z.enum(['line', 'choice', 'end']),
        x: z.number().finite(),
        y: z.number().finite(),
        characterId: z.uuid().nullable(),
        characterMissing: z.boolean().optional(),
        text: z.string().max(500_000),
      }),
    )
    .min(1)
    .max(1000),
  edges: z
    .array(
      z.object({
        id: z.uuid(),
        source: z.uuid(),
        target: z.uuid(),
        bend: z.object({ x: z.number().finite(), y: z.number().finite() }).nullable(),
      }),
    )
    .max(5000),
});
export type GraphFragment = z.infer<typeof graphFragment>;

export const graphCommand = z.discriminatedUnion('type', [
  z.object({ type: z.literal('paste-nodes'), operationId: z.uuid(), fragment: graphFragment }),
  z.object({
    type: z.literal('reverse-graph'),
    operationId: z.uuid(),
    targetOperationId: z.uuid(),
  }),
  z.object({
    type: z.literal('move-nodes'),
    operationId: z.uuid(),
    positions: z
      .array(z.object({ nodeId: z.uuid(), x: z.number().finite(), y: z.number().finite() }))
      .min(1)
      .max(1000),
  }),
  z.object({
    type: z.literal('connect-edge'),
    operationId: z.uuid(),
    edgeId: z.uuid(),
    source: z.uuid(),
    target: z.uuid(),
  }),
  z.object({
    type: z.literal('bend-edge'),
    operationId: z.uuid(),
    edgeId: z.uuid(),
    bend: z.object({ x: z.number().finite(), y: z.number().finite() }).nullable(),
  }),
  z.object({ type: z.literal('delete-edge'), operationId: z.uuid(), edgeId: z.uuid() }),
  z.object({ type: z.literal('delete-node'), operationId: z.uuid(), nodeId: z.uuid() }),
  z.object({
    type: z.literal('delete-nodes'),
    operationId: z.uuid(),
    nodeIds: z.array(z.uuid()).min(1).max(1000),
  }),
  z.object({
    type: z.literal('set-character'),
    operationId: z.uuid(),
    nodeId: z.uuid(),
    characterId: z.uuid().nullable(),
  }),
]);
export type GraphCommand = z.infer<typeof graphCommand>;
export const boardPresence = z.object({
  type: z.literal('board-presence'),
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  cursor: z.object({ x: z.number().finite(), y: z.number().finite() }).nullable(),
  nodeIds: z.array(z.uuid()).max(1000),
  edgeIds: z.array(z.uuid()).max(1000),
});
export type BoardAuthor = Omit<z.infer<typeof boardPresence>, 'type'> & { id: string };

export const clientMessage = z.discriminatedUnion('type', [
  ...graphCommand.options,
  boardPresence,
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
