import { useEffect, useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { useThree } from '@react-three/fiber';

export function useCoverTexture(source?: string, label = '音楽', artist = '') {
  const invalidate = useThree(state => state.invalidate);
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    return map;
  }, []);
  useEffect(() => {
    const canvas = texture.image as HTMLCanvasElement;
    const context = canvas.getContext('2d')!;
    // Missing artwork gets a song-specific label, still legible inside a circle.
    const colors = ['#e8c5ca', '#e5d6aa', '#cbd4ba', '#d4c6df'];
    const colorIndex = Array.from(label).reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % colors.length;
    context.fillStyle = colors[colorIndex]; context.fillRect(0, 0, 256, 256);
    context.strokeStyle = '#685c52'; context.lineWidth = 2;
    context.beginPath(); context.arc(128, 128, 111, 0, Math.PI * 2); context.stroke();
    context.fillStyle = '#685c52'; context.textAlign = 'center';
    context.font = 'bold 12px Nunito, sans-serif'; context.fillText('USAGI MUSIC ROOM', 128, 58, 155);
    const words = label.split(/\s+/);
    const rows: string[] = [];
    let row = '';
    context.font = 'bold 20px Nunito, sans-serif';
    for (const word of words) {
      const next = row ? row + ' ' + word : word;
      if (row && context.measureText(next).width > 183) { rows.push(row); row = word; }
      else row = next;
    }
    if (row) rows.push(row);
    rows.slice(0, 2).forEach((line, index) => context.fillText(line, 128, 91 + index * 23, 183));
    context.font = '14px Nunito, sans-serif'; context.fillText(artist, 128, 174, 173);
    context.font = '11px Nunito, sans-serif'; context.fillText('SIDE A  ·  33⅓ RPM', 128, 202, 151);
    texture.needsUpdate = true;
    invalidate();
    if (!source) return;
    let active = true;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (!active) return;
      const edge = Math.min(image.naturalWidth, image.naturalHeight);
      context.drawImage(image, (image.naturalWidth - edge) / 2, (image.naturalHeight - edge) / 2, edge, edge, 0, 0, 256, 256);
      texture.needsUpdate = true;
      invalidate();
    };
    image.src = source;
    return () => { active = false; image.onload = null; image.src = ''; };
  }, [source, label, artist, texture, invalidate]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

export function useUsagiSprite() {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 384;
    const context = canvas.getContext('2d')!;
    context.lineWidth = 7; context.strokeStyle = '#685c52';
    const ellipse = (x: number, y: number, rx: number, ry: number, color: string, stroke = true) => {
      context.fillStyle = color; context.beginPath(); context.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); context.fill(); if (stroke) context.stroke();
    };
    ellipse(85, 82, 23, 72, '#fff1c7'); ellipse(165, 82, 23, 72, '#fff1c7');
    ellipse(85, 78, 10, 53, '#efb8c2', false); ellipse(165, 78, 10, 53, '#efb8c2', false);
    ellipse(128, 286, 66, 62, '#fff1c7'); ellipse(128, 204, 108, 83, '#fff1c7');
    ellipse(62, 231, 21, 14, '#efb8c2', false); ellipse(194, 231, 21, 14, '#efb8c2', false);
    ellipse(82, 201, 32, 26, '#fffaf0'); ellipse(175, 201, 32, 26, '#fffaf0');
    context.beginPath(); context.moveTo(114, 198); context.lineTo(143, 198); context.stroke();
    ellipse(85, 201, 9, 11, '#685c52', false); ellipse(172, 201, 9, 11, '#685c52', false);
    context.beginPath(); context.moveTo(114, 240); context.quadraticCurveTo(128, 255, 140, 240); context.stroke();
    ellipse(72, 304, 19, 25, '#fff1c7'); ellipse(185, 304, 19, 25, '#fff1c7');
    ellipse(90, 351, 29, 14, '#fff1c7'); ellipse(163, 351, 29, 14, '#fff1c7');
    const map = new CanvasTexture(canvas); map.colorSpace = SRGBColorSpace; return map;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}
