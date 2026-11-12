import { useEffect, useRef, useState } from 'react';
import { maxImageGrid, validImageCells } from '../shared/pictures.ts';
import { imageGridSize, imageMask, samplePicture } from './pictureImport.ts';
import type { ImageGrid } from './pictureImport.ts';

export function PictureInput({ saved, setImage }: { saved: boolean; setImage(width: number, height: number, cells: string): void }) {
  const bitmap = useRef<ImageBitmap | undefined>(undefined);
  const request = useRef(0);
  const [size, setSize] = useState(maxImageGrid);
  const [grid, setGrid] = useState<ImageGrid>();
  const [error, setError] = useState('');
  useEffect(() => () => { request.current++; bitmap.current?.close(); }, []);

  function update(next: ImageGrid) {
    setGrid(next);
    setImage(next.width, next.height, imageMask(next));
  }
  async function upload(file: File) {
    const id = ++request.current;
    setError('');
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Choose an image under 10 MB.');
      const image = await createImageBitmap(file);
      if (id !== request.current) { image.close(); return; }
      bitmap.current?.close();
      bitmap.current = image;
      const nextSize = imageGridSize(image);
      setSize(nextSize);
      update(samplePicture(image, nextSize));
    } catch {
      if (id === request.current) setError('Could not open that image. Choose a PNG, JPEG, or WebP under 10 MB.');
    }
  }

  const mask = grid && imageMask(grid);
  return <div className="picture-input">
    <label>{saved ? 'Replace image' : 'Upload puzzle image'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file) void upload(file);
    }}/></label>
    {error && <p className="error" role="alert">{error}</p>}
    {grid && mask && <>
      <div className="picture-preview" role="img" aria-label={`Converted ${grid.width} by ${grid.height} grid`}
        style={{ gridTemplateColumns: `repeat(${grid.width}, 1fr)`, aspectRatio: grid.width / grid.height }}>
        {[...mask].map((cell, index) => <i key={index} data-filled={cell === '1' || undefined}/>)}
      </div>
      <label>Grid size ({grid.width} × {grid.height})<input type="range" min={5} max={maxImageGrid} value={size} onChange={event => {
        const nextSize = Number(event.target.value);
        setSize(nextSize);
        if (bitmap.current) update(samplePicture(bitmap.current, nextSize));
      }}/></label>
      <label>{grid.alpha ? 'Opacity cutoff' : 'Color cutoff'}<input type="range" min={1} max={255} value={grid.cutoff}
        onChange={event => update({ ...grid, cutoff: Number(event.target.value) })}/></label>
      <label className="picture-invert"><input type="checkbox" checked={grid.inverted} onChange={event => update({ ...grid, inverted: event.target.checked })}/> Invert filled and empty cells</label>
      {!validImageCells(grid.width, grid.height, mask) && <p className="error" role="alert">Adjust the cutoff until the grid has both filled and empty cells.</p>}
    </>}
  </div>;
}
