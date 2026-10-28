// Única função serverless da Vercel. Todas as rotas /api/* chegam aqui
// (ver "rewrites" em vercel.json) e são roteadas em server/app.js.
import { handler } from '../server/context.js';

export default handler;

export const config = {
  maxDuration: 60,
};
