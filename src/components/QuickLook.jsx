import { useState, useEffect, useCallback, useMemo } from 'react';
import { HexViewer } from './HexViewer.jsx';
import { TexPreview } from './TexPreview.jsx';
import { PModelPreview } from './PModelPreview.jsx';
import { SkeletonPreview } from './SkeletonPreview.jsx';
import { HRCPreview } from './HRCPreview.jsx';
import { RSDPreview } from './RSDPreview.jsx';
import { formatFileSize, isBattleTexFile, isPModelFile, isBattleSkeletonFile, isHRCFile, isRSDFile } from '../utils/fileTypes.ts';
import './QuickLook.css';

const HEX_COLUMN_WIDTHS = {
  16: 660,
  24: 920,
  32: 1180,
};

// SVG Icons
const DockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="1" y="2" width="6" height="12" rx="1" />
    <rect x="9" y="2" width="6" height="12" rx="1" />
  </svg>
);

const ExpandIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
  </svg>
);

export function QuickLook({ filename, data, onClose, onLoadFile, mode = 'modal', onDock, onUndock }) {
  const isTexFile = filename.toLowerCase().endsWith('.tex') || isBattleTexFile(filename);
  const isPFile = isPModelFile(filename);
  const isSkeletonFile = isBattleSkeletonFile(filename);
  const isHRC = isHRCFile(filename);
  const isRSD = isRSDFile(filename);
  const [hexColumns, setHexColumns] = useState(16);

  const modalWidth = useMemo(() => {
    if (isTexFile) return 900;
    if (isPFile) return 900;
    if (isSkeletonFile) return 900;
    if (isHRC) return 900;
    if (isRSD) return 900;
    return HEX_COLUMN_WIDTHS[hexColumns] || 900;
  }, [isTexFile, isPFile, isSkeletonFile, isHRC, isRSD, hexColumns]);

  const handleKeyDown = useCallback((e) => {
    // Close on Escape/Space in both modes
    if (e.key === 'Escape' || e.key === ' ') {
      e.preventDefault();
      onClose();
    }
  }, [onClose]);

  const handleOverlayClick = useCallback((e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const content = (
    <>
      <div className="quicklook-header">
        <h2 className="quicklook-title">{filename} <span>(preview)</span></h2>
        <div className="quicklook-header-buttons">
          {mode === 'modal' && onDock && (
            <button className="quicklook-button" onClick={onDock} title="Dock on the side">
              <DockIcon />
            </button>
          )}
          {mode === 'docked' && onUndock && (
            <button className="quicklook-button" onClick={onUndock} title="Fullscreen view">
              <ExpandIcon />
            </button>
          )}
          <button className="quicklook-button" onClick={onClose} title="Close (Esc)">
            ×
          </button>
        </div>
      </div>

      <div className="quicklook-content">
        {isTexFile ? (
          <TexPreview data={data} filename={filename} />
        ) : isPFile ? (
          <PModelPreview data={data} />
        ) : isSkeletonFile ? (
          <SkeletonPreview data={data} filename={filename} onLoadFile={onLoadFile} />
        ) : isHRC ? (
          <HRCPreview data={data} filename={filename} onLoadFile={onLoadFile} />
        ) : isRSD ? (
          <RSDPreview data={data} onLoadFile={onLoadFile} />
        ) : (
          <HexViewer data={data} columns={hexColumns} onColumnsChange={setHexColumns} />
        )}
      </div>

      <div className="quicklook-footer">
        <span>{formatFileSize(data.length)}</span>
        {isTexFile && <span>TEX Image</span>}
        {isPFile && <span>3D Model</span>}
        {isSkeletonFile && <span>Battle Skeleton</span>}
        {isHRC && <span>Field Skeleton</span>}
        {isRSD && <span>Resource Definition</span>}
        {!isTexFile && !isPFile && !isSkeletonFile && !isHRC && !isRSD && <span>Hex View</span>}
      </div>
    </>
  );

  if (mode === 'docked') {
    return (
      <div className="quicklook-docked">
        {content}
      </div>
    );
  }

  return (
    <div className="quicklook-overlay" onClick={handleOverlayClick}>
      <div className="quicklook-modal" style={{ maxWidth: modalWidth }}>
        {content}
      </div>
    </div>
  );
}
