import { type CSSProperties, memo, useEffect, useState, useSyncExternalStore } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  MiniMap,
  Controls,
  Handle,
  Position,
  useReactFlow,
  applyNodeChanges,
  type NodeProps,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api } from './api';
import { DialogueSession } from './session';
import { TextEditor } from './TextEditor';
import { StoryEdge } from './StoryEdge';
import type { DialogueNode, Project, NodeKind } from '../shared/model';
import './style.css';

type Recent = { id: string; name: string; editorLink?: string; ownerLink?: string };
function recents(): Recent[] {
  try {
    return JSON.parse(localStorage.getItem('nodic-projects') || '[]');
  } catch {
    return [];
  }
}
function remember(project: Recent) {
  const prior = recents();
  localStorage.setItem(
    'nodic-projects',
    JSON.stringify(
      [
        { ...prior.find((p) => p.id === project.id), ...project },
        ...prior.filter((p) => p.id !== project.id),
      ].slice(0, 20),
    ),
  );
}
const names: Record<NodeKind, string> = {
  start: 'Начало',
  line: 'Реплика',
  choice: 'Вариант',
  end: 'Конец',
};
const StoryNode = memo(
  ({
    data,
  }: NodeProps<Node<{ story: DialogueNode; characterName?: string; characterColor?: string }>>) => {
    const n = data.story;
    return (
      <div
        className={`story-node kind-${n.kind}${n.kind === 'line' && data.characterColor ? ' has-character' : ''}`}
        data-testid={`node-${n.kind}`}
        style={
          n.kind === 'line' && data.characterColor
            ? ({ '--character-color': data.characterColor } as CSSProperties)
            : undefined
        }
      >
        {n.kind === 'choice' && (
          <svg className="choice-shape" viewBox="0 0 270 180" aria-hidden="true">
            <path d="M 128 12 Q 135 2 142 12 L 260 165 Q 269 176 254 176 L 16 176 Q 1 176 10 165 Z" />
          </svg>
        )}
        {n.kind !== 'start' && <Handle type="target" position={Position.Left} aria-label="Вход" />}
        {n.kind !== 'choice' && (
          <div className="node-label">
            <span>{n.kind === 'start' ? '↗' : n.kind === 'end' ? '◼' : '≋'}</span>
            {names[n.kind]}
          </div>
        )}
        {(n.kind === 'line' || n.kind === 'choice') && (
          <>
            {n.kind === 'line' && (
              <div className="node-character">{data.characterName || 'Без персонажа'}</div>
            )}
            <p>{n.preview || (n.kind === 'line' ? 'Двойной клик, чтобы написать…' : '')}</p>
          </>
        )}
        {n.kind !== 'end' && <Handle type="source" position={Position.Right} aria-label="Выход" />}
      </div>
    );
  },
);
const nodeTypes = { story: StoryNode };
const edgeTypes = { story: StoryEdge };
const icons: Record<NodeKind, string> = { start: '↗', line: '≋', choice: '△', end: '◼' };

