import { useReducer, useState } from 'react';
import './App.css'
import { Console } from './Console'
import { reducer, type Action, type AppState } from './store';
import { command } from './command';
import { ResourceTabs } from './ResourceTabs';
import { useDeploymentController } from './useDeploymentController';
import { useReplicaSetController } from './useReplicaSetController';
import { useKubelet } from './useKubelet';
import { useStatusController } from './useStatusController';

const initialState: AppState = {
  Deployments: [],
  ReplicaSets: [],
  Pods: [],
}

function App() {
  const [store, dispatch] = useReducer<AppState, [action: Action]>(reducer, initialState)
  const [consoleOpen, setConsoleOpen] = useState(true);

  useDeploymentController(store, dispatch);
  useReplicaSetController(store, dispatch);
  useKubelet(store, dispatch);
  useStatusController(store, dispatch);

  function handleCommand(inputLine: string): Promise<string> {
    return command(inputLine, dispatch, store);
  }

  return (
    <>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <h1>k8s.js</h1>
        <ResourceTabs
          Deployments={store.Deployments}
          ReplicaSets={store.ReplicaSets}
          Pods={store.Pods}
        />
      </div>
      <div style={{ display: consoleOpen ? undefined : 'none' }}>
        <Console onCommand={handleCommand} onDismiss={() => setConsoleOpen(false)} />
      </div>
      {!consoleOpen && (
        <div style={{ backgroundColor: '#1e1e1e', borderTop: '1px solid #333', display: 'flex', alignItems: 'center', padding: '0 8px', height: '28px', flexShrink: 0 }}>
          <button
            onClick={() => setConsoleOpen(true)}
            style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
            title="Restore terminal"
            aria-label="Restore terminal"
          >
            <span style={{ transform: 'rotate(180deg)', display: 'inline-block', lineHeight: 1 }}>⌃</span>
            TERMINAL
          </button>
        </div>
      )}
    </>
  )
}

export default App
