import './App.css'
import { Console } from './Console'

function App() {

  function handleCommand(inputLine: string): Promise<string> {
    // For now, just echo the command back with a simple response
    return new Promise((resolve) => {
      const [command, ...args] = inputLine.trim().toLowerCase().split(' ');

      if (command === '') {
        resolve('');
        return;
      } else if (command === 'help') {
        resolve('Available commands: help, echo [message], date');
        return;
      } else if (command === 'echo') {
        const message = args.join(' ');
        resolve(message);
        return;
      } else if (command === 'date') {
        if (args[0] === '--iso') {
          resolve(new Date().toISOString());
          return;
        }
        resolve(new Date().toString());
        return;
      } else {
        resolve(`Unknown command: ${command}`);
        return;
      }
    });
  }

  return (
    <>
      <div style={{ flex: 1}}>
        <h1>k8s.js</h1>
      </div>
      <Console onCommand={handleCommand} />
    </>
  )
}

export default App