function Board({ project: initialProject, dialogueId }: { project: Project; dialogueId: string }) {
  const [project, setProject] = useState(initialProject);
  const [newDialogue, setNewDialogue] = useState(false);
  const [dialogueName, setDialogueName] = useState('');
  const [selectedEdge, setSelectedEdge] = useState<string>();
  const [creatingDialogue, setCreatingDialogue] = useState(false);
  const [session] = useState(() => new DialogueSession(dialogueId));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [editor, setEditor] = useState<string>();
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId?: string; edgeId?: string }>();
  const flow = useReactFlow();
  const [boardNodes, setBoardNodes] = useState<
    Node<{ story: DialogueNode; characterName?: string; characterColor?: string }>[]
  >([]);
  useEffect(() => {
    setBoardNodes((current) =>
      state.nodes.map((n) => {
        const prior = current.find((node) => node.id === n.id);
        return {
          ...prior,
          id: n.id,
          type: 'story',
          data: {
            story: n,
            characterName: project.characters.find((c) => c.id === n.characterId)?.name,
            characterColor: project.characters.find((c) => c.id === n.characterId)?.color,
          },
          position: prior?.dragging && state.connected ? prior.position : { x: n.x, y: n.y },
          dragging: state.connected && prior?.dragging,
        };
      }),
    );
  }, [state.nodes, state.connected, project.characters]);
  useEffect(() => {
    let cancelled = false;
    void api<Project>(`/projects/${project.id}`)
      .then((p) => {
        if (!cancelled) setProject(p);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [state.projectVersion, project.id]);
  useEffect(() => {
    if (editor && state.connected && !state.nodes.some((n) => n.id === editor)) {
      setEditor(undefined);
      setError('Нода удалена. Редактор закрыт.');
    }
  }, [editor, state.nodes, state.connected]);
  useEffect(() => () => session.destroy(), [session]);
  const add = async (kind: Exclude<NodeKind, 'start'>, point?: { x: number; y: number }) => {
    if (!session.canMove()) return;
    const position = flow.screenToFlowPosition(point || { x: innerWidth / 2, y: innerHeight / 2 });
    const creation = session.beginCreation();
    try {
      const created = await api<{ operationId?: string }>(`/dialogues/${dialogueId}/nodes`, {
        kind,
        ...position,
      });
      session.finishCreation(creation, created.operationId);
      setMenu(undefined);
    } catch (e) {
      session.finishCreation(creation);
      setError(String(e));
    }
  };
  const links = recents().find((p) => p.id === project.id);
  return (
    <div className="workspace">
      <aside className="sidebar">
        <a className="brand" href="/">
          n<span>o</span>dic<span className="brand-dot">.</span>
        </a>
        <div className="project-label">ПРОЕКТ</div>
        <h1>{project.name}</h1>
        <div className="sidebar-rule" />
        <div className="section-label">
          Диалоги <span>{project.dialogues.length.toString().padStart(2, '0')}</span>
        </div>
        {project.dialogues.map((d) => (
          <a
            key={d.id}
            className={`dialogue-link ${d.id === dialogueId ? 'active' : ''}`}
            href={`/p/${project.id}/d/${d.id}`}
          >
            <span>▧</span>
            {d.name}
          </a>
        ))}
        <button
          className="new-dialogue"
          disabled={!state.connected}
          onClick={() => setNewDialogue(true)}
        >
          ＋ Новый диалог
        </button>
        <div className="sidebar-foot">
          <span className="status-dot" />
          Общая история начинается здесь
        </div>
      </aside>
      <main className="canvas-area">
        <header className="board-header">
          <div>
            <span className="breadcrumb">{project.name} /</span>
            <strong>{project.dialogues.find((d) => d.id === dialogueId)?.name}</strong>
          </div>
          <div className="button-row">
            <button disabled={!session.canUndo()} onClick={() => session.undo()}>
              Отменить
            </button>
            <button disabled={!session.canRedo()} onClick={() => session.redo()}>
              Повторить
            </button>
            <span className="presence-pill">◉ {state.peers} на доске</span>
            <button onClick={() => setSharing(true)}>Поделиться ↗</button>
          </div>
        </header>
        <div className="board-topline">
          <span className="eyebrow">ДОСКА ДИАЛОГА</span>
          <span
            className={`save-status ${state.connected ? '' : 'offline'}`}
            data-testid="save-status"
          >
            {state.status}
          </span>
        </div>
        <ReactFlow
          nodes={boardNodes}
          onNodesChange={(changes) => setBoardNodes((nodes) => applyNodeChanges(changes, nodes))}
          onNodeDragStop={(_, node, nodes) =>
            session.moveNodes(
              (nodes.length ? nodes : [node]).map((n) => ({ nodeId: n.id, ...n.position })),
            )
          }
          edges={state.edges.map((edge) => ({
            ...edge,
            type: 'story',
            selected: edge.id === selectedEdge,
            data: {
              bend: edge.bend,
              editable: session.canMove(),
              select: () => setSelectedEdge(edge.id),
              save: (bend: { x: number; y: number } | null) =>
                session.command({
                  type: 'bend-edge',
                  operationId: crypto.randomUUID(),
                  edgeId: edge.id,
                  bend,
                }),
            },
          }))}
          edgeTypes={edgeTypes}
          onEdgesChange={(changes) => {
            for (const c of changes)
              if (c.type === 'select')
                setSelectedEdge((id) => (c.selected ? c.id : id === c.id ? undefined : id));
          }}
          onConnect={(connection) =>
            session.command({
              type: 'connect-edge',
              operationId: crypto.randomUUID(),
              edgeId: crypto.randomUUID(),
              source: connection.source,
              target: connection.target,
            })
          }
          onNodeContextMenu={(event, node) => {
            event.preventDefault();
            setMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
          }}
          onEdgeContextMenu={(event, edge) => {
            event.preventDefault();
            setSelectedEdge(edge.id);
            setMenu({ x: event.clientX, y: event.clientY, edgeId: edge.id });
          }}
          nodeTypes={nodeTypes}
          nodesDraggable={session.canMove()}
          deleteKeyCode={null}
          nodesConnectable={session.canMove()}
          connectionRadius={28}
          zoomOnDoubleClick={false}
          fitView
          fitViewOptions={{ maxZoom: 1 }}
          minZoom={0.15}
          maxZoom={2}
          onNodeDoubleClick={(_, node) => {
            if (node.data.story.kind === 'line' || node.data.story.kind === 'choice')
              setEditor(node.id);
          }}
          onPaneClick={() => {
            setMenu(undefined);
            setSelectedEdge(undefined);
          }}
          onPaneContextMenu={(event) => {
            event.preventDefault();
            setMenu({ x: event.clientX, y: event.clientY });
          }}
        >
          <Background color="#cbd2c8" gap={24} size={1} />
          <MiniMap nodeColor="#85a592" pannable zoomable />
          <Controls showInteractive={false} />
        </ReactFlow>
        <div className="canvas-caption">
          ПКМ — добавить ноду · Shift — выделить группу · Двойной клик — текст · Потяните связь —
          изменить кривую
        </div>
        {(error || state.notice) && (
          <div
            role="alert"
            className="error-toast"
            onClick={() => {
              setError('');
              session.clearNotice();
            }}
          >
            {error || state.notice}
          </div>
        )}
        {menu && (
          <div
            className="context-menu"
            style={{
              left: Math.min(menu.x, innerWidth - 180),
              top: Math.min(menu.y, innerHeight - 160),
            }}
          >
            {menu.nodeId ? (
              <button
                disabled={
                  !session.canMove() ||
                  state.nodes.find((n) => n.id === menu.nodeId)?.kind === 'start'
                }
                onClick={() => {
                  session.command({
                    type: 'delete-node',
                    operationId: crypto.randomUUID(),
                    nodeId: menu.nodeId!,
                  });
                  setMenu(undefined);
                }}
              >
                ⌫ Удалить ноду
              </button>
            ) : menu.edgeId ? (
              <>
                <button
                  disabled={!session.canMove()}
                  onClick={() => {
                    session.command({
                      type: 'bend-edge',
                      operationId: crypto.randomUUID(),
                      edgeId: menu.edgeId!,
                      bend: null,
                    });
                    setMenu(undefined);
                  }}
                >
                  ⌁ Сбросить форму
                </button>
                <button
                  disabled={!session.canMove()}
                  onClick={() => {
                    session.command({
                      type: 'delete-edge',
                      operationId: crypto.randomUUID(),
                      edgeId: menu.edgeId!,
                    });
                    setMenu(undefined);
                  }}
                >
                  ⌫ Удалить связь
                </button>
              </>
            ) : (
              (['line', 'choice', 'end'] as const).map((kind) => (
                <button key={kind} disabled={!state.connected} onClick={() => void add(kind, menu)}>
                  <span aria-hidden="true">{icons[kind]}</span> {names[kind]}
                </button>
              ))
            )}
          </div>
        )}
      </main>
      {editor && (
        <TextEditor
          key={editor}
          session={session}
          project={project}
          onCharacterChanged={(character) =>
            setProject((p) => ({
              ...p,
              characters: [...p.characters.filter((c) => c.id !== character.id), character],
            }))
          }
          nodeId={editor}
          close={() => setEditor(undefined)}
        />
      )}
      {newDialogue && (
        <div className="modal-backdrop">
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Новый диалог"
            onSubmit={(event) => {
              event.preventDefault();
              setCreatingDialogue(true);
              void api<{ id: string }>(`/projects/${project.id}/dialogues`, { name: dialogueName })
                .then((d) => {
                  location.href = `/p/${project.id}/d/${d.id}`;
                })
                .catch((e) => {
                  setError(e.message);
                  setCreatingDialogue(false);
                });
            }}
          >
            <div className="modal-heading">
              <h2>Новый диалог</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Закрыть"
                onClick={() => setNewDialogue(false)}
              >
                ×
              </button>
            </div>
            <label>
              Название диалога
              <input
                autoFocus
                required
                maxLength={120}
                value={dialogueName}
                onChange={(e) => setDialogueName(e.target.value)}
              />
            </label>
            <button className="primary" disabled={creatingDialogue || !dialogueName.trim()}>
              {creatingDialogue ? 'Создаём…' : 'Создать диалог'}
            </button>
          </form>
        </div>
      )}
      {sharing && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="share-title">
            <div className="modal-heading">
              <h2 id="share-title">Пригласить соавтора</h2>
              <button
                className="icon-button"
                aria-label="Закрыть"
                onClick={() => setSharing(false)}
              >
                ×
              </button>
            </div>
            <p>Открыв эту ссылку, коллега сможет редактировать проект без регистрации.</p>
            {links?.editorLink ? (
              <label>
                Ссылка редактора
                <input
                  aria-label="Ссылка редактора"
                  readOnly
                  value={links.editorLink}
                  onFocus={(e) => e.target.select()}
                />
              </label>
            ) : (
              <p>Для приглашения используйте исходную ссылку проекта.</p>
            )}
            {project.role === 'owner' && links?.ownerLink && (
              <details>
                <summary>Ссылка владельца</summary>
                <input
                  aria-label="Ссылка владельца"
                  readOnly
                  value={links.ownerLink}
                  onFocus={(e) => e.target.select()}
                />
                <p className="muted">
                  Сохраните отдельно: эта ссылка подтверждает права владельца.
                </p>
              </details>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export function App() {
  const match = location.pathname.match(/^\/p\/([^/]+)(?:\/d\/([^/]+))?$/);
  const [project, setProject] = useState<Project>();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!match) return;
    let cancelled = false;
    void (async () => {
      const token = new URLSearchParams(location.hash.slice(1)).get('key');
      if (token) {
        const grant = await api<{ role: string }>(`/projects/${match[1]}/access`, { token });
        if (grant.role === 'editor')
          remember({
            id: match[1],
            name: '',
            editorLink: `${location.origin}/p/${match[1]}#key=${token}`,
          });
        history.replaceState(null, '', location.pathname);
      }
      const value = await api<Project>(`/projects/${match[1]}`);
      remember({ id: value.id, name: value.name });
      if (!cancelled) setProject(value);
    })().catch((e) => {
      if (!cancelled) setError(e.message);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<{
        id: string;
        dialogueId: string;
        ownerToken: string;
        editorToken: string;
      }>('/projects', { name });
      const base = `${location.origin}/p/${result.id}`;
      remember({
        id: result.id,
        name,
        ownerLink: `${base}#key=${result.ownerToken}`,
        editorLink: `${base}#key=${result.editorToken}`,
      });
      location.href = `${base}/d/${result.dialogueId}#key=${result.ownerToken}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать проект.');
      setBusy(false);
    }
  }
  if (match)
    return project ? (
      <ReactFlowProvider>
        <Board
          key={match[2] || project.dialogues[0].id}
          project={project}
          dialogueId={match[2] || project.dialogues[0].id}
        />
      </ReactFlowProvider>
    ) : (
      <main className="loading">
        <a className="brand" href="/">
          nodic.
        </a>
        <p role={error ? 'alert' : undefined}>{error || 'Открываем проект…'}</p>
      </main>
    );
  return (
    <main className="landing">
      <header>
        <a className="brand" href="/">
          n<span>o</span>dic<span className="brand-dot">.</span>
        </a>
        <span className="eyebrow">ПРОСТРАНСТВО ДЛЯ ИСТОРИЙ</span>
      </header>
      <div className="landing-grid">
        <section>
          <span className="eyebrow">НАРРАТИВНЫЕ ДИАЛОГИ</span>
          <h1>
            У каждой истории
            <br />
            есть <em>выбор.</em>
          </h1>
          <p className="intro">
            Соединяйте реплики, находите новые ветви.
            <br />
            Пишите вместе — на одной доске.
          </p>
          <form onSubmit={(event) => void create(event)}>
            <label htmlFor="project-name">Название проекта</label>
            <div className="create-row">
              <input
                id="project-name"
                placeholder="Например, Тихий лес"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <button className="primary" disabled={busy || !name.trim()}>
                {busy ? 'Создаём…' : 'Создать проект'}
              </button>
            </div>
          </form>
          {error && <p role="alert">{error}</p>}
          <p className="small-note">Без регистрации. Пригласите команду по ссылке.</p>
        </section>
        <section className="landing-art" aria-hidden="true">
          <div className="art-tag">ПЕРВЫЙ ДИАЛОГ</div>
          <div className="art-line" />
          <div className="art-card">
            <span>↗ НАЧАЛО</span>
          </div>
          <div className="art-card reply">
            <span>НЕЗНАКОМЕЦ</span>
            <p>
              Ты тоже слышишь
              <br />
              голос леса?
            </p>
          </div>
          <div className="art-choices">
            <div>◇ Пойти на голос</div>
            <div>◇ Остаться здесь</div>
          </div>
          <div className="art-author">↖ Соавтор</div>
        </section>
      </div>
      {recents().length > 0 && (
        <section className="recent">
          <h2>Недавно открытые</h2>
          <div className="recent-grid">
            {recents().map((p) => (
              <a key={p.id} href={`/p/${p.id}`}>
                <span>▧</span>
                <strong>{p.name || 'Проект'}</strong>
                <span>↗</span>
              </a>
            ))}
          </div>
        </section>
      )}
      <footer>Небольшие реплики. Большие миры.</footer>
    </main>
  );
}
