import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload } from 'lucide-react';

/** Opens the file picker, then hands the chosen file to the import screen. */
export function ImportButton({ className = 'btn ghost small' }: { className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  return (
    <>
      <button className={className} onClick={() => input.current?.click()} title="Import cards from a CSV, text file or Anki deck">
        <Upload size={16} /> Import
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept=".csv,.tsv,.txt,.text,.apkg,.colpkg,text/csv,text/plain,text/tab-separated-values"
        aria-label="Choose a file to import"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) navigate('/import', { state: { file } });
        }}
      />
    </>
  );
}
