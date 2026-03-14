import { useRef, useEffect } from 'react';

type SignatureEditorProps = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
};

/**
 * Rich signature editor: text + paste/insert images (stored as data URLs in HTML).
 */
export function SignatureEditor({ value, onChange, placeholder = 'Best regards,\nYour Name\nYUCG', className = '', minHeight = '120px' }: SignatureEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync external value into the editor (e.g. when loading from API)
  useEffect(() => {
    if (ref.current == null) return;
    const current = ref.current.innerHTML;
    const normalized = (value || '').trim();
    // Avoid overwriting while user is typing (same content)
    if (normalized === '' && current === '') return;
    if (normalized !== '' && current === normalized) return;
    if (normalized !== current) {
      ref.current.innerHTML = normalized || '';
    }
  }, [value]);

  const handleInput = () => {
    if (ref.current) onChange(ref.current.innerHTML);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const img = document.createElement('img');
          img.src = dataUrl;
          img.style.maxWidth = '200px';
          img.style.height = 'auto';
          img.alt = 'Signature';
          document.execCommand('insertHTML', false, img.outerHTML);
          if (ref.current) onChange(ref.current.innerHTML);
        };
        reader.readAsDataURL(file);
        return;
      }
    }
  };

  const insertImageFromFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = document.createElement('img');
      img.src = dataUrl;
      img.style.maxWidth = '200px';
      img.style.height = 'auto';
      img.alt = 'Signature';
      if (ref.current) {
        ref.current.focus();
        document.execCommand('insertHTML', false, img.outerHTML);
        onChange(ref.current.innerHTML);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="text-sm px-3 py-1.5 rounded-lg border border-pale-sky bg-white hover:bg-pale-sky/30 text-deep-navy"
        >
          Insert image
        </button>
        <span className="text-xs text-slate-500">Paste an image (Ctrl+V) or use the button. Images are embedded in your signature.</span>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && file.type.startsWith('image/')) insertImageFromFile(file);
          e.target.value = '';
        }}
      />
      <div className="relative">
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onPaste={handlePaste}
        className={`w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-800 overflow-auto ${className}`}
        style={{ minHeight }}
      />
      {(!value || value.trim() === '') && (
        <span className="absolute left-3 top-2 text-slate-400 pointer-events-none text-sm">
          {placeholder.split('\n')[0]}
        </span>
      )}
    </div>
    </div>
  );
}
