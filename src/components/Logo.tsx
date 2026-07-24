import React from 'react';

interface LogoProps {
  className?: string;
  showText?: boolean;
  textColor?: string;
}

export function Logo({ className = "w-10 h-10" }: LogoProps) {
  return (
    <div className={`${className} flex items-center justify-center overflow-hidden`}>
      <img
        src="/fifa-logo.png"
        alt="FIFA Logo"
        className="block max-h-full max-w-full object-contain"
      />
    </div>
  );
}
