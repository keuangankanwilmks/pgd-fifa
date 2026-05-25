import React, { useEffect, useState } from 'react';

interface AnimatedModalProps {
  isOpen: boolean;
  children: React.ReactElement;
  className?: string;
  durationMs?: number;
}

export function AnimatedModal({
  isOpen,
  children,
  className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm',
  durationMs = 170,
}: AnimatedModalProps) {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(false);
  const [renderedChildren, setRenderedChildren] = useState<React.ReactElement | null>(isOpen ? children : null);

  useEffect(() => {
    if (isOpen) {
      setRenderedChildren(children);
    }
  }, [children, isOpen]);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      const frame = window.requestAnimationFrame(() => setIsVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }

    setIsVisible(false);
    const timeout = window.setTimeout(() => setShouldRender(false), durationMs);
    return () => window.clearTimeout(timeout);
  }, [durationMs, isOpen]);

  if (!shouldRender || !renderedChildren) return null;

  const child = renderedChildren as React.ReactElement<{ className?: string }>;
  const panel = React.cloneElement(child, {
    className: `${child.props.className || ''} fifa-modal-panel ${isVisible ? 'fifa-modal-open' : 'fifa-modal-closed'}`,
  });

  return (
    <div className={`${className} fifa-modal-backdrop ${isVisible ? 'fifa-modal-open' : 'fifa-modal-closed'}`}>
      {panel}
    </div>
  );
}
