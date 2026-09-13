import QRCode from 'qrcode';

export type QrResult = {
  qrDataUrl: string;
  resultUrl: string;
};

export type QrProvider = {
  generate: (payload: string) => Promise<QrResult>;
};

const LOCAL_PROVIDER: QrProvider = {
  generate: async (payload: string): Promise<QrResult> => {
    const qrDataUrl = await QRCode.toDataURL(payload, { width: 400, margin: 2 });
    return { qrDataUrl, resultUrl: payload };
  },
};

let activeProvider: QrProvider = LOCAL_PROVIDER;

export function setQrProvider(provider: QrProvider): void {
  activeProvider = provider;
}

export async function generateQrCode(payload: string): Promise<QrResult> {
  const result = await activeProvider.generate(payload);
  if (!result.qrDataUrl) {
    const qrDataUrl = await QRCode.toDataURL(payload, { width: 400, margin: 2 });
    return { qrDataUrl, resultUrl: payload };
  }
  return result;
}

export function buildResultPayload(resultId: string, eventId: string): string {
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  if (base && base !== 'null' && base !== 'file://') {
    return `${base}/#result/${resultId}`;
  }
  return `r3a-booth://result/${resultId}?event=${eventId}`;
}
