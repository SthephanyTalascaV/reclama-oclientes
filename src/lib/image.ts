// Prepara os prints no navegador: reduz o tamanho mantendo o texto legível.
// O mesmo conteúdo vai para a análise e depois para o salvamento (o servidor
// confere que as imagens salvas são exatamente as analisadas).

export interface PreparedImage {
  id: string;
  name: string;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  data: string; // base64 sem prefixo
  previewUrl: string;
  bytes: number;
  width: number;
  height: number;
}

const MAX_W = 1600;
const MAX_H = 4000;
export const MAX_TOTAL_BYTES = 2_900_000; // folga abaixo do limite da API
export const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Não foi possível abrir "${file.name}".`));
    };
    img.src = url;
  });
}

export async function prepareImage(file: File, quality = 0.85): Promise<PreparedImage> {
  if (!ACCEPTED.includes(file.type)) throw new Error(`"${file.name}" não é PNG, JPG ou WEBP.`);
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_W / img.naturalWidth, MAX_H / img.naturalHeight);
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(img.src);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const data = dataUrl.split(',')[1];
  return {
    id: crypto.randomUUID(),
    name: file.name,
    mime: 'image/jpeg',
    data,
    previewUrl: dataUrl,
    bytes: Math.round((data.length * 3) / 4),
    width: w,
    height: h,
  };
}

export const totalBytes = (imgs: PreparedImage[]) => imgs.reduce((s, i) => s + i.bytes, 0);

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
