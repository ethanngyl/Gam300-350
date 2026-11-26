/*!************************************************************************
\file ExportObjDialog.jsx
\author Xiong Yang
\par DP email: xiong.yang@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 16-11-2026
\brief
"Export .obj" dialog on the model page. Same options as the engine's Export
dialog (ExportDialog.cpp) for Wavefront OBJ: geometry (points or one
ellipsoid per splat), mesh detail, splat size in standard deviations and
minimum opacity, with the same "Up to N vertices" estimate. The last-used
options are remembered per browser. Exporting runs plyToObj.worker.js (so
the page stays responsive), shows its progress, then downloads the .obj.
- ExportObjDialog({ plyUrl, fileName, splatCount, sizeBytes, onClose })
plyUrl: the .ply to convert (server path or blob: URL). fileName: the
download's name without extension. splatCount (optional) feeds the
estimate.
**************************************************************************/

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { OBJ_EXPORT_DEFAULTS, objExportEstimate } from './plyToObj.js';
import { playSound } from '../audio/Audio.js';

const OPTIONS_KEY = 'genesis.objExportOptions';

function readSavedOptions() {
    try {
        const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? 'null');
        return saved && typeof saved === 'object' ? { ...OBJ_EXPORT_DEFAULTS, ...saved } : { ...OBJ_EXPORT_DEFAULTS };
    } catch {
        return { ...OBJ_EXPORT_DEFAULTS };
    }
}

function saveOptions(options) {
    try {
        localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
    } catch {
        /* storage blocked, the options just aren't remembered */
    }
}

