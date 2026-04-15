import { useRef, useState } from "react";
import { clusterFetch, type SimError, type SimResponse } from "../commands/curl";
import type { AppState } from "../store/store";

type NavEntry = { url: string; result: SimResponse | SimError | null };

export function Browser({ state, onDismiss }: { state: AppState; onDismiss?: () => void }) {
    const [addressBar, setAddressBar] = useState("http://");
    const [history, setHistory] = useState<NavEntry[]>([]);
    const [cursor, setCursor] = useState(-1); // index into history; -1 = blank page

    const inputRef = useRef<HTMLInputElement>(null);

    const current: NavEntry | null = cursor >= 0 ? history[cursor] ?? null : null;

    function navigate(rawUrl: string) {
        const url = rawUrl.trim();
        if (!url || url === "http://") return;
        const result = clusterFetch(url, state);
        const entry: NavEntry = { url, result };
        // Drop forward history
        const newHistory = [...history.slice(0, cursor + 1), entry];
        setHistory(newHistory);
        setCursor(newHistory.length - 1);
        setAddressBar(url);
    }

    function goBack() {
        if (cursor > 0) {
            const newCursor = cursor - 1;
            setCursor(newCursor);
            setAddressBar(history[newCursor].url);
        }
    }

    function goForward() {
        if (cursor < history.length - 1) {
            const newCursor = cursor + 1;
            setCursor(newCursor);
            setAddressBar(history[newCursor].url);
        }
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === "Enter") navigate(addressBar);
    }

    const canBack = cursor > 0;
    const canForward = cursor < history.length - 1;

    return (
        <div style={{
            display: "flex",
            flexDirection: "column",
            borderTop: "1px solid var(--border)",
            background: "var(--bg)",
            height: "400px",
        }}>
            {/* Chrome bar */}
            <div style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                padding: "4px 8px",
                borderBottom: "1px solid var(--border)",
                background: "var(--code-bg)",
                flexShrink: 0,
            }}>
                <button onClick={goBack} disabled={!canBack} title="Back" style={navBtnStyle(!canBack)}>◀</button>
                <button onClick={goForward} disabled={!canForward} title="Forward" style={navBtnStyle(!canForward)}>▶</button>
                <input
                    ref={inputRef}
                    value={addressBar}
                    onChange={e => setAddressBar(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={e => e.target.select()}
                    spellCheck={false}
                    style={{
                        flex: 1,
                        fontFamily: "var(--mono)",
                        fontSize: "12px",
                        padding: "3px 8px",
                        borderRadius: "12px",
                        border: "1px solid var(--border)",
                        background: "var(--bg)",
                        color: "var(--text-h)",
                        outline: "none",
                    }}
                />
                <button onClick={() => navigate(addressBar)} title="Go" style={navBtnStyle(false)}>Go</button>
                <button
                    onClick={onDismiss}
                    title="Close browser"
                    style={{ ...navBtnStyle(false), marginLeft: "4px", color: "var(--text)" }}
                >✕</button>
            </div>

            {/* Viewport */}
            <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
                {!current && (
                    <div style={{ padding: "32px", textAlign: "center", color: "var(--text)", opacity: 0.45 }}>
                        <div style={{ fontSize: "32px", marginBottom: "8px" }}>🌐</div>
                        <div style={{ fontFamily: "var(--mono)", fontSize: "13px" }}>
                            Type a service name or URL and press Enter
                        </div>
                    </div>
                )}
                {current?.result && !current.result.ok && (
                    <div style={{ padding: "32px 40px" }}>
                        <h2 style={{ color: "#c0392b", fontFamily: "var(--mono)", fontSize: "15px", marginBottom: "8px" }}>
                            This page can't be reached
                        </h2>
                        <p style={{ fontFamily: "var(--mono)", fontSize: "12px", color: "var(--text)" }}>
                            {(current.result as SimError).error}
                        </p>
                        <p style={{ fontFamily: "var(--mono)", fontSize: "11px", color: "var(--text)", opacity: 0.6, marginTop: "16px" }}>
                            ERR_CONNECTION_REFUSED
                        </p>
                    </div>
                )}
                {current?.result?.ok && (
                    <>
                        {/* Status bar */}
                        <div style={{
                            fontFamily: "var(--mono)",
                            fontSize: "10px",
                            color: "var(--text)",
                            opacity: 0.55,
                            padding: "2px 10px",
                            borderBottom: "1px solid var(--border)",
                            background: "var(--code-bg)",
                        }}>
                            {(current.result as SimResponse).status} {(current.result as SimResponse).statusText}
                            {" · "}
                            {(current.result as SimResponse).dialIP}
                            {(current.result as SimResponse).viaService ? ` via service/${(current.result as SimResponse).viaService}` : ""}
                            {" · "}
                            Server: {(current.result as SimResponse).headers["Server"]}
                        </div>
                        {/* Rendered body */}
                        <div
                            style={{ padding: "16px 24px" }}
                            // All user-controlled values (path, hostname) are HTML-escaped in simFetch
                            // before being placed in the body string.
                            dangerouslySetInnerHTML={{ __html: (current.result as SimResponse).body }}
                        />
                    </>
                )}
            </div>
        </div>
    );
}

function navBtnStyle(disabled: boolean): React.CSSProperties {
    return {
        background: "none",
        border: "none",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.3 : 0.75,
        fontFamily: "var(--mono)",
        fontSize: "12px",
        color: "var(--text-h)",
        padding: "2px 6px",
        borderRadius: "4px",
    };
}
