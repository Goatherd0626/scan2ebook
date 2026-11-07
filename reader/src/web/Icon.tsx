import type { SVGProps } from 'react';

const paths = {
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  back: 'M19 12H5m6-6-6 6 6 6',
  diagonal: 'M6 18 18 6M6 6h12v12',
  plus: 'M12 5v14M5 12h14',
  search: 'm20 20-4-4M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  folder: 'M3 7V5h6l2 2h10v13H3V7Z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  file: 'M6 3h8l5 5v13H5V4l1-1Zm8 0v6h5M8 13h8M8 17h6',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  lock: 'M6 10h12v11H6zM8 10V7a4 4 0 0 1 8 0v3',
  book: 'M3 4c4-1 6 0 9 2 3-2 5-3 9-2v16c-4-1-6 0-9 2-3-2-5-3-9-2V4Zm9 2v16',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 10v7M14 10v7',
} as const;

export function Icon({ name, size = 20, ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof paths; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]} /></svg>;
}
