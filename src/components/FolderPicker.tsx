import { useEffect, useState, useMemo } from 'react';
import { X, Folder, Search, ArrowUpDown, Loader2 } from 'lucide-react';
// Pastikan getToken memang diexport dari pkceAuth.ts
import { getToken } from '../pkceAuth'; 

type DriveFolder = {
  id: string;
  name: string;
  createdTime?: string;
  modifiedTime?: string;
};

type FolderPickerProps = {
  clientId: string;
  onSelect: (folder: { id: string; name: string }) => void;
  onClose: () => void;
};

export function FolderPicker({ clientId, onSelect, onClose }: FolderPickerProps) {
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'az'>('newest');

  useEffect(() => {
    async function fetchFolders() {
      try {
        setLoading(true);
        
        // 🔧 FIX: Memanggil fungsi getToken() yang sudah di-import
        const token = getToken(); 
        
        if (!token) throw new Error('Token Google Drive tidak ditemukan. Silakan connect ulang.');

        // Ambil folder dari Google Drive API
        const response = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=mimeType='application/vnd.google-apps.folder'+and+trashed=false&fields=files(id,name,createdTime,modifiedTime)&pageSize=1000`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        if (!response.ok) {
          throw new Error('Gagal mengambil folder dari Google Drive');
        }

        const data = await response.json();
        setFolders(data.files || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    void fetchFolders();
  }, [clientId]);

  // LOGIKA FILTER & SORTIR
  const filteredAndSortedFolders = useMemo(() => {
    let result = [...folders];

    if (searchQuery.trim()) {
      const lowerQuery = searchQuery.toLowerCase();
      result = result.filter((f) => f.name.toLowerCase().includes(lowerQuery));
    }

    result.sort((a, b) => {
      if (sortBy === 'az') {
        return a.name.localeCompare(b.name);
      }
      
      const timeA = new Date(a.createdTime || a.modifiedTime || 0).getTime();
      const timeB = new Date(b.createdTime || b.modifiedTime || 0).getTime();
      
      if (sortBy === 'newest') {
        return timeB - timeA;
      } else {
        return timeA - timeB;
      }
    });

    return result;
  }, [folders, searchQuery, sortBy]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)' }}>
      <div style={{ width: '100%', maxWidth: 480, maxHeight: '85vh', background: '#2a2a2a', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)' }}>
        
        {/* HEADER */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #444' }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#fff', margin: 0 }}>Pilih Folder Utama</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer', padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        {/* SEARCH & SORT CONTROLS */}
        <div style={{ padding: '12px 20px', display: 'flex', gap: 10, borderBottom: '1px solid #444', background: '#222' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#888' }} />
            <input
              type="text"
              placeholder="Cari folder..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '100%', padding: '8px 10px 8px 34px', background: '#333', border: '1px solid #555', borderRadius: 6, color: '#fff', fontSize: 14, outline: 'none' }}
            />
          </div>
          <div style={{ position: 'relative' }}>
            <ArrowUpDown size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#888', pointerEvents: 'none' }} />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              style={{ padding: '8px 10px 8px 30px', background: '#333', border: '1px solid #555', borderRadius: 6, color: '#fff', fontSize: 14, outline: 'none', cursor: 'pointer', appearance: 'none' }}
            >
              <option value="newest">Terbaru</option>
              <option value="oldest">Terlama</option>
              <option value="az">A - Z</option>
            </select>
          </div>
        </div>

        {/* LIST FOLDER */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, color: '#aaa' }}>
              <Loader2 size={24} className="animate-spin" style={{ marginBottom: 10 }} />
              Memuat folder...
            </div>
          ) : error ? (
            <div style={{ color: '#f87171', textAlign: 'center', padding: 20 }}>{error}</div>
          ) : filteredAndSortedFolders.length === 0 ? (
            <div style={{ color: '#aaa', textAlign: 'center', padding: 20 }}>Folder tidak ditemukan.</div>
          ) : (
            filteredAndSortedFolders.map((folder) => (
              <button
                key={folder.id}
                onClick={() => onSelect({ id: folder.id, name: folder.name })}
                style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '12px 14px', background: '#333', border: '1px solid #444', borderRadius: 8, color: '#fff', fontSize: 14, cursor: 'pointer', textAlign: 'left', transition: 'background 0.2s' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#444')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#333')}
              >
                <Folder size={18} style={{ color: '#facc15', flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folder.name}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}