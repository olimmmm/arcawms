import { useRef, useState, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';

export function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

export function useResponsiveColumns(defaultCols = 4) {
  const [cols, setCols] = useState(() => {
    if (typeof window === 'undefined') return defaultCols;
    const w = window.innerWidth;
    if (w < 640) return 2;
    if (w < 768) return 3;
    return 4;
  });

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      const next = w < 640 ? 2 : w < 768 ? 3 : 4;
      setCols(prev => (prev === next ? prev : next));
    };
    window.addEventListener('resize', handleResize, { passive: true });
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return cols;
}

interface UseWindowVirtualListOptions<T> {
  items: T[];
  estimateSize: number | ((index: number) => number);
  overscan?: number;
  isActive?: boolean;
}

/**
 * High-performance window-scroll virtualizer hook for lists and grids.
 * Accurately calculates scroll margins and avoids remeasuring when tabs are inactive.
 */
export function useWindowVirtualList<T>({
  items,
  estimateSize,
  overscan = 5,
  isActive = true,
}: UseWindowVirtualListOptions<T>) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  const measureOffset = useCallback(() => {
    if (listRef.current && isActive) {
      const rect = listRef.current.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      if (top >= 0) {
        setScrollMargin(top);
      }
    }
  }, [isActive]);

  useLayoutEffect(() => {
    if (isActive) {
      measureOffset();
    }
  }, [isActive, measureOffset, items.length]);

  useEffect(() => {
    if (!isActive) return;
    const handleResize = () => measureOffset();
    window.addEventListener('resize', handleResize, { passive: true });
    return () => window.removeEventListener('resize', handleResize);
  }, [isActive, measureOffset]);

  const sizeFn = useMemo(() => {
    return typeof estimateSize === 'function' ? estimateSize : () => estimateSize;
  }, [estimateSize]);

  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: sizeFn,
    overscan,
    scrollMargin,
  });

  return {
    listRef,
    virtualizer,
    virtualItems: virtualizer.getVirtualItems(),
    totalSize: virtualizer.getTotalSize(),
    scrollMargin: virtualizer.options.scrollMargin || scrollMargin,
  };
}
