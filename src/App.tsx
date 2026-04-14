import { useReducer } from 'react';
import './App.css'
import { Console } from './Console'
import { reducer, type Action, type AppState } from './store';
import { command } from './command';

const initialState: AppState = {
  Deployments: [],
  ReplicaSets: [],
  Pods: [],
}

function App() {
  const [store, dispatch] = useReducer<AppState, [action: Action]>(reducer, initialState)

  function handleCommand(inputLine: string): Promise<string> {
    return command(inputLine, dispatch);
  }

  return (
    <>
      <div style={{ flex: 1}}>
        <h1>k8s.js</h1>
        <h2>Deployments</h2>
        <ul>
          {store.Deployments.map(d => <li key={`${d.metadata.namespace}/${d.metadata.name}`}>{d.metadata.namespace}/{d.metadata.name}</li>)}
        </ul>
        <h2>ReplicaSets</h2>
        <ul>
          {store.ReplicaSets.map(r => <li key={`${r.metadata.namespace}/${r.metadata.name}`}>{r.metadata.namespace}/{r.metadata.name}</li>)}
        </ul>
        <h2>Pods</h2>
        <ul>
          {store.Pods.map(p => <li key={`${p.metadata.namespace}/${p.metadata.name}`}>{p.metadata.namespace}/{p.metadata.name}</li>)}
        </ul>
      </div>
      <Console onCommand={handleCommand} />
    </>
  )
}

export default App
