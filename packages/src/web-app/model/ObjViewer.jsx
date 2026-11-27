/*!************************************************************************
\file ObjViewer.jsx
\author Xiong Yang
\par DP email: xiong.yang@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 16-11-2026
\brief
Shows a Wavefront .obj in the browser with three.js. The file is downloaded
and parsed in objParser.worker.js, so large scan exports don't freeze the
page. Meshes with vertex colours (the engine's and the web app's .obj
export) are drawn unlit, so they show the captured colours like the
engine's .glb export; meshes without colours are lit and grey. A file with
no faces (a points export) is drawn as a point cloud. Orbit controls match
the other viewers: drag to orbit, right-drag to pan, scroll to zoom.
- ObjViewer({ url, sizeBytes, isEmbedded, onInfo })
url: the .obj (a blob: URL for a file from the user's computer).
sizeBytes: used for download progress if the server sends no length.
isEmbedded draws it inside its parent (which must be position: relative)
instead of over the whole page. onInfo({ vertexCount, triangleCount }) is
called once the model is loaded.
**************************************************************************/

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Camera direction from the model's centre when the view is reset.
const VIEW_DIRECTION = new THREE.Vector3(-0.55, 0.35, 1).normalize();

// Centre and radius to frame. Scan exports often have a few stray splats far
// away, so this frames the 2nd to 98th percentile of the vertices on each
// axis (from a sample) instead of the full bounding sphere.
function framingBounds(positions) {
    const vertexCount = positions.length / 3;
    const step = Math.max(1, Math.floor(vertexCount / 50000));
    const axes = [[], [], []];
    for (let i = 0; i < vertexCount; i += step) {
        for (let a = 0; a < 3; ++a) {
            const v = positions[i * 3 + a];
            if (Number.isFinite(v)) axes[a].push(v);
        }
    }
    if (axes[0].length === 0) return { center: new THREE.Vector3(), radius: 1 };
    const lo = new THREE.Vector3();
    const hi = new THREE.Vector3();
    axes.forEach((values, a) => {
        values.sort((x, y) => x - y);
        lo.setComponent(a, values[Math.floor((values.length - 1) * 0.02)]);
        hi.setComponent(a, values[Math.ceil((values.length - 1) * 0.98)]);
    });
    const radius = hi.distanceTo(lo) / 2;
    return { center: lo.add(hi).multiplyScalar(0.5), radius: radius > 0 ? radius : 1 };
}

