import { useRef, useState } from 'react';
import type { ActionDispatch } from 'react';
import type { Action, AppState } from '../store/store';
import { kubectlApply } from '../commands/kubectl-apply';
import { writeFile } from '../commands/helpers/filesystem';

interface EditorProps {
  state: AppState;
  dispatch: ActionDispatch<[action: Action]>;
  initialContent: string;
  namespace: string;
  onClose: () => void;
}

export function Editor({ state, dispatch, initialContent, namespace, onClose }: EditorProps) {
  const [content, setContent] = useState(initialContent);
  const [output, setOutput] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      // Insert two spaces at the cursor / replacing selection
      ta.setRangeText('  ', start, end, 'end');
      // Sync React state
      setContent(ta.value);
    }
  }

  async function handleApply() {
    if (applying) return;
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setApplying(true);
    setOutput([]);
    try {
      writeFile('_editor.yaml', content);
      const lines: string[] = [];
      for await (const line of kubectlApply(['-f', '_editor.yaml'], namespace, state, dispatch)) {
        lines.push(line);
        setOutput([...lines]);
        // Scroll output into view
        setTimeout(() => {
          if (outputRef.current) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight;
          }
        }, 0);
      }
    } catch (err) {
      setOutput([String(err instanceof Error ? err.message : err)]);
    } finally {
      setApplying(false);
      hideTimerRef.current = setTimeout(() => setOutput([]), 3000);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '400px', backgroundColor: '#1e1e1e', fontFamily: 'monospace' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px', backgroundColor: '#252526', borderBottom: '1px solid #333', flexShrink: 0 }}>
        <span style={{ color: '#888', fontSize: '11px', flex: 1 }}>namespace: {namespace}</span>
        <button
          onClick={handleApply}
          disabled={applying}
          style={{
            background: applying ? '#3a3a3a' : '#6d28d9',
            border: 'none',
            borderRadius: '4px',
            color: applying ? '#666' : '#e0e0e0',
            cursor: applying ? 'default' : 'pointer',
            fontFamily: 'monospace',
            fontSize: '11px',
            padding: '3px 12px',
          }}
        >
          {applying ? 'Applying…' : 'Apply'}
        </button>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '14px', padding: '0 4px' }}
          title="Close editor"
        >
          ✕
        </button>
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={e => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        style={{
          flex: output.length > 0 ? '1 1 0' : '1',
          minHeight: 0,
          resize: 'none',
          backgroundColor: '#1e1e1e',
          color: '#d4d4d4',
          border: 'none',
          borderBottom: output.length > 0 ? '1px solid #333' : 'none',
          fontFamily: 'monospace',
          fontSize: '13px',
          lineHeight: '1.5',
          outline: 'none',
          padding: '8px 12px',
          tabSize: 2,
        }}
      />

      {/* Output zone */}
      {output.length > 0 && (
        <div
          ref={outputRef}
          style={{
            flexShrink: 0,
            maxHeight: '80px',
            overflowY: 'auto',
            padding: '4px 12px',
            backgroundColor: '#141414',
          }}
        >
          {output.map((line, i) => (
            <div key={i} style={{ color: line.startsWith('error') || line.startsWith('kubectl') ? '#f87171' : '#86efac', fontSize: '12px', lineHeight: '1.6' }}>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
