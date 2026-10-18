import { useState, useEffect } from 'react';
import { Folder, X, Loader2 } from 'lucide-react';
import { listDriveFolders, type DriveFolder } from '../gdriveService';

interface FolderPickerProps {
  clientId: string;
  onSelect: (folder: DriveFolder) => void;
  onClose: () => void;
}

export function FolderPicker({ clientId, onSelect, onClose }: FolderPickerProps) {
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void listDriveFolders(clientId)
      .then(setFolders)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [clientId]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#1a1614', width: '100%', maxWidth: 450, borderRadius: 16, border: '1px solid #333', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '80vh' }}>
        
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, color: '#fff', fontSize: 16 }}>Pilih Folder Utama</h3>
          <button onClick={onClose} style={{ background: 'none', border: 0, color: '#fff', cursor: 'pointer' }}><X size={20} /></button>
        </div>

        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
          {loading && <div style={{ color: '#aaa', textAlign: 'center', padding: 20 }}><Loader2 className="animate-spin mx-auto mb-2" size={24} /> Memuat folder...</div>}
          {error && <div style={{ color: '#ef3f25', textAlign: 'center' }}>{error}</div>}
          
          {!loading && !error && folders.map((f) => (
            <button
              key={f.id}
              onClick={() => onSelect(f)}
              style={{ width: '100%', padding: 14, background: 'rgba(255,255,255,0.05)', border: '1px solid transparent', borderRadius: 8, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12, color: '#fff', cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s' }}
              onMouseOver={(e) => e.currentTarget.style.borderColor = '#ef3f25'}
              onMouseOut={(e) => e.currentTarget.style.borderColor = 'transparent'}
            >
              <Folder size={20} color="#ef3f25" />
              <span style={{ fontSize: 14, fontWeight: 500 }}>{f.name}</span>
            </button>
          ))}
          
          {!loading && !error && folders.length === 0 && (
            <div style={{ color: '#aaa', textAlign: 'center', padding: 20 }}>Tidak ada folder ditemukan di Drive kamu.</div>
          )}
        </div>
      </div>
    </div>
  );
}