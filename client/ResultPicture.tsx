import { useEffect, useMemo, useState } from 'react';
import { isUploadedCrossStyle } from '../shared/protocol.ts';
import type { CrossStyle, PuzzleResult } from '../shared/protocol.ts';
import { isVideoCrossSource, videoPoster } from './crossMedia.ts';
import { crossImageSource, crossStyles } from './crossStyles.ts';

export function ResultPicture({ result, crossStyle, crossImage }: { result: PuzzleResult; crossStyle: CrossStyle; crossImage?: string }) {
  const { cells, crossStyles: styles, crossImages, settings: { width, height } } = result;
  const [posters, setPosters] = useState<Record<string, string>>({});
  const sources = useMemo(() => cells.map((cell, index) => {
    if (cell !== 2) return;
    const style = styles?.[index] ?? crossStyle;
    const uploaded = isUploadedCrossStyle(style) ? crossImages?.[style] ?? (style === crossStyle ? crossImage : undefined) : undefined;
    return crossImageSource(style, uploaded);
  }), [cells, styles, crossImages, crossStyle, crossImage]);
  useEffect(() => {
    let active = true;
    const videos = new Set(sources.filter((source): source is string => !!source && isVideoCrossSource(source)));
    for (const source of videos) {
      void videoPoster(source).then(poster => {
        if (active && poster) setPosters(current => ({ ...current, [source]: poster }));
      }).catch(() => {});
    }
    return () => { active = false; };
  }, [sources]);

  return <div className="victory-picture" style={{ gridTemplateColumns: `repeat(${width}, 1fr)`, aspectRatio: width / height }} aria-label="Final puzzle board" role="img">
    {cells.map((cell, index) => {
      const source = sources[index];
      const image = source && isVideoCrossSource(source) ? posters[source] : source;
      const poop = cell === 2 && (styles?.[index] ?? crossStyle) === 'poop';
      if (!image && !poop) return <i className={cell === 1 ? 'filled' : cell === 2 ? 'crossed' : ''} key={index}/>;
      return <i className="custom-cross" key={index}>
        {image ? <img src={image} alt="" /> : <span style={{ fontSize: 65 / width + 'cqw' }}>{crossStyles.poop.symbol}</span>}
      </i>;
    })}
  </div>;
}
