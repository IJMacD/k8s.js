import { useEffect, useState } from 'react';

interface DiagramProps {
  dot: string;
  onClose: () => void;
}

export function Diagram({ dot, onClose }: DiagramProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSvg(null);

    (async () => {
        const { Graphviz } = await import('@hpcc-js/wasm-graphviz');
        const g = await Graphviz.load();
        try {
            const svg = await g.layout(dot, 'svg', 'dot');
            if (!cancelled) {
                setSvg(svg);
                setLoading(false);
            }
        } catch (e) {
            if (!cancelled) {
                setError((e as Error).message || String(e));
                setLoading(false);
            }
        }
    })();
    
    return () => { cancelled = true; };
  }, [dot]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#23272e', borderRadius: 8, boxShadow: '0 2px 16px #0008', padding: 0, minWidth: 400, minHeight: 300, maxWidth: '90vw', maxHeight: '90vh', position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 8, right: 12, background: 'none', border: 'none', color: '#fff', fontSize: 24, cursor: 'pointer', zIndex: 1 }}>×</button>
        <div style={{overflow: 'auto', maxHeight: '80vh', maxWidth: '90vw', display: 'flex', justifyContent: 'center', padding: 16}}>
            <div style={{ padding: 24, minHeight: 200, minWidth: 300, textAlign: 'center' }}>
            {loading && <div style={{ color: '#aaa', fontFamily: 'monospace' }}>Rendering diagram…</div>}
            {error && <div style={{ color: '#f66', fontFamily: 'monospace' }}>Error: {error}</div>}
            {svg && <div dangerouslySetInnerHTML={{ __html: svg }} style={{ display: 'inline-block', maxWidth: '100%' }} />}
            </div>
        </div>
      </div>
    </div>
  );
}
