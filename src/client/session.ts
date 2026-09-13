import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { entries, set, del } from 'idb-keyval';
import { decodeBytes, encodeBytes } from '../shared/protocol';
import type { DialogueNode } from '../shared/model';

const REMOTE = Symbol('remote');
type Pending = { type: 'text-update'; nodeId: string; operationId: string; data: string };
export interface TextHandle {
  doc: Y.Doc;
  undo: Y.UndoManager;
  awareness: Awareness;
  loaded: boolean;
}
interface SessionState {
  connected: boolean;
  status: string;
  peers: number;
  nodes: DialogueNode[];
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
  private state: SessionState = {
    connected: false,
    status: 'Подключение…',
    peers: 0,
    nodes: [],
    version: 0,
  };

  constructor(private dialogueId: string) {
    let sessionId = sessionStorage.getItem('nodic-tab');
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      sessionStorage.setItem('nodic-tab', sessionId);
    }
    this.outboxPrefix = `nodic:${sessionId}:${dialogueId}:`;
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
      for (const [key, value] of await entries<string, Pending>()) {
        if (!key.startsWith(this.outboxPrefix)) continue;
        this.pending.set(value.operationId, value);
        this.durable.add(value.operationId);
        Y.applyUpdate(this.ensureText(value.nodeId).doc, decodeBytes(value.data), REMOTE);
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
        this.update({ connected: true, nodes: message.nodes || [] });
        for (const nodeId of this.texts.keys()) this.send({ type: 'open-text', nodeId });
        this.status();
      } else if (message.type === 'peers') this.update({ peers: message.count });
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
            if (pending.nodeId === message.nodeId && this.durable.has(pending.operationId))
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
            this.pending.delete(message.operationId);
            this.durable.delete(message.operationId);
            this.status();
          })
          .catch(() => {
            this.failed = true;
            this.status();
          });
      } else if (message.type === 'error') {
        this.failed = true;
        this.update({ status: message.message });
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
    return this.state.connected && handle.loaded && !this.failed;
  }
  destroy() {
    this.stopped = true;
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
