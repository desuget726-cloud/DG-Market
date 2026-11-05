import { useState } from 'react';
import { PAYMENT_PROVIDER_LOGOS } from './paymentProviderData';

function PaymentProviderLogo({ provider, className = '' }) {
  const [imageFailed, setImageFailed] = useState(false);
  const logo = PAYMENT_PROVIDER_LOGOS[provider];

  return (
    <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden ${className}`}>
      {imageFailed ? (
        <span aria-hidden="true" className="text-[0.55rem] font-black tracking-tight text-slate-600">
          {logo.initials}
        </span>
      ) : (
        <img
          src={logo.src}
          alt={logo.alt}
          className="h-full w-full object-contain p-1"
          onError={() => setImageFailed(true)}
        />
      )}
    </span>
  );
}

export default PaymentProviderLogo;
