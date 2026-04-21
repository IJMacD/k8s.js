import type { ActionDispatch } from "react";
import type { EditorMode } from '../components/Editor';
import type { Action, AppState } from '../store/store';
import { writeFile } from './helpers/filesystem';

// Generate Graphviz DOT source from cluster state
export function generateDot(state: AppState): string {
  // Header
  let dot = `digraph cluster_state {\n`;
  dot += '  rankdir=LR;\n  compound=true;\n  fontname="monospace";\n';

  // Workload subgraph
  dot += '  subgraph cluster_workloads {\n    label="Workloads";\n    style=filled;\n    color="#e3f2fd";\n';

  state.Deployments.forEach(deploy => {
    const deployNode = `deployment/${deploy.metadata.name}`;
    dot += `    "${deployNode}" [shape=box, style=filled, fillcolor="#bbdefb"];\n`;
  });
  state.ReplicaSets.forEach(rs => {
    const rsNode = `replicaset/${rs.metadata.name}`;
    dot += `    "${rsNode}" [shape=box, style=filled, fillcolor="#90caf9"];\n`;
    if (rs.metadata.ownerReferences) {
      rs.metadata.ownerReferences.forEach(owner => {
        if (owner.kind === "Deployment") {
          const ownerNode = `${owner.kind.toLowerCase()}/${owner.name}`;
          dot += `    "${ownerNode}" -> "${rsNode}" [style=bold];\n`;
        }
      });
    }
  });
  state.DaemonSets.forEach(ds => {
    const dsNode = `daemonset/${ds.metadata.name}`;
    dot += `    "${dsNode}" [shape=box, style=filled, fillcolor="#90caf9"];\n`;
  });
  state.StatefulSets.forEach(ss => {
    const ssNode = `statefulset/${ss.metadata.name}`;
    dot += `    "${ssNode}" [shape=box, style=filled, fillcolor="#90caf9"];\n`;
  });
  state.CronJobs.forEach(cj => {
    const cjNode = `cronjob/${cj.metadata.name}`;
    dot += `    "${cjNode}" [shape=box, style=filled, fillcolor="#90caf9"];\n`;
  });
  state.Jobs.forEach(job => {
    const jobNode = `job/${job.metadata.name}`;
    dot += `    "${jobNode}" [shape=box, style=filled, fillcolor="#90caf9"];\n`;
    if (job.metadata.ownerReferences) {
      job.metadata.ownerReferences.forEach(owner => {
        if (owner.kind === "CronJob") {
          const ownerNode = `${owner.kind.toLowerCase()}/${owner.name}`;
          dot += `    "${ownerNode}" -> "${jobNode}" [style=bold];\n`;
        }
      });
    }
  });
  dot += '   { rank=sink; node [shape=ellipse, style=filled, fillcolor="#c8e6c9"]; \n';
  state.Pods.forEach(pod => {
    const podNode = `pod/${pod.metadata.name}`;
    dot += `      "${podNode}" [fillcolor="${pod.status.phase === "Running" ? "#c8e6c9" : "#eee"}", label="${pod.metadata.name}"]; \n`;
  });
  dot += '   }\n';

  state.Pods.forEach(pod => {
    const podNode = `pod/${pod.metadata.name}`;
    if (pod.metadata.ownerReferences) {
      pod.metadata.ownerReferences.forEach(owner => {
        const ownerNode = `${owner.kind.toLowerCase()}/${owner.name}`;
        dot += `    "${ownerNode}" -> "${podNode}";\n`;
      });
    }
  });

  dot += '  }\n';


  // Nodes subgraph
  dot += '  subgraph cluster_nodes {\n    label="Nodes";\n    style=filled;\n    color="#e8f5e9";\n';
  state.Nodes.forEach(node => {
    const nodeNode = `node/${node.metadata.name}`;
    dot += `    "${nodeNode}" [shape=hexagon, style=filled, fillcolor="#a5d6a7"];\n`;
  });
  dot += '  }\n';

  // Network subgraph
  dot += '  subgraph cluster_network {\n    label="Network";\n    style=filled;\n    color="#fce4ec";\n';
  
  dot += ` { rank=same; node [shape=diamond, style=filled, fillcolor="#f8bbd0"]; `;
  state.Services.forEach(svc => {
    const svcNode = `service/${svc.metadata.name}`;
    dot += `    "${svcNode}"`;
  });
  dot += ' }\n';

  state.Services.forEach(svc => {
    const svcNode = `service/${svc.metadata.name}`;
  
    if (svc.spec.type === "LoadBalancer") {
        const lbNode = `loadbalancer/${svc.metadata.name}`;
        dot += `    "${lbNode}" [label="${svc.status.loadBalancer?.ingress?.[0]?.ip}"];\n`;
        dot += `    "${svcNode}" -> "${lbNode}" [style=dotted, dir=back, constraint=false];\n`;
    }
  });

  state.Endpoints.forEach(ep => {
    const svcNode = `service/${ep.metadata.name}`;

    ep.subsets.forEach(subset => {
      subset.addresses.forEach(addr => {
        const targetRef = addr.targetRef;
        if (targetRef) {
          const targetNode = `${targetRef.kind.toLowerCase()}/${targetRef.name}`;
          dot += `     "${targetNode}" -> "${svcNode}" [style=dashed, dir=back];\n`;
        }
      });
    });
  });

    state.Nodes.forEach(node => {
        const nodeNode = `node/${node.metadata.name}`;
        state.Services.filter(svc => svc.spec.type === "NodePort" || svc.spec.type === "LoadBalancer").forEach(svc => {
            const svcNode = `service/${svc.metadata.name}`;
            dot += `    "${svcNode}" -> "${nodeNode}" [style=dashed, dir=back, label="${svc.spec.ports?.map(p => p.nodePort).join(", ")}"];\n`;
        });
    });
  dot += '  }\n';


  dot += '}\n';
  return dot;
}

// Async generator command
export async function* exec(
  _command: string,
  args: string[],
  _dispatch: ActionDispatch<[action: Action]>,
  getState: () => AppState,
  _openEditor: (yaml: string, namespace: string, mode?: EditorMode, filename?: string) => void,
  openDiagram: (dot: string) => void,
  _stdin: string | null
): AsyncGenerator<string> {
  // Parse output filename
  let filename = 'cluster.dot';
  const oidx = args.indexOf('-o');
  if (oidx >= 0 && args[oidx + 1]) {
    filename = args[oidx + 1];
  }
  const state = getState();
  const dot = generateDot(state);
  await writeFile(filename, dot);
  openDiagram(dot);
  yield `Diagram written to ${filename}`;
}
