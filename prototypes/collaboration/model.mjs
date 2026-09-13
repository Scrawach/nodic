// THROWAWAY PROTOTYPE. In-memory authority and independent Yjs replicas.
import * as Y from './yjs.vendor.mjs';

export class CollaborationDemo {
  constructor() {
    this.revision = 0;
    this.pending = [];
    this.commands = [];
    this.automatic = true;
    this.events = [];
    this.nodes = {
      start: { type: 'start', name: 'Начало', x: 0, alive: true },
      line: { type: 'line', name: 'Реплика', x: 1, alive: true },
      a: { type: 'choice', name: 'Остаться', x: 2, alive: true },
      b: { type: 'choice', name: 'Уйти', x: 2, alive: true },
      end: { type: 'end', name: 'Конец', x: 3, alive: true },
    };
    this.edges = new Map([['initial', { from: 'start', to: 'line' }]]);
    this.server = new Y.Doc();
    this.server.getText('line').insert(0, 'Привет, путник.');
    const seed = Y.encodeStateAsUpdate(this.server);
    this.clients = ['Аня', 'Борис'].map((name, i) => {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, seed);
      const origin = { author: i };
      const undo = new Y.UndoManager(doc.getText('line'), { trackedOrigins: new Set([origin]), captureTimeout: 0 });
      const client = { name, doc, origin, undo, online: true, past: [], future: [] };
      doc.on('update', (update, source) => {
        if (source === 'remote') return;
        this.pending.push({ author: i, update });
      });
      return client;
    });
    this.log('Две независимые копии реплики готовы. Данные хранятся только в памяти.');
  }
  destroy() {
    for (const c of this.clients) { c.undo.destroy(); c.doc.destroy(); }
    this.server.destroy();
  }
  log(message) { this.events.unshift(message); this.events.length = Math.min(this.events.length, 12); }
  record(i, action) { this.clients[i].past.push(action); this.clients[i].future = []; }
  edit(i, value) {
    const c = this.clients[i];
    if (!c.online || !this.nodes.line.alive) return this.log('Редактирование недоступно: нет связи или реплика удалена.');
    const text = c.doc.getText('line'), old = text.toString();
    if (old === value) return;
    let start = 0, end = 0;
    while (start < old.length && start < value.length && old[start] === value[start]) start++;
    while (end < old.length - start && end < value.length - start && old[old.length - 1 - end] === value[value.length - 1 - end]) end++;
    c.doc.transact(() => {
      const count = old.length - start - end;
      if (count) text.delete(start, count);
      const insert = value.slice(start, value.length - end);
      if (insert) text.insert(start, insert);
    }, c.origin);
    this.record(i, { kind: 'text' });
    this.log(`${c.name}: текст изменён.`);
    if (this.automatic) this.deliver();
  }
  append(i, text) { this.edit(i, this.clients[i].doc.getText('line').toString() + text); }
  deliver(reverse = false, duplicate = false) {
    const deliverable = this.pending.filter(p => this.clients[p.author].online);
    this.pending = this.pending.filter(p => !this.clients[p.author].online);
    if (reverse) deliverable.reverse();
    for (const p of deliverable) {
      Y.applyUpdate(this.server, p.update, 'remote');
      if (duplicate) Y.applyUpdate(this.server, p.update, 'remote');
    }
    for (const c of this.clients) {
      if (!c.online) continue;
      const difference = Y.encodeStateAsUpdate(this.server, Y.encodeStateVector(c.doc));
      Y.applyUpdate(c.doc, difference, 'remote');
    }
    if (deliverable.length) this.log(`Доставлено изменений: ${deliverable.length}${reverse ? ', в обратном порядке' : ''}${duplicate ? ', с повторами' : ''}.`);
  }
  setOnline(i, online) {
    this.clients[i].online = online;
    this.log(`${this.clients[i].name}: ${online ? 'соединение восстановлено' : 'нет соединения; ввод приостановлен'}.`);
    if (online) this.deliver();
  }
  canConnect(from, to) {
    const source = this.nodes[from], target = this.nodes[to];
    if (!source?.alive || !target?.alive) return 'Одна из нод удалена.';
    if (source.type === 'end') return 'У конца нет выхода.';
    if (target.type === 'start') return 'У начала нет входа.';
    const outgoing = [...this.edges.values()].filter(e => e.from === from);
    if (outgoing.some(e => e.to === to)) return 'Такая связь уже существует.';
    if (outgoing.length && (target.type !== 'choice' || outgoing.some(e => this.nodes[e.to].type !== 'choice'))) {
      return 'Несколько выходов разрешены только в варианты.';
    }
    return null;
  }
  queueConnection(i, from, to) {
    if (!this.clients[i].online) return this.log('Нет соединения: действие недоступно.');
    this.commands.push({ author: i, from, to });
    this.log(`${this.clients[i].name}: запрошена связь ${from} → ${to}.`);
  }
  processConnections() {
    const commands = this.commands.splice(0);
    for (const { author, from, to } of commands) {
      const error = this.canConnect(from, to);
      if (error) { this.log(`${this.clients[author].name}: связь отклонена. ${error}`); continue; }
      const id = `edge-${++this.revision}`;
      this.edges.set(id, { from, to });
      this.record(author, { kind: 'edge', id, from, to });
      this.log(`${this.clients[author].name}: связь ${from} → ${to} принята.`);
    }
  }
  move(i) {
    if (!this.clients[i].online || !this.nodes.line.alive) return;
    const before = this.nodes.line.x;
    const revision = ++this.revision;
    this.nodes.line.x = before + 1;
    this.nodes.line.positionRevision = revision;
    this.record(i, { kind: 'move', before, after: before + 1, revision });
    this.log(`${this.clients[i].name}: реплика перемещена в позицию ${before + 1}.`);
  }
  remove(i) {
    if (!this.clients[i].online || !this.nodes.line.alive) return;
    const incident = [...this.edges].filter(([, e]) => e.from === 'line' || e.to === 'line');
    for (const [id] of incident) this.edges.delete(id);
    this.nodes.line.alive = false;
    this.nodes.line.deletionRevision = ++this.revision;
    this.record(i, { kind: 'delete', incident, revision: this.revision });
    this.log(`${this.clients[i].name}: реплика удалена. Её текст удерживается для отмены; редакторы закрыты.`);
  }
  undo(i) {
    const c = this.clients[i];
    if (!c.online) return;
    const action = c.past.pop();
    if (!action) return;
    let undone = true;
    if (action.kind === 'text') c.undo.undo();
    if (action.kind === 'move') {
      if (this.nodes.line.positionRevision !== action.revision || !this.nodes.line.alive) undone = false;
      else { this.nodes.line.x = action.before; this.nodes.line.positionRevision = ++this.revision; action.undoRevision = this.revision; }
    }
    if (action.kind === 'edge') undone = this.edges.delete(action.id);
    if (action.kind === 'delete') {
      if (this.nodes.line.alive || this.nodes.line.deletionRevision !== action.revision) undone = false;
      else {
        this.nodes.line.alive = true;
        for (const [id, e] of action.incident) {
          const error = this.canConnect(e.from, e.to);
          if (!error) this.edges.set(id, e);
          else this.log(`Связь ${e.from} → ${e.to} не восстановлена: ${error}`);
        }
      }
    }
    if (undone) c.future.push(action);
    this.log(`${c.name}: ${undone ? 'своё действие отменено' : 'отмена пропущена, чтобы сохранить последующее изменение'}.`);
    if (this.automatic) this.deliver();
  }
  redo(i) {
    const c = this.clients[i];
    if (!c.online) return;
    const action = c.future.pop();
    if (!action) return;
    let applied = true;
    if (action.kind === 'text') c.undo.redo();
    if (action.kind === 'move') {
      if (this.nodes.line.positionRevision !== action.undoRevision || !this.nodes.line.alive) applied = false;
      else { this.nodes.line.x = action.after; this.nodes.line.positionRevision = ++this.revision; action.revision = this.revision; }
    }
    if (action.kind === 'edge') {
      if (this.canConnect(action.from, action.to)) applied = false;
      else this.edges.set(action.id, { from: action.from, to: action.to });
    }
    if (action.kind === 'delete') {
      // Delete redo must not erase activity performed after the restore.
      this.log('Повтор удаления оставлен для следующего прототипа; обычное удаление доступно.');
      applied = false;
    }
    if (applied) c.past.push(action);
    this.log(`${c.name}: ${applied ? 'действие повторено' : 'повтор пропущен'}.`);
    if (this.automatic) this.deliver();
  }
  snapshot() {
    return {
      alive: this.nodes.line.alive,
      position: this.nodes.line.x,
      serverText: this.server.getText('line').toString(),
      clients: this.clients.map(c => ({ name: c.name, online: c.online, text: c.doc.getText('line').toString(), undo: c.past.length, redo: c.future.length })),
      edges: [...this.edges.values()],
      pending: this.pending.length,
      commands: this.commands.length,
      events: [...this.events],
    };
  }
}

