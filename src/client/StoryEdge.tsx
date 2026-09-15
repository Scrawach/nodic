import { useEffect, useRef, useState } from 'react';
import { BaseEdge, getBezierPath, useReactFlow, type Edge, type EdgeProps } from '@xyflow/react';

type Point = { x: number; y: number };
export type StoryEdgeData = {
  bend: Point | null;
  authors?: { name: string; color: string }[];
  editable: boolean;
  select: () => void;
  save: (bend: Point | null) => void;
};
export function StoryEdge(props: EdgeProps<Edge<StoryEdgeData>>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, data } =
    props;
  const flow = useReactFlow();
  const [draft, setDraft] = useState<Point>();
  const dragging = useRef(false);
  useEffect(() => {
    if (!data?.editable) {
      dragging.current = false;
      setDraft(undefined);
    }
  }, [data?.editable]);
  const bend = draft || data?.bend;
  const path = bend
    ? `M ${sourceX},${sourceY} Q ${bend.x},${bend.y} ${targetX},${targetY}`
    : getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })[0];
  const start = useRef<{ t: number; x: number; y: number } | undefined>(undefined);
  return (
    <g
      className={`story-edge nodrag nopan ${selected ? 'is-selected' : ''}`}
      data-testid={`edge-${id}`}
      onPointerDown={(event) => {
        if (event.button !== 0 || !data?.editable) return;
        event.stopPropagation();
        data.select();
        const p = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
        const dx = targetX - sourceX,
          dy = targetY - sourceY;
        const t = Math.max(
          0.1,
          Math.min(0.9, ((p.x - sourceX) * dx + (p.y - sourceY) * dy) / (dx * dx + dy * dy || 1)),
        );
        start.current = { t, x: event.clientX, y: event.clientY };
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!dragging.current || !start.current) return;
        const p = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
        const dx = targetX - sourceX,
          dy = targetY - sourceY;
        const distance =
          Math.abs(dy * (p.x - sourceX) - dx * (p.y - sourceY)) / (Math.hypot(dx, dy) || 1);
        if (distance * flow.getZoom() < 12) {
          setDraft({ x: (sourceX + targetX) / 2, y: (sourceY + targetY) / 2 });
        } else {
          const t = start.current.t,
            a = (1 - t) ** 2,
            b = t ** 2,
            c = 2 * t * (1 - t);
          setDraft({
            x: (p.x - a * sourceX - b * targetX) / c,
            y: (p.y - a * sourceY - b * targetY) / c,
          });
        }
      }}
      onPointerUp={(event) => {
        if (!dragging.current) return;
        dragging.current = false;
        if (
          draft &&
          start.current &&
          Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 3
        )
          data?.save(draft);
        setDraft(undefined);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        dragging.current = false;
        setDraft(undefined);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (data?.editable) data.save(null);
      }}
    >
      {!!data?.authors?.length && (
        <text
          data-testid="remote-edge-selection"
          x={(sourceX + targetX) / 2}
          y={(sourceY + targetY) / 2 - 12}
          fill={data.authors[0].color}
          fontSize="13"
          pointerEvents="none"
        >
          {data.authors.map((a) => a.name).join(', ')}
        </text>
      )}
      <defs>
        <marker
          id={`nodic-arrow-${id}`}
          viewBox="0 -4 12 8"
          markerWidth="12"
          markerHeight="8"
          refX="11"
          refY="0"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M 0 -3 L 11 0 L 0 3 Z" fill={selected ? 'var(--text)' : 'var(--muted)'} />
        </marker>
      </defs>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={`url(#nodic-arrow-${id})`}
        interactionWidth={24}
        style={{
          stroke: selected ? 'var(--text)' : 'var(--muted)',
          strokeWidth: selected ? 4 : 2.5,
        }}
      />
      {selected && bend && (
        <circle
          cx={(sourceX + 2 * bend.x + targetX) / 4}
          cy={(sourceY + 2 * bend.y + targetY) / 4}
          r={5}
          fill="var(--panel)"
          stroke="var(--text)"
          strokeWidth={2}
          pointerEvents="none"
        />
      )}
    </g>
  );
}
