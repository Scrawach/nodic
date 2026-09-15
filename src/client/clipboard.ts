import { graphFragment, type GraphFragment } from '../shared/protocol';

const key = 'nodic-graph-clipboard-v1';
export function storeFragment(fragment: GraphFragment) {
  const value = JSON.stringify(graphFragment.parse(fragment));
  if (new TextEncoder().encode(value).length > 1_500_000)
    throw new Error('Выделение слишком велико для копирования. Выберите меньше нод.');
  sessionStorage.setItem(key, value);
}
export function pastedFragment(projectId: string, point: { x: number; y: number }): GraphFragment {
  const stored = sessionStorage.getItem(key);
  if (!stored) throw new Error('Сначала скопируйте ноды.');
  const fragment = graphFragment.parse(JSON.parse(stored));
  if (fragment.projectId !== projectId)
    throw new Error('Вставка доступна только внутри одного проекта.');
  const ids = new Map(fragment.nodes.map((node) => [node.id, crypto.randomUUID()]));
  const dx = point.x - Math.min(...fragment.nodes.map((n) => n.x));
  const dy = point.y - Math.min(...fragment.nodes.map((n) => n.y));
  return {
    projectId,
    nodes: fragment.nodes.map((n) => ({ ...n, id: ids.get(n.id)!, x: n.x + dx, y: n.y + dy })),
    edges: fragment.edges.map((e) => ({
      ...e,
      id: crypto.randomUUID(),
      source: ids.get(e.source)!,
      target: ids.get(e.target)!,
      bend: e.bend ? { x: e.bend.x + dx, y: e.bend.y + dy } : null,
    })),
  };
}
