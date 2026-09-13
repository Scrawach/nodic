import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import type { DialogueSession } from './session';

const editability = (enabled: boolean) => [
  EditorView.editable.of(enabled),
  EditorState.readOnly.of(!enabled),
  EditorView.contentAttributes.of({ 'aria-readonly': String(!enabled) }),
];

export function TextEditor({
  session,
  nodeId,
  close,
}: {
  session: DialogueSession;
  nodeId: string;
  close: () => void;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [handle] = useState(() => session.openText(nodeId));
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const [editable] = useState(() => new Compartment());
  const enabled = session.canEdit(handle);
  useEffect(() => {
    if (!handle.loaded || !host.current || view.current) return;
    const name =
      sessionStorage.getItem('nodic-name') || `Автор ${String(handle.doc.clientID).slice(-3)}`;
    handle.awareness.setLocalState({ user: { name, color: '#b97946', colorLight: '#b9794633' } });
    handle.undo.stopCapturing();
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: handle.doc.getText('text').toString(),
        extensions: [
          editable.of(editability(enabled)),
          EditorView.contentAttributes.of({
            'aria-label': 'Текст реплики',
            role: 'textbox',
            'aria-multiline': 'true',
          }),
          yCollab(handle.doc.getText('text'), handle.awareness, { undoManager: handle.undo }),
          keymap.of([...yUndoManagerKeymap, ...defaultKeymap]),
          EditorView.lineWrapping,
          EditorView.theme({
            '&': { minHeight: '240px', fontSize: '18px' },
            '.cm-content': { padding: '16px', lineHeight: '1.7', fontFamily: 'inherit' },
            '&.cm-focused': { outline: 'none' },
          }),
        ],
      }),
    });
    view.current = editor;
    editor.focus();
  }, [handle, handle.loaded, editable, enabled]);
  useEffect(() => {
    view.current?.dispatch({ effects: editable.reconfigure(editability(enabled)) });
  }, [editable, enabled]);
  useEffect(
    () => () => {
      view.current?.destroy();
      handle.undo.stopCapturing();
      handle.awareness.setLocalState(null);
    },
    [handle],
  );
  return (
    <div
      className="modal-backdrop"
      onKeyDown={(event) => {
        if (event.key === 'Escape') close();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
        className="modal editor-modal"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">РЕПЛИКА</span>
            <h2 id="editor-title">Слова, которые меняют историю</h2>
          </div>
          <button className="icon-button" onClick={close} aria-label="Закрыть">
            ×
          </button>
        </div>
        <div className="editor-meta">
          <span>Без персонажа</span>
          <span data-testid="editor-presence">
            В редакторе: {handle.awareness.getStates().size}
          </span>
        </div>
        {!handle.loaded && <p className="muted">Подключаем редактор…</p>}
        <div ref={host} className="text-editor" />
        <footer className="editor-footer">
          <div className="button-row">
            <button disabled={!enabled} onClick={() => handle.undo.undo()}>
              Отменить ввод
            </button>
            <button disabled={!enabled} onClick={() => handle.undo.redo()}>
              Повторить ввод
            </button>
          </div>
          <span>
            {state.connected
              ? 'Изменения сохраняются автоматически'
              : 'Нет соединения. Ввод приостановлен.'}
          </span>
        </footer>
      </section>
    </div>
  );
}