function clamp(value, min, max, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

function formatSize(bytes) {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function ExportObjDialog({ plyUrl, fileName, splatCount, sizeBytes, onClose }) {
    const [options, setOptions] = useState(readSavedOptions);
    // idle | working | done | error
    const [status, setStatus] = useState('idle');
    const [progress, setProgress] = useState({ stage: 'download', fraction: null });
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const workerRef = useRef(null);
    const downloadUrlRef = useRef(null);
    const confirmRef = useRef(null);

    const isMesh = options.geometry === 'mesh';
    const isWorking = status === 'working';
    const downloadName = `${(fileName || 'model').replace(/[^\w.-]+/g, '_')}.obj`;

    useEffect(() => {
        confirmRef.current?.focus();
        return () => {
            workerRef.current?.terminate();
            if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
        };
    }, []);

    function update(changes) {
        setOptions((current) => ({ ...current, ...changes }));
        // New options need a new export, not the last file again.
        if (status === 'done' || status === 'error') {
            setStatus('idle');
            setError(null);
        }
    }

    function close() {
        onClose();
    }

    function download() {
        const link = document.createElement('a');
        link.href = downloadUrlRef.current;
        link.download = downloadName;
        document.body.appendChild(link);
        link.click();
        link.remove();
    }

    function startExport(event) {
        event.preventDefault();
        if (status === 'done') {
            download();
            return;
        }
        const cleanOptions = {
            geometry: options.geometry === 'points' ? 'points' : 'mesh',
            highDetail: Boolean(options.highDetail),
            sigmaScale: clamp(options.sigmaScale, 0.25, 4, OBJ_EXPORT_DEFAULTS.sigmaScale),
            minAlpha: clamp(options.minAlpha, 0, 0.99, OBJ_EXPORT_DEFAULTS.minAlpha),
        };
        setOptions(cleanOptions);
        saveOptions(cleanOptions);
        setStatus('working');
        setError(null);
        setProgress({ stage: 'download', fraction: null });

        const worker = new Worker(new URL('./plyToObj.worker.js', import.meta.url), { type: 'module' });
        workerRef.current = worker;
        worker.onmessage = ({ data }) => {
            if (data.type === 'progress') {
                setProgress({ stage: data.stage, fraction: data.fraction });
                return;
            }
            worker.terminate();
            workerRef.current = null;
            if (data.type === 'done') {
                if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
                downloadUrlRef.current = URL.createObjectURL(data.blob);
                setResult({ ...data, sizeBytes: data.blob.size });
                setStatus('done');
                download();
                playSound('save');
            } else {
                setError(data.message);
                setStatus('error');
                playSound('error');
            }
        };
        worker.onerror = (event) => {
            worker.terminate();
            workerRef.current = null;
            setError(event.message || 'The export failed.');
            setStatus('error');
            playSound('error');
        };
        // A worker resolves relative URLs against its own script, so pass an absolute one.
        worker.postMessage({ url: new URL(plyUrl, window.location.href).href, sizeHint: sizeBytes, options: cleanOptions });
    }

    function cancelExport() {
        workerRef.current?.terminate();
        workerRef.current = null;
        setStatus('idle');
    }

    function handleKeyDown(event) {
        // Keep typing away from window-level shortcuts (the splat viewer's).
        event.stopPropagation();
        if (event.key === 'Escape') {
            if (isWorking) cancelExport();
            else close();
        }
    }

    let estimate = null;
    if (splatCount > 0) {
        const { vertices, triangles } = objExportEstimate(splatCount, options);
        estimate = isMesh
            ? `Up to ${vertices.toLocaleString()} vertices and ${triangles.toLocaleString()} triangles`
            : `Up to ${vertices.toLocaleString()} points`;
        if (Number(options.minAlpha) > 0) estimate += ' (fewer after the opacity filter)';
        estimate += '.';
    }

    const percent = progress.fraction == null ? null : Math.round(progress.fraction * 100);
    const progressText = progress.stage === 'download'
        ? `Downloading the .ply${percent == null ? '...' : ` ${percent}%`}`
        : `Converting${percent == null ? '...' : ` ${percent}%`}`;
    // Download is the first quarter of the bar, conversion the rest.
    const barFraction = progress.stage === 'download'
        ? (progress.fraction ?? 0) * 0.25
        : 0.25 + (progress.fraction ?? 0) * 0.75;

    return createPortal(
        <div className="action-dialog-backdrop" onPointerDown={() => !isWorking && close()}>
            <form
                className="forma-card action-dialog export-obj-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="export-obj-title"
                onSubmit={startExport}
                onPointerDown={(event) => event.stopPropagation()}
                onKeyDown={handleKeyDown}
            >
                <h3 id="export-obj-title">Export as .obj</h3>
                <p className="action-dialog-message">
                    Wavefront OBJ with vertex colours. Opens in almost every 3D tool; large and slow for big scans.
                </p>

                <fieldset className="export-obj-fields" disabled={isWorking}>
                    <label>
                        <span>Geometry</span>
                        <select value={options.geometry} onChange={(e) => update({ geometry: e.target.value })}>
                            <option value="mesh">Mesh (one ellipsoid per splat)</option>
                            <option value="points">Points (one vertex per splat)</option>
                        </select>
                    </label>
                    <label>
                        <span>Mesh detail</span>
                        <select
                            value={options.highDetail ? 'high' : 'low'}
                            disabled={!isMesh}
                            onChange={(e) => update({ highDetail: e.target.value === 'high' })}
                        >
                            <option value="low">Low (8 triangles per splat)</option>
                            <option value="high">High (20 triangles per splat)</option>
                        </select>
                    </label>
                    <label title="Ellipsoid radius in standard deviations of each Gaussian. Larger values close gaps but make the surface look blobby.">
                        <span>Splat size (σ)</span>
                        <input
                            type="number"
                            min="0.25"
                            max="4"
                            step="0.25"
                            value={options.sigmaScale}
                            disabled={!isMesh}
                            onChange={(e) => update({ sigmaScale: e.target.value })}
                        />
                    </label>
                    <label title="Skip splats more transparent than this. Faint splats are mostly haze and make mesh exports much larger.">
                        <span>Min opacity</span>
                        <input
                            type="number"
                            min="0"
                            max="0.99"
                            step="0.05"
                            value={options.minAlpha}
                            onChange={(e) => update({ minAlpha: e.target.value })}
                        />
                    </label>
                </fieldset>

                {estimate && status === 'idle' && <p className="export-obj-note">{estimate}</p>}

                {isWorking && (
                    <div className="export-obj-progress" aria-live="polite">
                        <div className="export-obj-bar"><span style={{ width: `${barFraction * 100}%` }} /></div>
                        <p className="export-obj-note">{progressText}</p>
                    </div>
                )}

                {status === 'done' && result && (
                    <p className="export-obj-note export-obj-done">
                        Exported {result.splatCount.toLocaleString()} splats as {result.vertexCount.toLocaleString()} vertices
                        {result.triangleCount > 0 && ` and ${result.triangleCount.toLocaleString()} triangles`}
                        {' '}({formatSize(result.sizeBytes)}). Your download should have started.
                    </p>
                )}

                {error && <p className="action-dialog-error">{error}</p>}

                <div className="action-dialog-buttons">
                    {isWorking ? (
                        <button type="button" className="forma-btn" onClick={cancelExport}>Cancel</button>
                    ) : (
                        <button type="button" className="forma-btn" onClick={close}>
                            {status === 'done' ? 'Close' : 'Cancel'}
                        </button>
                    )}
                    <button ref={confirmRef} type="submit" className="forma-btn forma-btn-primary" disabled={isWorking}>
                        {isWorking ? 'Exporting...' : status === 'done' ? 'Download again' : 'Export'}
                    </button>
                </div>
            </form>
        </div>,
        document.body
    );
}

export default ExportObjDialog;
