export type NodeKind = 'start' | 'line' | 'choice' | 'end';

export interface DialogueNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  preview: string;
  characterId: string | null;
  characterMissing?: boolean;
}

export const characterColors = [
  '#4c956c',
  '#487fbd',
  '#b45f8c',
  '#c18a35',
  '#8065b1',
  '#3d989d',
  '#bc654d',
  '#727f3a',
];

export interface Character {
  id: string;
  name: string;
  color: string;
}
export interface DialogueEdge {
  id: string;
  source: string;
  target: string;
  bend: { x: number; y: number } | null;
}
export interface GraphSnapshot {
  nodes: DialogueNode[];
  edges: DialogueEdge[];
}

export interface Dialogue {
  id: string;
  projectId: string;
  name: string;
  nodes: DialogueNode[];
  edges: DialogueEdge[];
}

export interface Project {
  id: string;
  name: string;
  role: 'owner' | 'editor';
  characters: Character[];
  dialogues: { id: string; name: string }[];
}
