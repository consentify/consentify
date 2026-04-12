export type ProviderFlavor = 'nextjs-app' | 'nextjs-pages' | 'vite-react' | 'remix';

export function generateReactProvider(flavor: ProviderFlavor): string {
    const useClientDirective = flavor === 'nextjs-app' ? "'use client';\n\n" : '';
    const relativeImport =
        flavor === 'nextjs-app' || flavor === 'nextjs-pages' ? '@/lib/consent' : '../lib/consent';

    return `${useClientDirective}import { useConsentify } from '@consentify/react';
import { consent } from '${relativeImport}';

export function ConsentProvider({ children }: { children: React.ReactNode }) {
    const state = useConsentify(consent);

    return (
        <>
            {children}
            {state.decision === 'unset' && (
                <div
                    role="dialog"
                    aria-label="Cookie consent"
                    style={{
                        position: 'fixed',
                        bottom: 16,
                        left: 16,
                        right: 16,
                        maxWidth: 480,
                        margin: '0 auto',
                        padding: 16,
                        background: '#111',
                        color: '#fff',
                        borderRadius: 8,
                        zIndex: 9999,
                    }}
                >
                    <p style={{ margin: 0, marginBottom: 12 }}>
                        We use cookies to improve your experience. Choose your preferences below.
                    </p>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => consent.acceptAll()}>Accept all</button>
                        <button onClick={() => consent.rejectAll()}>Reject all</button>
                    </div>
                </div>
            )}
        </>
    );
}
`;
}
