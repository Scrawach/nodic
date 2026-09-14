import { memo, useEffect, useState, useSyncExternalStore } from 'react';
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
const StoryNode = memo(({ data }: NodeProps<Node<{ story: DialogueNode }>>) => {
  const n = data.story;
  return (
    <div className={`story-node kind-${n.kind}`} data-testid={`node-${n.kind}`}>
      {n.kind !== 'start' && <Handle type="target" position={Position.Left} />}
      <div className="node-label">
        <span>
          {n.kind === 'choice' ? '◇' : n.kind === 'start' ? '↗' : n.kind === 'end' ? '◼' : '≋'}
        </span>
        {names[n.kind]}
      </div>
      {(n.kind === 'line' || n.kind === 'choice') && (
        <>
          <div className="node-character">
            {n.kind === 'line' ? 'Без персонажа' : 'Выбор игрока'}
          </div>
          <p>{n.preview || 'Двойной клик, чтобы написать…'}</p>
        </>
      )}
      {n.kind !== 'end' && <Handle type="source" position={Position.Right} />}
    </div>
  );
});
const nodeTypes = { story: StoryNode };

function Board({ project, dialogueId }: { project: Project; dialogueId: string }) {
  const [session] = useState(() => new DialogueSession(dialogueId));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [editor, setEditor] = useState<string>();
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const flow = useReactFlow();
  const [boardNodes, setBoardNodes] = useState<Node<{ story: DialogueNode }>[]>([]);
  useEffect(() => {
    setBoardNodes((current) =>
      state.nodes.map((n) => {
        const prior = current.find((node) => node.id === n.id);
        return {
          ...prior,
          id: n.id,
          type: 'story',
          data: { story: n },
          position: prior?.dragging && state.connected ? prior.position : { x: n.x, y: n.y },
          dragging: state.connected && prior?.dragging,
        };
      }),
    );
  }, [state.nodes, state.connected]);
  useEffect(() => () => session.destroy(), [session]);
  const add = async (kind: Exclude<NodeKind, 'start'>, point?: { x: number; y: number }) => {
    if (!state.connected) return;
    const position = flow.screenToFlowPosition(point || { x: innerWidth / 2, y: innerHeight / 2 });
    try {
      await api(`/dialogues/${dialogueId}/nodes`, { kind, ...position });
      setMenu(undefined);
    } catch (e) {
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
          edges={[]}
          nodeTypes={nodeTypes}
          nodesDraggable={session.canMove()}
          deleteKeyCode={null}
          nodesConnectable={false}
          zoomOnDoubleClick={false}
          fitView
          fitViewOptions={{ maxZoom: 1 }}
          minZoom={0.15}
          maxZoom={2}
          onNodeDoubleClick={(_, node) => {
            if (node.data.story.kind === 'line' || node.data.story.kind === 'choice')
              setEditor(node.id);
          }}
          onPaneClick={() => setMenu(undefined)}
          onPaneContextMenu={(event) => {
            event.preventDefault();
            setMenu({ x: event.clientX, y: event.clientY });
          }}
        >
          <Background color="#cbd2c8" gap={24} size={1} />
          <MiniMap nodeColor="#85a592" pannable zoomable />
          <Controls showInteractive={false} />
        </ReactFlow>
        <div className="node-toolbar">
          <span>ДОБАВИТЬ</span>
          <button
            disabled={!state.connected}
            aria-label="Добавить реплику"
            onClick={() => void add('line')}
          >
            ≋ Реплика
          </button>
          <button disabled={!state.connected} onClick={() => void add('choice')}>
            ◇ Вариант
          </button>
          <button disabled={!state.connected} onClick={() => void add('end')}>
            ◼ Конец
          </button>
        </div>
        <div className="canvas-caption">
          Колесо — масштаб · Перетаскивание поля — навигация · Двойной клик — текст
        </div>
        {error && (
          <div role="alert" className="error-toast" onClick={() => setError('')}>
            {error}
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
            {(['line', 'choice', 'end'] as const).map((kind) => (
              <button key={kind} onClick={() => void add(kind, menu)}>
                {names[kind]}
              </button>
            ))}
          </div>
        )}
      </main>
      {editor && (
        <TextEditor
          key={editor}
          session={session}
          nodeId={editor}
          close={() => setEditor(undefined)}
        />
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