function ObjViewer({ url, sizeBytes, isEmbedded = false, onInfo }) {
    const containerRef = useRef(null);
    const sceneRef = useRef(null); // { resetView, setWireframe }
    const onInfoRef = useRef(onInfo);
    const [status, setStatus] = useState({ phase: 'download', progress: null });
    const [isWireframe, setIsWireframe] = useState(false);

    useEffect(() => {
        onInfoRef.current = onInfo;
    }, [onInfo]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container || !url) return undefined;
        let disposed = false;
        setStatus({ phase: 'download', progress: null });
        setIsWireframe(false);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none';
        container.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        scene.add(new THREE.HemisphereLight(0xffffff, 0x404048, 1.6));
        const sun = new THREE.DirectionalLight(0xffffff, 1.8);
        sun.position.set(0.6, 1, 0.8);
        scene.add(sun);

        const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
        camera.position.set(-1.5, 1, 3);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.1;
        controls.screenSpacePanning = true;

        let object = null;
        let bounds = null;

        function resetView() {
            if (!bounds) return;
            const distance = bounds.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.1;
            camera.position.copy(bounds.center).addScaledVector(VIEW_DIRECTION, distance);
            camera.near = Math.max(distance / 1000, 1e-4);
            camera.far = distance * 100;
            camera.updateProjectionMatrix();
            controls.target.copy(bounds.center);
            controls.update();
        }

        function resize() {
            const width = container.clientWidth || 1;
            const height = container.clientHeight || 1;
            renderer.setSize(width, height, false);
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
        }
        resize();
        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(container);

        let frame = 0;
        function tick() {
            frame = requestAnimationFrame(tick);
            controls.update();
            renderer.render(scene, camera);
        }
        tick();

        sceneRef.current = {
            resetView,
            setWireframe(on) {
                if (object?.material && 'wireframe' in object.material) object.material.wireframe = on;
            },
        };

        const worker = new Worker(new URL('./objParser.worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => {
            if (disposed) return;
            if (data.type === 'progress') {
                setStatus({ phase: 'download', progress: data.fraction });
                return;
            }
            worker.terminate();
            if (data.type === 'error') {
                setStatus({ phase: 'error', message: data.message });
                return;
            }

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
            if (data.colors) geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
            bounds = framingBounds(data.positions);
            const { radius } = bounds;

            if (data.indices) {
                geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
                const material = data.colors
                    ? new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })
                    : new THREE.MeshStandardMaterial({ color: 0xb8bcc6, roughness: 0.75, side: THREE.DoubleSide });
                if (!data.colors) geometry.computeVertexNormals();
                object = new THREE.Mesh(geometry, material);
            } else {
                const material = new THREE.PointsMaterial({
                    size: radius * 0.004,
                    vertexColors: Boolean(data.colors),
                    color: data.colors ? 0xffffff : 0xb8bcc6,
                });
                object = new THREE.Points(geometry, material);
            }
            scene.add(object);
            resetView();
            setStatus({
                phase: 'ready',
                isPoints: !data.indices,
                vertexCount: data.vertexCount,
                triangleCount: data.triangleCount,
            });
            onInfoRef.current?.({ vertexCount: data.vertexCount, triangleCount: data.triangleCount });
        };
        worker.onerror = (event) => {
            if (!disposed) setStatus({ phase: 'error', message: event.message || 'Couldn\'t read this .obj.' });
        };
        worker.postMessage({ url: new URL(url, window.location.href).href, sizeHint: sizeBytes });

        return () => {
            disposed = true;
            worker.terminate();
            cancelAnimationFrame(frame);
            resizeObserver.disconnect();
            controls.dispose();
            if (object) {
                object.geometry.dispose();
                object.material.dispose();
            }
            renderer.dispose();
            renderer.domElement.remove();
            sceneRef.current = null;
        };
    }, [url, sizeBytes]);

    let message = null;
    if (status.phase === 'download') {
        message = status.progress == null ? 'Loading model…' : `Loading model… ${Math.round(status.progress * 100)}%`;
    } else if (status.phase === 'error') {
        message = status.message;
    }

    const overlayPosition = isEmbedded ? 'absolute' : 'fixed';

    return (
        <>
            <div
                ref={containerRef}
                style={isEmbedded
                    ? { position: 'absolute', inset: 0, width: '100%', height: '100%' }
                    : { position: 'fixed', inset: 0, width: '100vw', height: '100vh' }}
            />
            {message && (
                <div
                    className="genesis-overlay"
                    role="status"
                    style={{
                        position: overlayPosition,
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        padding: '12px 18px',
                        borderRadius: 8,
                        background: 'rgba(0, 0, 0, 0.6)',
                        color: status.phase === 'error' ? '#ff9b9b' : '#f4fbfd',
                        zIndex: 10,
                        pointerEvents: 'none',
                    }}
                >
                    {message}
                </div>
            )}
            {status.phase === 'ready' && (
                <div
                    className="genesis-overlay engine-viewer-controls"
                    style={{ position: overlayPosition, bottom: isEmbedded ? 12 : 16, right: isEmbedded ? 12 : 16, display: 'flex', gap: 8, alignItems: 'center', zIndex: 10 }}
                >
                    <span className="engine-viewer-count" style={{ color: '#f4fbfd', fontSize: 13, opacity: 0.8, marginRight: 4 }}>
                        {status.isPoints
                            ? `${status.vertexCount.toLocaleString()} points`
                            : `${status.triangleCount.toLocaleString()} triangles`}
                    </span>
                    {!status.isPoints && (
                        <button
                            className={`btn ${isWireframe ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => {
                                const next = !isWireframe;
                                setIsWireframe(next);
                                sceneRef.current?.setWireframe(next);
                            }}
                        >
                            Wireframe
                        </button>
                    )}
                    <button className="btn btn-ghost" onClick={() => sceneRef.current?.resetView()}>
                        Reset view
                    </button>
                </div>
            )}
        </>
    );
}

export default ObjViewer;
