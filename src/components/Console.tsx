/**
 * Basic console component. Provides a prompt. Accepts user input and displays output. Can be used to interact with the k8s.js library in a REPL-like environment.
 * @returns JSX.Element
 */

import { useEffect, useRef, useState } from "react";
import { useSavedState } from "../hooks/useSavedState";

const PROMPT = '> ';
const PROMPT_CONT = '  '; // continuation prompt, same width as PROMPT

export function Console({ onCommand }: { onCommand: (command: string) => AsyncGenerator<string>; }) {
    const [input, setInput] = useState('');
    const [output, setOutput] = useState<string[]>([
        'Welcome to k8s.js! Try a few commands to get started:',
        '',
        '  kubectl create deployment web --image=nginx --replicas=3',
        '  kubectl expose deployment web --port=80',
        '  kubectl rollout status deployment/web',
        '  curl -i web',
        '',
    ]);
    const [inputQueue, setInputQueue] = useState<string[]>([]);
    const [inputHistory, setInputHistory] = useSavedState<string[]>('console.inputHistory', []);
    const [historyIndex, setHistoryIndex] = useState<number>(-1);

    const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(event.target.value);
        autoResize(event.target);
    };

    const submitInput = () => {
        const lines = input.split('\n');
        const commands = lines.filter(l => l.trim() !== '');
        // Echo the typed input (with continuation prompt on wrapped lines)
        const echo = lines.map((l, i) => `${i === 0 ? PROMPT : PROMPT_CONT}${l}`).join('\n');
        setOutput(prev => [...prev, echo]);
        if (commands.length > 0) {
            // Store each individual command in history, skipping consecutive duplicates
            const newHistory = [...inputHistory];
            for (const cmd of commands) {
                if (newHistory.length === 0 || newHistory[newHistory.length - 1] !== cmd) {
                    newHistory.push(cmd);
                }
            }
            setInputHistory(newHistory);
            setInputQueue(prev => [...prev, ...commands]);
        }
        setHistoryIndex(-1);
        setInput('');
    };

    const outputRef = useRef<HTMLDivElement>(null);

    const autoResize = (el: HTMLTextAreaElement) => {
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
    };

    // Scroll to the bottom of the output when new output is added
    useEffect(() => {
        if (outputRef.current) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
    }, [output]);

    // Guard against re-entrancy: onCommand is recreated every render (it closes over store),
    // so the effect would fire again mid-command whenever App re-renders (e.g. during rollout polling).
    const processingRef = useRef(false);

    // Process commands from the input queue one at a time.
    // Uses for-await-of so commands can yield multiple lines incrementally.
    useEffect(() => {
        if (inputQueue.length > 0 && !processingRef.current) {
            processingRef.current = true;
            const cmd = inputQueue[0];
            (async () => {
                try {
                    for await (const line of onCommand(cmd)) {
                        setOutput(prev => [...prev, line]);
                    }
                } catch (e) {
                    setOutput(prev => [...prev, (e as Error).message]);
                } finally {
                    processingRef.current = false;
                    setInputQueue(prev => prev.slice(1));
                }
            })();
        }
    }, [inputQueue, onCommand]);

     // Handle keyboard shortcuts
     const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submitInput();
        } else if (event.key === 'ArrowUp') {
            const atStart = inputRef.current?.selectionStart === 0;
            if ((historyIndex !== -1 || atStart) && historyIndex < inputHistory.length - 1) {
                event.preventDefault();
                const newIndex = historyIndex + 1;
                setHistoryIndex(newIndex);
                setInput(inputHistory[inputHistory.length - 1 - newIndex]);
                moveCursorToEndRef.current = true;
            }
        } else if (event.key === 'ArrowDown') {
            const atEnd = inputRef.current?.selectionStart === input.length;
            if ((historyIndex !== -1 || atEnd) && historyIndex > 0) {
                event.preventDefault();
                const newIndex = historyIndex - 1;
                setHistoryIndex(newIndex);
                setInput(inputHistory[inputHistory.length - 1 - newIndex]);
                moveCursorToEndRef.current = true;
            } else if ((historyIndex !== -1 || atEnd) && historyIndex === 0) {
                event.preventDefault();
                setHistoryIndex(-1);
                setInput('');
            }
        }
    };

    const inputRef = useRef<HTMLTextAreaElement>(null);
    const moveCursorToEndRef = useRef(false);

    useEffect(() => {
        if (inputRef.current) {
            autoResize(inputRef.current);
            if (moveCursorToEndRef.current) {
                const len = inputRef.current.value.length;
                inputRef.current.setSelectionRange(len, len);
                moveCursorToEndRef.current = false;
            }
        }
    }, [input]);

    // Focus the input field when the component mounts
    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.focus();
        }
    }, []);

    function handleConsoleClick() {
        // If the user clicks anywhere on the console, focus the input field, but not if the are selecting text in the output
        const selection = window.getSelection();
        if (selection && selection.toString().length > 0) {
            return;
        }
        if (inputRef.current) {
            inputRef.current.focus();
        }
    }

    return (
        <div style={{ backgroundColor: '#1e1e1e', color: '#d4d4d4', fontFamily: 'monospace', fontSize: '16px', textAlign: 'left', height: '400px', display: 'flex', flexDirection: 'column', borderTop: '1px solid #333' }} onClick={handleConsoleClick}>
            <div style={{ flex: 1, overflowY: 'auto', padding: '5px' }} ref={outputRef}>
                {output.map((line, index) => (
                    <div key={index} style={{ whiteSpace: 'pre-wrap' }}>{line || '\u00a0'}</div>
                ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', padding: '0 5px', flexShrink: 0, visibility: inputQueue.length > 0 ? 'hidden' : 'visible' }}>
                <span style={{ paddingTop: '4px', lineHeight: '1.5' }}>{PROMPT}</span>
                <textarea
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    style={{ padding: '4px', marginLeft: '4px', backgroundColor: '#1e1e1e', color: '#d4d4d4', border: 'none', outline: 'none', flex: 1, fontFamily: 'monospace', fontSize: '16px', resize: 'none', overflow: 'hidden', lineHeight: '1.5' }}
                    autoFocus
                    ref={inputRef}
                />
            </div>
        </div>
    );
}
