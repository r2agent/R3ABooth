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
        <div className="qris-gate-header">
          <div className="qris-gate-icon">
            <QrCode size={28} strokeWidth={2} />
          </div>
          <h2>SCAN & PAY WITH DANA</h2>
          <p>Scan QRIS di bawah pakai DANA, OVO, GoPay, ShopeePay, atau bank apapun</p>
        </div>

        <div className="qris-gate-qr">
          {qrisImageUrl ? (
            <img src={qrisImageUrl} alt="QRIS DANA" />
          ) : (
            <div className="qris-gate-qr-placeholder">
              <QrCode size={96} strokeWidth={1} />
              <span>QRIS belum di-set</span>
              <small>Upload di Settings → Payment</small>
            </div>
          )}
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
            <li>Buka app DANA / e-wallet / m-banking</li>
            <li>Tap menu "Scan QRIS"</li>
            <li>Scan QR di atas</li>
            <li>Masukkan nominal <strong>Rp {formattedPrice}</strong></li>
            <li>Selesaikan pembayaran</li>
          </ol>
        </div>

        <div className="qris-gate-actions">
          <button
            type="button"
            className="qris-gate-cancel"
            onClick={onCancel}
          >
            <X size={18} /> BATAL
          </button>
          <button
            type="button"
            className="qris-gate-confirm"
            onClick={onConfirm}
          >
            <Check size={18} /> SAYA SUDAH BAYAR
          </button>
        </div>

        <p className="qris-gate-note">
          ⚠️ Pastikan sudah bayar sebelum lanjut. Booth tidak bertanggung jawab jika belum bayar tapi tetap lanjut.
        </p>
      </div>
    </div>
  );
}