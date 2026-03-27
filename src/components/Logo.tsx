import React, { useState } from 'react';

interface LogoProps {
  className?: string;
  showText?: boolean;
  textColor?: string;
}

export function Logo({ className = "w-10 h-10" }: LogoProps) {
  const [imgSrc, setImgSrc] = useState("https://i.ibb.co.com/Qv9MHX1G/Logo-FIFA-fix.png");
  const [hasError, setHasError] = useState(false);

  const handleError = () => {
    if (imgSrc.includes(".co.com")) {
      console.log("Retrying logo with standard ibb.co domain...");
      setImgSrc("https://i.ibb.co/Qv9MHX1G/Logo-FIFA-fix.png");
    } else {
      console.error("Logo failed to load on both domains.");
      setHasError(true);
    }
  };

  return (
    <div className={`${className} flex items-center justify-center overflow-hidden`}>
      {!hasError ? (
        <img 
          key={imgSrc}
          src={imgSrc} 
          alt="FIFA Logo" 
          className="max-w-full max-h-full object-contain block transition-opacity duration-300"
          referrerPolicy="no-referrer"
          onLoad={() => console.log('Logo loaded successfully from:', imgSrc)}
          onError={handleError}
        />
      ) : (
        <div className="flex flex-col items-center justify-center text-white font-bold">
          <span className="text-2xl">FIFA</span>
          <span className="text-[10px] opacity-50">LOGO ERROR</span>
        </div>
      )}
    </div>
  );
}
