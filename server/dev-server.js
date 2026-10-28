// Servidor local da API (porta 3001). O Vite (porta 5173) encaminha /api para cá.
// Uso: npm run dev  (com .env.local)  ou  npm run dev:demo  (dados fictícios)
import http from 'node:http';
import { handler } from './context.js';

const port = Number(process.env.API_PORT || 3001);
http.createServer((req, res) => handler(req, res)).listen(port, () => {
  const demo = process.env.DEMO_MODE === 'true';
  console.log(`API local em http://localhost:${port}${demo ? '  [MODO DEMONSTRAÇÃO — dados fictícios]' : ''}`);
});
