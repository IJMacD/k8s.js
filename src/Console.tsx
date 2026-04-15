/**
 * Basic console component. Provides a prompt. Accepts user input and displays output. Can be used to interact with the k8s.js library in a REPL-like environment.
 * @returns JSX.Element
 */

import { useEffect, useRef, useState } from "react";
import { useSavedState } from "./useSavedState";

const PROMPT = '> ';

export function Console({ onCommand, onDismiss }: { onCommand: (command: string) => Promise<string>; onDismiss?: () => void }) {
    const [input, setInput] = useState('');
    const [output, setOutput] = useState<string[]>([]);
    const [inputQueue, setInputQueue] = useState<string[]>([]);
    const [inputHistory, setInputHistory] = useSavedState<string[]>('console.inputHistory', []);
    const [historyIndex, setHistoryIndex] = useState<number>(-1);

    const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setInput(event.target.value);
    };

    const handleInputSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        // Echo the input back to the output
        setOutput([...output, `${PROMPT}${input}`]);
        // Push the command to the input queue for processing
        setInputQueue([...inputQueue, input]);
        // Add the command to the history
        if (input.trim() !== '' && (inputHistory.length === 0 || inputHistory[inputHistory.length - 1] !== input)) {
            setInputHistory([...inputHistory, input]);
        }
        setHistoryIndex(-1); // Reset history index
        setInput('');
    };

    const outputRef = useRef<HTMLDivElement>(null);

    // Scroll to the bottom of the output when new output is added
    useEffect(() => {
        if (outputRef.current) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
    }, [output]);

    // Process commands from the input queue
    // Wait for the onCommand promise to resolve before processing the next command in the queue
    useEffect(() => {
        if (inputQueue.length > 0) {
            const command = inputQueue[0];
            onCommand(command).then((result) => {
                setOutput((prevOutput) => [...prevOutput, result]);
                setInputQueue((prevQueue) => prevQueue.slice(1)); // Remove the processed command from the queue
            }).catch((e) => {
                setOutput(prevOutput => [...prevOutput, e.message])
                setInputQueue(prevQueue => prevQueue.slice(1))
            });
        }
    }, [inputQueue, onCommand]);

     // Handle up/down arrow keys for input history navigation
     const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            // Navigate up in history
            if (historyIndex < inputHistory.length - 1) {
                const newIndex = historyIndex + 1;
                setHistoryIndex(newIndex);
                setInput(inputHistory[inputHistory.length - 1 - newIndex]);
                moveCursorToEndRef.current = true;
            }
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            // Navigate down in history
            if (historyIndex > 0) {
                const newIndex = historyIndex - 1;
                setHistoryIndex(newIndex);
                setInput(inputHistory[inputHistory.length - 1 - newIndex]);
                moveCursorToEndRef.current = true;
            } else {
                setHistoryIndex(-1);
                setInput('');
            }
        }
    };

    const inputRef = useRef<HTMLInputElement>(null);
    const moveCursorToEndRef = useRef(false);

    useEffect(() => {
        if (moveCursorToEndRef.current && inputRef.current) {
            const len = inputRef.current.value.length;
            inputRef.current.setSelectionRange(len, len);
            moveCursorToEndRef.current = false;
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 8px', borderBottom: '1px solid #333', flexShrink: 0 }}>
                <span style={{ fontSize: '12px', color: '#888', userSelect: 'none' }}>TERMINAL</span>
                {onDismiss && (
                    <button
                        onClick={e => { e.stopPropagation(); onDismiss(); }}
                        style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '0 2px' }}
                        title="Minimise terminal"
                        aria-label="Minimise terminal"
                    >
                        ⌃
                    </button>
                )}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '5px' }} ref={outputRef}>
                {output.map((line, index) => (
                    <div key={index} style={{ whiteSpace: 'pre-wrap' }}>{line}</div>
                ))}
            </div>
            <form onSubmit={handleInputSubmit} style={{ display: 'flex', alignItems: 'center', padding: '0 5px', flexShrink: 0 }}>
                <span>{PROMPT}</span>
                <input
                    type="text"
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    style={{ padding: '4px', marginLeft: '4px', backgroundColor: '#1e1e1e', color: '#d4d4d4', border: 'none', outline: 'none', flex: 1, fontFamily: 'monospace', fontSize: '16px' }}
                    autoFocus
                    ref={inputRef}
                />
            </form>
        </div>
    );
}
