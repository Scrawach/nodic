import { recoverCreations } from './api';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { entries, set, del } from 'idb-keyval';
import { decodeBytes, encodeBytes, type MoveNodes, type GraphCommand } from '../shared/protocol';
import type { DialogueNode, DialogueEdge } from '../shared/model';

const REMOTE = Symbol('remote');
type Pending =
  | { type: 'text-update'; nodeId: string; operationId: string; data: string }
  | (GraphCommand & { order: number });
export interface TextHandle {
  doc: Y.Doc;
  undo: Y.UndoManager;
  awareness: Awareness;
  loaded: boolean;
}
type HistoryEntry =
  | { type: 'graph'; operationId: string }
  | { type: 'text'; nodeId: string; item: Y.UndoManager['undoStack'][number] };

interface SessionState {
  connected: boolean;
  status: string;
  peers: number;
  nodes: DialogueNode[];
  edges: DialogueEdge[];
  projectVersion: number;
  notice: string;
  version: number;
}

export class DialogueSession {
  private socket?: WebSocket;
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private listeners = new Set<() => void>();
  private texts = new Map<string, TextHandle>();
  private pending = new Map<string, Pending>();
  private durable = new Set<string>();
  private outboxPrefix: string;
  private failed = false;
  private moveOrder = Date.now();
  private sentMove?: string;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private reversingText = false;
  private creations = new Map<string, HistoryEntry>();
  private reversals = new Map<string, { direction: 'undo' | 'redo'; target: HistoryEntry }>();
  private stopCapturing() {
    for (const handle of this.texts.values()) handle.undo.stopCapturing();
  }
  private remember(entry: HistoryEntry) {
    this.undoStack.push(entry);
    this.redoStack = [];
    for (const handle of this.texts.values()) handle.undo.clear(false, true);
    this.update();
  }
  beginCreation() {
    const id = crypto.randomUUID();
    const entry: HistoryEntry = { type: 'graph', operationId: id };
    this.creations.set(id, entry);
    this.stopCapturing();
    this.remember(entry);
    return id;
  }
  finishCreation(id: string, operationId?: string) {
    const entry = this.creations.get(id);
    this.creations.delete(id);
    if (entry?.type === 'graph' && operationId) entry.operationId = operationId;
    else this.undoStack = this.undoStack.filter((item) => item !== entry);
    if (!this.stopped) this.update();
  }
  canUndo() {
    return (
      this.canMove() && !this.pending.size && !this.creations.size && this.undoStack.length > 0
    );
  }
  canRedo() {
    return (
      this.canMove() && !this.pending.size && !this.creations.size && this.redoStack.length > 0
    );
  }
  undo() {
    this.reverse('undo');
  }
  redo() {
    this.reverse('redo');
  }
  private reverse(direction: 'undo' | 'redo') {
    if (!(direction === 'undo' ? this.canUndo() : this.canRedo())) return;
    this.stopCapturing();
    const from = direction === 'undo' ? this.undoStack : this.redoStack;
    const to = direction === 'undo' ? this.redoStack : this.undoStack;
    const target = from.at(-1)!;
    if (target.type === 'text') {
      const handle = this.texts.get(target.nodeId)!;
      const stack = direction === 'undo' ? handle.undo.undoStack : handle.undo.redoStack;
      if (!handle.loaded || !this.state.nodes.some((n) => n.id === target.nodeId)) {
        const index = stack.indexOf(target.item);
        if (index !== -1) stack.splice(index, 1);
        from.pop();
        this.update({ notice: 'Отмена пропущена: нода недоступна для редактирования.' });
        return;
      }
      from.pop();
      // Yjs normally skips empty items and continues into older actions. Isolate
      // this one item so a remote deletion cannot jump across a graph action.
      const index = stack.indexOf(target.item);
      if (index === -1) {
        this.update();
        return;
      }
      const older = stack.splice(0, index);
      this.reversingText = true;
      try {
        const result = direction === 'undo' ? handle.undo.undo() : handle.undo.redo();
        const opposite = direction === 'undo' ? handle.undo.redoStack : handle.undo.undoStack;
        const item = opposite.at(-1);
        if (result && item) to.push({ ...target, item });
      } finally {
        stack.unshift(...older);
        this.reversingText = false;
        this.update();
      }
      return;
    }
    const operationId = crypto.randomUUID();
    this.reversals.set(operationId, { direction, target });
    this.command({ type: 'reverse-graph', operationId, targetOperationId: target.operationId });
  }
  private finishHistory(operationId: string, accepted: boolean) {
    const operation = this.pending.get(operationId);
    if (!operation || operation.type === 'text-update') return;
    const reversal = this.reversals.get(operationId);
    if (reversal) {
      const from = reversal.direction === 'undo' ? this.undoStack : this.redoStack;
      const to = reversal.direction === 'undo' ? this.redoStack : this.undoStack;
      if (from.at(-1) === reversal.target) from.pop();
      if (accepted) to.push({ type: 'graph', operationId });
      this.reversals.delete(operationId);
    } else if (!accepted) {
      this.undoStack = this.undoStack.filter(
        (entry) => entry.type !== 'graph' || entry.operationId !== operationId,
      );
    }
  }
  private historyKey = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const undo = event.code === 'KeyZ' && !event.shiftKey;
    const redo = (event.code === 'KeyZ' && event.shiftKey) || event.code === 'KeyY';
    if (!undo && !redo) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      !target.closest('.cm-editor') &&
      (target.closest('input, textarea, select') || target.isContentEditable)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (undo) this.undo();
    else this.redo();
  };
  private state: SessionState = {
    connected: false,
    status: 'Подключение…',
    peers: 0,
    nodes: [],
    edges: [],
    projectVersion: 0,
    notice: '',
    version: 0,
  };

  constructor(private dialogueId: string) {
    let sessionId = sessionStorage.getItem('nodic-tab');
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      sessionStorage.setItem('nodic-tab', sessionId);
    }
    this.outboxPrefix = `nodic:${sessionId}:${dialogueId}:`;
    window.addEventListener('keydown', this.historyKey, true);
    window.addEventListener('offline', this.offline);
    window.addEventListener('online', this.online);
    void this.initialize();
  }
  private offline = () => {
    clearTimeout(this.timer);
    for (const handle of this.texts.values()) handle.loaded = false;
    this.update({ connected: false });
    this.status();
    this.socket?.close();
  };
  private online = () => {
    clearTimeout(this.timer);
    if (!this.stopped && this.socket?.readyState !== WebSocket.OPEN) this.connect();
  };
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<SessionState> = {}) {
    this.state = { ...this.state, ...patch, version: this.state.version + 1 };
    for (const listener of this.listeners) listener();
  }
  private status() {
    this.update({
      status: this.failed
        ? 'Не удалось сохранить — переподключитесь'
        : !this.state.connected
          ? 'Нет соединения'
          : this.pending.size
            ? 'Сохраняется…'
            : 'Сохранено',
    });
  }
  private async initialize() {
    try {
      const stored = (await entries<string, Pending>()).filter(([key]) =>
        key.startsWith(this.outboxPrefix),
      );
      stored.sort(
        (a, b) =>
          (a[1].type !== 'text-update' ? a[1].order : 0) -
          (b[1].type !== 'text-update' ? b[1].order : 0),
      );
      for (const [, value] of stored) {
        this.pending.set(value.operationId, value);
        this.durable.add(value.operationId);
        if (value.type === 'text-update')
          Y.applyUpdate(this.ensureText(value.nodeId).doc, decodeBytes(value.data), REMOTE);
        else this.moveOrder = Math.max(this.moveOrder, value.order);
      }
      try {
        await recoverCreations(`/dialogues/${this.dialogueId}`);
      } catch {
        this.update({
          notice:
            'Не удалось подтвердить создание нод. Обновите страницу после восстановления связи.',
        });
      }
      if (!this.stopped) this.connect();
    } catch {
      this.failed = true;
      this.status();
    }
  }
  private send(message: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
  private connect() {
    if (this.stopped || !navigator.onLine) {
      this.status();
      return;
    }
    const socket = new WebSocket(
      `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/dialogues/${this.dialogueId}/live`,
    );
    this.socket = socket;
    socket.onmessage = (event) => {
      if (socket !== this.socket || this.stopped || !navigator.onLine) return;
      const message = JSON.parse(event.data);
      if (message.type === 'ready') {
        this.failed = false;
        this.sentMove = undefined;
        this.update({
          connected: true,
          nodes: message.nodes || [],
          edges: message.edges || [],
          projectVersion: this.state.projectVersion + 1,
        });
        this.flushMove();
        for (const nodeId of this.texts.keys()) {
          if (this.state.nodes.some((n) => n.id === nodeId))
            this.send({ type: 'open-text', nodeId });
          else
            for (const pending of this.pending.values())
              if (
                pending.type === 'text-update' &&
                pending.nodeId === nodeId &&
                this.durable.has(pending.operationId)
              )
                this.send(pending);
        }
        this.status();
      } else if (message.type === 'peers') this.update({ peers: message.count });
      else if (message.type === 'project-changed')
        this.update({ projectVersion: this.state.projectVersion + 1 });
      else if (message.type === 'graph')
        this.update({ nodes: message.nodes, edges: message.edges });
      else if (message.type === 'positions')
        this.update({
          nodes: this.state.nodes.map((node) => {
            const position = (message.positions as MoveNodes['positions']).find(
              (p) => p.nodeId === node.id,
            );
            return position ? { ...node, x: position.x, y: position.y } : node;
          }),
        });
      else if (message.type === 'node')
        this.update({
          nodes: [...this.state.nodes.filter((n) => n.id !== message.node.id), message.node],
        });
      else if (message.type === 'preview')
        this.update({
          nodes: this.state.nodes.map((n) =>
            n.id === message.nodeId ? { ...n, preview: message.preview } : n,
          ),
        });
      else if (message.type === 'text-state' || message.type === 'text-update') {
        const handle = this.texts.get(message.nodeId);
        if (!handle) return;
        Y.applyUpdate(handle.doc, decodeBytes(message.data), REMOTE);
        if (message.type === 'text-state') {
          handle.loaded = true;
          for (const pending of this.pending.values())
            if (
              pending.type === 'text-update' &&
              pending.nodeId === message.nodeId &&
              this.durable.has(pending.operationId)
            )
              this.send(pending);
          this.sendAwareness(message.nodeId, handle);
        }
        this.update();
      } else if (message.type === 'awareness') {
        const handle = this.texts.get(message.nodeId);
        if (handle) applyAwarenessUpdate(handle.awareness, decodeBytes(message.data), REMOTE);
        this.update();
      } else if (message.type === 'saved') {
        void del(this.outboxPrefix + message.operationId)
          .then(() => {
            this.finishHistory(message.operationId, true);
            if (message.notice) this.update({ notice: message.notice });
            this.pending.delete(message.operationId);
            this.durable.delete(message.operationId);
            if (this.sentMove === message.operationId) this.sentMove = undefined;
            this.flushMove();
            this.status();
          })
          .catch(() => {
            this.failed = true;
            this.status();
          });
      } else if (message.type === 'error') {
        const operation = this.pending.get(message.operationId);
        if (message.rejected && operation && operation.type !== 'text-update') {
          void del(this.outboxPrefix + message.operationId)
            .then(() => {
              this.finishHistory(message.operationId, false);
              this.pending.delete(message.operationId);
              this.durable.delete(message.operationId);
              if (this.sentMove === message.operationId) this.sentMove = undefined;
              this.update({ notice: message.message });
              this.flushMove();
              this.status();
            })
            .catch(() => {
              this.failed = true;
              this.status();
            });
        } else {
          this.failed = true;
          this.update({ status: message.message });
        }
      }
    };
    socket.onclose = () => {
      if (socket !== this.socket || this.stopped) return;
      for (const handle of this.texts.values()) handle.loaded = false;
      this.update({ connected: false });
      this.status();
      if (navigator.onLine) this.timer = setTimeout(() => this.connect(), 1500);
    };
    socket.onerror = () => socket.close();
  }
  private sendAwareness(nodeId: string, handle: TextHandle) {
    if (this.state.connected && handle.loaded)
      this.send({
        type: 'awareness',
        nodeId,
        data: encodeBytes(encodeAwarenessUpdate(handle.awareness, [handle.doc.clientID])),
      });
  }
  private flushMove() {
    if (!this.state.connected || this.stopped || this.failed || this.sentMove) return;
    const move = [...this.pending.values()].find((p) => p.type !== 'text-update');
    if (!move || !this.durable.has(move.operationId)) return;
    this.sentMove = move.operationId;
    this.send(move);
  }
  moveNodes(positions: MoveNodes['positions']) {
    this.command({ type: 'move-nodes', operationId: crypto.randomUUID(), positions });
  }
  command(command: GraphCommand) {
    if (
      !this.state.connected ||
      this.failed ||
      (this.reversals.size > 0 && !this.reversals.has(command.operationId))
    )
      return;
    this.stopCapturing();
    if (command.type !== 'reverse-graph')
      this.remember({ type: 'graph', operationId: command.operationId });
    const message: Pending = { ...command, order: ++this.moveOrder };
    this.pending.set(message.operationId, message);
    this.status();
    void set(this.outboxPrefix + message.operationId, message)
      .then(() => {
        this.durable.add(message.operationId);
        this.flushMove();
      })
      .catch(() => {
        this.failed = true;
        this.status();
      });
  }
  clearNotice() {
    this.update({ notice: '' });
  }
  canMove() {
    return this.state.connected && !this.failed && !this.reversals.size;
  }
  private ensureText(nodeId: string) {
    let handle = this.texts.get(nodeId);
    if (handle) return handle;
    const doc = new Y.Doc(),
      text = doc.getText('text');
    const awareness = new Awareness(doc);
    awareness.setLocalState(null);
    handle = {
      doc,
      awareness,
      undo: new Y.UndoManager(text, { trackedOrigins: new Set(), captureTimeout: 500 }),
      loaded: false,
    };
    this.texts.set(nodeId, handle);
    const current = handle;
    current.undo.on('stack-item-added', ({ stackItem }) => {
      if (this.reversingText) return;
      for (const [id, other] of this.texts) if (id !== nodeId) other.undo.stopCapturing();
      this.remember({ type: 'text', nodeId, item: stackItem });
    });
    doc.on('update', (bytes: Uint8Array, origin: unknown) => {
      if (origin === REMOTE || this.stopped) return;
      const message: Pending = {
        type: 'text-update',
        nodeId,
        operationId: crypto.randomUUID(),
        data: encodeBytes(bytes),
      };
      this.pending.set(message.operationId, message);
      this.status();
      void set(this.outboxPrefix + message.operationId, message)
        .then(() => {
          this.durable.add(message.operationId);
          if (!this.stopped && this.state.connected && current.loaded) this.send(message);
        })
        .catch(() => {
          this.failed = true;
          this.status();
        });
    });
    awareness.on('update', (_changes: unknown, origin: unknown) => {
      if (origin !== REMOTE) this.sendAwareness(nodeId, current);
      this.update();
    });
    return handle;
  }
  openText(nodeId: string) {
    const existed = this.texts.has(nodeId);
    const handle = this.ensureText(nodeId);
    if (!existed && this.state.connected) this.send({ type: 'open-text', nodeId });
    return handle;
  }
  canEdit(handle: TextHandle) {
    return this.state.connected && handle.loaded && !this.failed && !this.reversals.size;
  }
  destroy() {
    this.stopped = true;
    window.removeEventListener('keydown', this.historyKey, true);
    window.removeEventListener('offline', this.offline);
    window.removeEventListener('online', this.online);
    clearTimeout(this.timer);
    this.socket?.close();
    for (const h of this.texts.values()) {
      h.awareness.destroy();
      h.undo.destroy();
      h.doc.destroy();
    }
    this.listeners.clear();
  }
}
