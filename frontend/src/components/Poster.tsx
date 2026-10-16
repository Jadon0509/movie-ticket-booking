import { useState } from 'react';

/** Poster image, or a coloured placeholder if there is no URL / it fails to load. */
export default function Poster({ url, title, className = '' }: { url: string; title: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) return <img className={`poster ${className}`} src={url} alt={`${title} poster`} onError={() => setFailed(true)} />;
  const hue = [...title].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div className={`poster placeholder ${className}`} style={{ background: `linear-gradient(135deg, hsl(${hue} 45% 35%), hsl(${(hue + 50) % 360} 50% 20%))` }} aria-label={`${title} (no poster)`}>
      <span>{title}</span>
    </div>
  );
}
