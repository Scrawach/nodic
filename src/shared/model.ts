export type NodeKind = 'start' | 'line' | 'choice' | 'end';

export interface DialogueNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  preview: string;
}

export interface Dialogue {
  id: string;
  projectId: string;
  name: string;
  nodes: DialogueNode[];
}

export interface Project {
  id: string;
  name: string;
  role: 'owner' | 'editor';
  dialogues: { id: string; name: string }[];
}
