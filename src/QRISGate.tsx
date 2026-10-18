import { useEffect } from 'react';
import { QrCode, Check, X } from 'lucide-react';

interface QRISGateProps {
  qrisImageUrl: string;
  price: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function QRISGate({ qrisImageUrl, price, onConfirm, onCancel }: QRISGateProps) {
  // Prevent body scroll saat overlay muncul
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Format harga: 25000 → "25.000"
  const formattedPrice = new Intl.NumberFormat('id-ID').format(price);

  return (
    <div className="qris-gate-overlay">
      <div className="qris-gate-box">
        
        {/* KOLOM KIRI: QR CODE */}
        <div className="qris-gate-left">
          <div className="qris-gate-qr">
            {qrisImageUrl ? (
              <img src={qrisImageUrl} alt="QRIS DANA" />
            ) : (
              <div className="qris-gate-qr-placeholder">
                <QrCode size={64} strokeWidth={1} />
                <span>QRIS belum di-set</span>
              </div>
            )}
          </div>
        </div>

        {/* KOLOM KANAN: INFO & ACTION */}
        <div className="qris-gate-right">
          <div className="qris-gate-header">
            <div className="qris-gate-icon">
              <QrCode size={24} strokeWidth={2} />
            </div>
            <div>
              <h2>SCAN & PAY</h2>
              <p>Gunakan DANA, OVO, GoPay, ShopeePay, atau m-banking.</p>
            </div>
          </div>

          <div className="qris-gate-price">
            <span className="qris-gate-price-label">Total Pembayaran</span>
            <span className="qris-gate-price-value">
              <span className="qris-gate-price-currency">Rp</span>
              {formattedPrice}
            </span>
          </div>

          <div className="qris-gate-instruction">
            <span className="qris-gate-instruction-title">Cara Bayar:</span>
            <ol>
              <li>Buka app e-wallet / m-banking</li>
              <li>Pilih menu "Scan QRIS"</li>
              <li>Scan QR di samping</li>
              <li>Masukkan nominal <strong>Rp {formattedPrice}</strong></li>
            </ol>
          </div>

          <div className="qris-gate-actions">
            <button type="button" className="qris-gate-cancel" onClick={onCancel}>
              <X size={16} /> BATAL
            </button>
            <button type="button" className="qris-gate-confirm" onClick={onConfirm}>
              <Check size={16} /> SUDAH BAYAR
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}