export const scenarios = [
  { title: 'Общий текст', description: 'Правки созданы до доставки чужих изменений. После обмена обе копии должны совпасть, сохранив оба добавления.', steps: [
    ['Задержать доставку', m => { m.automatic = false; }],
    ['Аня добавляет приветствие', m => m.append(0, ' Я Аня.')],
    ['Борис добавляет вопрос', m => m.append(1, ' Куда идёшь?')],
    ['Доставить в обратном порядке, с повторами', m => m.deliver(true, true)],
    ['Аня отменяет только своё добавление', m => { m.undo(0); m.deliver(); }],
    ['Аня повторяет добавление', m => { m.redo(0); m.deliver(); }],
  ] },
  { title: 'Удаление во время ввода', description: 'Борис вводит текст, но сообщение ещё в пути. Аня удаляет ноду. Отмена удаления должна вернуть и пришедший текст.', steps: [
    ['Задержать доставку', m => { m.automatic = false; }],
    ['Борис дописывает реплику', m => m.append(1, ' Не забудь ключ.')],
    ['Аня удаляет реплику', m => m.remove(0)],
    ['Доставить изменение скрытого текста', m => m.deliver()],
    ['Аня отменяет удаление', m => m.undo(0)],
  ] },
  { title: 'Конфликт связей', description: 'Каждый запрос допустим на исходной доске. Сервер принимает первый и отклоняет несовместимый второй; запрещённый граф не возникает.', steps: [
    ['Аня: реплика → конец', m => m.queueConnection(0, 'line', 'end')],
    ['Борис: реплика → вариант', m => m.queueConnection(1, 'line', 'a')],
    ['Обработать оба запроса', m => m.processConnections()],
    ['Аня отменяет свою связь', m => m.undo(0)],
    ['Добавить два варианта', m => { m.queueConnection(0, 'line', 'a'); m.queueConnection(1, 'line', 'b'); m.processConnections(); }],
  ] },
  { title: 'Чужое перемещение', description: 'Борис перемещает ту же ноду после Ани. Отмена Ани не должна возвращать ноду поверх нового положения Бориса.', steps: [
    ['Аня перемещает реплику', m => m.move(0)],
    ['Борис перемещает реплику дальше', m => m.move(1)],
    ['Аня отменяет своё перемещение', m => m.undo(0)],
  ] },
  { title: 'Потеря соединения', description: 'Уже введённый текст остаётся в очереди. Новый ввод отключён до восстановления соединения; затем копии сходятся.', steps: [
    ['Задержать доставку', m => { m.automatic = false; }],
    ['Аня вводит текст', m => m.append(0, ' Подожди.')],
    ['Аня теряет соединение', m => m.setOnline(0, false)],
    ['Борис дописывает свою часть', m => { m.append(1, ' Я здесь.'); m.deliver(); }],
    ['Аня подключается снова', m => m.setOnline(0, true)],
  ] },
];
