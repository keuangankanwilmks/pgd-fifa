import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export type PageSizeValue = number | 'all';

interface PageSizeOption {
  value: PageSizeValue;
  label: string;
}

interface PageSizeDropdownProps {
  options: PageSizeOption[];
  value: PageSizeValue;
  onChange: (value: PageSizeValue) => void;
  className?: string;
}

export function PageSizeDropdown({ options, value, onChange, className = '' }: PageSizeDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find(option => option.value === value) ?? options[0];

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        className="relative flex h-7 w-full items-center rounded-lg border border-gray-200 bg-gray-50 px-2 text-xs font-bold text-gray-700 outline-none transition-all hover:bg-white focus:border-[#009B4F] focus:ring-2 focus:ring-[#009B4F]/20"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="block w-full text-center">{selectedOption?.label}</span>
        <ChevronDown className={`absolute right-1.5 h-3.5 w-3.5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          className="absolute bottom-full left-0 z-[90] mb-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-xl"
          role="listbox"
        >
          {options.map(option => (
            <button
              key={String(option.value)}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`block w-full px-2 py-1.5 text-center text-xs font-bold transition-colors ${
                option.value === value
                  ? 'bg-[#009B4F] text-white'
                  : 'text-gray-700 hover:bg-emerald-50 hover:text-[#009B4F]'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
