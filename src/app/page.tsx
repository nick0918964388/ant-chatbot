'use client';

import dynamic from 'next/dynamic';

const Indepentent = dynamic(() => import('./indepentent'), { ssr: false });

export default function ChatBot() {

  return (
    <div className="h-screen flex flex-col">
      <div className="flex-1 p-4">
        <Indepentent />
    </div>
    </div>
  );
}
